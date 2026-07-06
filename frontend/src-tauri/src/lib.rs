// Desktop shell: starts the bundled Python backend (PyInstaller sidecar) on a
// free localhost port, tells the app data dir where to persist, exposes the
// port to the frontend via the `backend_port` command, and kills the backend
// when the window closes.
use std::net::TcpListener;
use std::sync::Mutex;

use tauri::{Manager, State, WindowEvent};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct Backend {
    port: u16,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn backend_port(state: State<Backend>) -> u16 {
    state.port
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
        .setup(move |app| {
            // Persist connection/mapping profiles in the OS app-data folder.
            let data_dir = app.path().app_data_dir().unwrap_or_default();
            let _ = std::fs::create_dir_all(&data_dir);

            let sidecar = app
                .shell()
                .sidecar("migration-backend")
                .expect("sidecar binary 'migration-backend' not found")
                .args([port.to_string()])
                .env("DBMS_DATA_DIR", data_dir.to_string_lossy().to_string());

            let (mut rx, child) = sidecar.spawn().expect("failed to spawn backend sidecar");
            app.manage(Backend {
                port,
                child: Mutex::new(Some(child)),
            });

            // Drain the sidecar's stdout/stderr so its pipe never fills up.
            tauri::async_runtime::spawn(async move {
                while rx.recv().await.is_some() {}
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
        .invoke_handler(tauri::generate_handler![backend_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
