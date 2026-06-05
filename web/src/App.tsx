// Resonance web UI — Phase 1: project/run browser + live run view.
// Audio panel, A/B compare and dataset views land in Phases 2-3.
import { useEffect, useState } from "react";
import { api, type Project, type Run } from "./api";
import { RunView } from "./RunView";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.projects().then(setProjects).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (selectedProject) api.runs(selectedProject).then(setRuns).catch((e) => setError(String(e)));
  }, [selectedProject]);

  return (
    <main style={{ fontFamily: "system-ui", display: "flex", gap: 24, padding: "1.5rem" }}>
      <nav style={{ minWidth: 220 }}>
        <h1 style={{ fontSize: 20 }}>Resonance</h1>
        {error && <p style={{ color: "crimson", fontSize: 12 }}>{error}</p>}
        <h3 style={{ fontSize: 13, color: "#888" }}>Projects</h3>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {projects.map((p) => (
            <li key={p.id}>
              <button onClick={() => setSelectedProject(p.slug)}>
                {p.name}
              </button>
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
      </nav>
      <div style={{ flex: 1 }}>
        {selectedRun ? (
          <RunView runId={selectedRun} />
        ) : (
          <p style={{ color: "#888" }}>Select a project, then a run.</p>
        )}
      </div>
    </main>
  );
}
