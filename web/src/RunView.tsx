// Run view: config panel + live metric charts. Polls every 2s (SSE/WebSocket arrives later).
import { useEffect, useState } from "react";
import { api, type MetricPoint, type Run } from "./api";
import { LineChart } from "./LineChart";
import { AudioPanel } from "./AudioPanel";

const POLL_MS = 2000;

export function RunView({ runId }: { runId: string }) {
  const [run, setRun] = useState<Run | null>(null);
  const [series, setSeries] = useState<Record<string, MetricPoint[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await api.run(runId);
        const names = await api.metricNames(runId);
        const entries = await Promise.all(
          names.map(async (n) => [n, await api.metrics(runId, n)] as const)
        );
        if (!alive) return;
        setRun(r);
        setSeries(Object.fromEntries(entries));
        setError(null);
      } catch (e) {
        if (alive) setError(String(e));
      }
    }
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [runId]);

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!run) return <p>Loading run…</p>;

  return (
    <section>
      <h2 style={{ marginBottom: 4 }}>
        {run.display_name ?? run.id.slice(0, 8)}{" "}
        <span style={{ fontSize: 13, color: "#888" }}>· {run.state}</span>
      </h2>
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontSize: 13 }}>config</summary>
        <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 6, fontSize: 12 }}>
          {JSON.stringify(run.config, null, 2)}
        </pre>
      </details>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        {Object.entries(series).map(([name, pts]) => (
          <LineChart key={name} title={name} points={pts} />
        ))}
        {Object.keys(series).length === 0 && <p>No metrics logged yet.</p>}
      </div>
      <AudioPanel runId={runId} />
    </section>
  );
}
