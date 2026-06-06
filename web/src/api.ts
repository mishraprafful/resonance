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

export interface Team {
  org_id: string;
  slug: string;
  name: string;
  role: string;
}

export interface Me {
  username: string;
  is_admin: boolean;
  current_org: string | null;
  teams: Team[];
  pending_requests: { slug: string; status: string }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, `${path} -> ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE", credentials: "same-origin" });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
}

// Client-side memo of presigned URLs (the server also caches in Redis). Keyed by sha+kind.
const _urlCache = new Map<string, Promise<string>>();

export const api = {
  projects: () => get<Project[]>("/v1/projects"),
  createProject: (slug: string, name: string) =>
    post<Project>("/v1/projects", { slug, name }),
  deleteProject: (slug: string) => del(`/v1/projects/${slug}`),
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
  // Auth-scoped streaming URL for range playback of an original. Resolves to the Go media gateway
  // (HMAC-signed, CDN-cacheable, range-streamed) when configured, else a direct presigned GET.
  // Always original quality — never a lossy rendition (§7b).
  streamUrl: (sha: string): Promise<string> => {
    const ck = `${sha}:stream`;
    if (!_urlCache.has(ck)) {
      _urlCache.set(
        ck,
        get<{ url: string }>(`/v1/assets/${sha}/stream-url?kind=original`).then((r) => r.url)
      );
    }
    return _urlCache.get(ck)!;
  },

  createRating: (body: Omit<Rating, "id">) => post<Rating>("/v1/ratings", body),
  ratings: (testId: string) => get<Rating[]>(`/v1/ratings?test_id=${encodeURIComponent(testId)}`),

  datasets: () => get<Dataset[]>("/v1/datasets"),
  dataset: (id: string) => get<DatasetDetail>(`/v1/datasets/${id}`),

  // --- auth / accounts ---
  bootstrapStatus: () => get<{ needs_bootstrap: boolean }>("/v1/auth/bootstrap-status"),
  bootstrap: (username: string, password: string) =>
    post<{ username: string }>("/v1/auth/bootstrap", { username, password }),
  signup: (body: {
    username: string; password: string; team_mode: "create" | "join";
    team_slug?: string; team_name?: string;
  }) => post<{ username: string; current_org: string | null; pending: boolean }>("/v1/auth/signup", body),
  login: (username: string, password: string) =>
    post<{ username: string; current_org: string | null }>("/v1/auth/login", { username, password }),
  logout: () => post<{ ok: boolean }>("/v1/auth/logout"),
  me: () => get<Me>("/v1/auth/me"),
  switchTeam: (org_id: string) => post<{ current_org: string }>("/v1/auth/switch-team", { org_id }),
  listTeams: () => get<{ teams: { id: string; slug: string; name: string }[] }>("/v1/teams").then((r) => r.teams),
  createTeam: (slug: string, name: string) => post<{ org_id: string }>("/v1/teams", { slug, name }),
  deleteTeam: (orgId: string) => del(`/v1/teams/${orgId}`),
  requestJoin: (orgId: string) => post<{ status: string }>(`/v1/teams/${orgId}/join-request`),
  listRequests: (orgId: string) =>
    get<{ requests: { id: string; username: string; status: string }[] }>(`/v1/teams/${orgId}/requests`).then((r) => r.requests),
  decideRequest: (orgId: string, reqId: string, action: "approve" | "deny") =>
    post<{ status: string }>(`/v1/teams/${orgId}/requests/${reqId}/${action}`),
};
