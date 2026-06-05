// Typed client for the Resonance control/query API. In dev, Vite proxies /v1 -> :8000.

export interface Project {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface Run {
  id: string;
  project_id: string;
  display_name: string | null;
  state: string;
  config: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

export interface MetricPoint {
  step: number;
  value: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  projects: () => get<Project[]>("/v1/projects"),
  runs: (projectSlug: string) => get<Run[]>(`/v1/projects/${projectSlug}/runs`),
  run: (runId: string) => get<Run>(`/v1/runs/${runId}`),
  metricNames: (runId: string) =>
    get<{ metrics: string[] }>(`/v1/runs/${runId}/metric-names`).then((r) => r.metrics),
  metrics: (runId: string, metric: string) =>
    get<{ points: MetricPoint[] }>(
      `/v1/runs/${runId}/metrics?metric=${encodeURIComponent(metric)}`
    ).then((r) => r.points),
};
