// Audio panel: per-key sample browser with a step slider (scrub how generated audio evolves over
// training), inline player, precomputed waveform + spectrogram, and output-vs-reference A/B.
import { useEffect, useMemo, useState } from "react";
import { api, type AudioEntry } from "./api";
import { Waveform } from "./Waveform";

function KeyBrowser({ entries }: { entries: AudioEntry[] }) {
  // entries for a single key, ordered by step
  const sorted = useMemo(
    () => [...entries].sort((a, b) => (a.step ?? 0) - (b.step ?? 0)),
    [entries]
  );
  const [idx, setIdx] = useState(sorted.length - 1);
  const e = sorted[Math.min(idx, sorted.length - 1)];
  if (!e) return null;

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{e.key}</strong>
        <span style={{ fontSize: 12, color: "#888" }}>
          step {e.step ?? "—"} · {e.duration_s ? `${e.duration_s.toFixed(2)}s` : "…"} ·{" "}
          {e.derived ? "derived" : "deriving…"}
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
          {e.peaks_url && <Waveform peaksUrl={e.peaks_url} />}
          {e.audio_url && <audio controls src={e.audio_url} style={{ display: "block", width: 420 }} />}
        </div>
        {e.reference_url && (
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>reference (A/B)</div>
            <audio controls src={e.reference_url} style={{ display: "block", width: 420 }} />
          </div>
        )}
        {e.spectrogram_url && (
          <div>
            <div style={{ fontSize: 12, color: "#666" }}>spectrogram</div>
            <img
              src={e.spectrogram_url}
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
  const [entries, setEntries] = useState<AudioEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const tick = () => api.audio(runId).then((e) => alive && setEntries(e)).catch(() => {});
    tick();
    const id = setInterval(tick, 3000); // keep polling so derivations appear when ready
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [runId]);

  const byKey = useMemo(() => {
    const m = new Map<string, AudioEntry[]>();
    for (const e of entries) (m.get(e.key) ?? m.set(e.key, []).get(e.key)!).push(e);
    return [...m.entries()];
  }, [entries]);

  if (entries.length === 0) return null;
  return (
    <section style={{ marginTop: 24 }}>
      <h3>Audio</h3>
      {byKey.map(([key, es]) => (
        <KeyBrowser key={key} entries={es} />
      ))}
    </section>
  );
}
