// A/B synced compare + blind-test. Add clips from any run/key/step as tracks, play them with a
// shared transport, and (optionally) run a blind test that shuffles + hides labels and logs ratings.
// Playback is always the ORIGINAL uploaded audio (exact quality) — that's the whole point of A/B.
import { useEffect, useRef, useState } from "react";
import { api, type AudioEntry, type Project, type Run } from "./api";

interface Track {
  uid: string;
  label: string;
  runId: string;
  sha: string;
  url: string;
}

let _uid = 0;
const shuffle = <T,>(a: T[]): T[] => a.map((v) => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

function AddTrack({ projects, onAdd }: { projects: Project[]; onAdd: (t: Omit<Track, "uid" | "url">) => void }) {
  const [proj, setProj] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const [key, setKey] = useState("");
  const [entries, setEntries] = useState<AudioEntry[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => { if (proj) api.runs(proj).then(setRuns).catch(() => {}); }, [proj]);
  useEffect(() => { if (runId) api.audioKeys(runId).then(setKeys).catch(() => {}); }, [runId]);
  useEffect(() => {
    if (!runId || !key) return;
    (async () => {
      const acc: AudioEntry[] = []; let cursor: string | undefined;
      do { const p = await api.audioPage(runId, key, cursor); acc.push(...p.items); cursor = p.next_cursor ?? undefined; } while (cursor);
      setEntries(acc.sort((a, b) => (a.step ?? 0) - (b.step ?? 0))); setIdx(acc.length - 1);
    })().catch(() => {});
  }, [runId, key]);

  const e = entries[Math.min(idx, entries.length - 1)];
  const sel = (label: string, value: string, set: (v: string) => void, opts: [string, string][]) => (
    <label style={{ fontSize: 12, marginRight: 8 }}>
      {label}{" "}
      <select value={value} onChange={(ev) => set(ev.target.value)}>
        <option value="">—</option>
        {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );

  return (
    <div style={{ border: "1px dashed #ccc", borderRadius: 8, padding: 10, marginBottom: 12 }}>
      {sel("project", proj, (v) => { setProj(v); setRunId(""); setKeys([]); setKey(""); setEntries([]); }, projects.map((p) => [p.slug, p.name]))}
      {sel("run", runId, (v) => { setRunId(v); setKey(""); setEntries([]); }, runs.map((r) => [r.id, r.display_name ?? r.id.slice(0, 8)]))}
      {sel("key", key, (v) => { setKey(v); setEntries([]); }, keys.map((k) => [k, k]))}
      {entries.length > 0 && (
        <>
          <label style={{ fontSize: 12 }}>
            step{" "}
            <input type="range" min={0} max={entries.length - 1} value={Math.min(idx, entries.length - 1)} onChange={(ev) => setIdx(Number(ev.target.value))} />
            {" "}{e?.step}
          </label>
          <button
            style={{ marginLeft: 8 }}
            onClick={() => {
              const run = runs.find((r) => r.id === runId);
              onAdd({ label: `${run?.display_name ?? runId.slice(0, 6)} · ${key} · step ${e?.step}`, runId, sha: e!.asset_sha });
            }}
          >
            + add track
          </button>
        </>
      )}
    </div>
  );
}

export function ComparePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [blind, setBlind] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [testId] = useState(() => `test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  useEffect(() => { api.projects().then(setProjects).catch(() => {}); }, []);

  const add = (t: Omit<Track, "uid" | "url">) =>
    api.streamUrl(t.sha).then((url) => {
      const uid = `t${_uid++}`;
      setTracks((ts) => [...ts, { ...t, uid, url }]);
      setOrder((o) => [...o, uid]);
    });

  const forEachAudio = (fn: (a: HTMLAudioElement) => void) => audioRefs.current.forEach(fn);
  const playAll = () => forEachAudio((a) => { a.currentTime = 0; void a.play(); });
  const pauseAll = () => forEachAudio((a) => a.pause());

  const startBlind = () => { setOrder(shuffle(tracks.map((t) => t.uid))); setScores({}); setRevealed(false); setBlind(true); };
  const reveal = () => {
    setRevealed(true);
    for (const t of tracks) {
      const s = scores[t.uid];
      if (s) void api.createRating({ test_id: testId, asset_sha: t.sha, run_id: t.runId, label: t.label, score: s, blind: true });
    }
  };

  const ordered = order.map((uid) => tracks.find((t) => t.uid === uid)!).filter(Boolean);

  return (
    <section>
      <h2>Compare {blind ? <span style={{ fontSize: 13, color: "#a00" }}>· blind test</span> : null}</h2>
      <AddTrack projects={projects} onAdd={add} />

      {tracks.length > 0 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
          <button onClick={playAll}>▶ play all (synced)</button>
          <button onClick={pauseAll}>⏸ pause all</button>
          {!blind && <button onClick={startBlind}>🎧 start blind test</button>}
          {blind && !revealed && <button onClick={reveal}>reveal + log ratings</button>}
          {blind && <button onClick={() => { setBlind(false); setRevealed(false); }}>exit blind</button>}
        </div>
      )}

      {ordered.map((t, i) => (
        <div key={t.uid} style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{blind && !revealed ? `Track ${String.fromCharCode(65 + i)}` : t.label}</strong>
            <button style={{ fontSize: 12 }} onClick={() => { setTracks((ts) => ts.filter((x) => x.uid !== t.uid)); setOrder((o) => o.filter((u) => u !== t.uid)); audioRefs.current.delete(t.uid); }}>remove</button>
          </div>
          <audio
            controls
            src={t.url}
            preload="none"
            style={{ width: "100%", marginTop: 6 }}
            ref={(el) => { if (el) audioRefs.current.set(t.uid, el); else audioRefs.current.delete(t.uid); }}
          />
          {blind && (
            <div style={{ fontSize: 13, marginTop: 4 }}>
              rate:{" "}
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} onClick={() => setScores((sc) => ({ ...sc, [t.uid]: s }))}
                  style={{ fontWeight: scores[t.uid] === s ? 700 : 400 }}>{s}</button>
              ))}
              {scores[t.uid] ? ` ★${scores[t.uid]}` : ""}
            </div>
          )}
        </div>
      ))}

      {tracks.length === 0 && <p style={{ color: "#888" }}>Add tracks from any run/key/step to compare them side by side (original quality).</p>}
    </section>
  );
}
