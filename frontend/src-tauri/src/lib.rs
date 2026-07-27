// Desktop shell: starts the bundled Python backend (PyInstaller sidecar) on a
// free localhost port, tells the app data dir where to persist, exposes the
// port to the frontend via the `backend_port` command, and kills the backend
// when the window closes.
use std::net::TcpListener;
use std::sync::Mutex;

use tauri::{Manager, State, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct Backend {
    port: u16,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn backend_port(state: State<Backend>) -> u16 {
    state.port
}

// Open a URL in the user's default browser. In the Tauri webview a plain
// window.open / <a target="_blank"> does nothing, so the frontend routes
// external links (e.g. the "Update available" download page) through here.
// Uses the per-OS opener directly — no extra plugin/permission needed.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("refusing to open non-http(s) url".into());
    }
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn();
    #[cfg(target_os = "linux")]
    let spawned = std::process::Command::new("xdg-open").arg(&url).spawn();
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8000)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = free_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            // Persist connection/mapping profiles in the OS app-data folder.
            let data_dir = app.path().app_data_dir().unwrap_or_default();

            // One-time migration: earlier builds shipped under the
            // `net.fiberathome.keeldb` identifier. If that folder still exists
            // and the new one doesn't, move it so upgraders keep their saved
            // connections, encryption key, and unlock password.
            if let Some(parent) = data_dir.parent() {
                let legacy = parent.join("net.fiberathome.keeldb");
                if legacy.is_dir() && !data_dir.exists() {
                    let _ = std::fs::rename(&legacy, &data_dir);
                }
            }
            let _ = std::fs::create_dir_all(&data_dir);

            let mut sidecar = app
                .shell()
                .sidecar("keeldb-backend")
                .expect("sidecar binary 'keeldb-backend' not found")
                .args([port.to_string()]);
            // Only pass the data dir when we actually resolved one — an empty
            // value would make the backend fall back to its own default rather
            // than treating "" as a real (and wrong) path.
            let data_dir_str = data_dir.to_string_lossy().to_string();
            if !data_dir_str.is_empty() {
                sidecar = sidecar.env("DBMS_DATA_DIR", data_dir_str);
            }

            let (mut rx, child) = sidecar.spawn().expect("failed to spawn backend sidecar");
            app.manage(Backend {
                port,
                child: Mutex::new(Some(child)),
            });

            // Drain the sidecar's stdout/stderr (so its pipe never fills up) AND
            // tee it to <data_dir>/backend.log. Without this the sidecar's output
            // is lost, so a backend that starts then crashes leaves no trace —
            // the log captures the traceback and the Terminated exit code/signal.
            let log_path = data_dir.join("backend.log");
            tauri::async_runtime::spawn(async move {
                use std::io::Write;
                let mut log = std::fs::File::create(&log_path).ok();
                let mut write = |s: String| {
                    if let Some(f) = log.as_mut() {
                        let _ = f.write_all(s.as_bytes());
                        let _ = f.flush();
                    }
                };
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                            write(String::from_utf8_lossy(&b).into_owned())
                        }
                        CommandEvent::Error(e) => write(format!("[sidecar error] {e}\n")),
                        CommandEvent::Terminated(p) => write(format!(
                            "[sidecar terminated] code={:?} signal={:?}\n",
                            p.code, p.signal
                        )),
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<Backend>() {
                    if let Some(child) = state.child.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![backend_port, open_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
