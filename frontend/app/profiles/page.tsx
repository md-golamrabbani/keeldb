"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useWizard } from "@/lib/store";
import type { MappingProfile, MigrationProject } from "@/lib/types";
import ProjectRunPanel from "@/components/ProjectRunPanel";
import PortabilityBar from "@/components/PortabilityBar";
import { IconBookmark, IconLayers, IconPlay, IconPlus, IconTrash } from "@/components/icons";

const OUTPUT_LABEL: Record<string, string> = { push: "push", sql: ".sql", csv: ".csv", json: ".json" };

export default function ProfilesPage() {
  const [mappings, setMappings] = useState<MappingProfile[]>([]);
  const [projects, setProjects] = useState<MigrationProject[]>([]);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [projName, setProjName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [runProject, setRunProject] = useState<MigrationProject | null>(null);
  const router = useRouter();
  const w = useWizard();

  const refresh = () => {
    api.listMappings().then(setMappings).catch((e) => setError(String(e)));
    api.listProjects().then(setProjects).catch((e) => setError(String(e)));
  };
  useEffect(() => { refresh(); }, []);

  const mapById = useMemo(() => new Map(mappings.map((m) => [m.id, m])), [mappings]);
  const toggleSel = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const createProject = async () => {
    try {
      await api.saveProject({ name: projName || "Untitled project", mapping_ids: selected });
      setShowForm(false); setProjName(""); setSelected([]); refresh();
    } catch (e) { setError(String(e)); }
  };
  const removeProject = async (p: MigrationProject) => {
    if (!confirm(`Delete project "${p.name}"?`)) return;
    await api.deleteProject(p.id); refresh();
  };

  const load = (m: MappingProfile) => {
    w.reset();
    w.setSource({ connId: m.source_conn_id, schema: m.source_schema, table: m.source_table });
    w.setTarget({ connId: m.target_conn_id, schema: m.target_schema, table: m.target_table });
    w.setColumnMaps(m.column_maps);
    w.setGlobals({
      conflictStrategy: m.conflict_strategy, batchSize: m.batch_size, whereFilter: m.where_filter,
      stopOnError: m.stop_on_error, outputMode: m.output_mode, includeDdl: m.include_ddl,
      mappingName: m.name, loadedMappingId: m.id,
    });
    router.push("/migrate");
  };
  const remove = async (m: MappingProfile) => {
    if (!confirm(`Delete mapping profile "${m.name}"?`)) return;
    await api.deleteMapping(m.id); refresh();
  };

  return (
    <div className="space-y-8">
      <PortabilityBar onImported={refresh} />

      {/* ---- Projects ---- */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Migration Projects</h1>
            <p className="mt-1 text-sm muted">Run several table mappings together, loaded parents-first by foreign keys.</p>
          </div>
          {!showForm && (
            <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={mappings.length === 0}>
              <IconPlus /> New project
            </button>
          )}
        </div>

        {showForm && (
          <div className="card card-pad space-y-3">
            <div>
              <label className="label">Project name</label>
              <input className="input !w-72" value={projName} placeholder="e.g. HRIS migration" onChange={(e) => setProjName(e.target.value)} />
            </div>
            <div>
              <label className="label">Include mappings (checked order = base order; FK order applied at run)</label>
              <div className="card max-h-56 overflow-y-auto p-1.5">
                {mappings.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                    <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggleSel(m.id)} />
                    <span className="flex-1">{m.name}</span>
                    <span className="font-mono text-xs faint">→ {m.target_schema && `${m.target_schema}.`}{m.target_table}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary btn-sm" onClick={createProject} disabled={!projName || selected.length === 0}>Create project</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowForm(false); setSelected([]); setProjName(""); }}>Cancel</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {projects.map((p) => (
            <div key={p.id} className="card card-pad space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 font-medium"><IconLayers width={16} height={16} /> {p.name}</span>
                <span className="badge">{p.mapping_ids.length} tables</span>
              </div>
              <p className="font-mono text-xs muted">
                {p.mapping_ids.map((id) => mapById.get(id)?.target_table ?? "?").join(" · ")}
              </p>
              <div className="flex gap-2 pt-1">
                <button className="btn btn-primary btn-sm" onClick={() => setRunProject(p)}><IconPlay width={12} height={12} /> Run project</button>
                <button className="btn btn-ghost btn-sm" onClick={() => removeProject(p)} aria-label="Delete"><IconTrash width={14} height={14} /></button>
              </div>
            </div>
          ))}
        </div>
        {projects.length === 0 && !showForm && (
          <p className="text-sm muted">No projects yet. {mappings.length === 0 ? "Save some mappings first, then group them into a project." : "Create one to run several tables together."}</p>
        )}
      </section>

      {/* ---- Saved mappings ---- */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Saved Mappings</h2>
          <p className="mt-1 text-sm muted">Reusable single-table mapping profiles — load one to re-run it, or group them into a project above.</p>
        </div>
        {error && <p className="alert-danger">{error}</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {mappings.map((m) => (
            <div key={m.id} className="card card-pad space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.name}</span>
                <div className="flex gap-1.5">
                  <span className="badge badge-accent">{OUTPUT_LABEL[m.output_mode] ?? m.output_mode}</span>
                  <span className="badge">{m.conflict_strategy}</span>
                </div>
              </div>
              <p className="font-mono text-xs muted">
                {m.source_schema && `${m.source_schema}.`}{m.source_table} → {m.target_schema && `${m.target_schema}.`}{m.target_table}
              </p>
              <p className="text-xs faint">
                {m.column_maps.filter((c) => c.enabled && c.target_col).length} columns · batch {m.batch_size}
                {m.where_filter ? ` · WHERE ${m.where_filter}` : ""}
              </p>
              <div className="flex gap-2 pt-1">
                <button className="btn btn-primary btn-sm" onClick={() => load(m)}><IconPlay width={12} height={12} /> Load &amp; run</button>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(m)} aria-label="Delete"><IconTrash width={14} height={14} /></button>
              </div>
            </div>
          ))}
        </div>
        {mappings.length === 0 && !error && (
          <div className="card card-pad flex flex-col items-center gap-2 py-16 text-center">
            <IconBookmark width={28} height={28} />
            <p className="font-medium">No saved migrations yet</p>
            <p className="text-sm muted">Configure one in the Migrate wizard and save it from the Run step.</p>
          </div>
        )}
      </section>

      {runProject && <ProjectRunPanel projectId={runProject.id} projectName={runProject.name} onClose={() => setRunProject(null)} />}
    </div>
  );
}
