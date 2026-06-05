// Resonance web UI: project/run browser + live run view, A/B compare, and dataset views.
import { useEffect, useState } from "react";
import { api, type Project, type Run } from "./api";
import { RunView } from "./RunView";
import { ComparePage } from "./ComparePage";
import { DatasetsPage } from "./DatasetsPage";

type View = "runs" | "compare" | "datasets";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [view, setView] = useState<View>("runs");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.projects().then(setProjects).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (selectedProject) api.runs(selectedProject).then(setRuns).catch((e) => setError(String(e)));
  }, [selectedProject]);

  const tab = (v: View, label: string) => (
    <button
      onClick={() => setView(v)}
      style={{ fontWeight: view === v ? 700 : 400, marginRight: 6 }}
    >
      {label}
    </button>
  );

  return (
    <main style={{ fontFamily: "system-ui", display: "flex", gap: 24, padding: "1.5rem" }}>
      <nav style={{ minWidth: 220 }}>
        <h1 style={{ fontSize: 20 }}>Resonance</h1>
        <div style={{ margin: "8px 0" }}>{tab("runs", "Runs")}{tab("compare", "Compare")}{tab("datasets", "Datasets")}</div>
        {error && <p style={{ color: "crimson", fontSize: 12 }}>{error}</p>}
        {view === "runs" && (
          <>
            <h3 style={{ fontSize: 13, color: "#888" }}>Projects</h3>
            <ul style={{ listStyle: "none", padding: 0 }}>
              {projects.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setSelectedProject(p.slug)}>{p.name}</button>
                </li>
              ))}
            </ul>
            {selectedProject && (
              <>
                <h3 style={{ fontSize: 13, color: "#888" }}>Runs</h3>
                <ul style={{ listStyle: "none", padding: 0 }}>
                  {runs.map((r) => (
                    <li key={r.id}>
                      <button onClick={() => setSelectedRun(r.id)}>
                        {r.display_name ?? r.id.slice(0, 8)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </nav>
      <div style={{ flex: 1 }}>
        {view === "runs" &&
          (selectedRun ? <RunView runId={selectedRun} /> : <p style={{ color: "#888" }}>Select a project, then a run.</p>)}
        {view === "compare" && <ComparePage />}
        {view === "datasets" && <DatasetsPage projects={projects} />}
      </div>
    </main>
  );
}
