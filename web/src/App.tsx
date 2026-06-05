// Resonance web UI: auth-gated. Project/run browser + live run view, A/B compare, datasets, and
// account/teams management. The active team scopes everything shown.
import { useEffect, useState } from "react";
import { api, type Me, type Project, type Run } from "./api";
import { AuthGate } from "./Auth";
import { RunView } from "./RunView";
import { ComparePage } from "./ComparePage";
import { DatasetsPage } from "./DatasetsPage";
import { AccountPage } from "./AccountPage";

type View = "runs" | "compare" | "datasets" | "account";

function AppInner({ me, reload }: { me: Me; reload: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [view, setView] = useState<View>(me.current_org ? "runs" : "account");
  const [error, setError] = useState<string | null>(null);
  const currentTeam = me.teams.find((t) => t.org_id === me.current_org);

  // Re-fetch tenant-scoped data whenever the active team changes.
  useEffect(() => {
    setSelectedProject(null);
    setSelectedRun(null);
    if (me.current_org) api.projects().then(setProjects).catch((e) => setError(String(e)));
  }, [me.current_org]);

  useEffect(() => {
    if (selectedProject) api.runs(selectedProject).then(setRuns).catch((e) => setError(String(e)));
  }, [selectedProject]);

  const tab = (v: View, label: string) => (
    <button onClick={() => setView(v)} style={{ fontWeight: view === v ? 700 : 400, marginRight: 6 }}>{label}</button>
  );

  return (
    <main style={{ fontFamily: "system-ui", display: "flex", gap: 24, padding: "1.5rem" }}>
      <nav style={{ minWidth: 220 }}>
        <h1 style={{ fontSize: 20, marginBottom: 0 }}>Resonance</h1>
        <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          {me.username} · team: <strong>{currentTeam?.name ?? "— none —"}</strong>
        </div>
        <div style={{ margin: "8px 0" }}>
          {tab("runs", "Runs")}{tab("compare", "Compare")}{tab("datasets", "Datasets")}{tab("account", "Account")}
        </div>
        {error && <p style={{ color: "crimson", fontSize: 12 }}>{error}</p>}
        {view === "runs" && me.current_org && (
          <>
            <h3 style={{ fontSize: 13, color: "#888" }}>Projects</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {projects.map((p) => (
                <li key={p.id}><button onClick={() => setSelectedProject(p.slug)}>{p.name}</button></li>
              ))}
            </ul>
            {selectedProject && (
              <>
                <h3 style={{ fontSize: 13, color: "#888" }}>Runs</h3>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {runs.map((r) => (
                    <li key={r.id}><button onClick={() => setSelectedRun(r.id)}>{r.display_name ?? r.id.slice(0, 8)}</button></li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </nav>
      <div style={{ flex: 1 }}>
        {!me.current_org && view !== "account" && (
          <p style={{ color: "#a00" }}>You're not on a team yet — create or join one in the Account tab.</p>
        )}
        {view === "runs" && me.current_org &&
          (selectedRun ? <RunView runId={selectedRun} /> : <p style={{ color: "#888" }}>Select a project, then a run.</p>)}
        {view === "compare" && <ComparePage />}
        {view === "datasets" && <DatasetsPage projects={projects} />}
        {view === "account" && <AccountPage me={me} reload={reload} />}
      </div>
    </main>
  );
}

export function App() {
  return <AuthGate>{(me, reload) => <AppInner key={me.current_org ?? "none"} me={me} reload={reload} />}</AuthGate>;
}
