// Audio panel: per-key sample browser with a step slider (scrub how generated audio evolves over
// training). URLs are presigned lazily for the selected step only — playback is always the ORIGINAL
// uploaded audio (exact quality). Spectrogram/waveform are precomputed derivations.
import { useEffect, useMemo, useState } from "react";
import { api, type AudioEntry } from "./api";
import { Waveform } from "./Waveform";

interface ResolvedUrls {
  audio?: string;
  reference?: string;
  peaks?: string;
  spectrogram?: string;
}

function useAllEntries(runId: string, key: string): AudioEntry[] {
  const [entries, setEntries] = useState<AudioEntry[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const acc: AudioEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.audioPage(runId, key, cursor);
        acc.push(...page.items);
        cursor = page.next_cursor ?? undefined;
      } while (cursor);
      if (alive) setEntries(acc.sort((a, b) => (a.step ?? 0) - (b.step ?? 0)));
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [runId, key]);
  return entries;
}

function KeyBrowser({ runId, k }: { runId: string; k: string }) {
  const sorted = useAllEntries(runId, k);
  const [idx, setIdx] = useState(0);
  const [urls, setUrls] = useState<ResolvedUrls>({});
  const e = sorted[Math.min(idx, sorted.length - 1)];

  // default to the latest step once entries arrive
  useEffect(() => {
    if (sorted.length) setIdx(sorted.length - 1);
  }, [sorted.length]);

  // presign only the selected step's assets, on demand (always original quality for output/ref)
  useEffect(() => {
    if (!e) return;
    let alive = true;
    (async () => {
      const [audio, reference, peaks, spectrogram] = await Promise.all([
        api.streamUrl(e.asset_sha),
        e.reference_sha ? api.streamUrl(e.reference_sha) : Promise.resolve(undefined),
        e.has_peaks ? api.presign(e.asset_sha, "peaks") : Promise.resolve(undefined),
        e.has_spectrogram ? api.presign(e.asset_sha, "spectrogram") : Promise.resolve(undefined),
      ]);
      if (alive) setUrls({ audio, reference, peaks, spectrogram });
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [e?.id]);

  if (!e) return null;
  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{k}</strong>
        <span style={{ fontSize: 12, color: "#888" }}>
          step {e.step ?? "—"} · {e.duration_s ? `${e.duration_s.toFixed(1)}s` : "…"} ·{" "}
          {e.derived ? "derived" : "deriving…"} · original quality
        </span>
      </div>

      {sorted.length > 1 && (
        <input
          type="range"
          min={0}
          max={sorted.length - 1}
          value={Math.min(idx, sorted.length - 1)}
          onChange={(ev) => setIdx(Number(ev.target.value))}
          style={{ width: "100%", margin: "8px 0" }}
          title="scrub across training steps"
        />
      )}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "#666" }}>output</div>
          {urls.peaks && <Waveform peaksUrl={urls.peaks} />}
          {urls.audio && <audio controls src={urls.audio} style={{ display: "block", width: 420 }} />}
        </div>
        {urls.reference && (
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>reference (A/B)</div>
            <audio controls src={urls.reference} style={{ display: "block", width: 420 }} />
          </div>
        )}
        {urls.spectrogram && (
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>spectrogram</div>
            <img
              src={urls.spectrogram}
              alt="spectrogram"
              style={{ height: 120, borderRadius: 6, imageRendering: "pixelated" }}
            />
          </div>
        )}
      </div>
      {e.caption && <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>{e.caption}</p>}
    </div>
  );
}

export function AudioPanel({ runId }: { runId: string }) {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const tick = () => api.audioKeys(runId).then((k) => alive && setKeys(k)).catch(() => {});
    tick();
    const id = setInterval(tick, 5000); // new keys/derivations appear as the run progresses
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [runId]);

  const sortedKeys = useMemo(() => [...keys].sort(), [keys]);
  if (sortedKeys.length === 0) return null;
  return (
    <section style={{ marginTop: 24 }}>
      <h3>Audio</h3>
      {sortedKeys.map((k) => (
        <KeyBrowser key={k} runId={runId} k={k} />
      ))}
    </section>
  );
}
