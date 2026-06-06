// Audio-data hooks shared by the run detail, gallery, and compare views.
// Entries are keyset-paginated; URLs are presigned lazily (original quality for playback/A-B,
// peaks for the waveform canvas, spectrogram PNG for the spectrogram canvas).
import { useEffect, useState } from "react";
import { api, type AudioEntry } from "./api";

export function useAudioKeys(runId: string, pollMs = 5000) {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = () => api.audioKeys(runId).then((k) => alive && setKeys([...k].sort())).catch(() => {});
    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [runId, pollMs]);
  return keys;
}

export async function fetchAllEntries(runId: string, key: string): Promise<AudioEntry[]> {
  const acc: AudioEntry[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.audioPage(runId, key, cursor);
    acc.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return acc.sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
}

export function useAudioEntries(runId: string, key: string | null) {
  const [entries, setEntries] = useState<AudioEntry[]>([]);
  useEffect(() => {
    if (!key) {
      setEntries([]);
      return;
    }
    let alive = true;
    fetchAllEntries(runId, key).then((e) => alive && setEntries(e)).catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, [runId, key]);
  return entries;
}

export interface EntryUrls {
  audio?: string;
  reference?: string;
  peaks?: string;
  spectrogram?: string;
  refPeaks?: string;
  refSpectrogram?: string;
}

const softPresign = (sha: string, kind: "original" | "peaks" | "spectrogram") =>
  api.presign(sha, kind).catch(() => undefined);

// Playback (original quality) goes through the media gateway when configured — range-streamed,
// CDN-cacheable; falls back to a direct presigned GET server-side. Peaks/spectrogram stay on presign.
const softStream = (sha: string) => api.streamUrl(sha).catch(() => undefined);

export function useEntryUrls(entry: AudioEntry | null | undefined): EntryUrls {
  const [urls, setUrls] = useState<EntryUrls>({});
  useEffect(() => {
    if (!entry) {
      setUrls({});
      return;
    }
    let alive = true;
    const ref = entry.reference_sha;
    (async () => {
      const [audio, reference, peaks, spectrogram, refPeaks, refSpectrogram] = await Promise.all([
        softStream(entry.asset_sha),
        ref ? softStream(ref) : Promise.resolve(undefined),
        entry.has_peaks ? softPresign(entry.asset_sha, "peaks") : Promise.resolve(undefined),
        entry.has_spectrogram ? softPresign(entry.asset_sha, "spectrogram") : Promise.resolve(undefined),
        ref ? softPresign(ref, "peaks") : Promise.resolve(undefined),
        ref ? softPresign(ref, "spectrogram") : Promise.resolve(undefined),
      ]);
      if (alive) setUrls({ audio, reference, peaks, spectrogram, refPeaks, refSpectrogram });
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [entry?.id]);
  return urls;
}

// Best-effort hero spectrogram for a run card: first key -> latest entry -> spectrogram URL.
export function useHeroSpectrogram(runId: string) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    (async () => {
      const keys = await api.audioKeys(runId);
      if (!keys.length) return;
      const entries = await fetchAllEntries(runId, keys[0]);
      const latest = entries[entries.length - 1];
      if (latest?.has_spectrogram) {
        const u = await api.presign(latest.asset_sha, "spectrogram");
        if (alive) setUrl(u);
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [runId]);
  return url;
}
