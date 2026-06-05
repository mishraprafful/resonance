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

export interface AudioEntry {
  id: string;
  key: string;
  step: number | null;
  caption: string | null;
  asset_sha: string;
  reference_sha: string | null;
  sample_rate: number | null;
  duration_s: number | null;
  derived: boolean;
  has_peaks: boolean;
  has_spectrogram: boolean;
}

export interface AudioPage {
  items: AudioEntry[];
  next_cursor: string | null;
}

export type PresignKind = "original" | "peaks" | "spectrogram";

export interface Rating {
  id: string;
  test_id: string;
  asset_sha: string;
  run_id: string | null;
  label: string | null;
  score: number;
  blind: boolean;
}

export interface Dataset {
  id: string;
  name: string;
  version: string;
  project_id: string | null;
  item_count: number;
  created_at: string;
}

export interface DatasetItem {
  sha256: string;
  path: string;
  size_bytes?: number;
}

export interface DatasetDetail extends Dataset {
  items: DatasetItem[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

// Client-side memo of presigned URLs (the server also caches in Redis). Keyed by sha+kind.
const _urlCache = new Map<string, Promise<string>>();

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

  audioKeys: (runId: string) =>
    get<{ keys: string[] }>(`/v1/runs/${runId}/audio/keys`).then((r) => r.keys),
  audioPage: (runId: string, key: string, cursor?: string) => {
    const q = new URLSearchParams({ key });
    if (cursor) q.set("cursor", cursor);
    return get<AudioPage>(`/v1/runs/${runId}/audio?${q}`);
  },
  // Lazily mint a presigned URL for an asset (original = exact uploaded quality, for A/B compare).
  presign: (sha: string, kind: PresignKind = "original"): Promise<string> => {
    const ck = `${sha}:${kind}`;
    if (!_urlCache.has(ck)) {
      _urlCache.set(
        ck,
        get<{ url: string }>(`/v1/assets/${sha}/url?kind=${kind}`).then((r) => r.url)
      );
    }
    return _urlCache.get(ck)!;
  },

  createRating: (body: Omit<Rating, "id">) => post<Rating>("/v1/ratings", body),
  ratings: (testId: string) => get<Rating[]>(`/v1/ratings?test_id=${encodeURIComponent(testId)}`),

  datasets: () => get<Dataset[]>("/v1/datasets"),
  dataset: (id: string) => get<DatasetDetail>(`/v1/datasets/${id}`),
};
