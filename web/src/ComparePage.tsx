// Compare: run selector chips + three tabs —
//   Metrics    — eval comparison table + overlaid multi-run metric charts.
//   A/B player — synced playback of the latest sample per run for a key, with blind-test mode
//                (shuffle + hidden labels → star ratings → reveal, logged to /v1/ratings).
//   Prompt grid — the same key across every selected run, side by side, synced.
// Playback is always the ORIGINAL uploaded audio (exact quality) — the whole point of A/B.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type AudioEntry, type MetricPoint, type Project } from "./api";
import { fmt, runColor, type ChartStyle, type ColormapName } from "./design/theme";
import { Icon } from "./design/icons";
import { Btn, Empty, RunChip, Segmented } from "./design/ui";
import { MetricChart, Spectrogram, Waveform, playBtnStyle, transportProgress, useTransport, type ChartSeries } from "./design/audioviz";
import { fetchAllEntries } from "./audioData";
import { colLabel, fmtMetric, isLrMetric, useEnrichedRuns, type EnrichedRun } from "./runsData";

const shuffle = <T,>(a: T[]): T[] => a.map((v) => [Math.random(), v] as const).sort((x, y) => x[0] - y[0]).map(([, v]) => v);

export function ComparePage({
  project, seedRunIds, colormap, chartStyle,
}: {
  project: Project; seedRunIds: string[]; colormap: ColormapName; chartStyle: ChartStyle;
}) {
  const { runs } = useEnrichedRuns(project.slug);
  const [tab, setTab] = useState<"metrics" | "ab" | "grid">("metrics");
  const [selected, setSelected] = useState<string[]>([]);
  const seedKey = seedRunIds.join(",");

  useEffect(() => {
    if (!runs.length) return;
    const base = seedRunIds.length ? seedRunIds : runs.slice(0, 3).map((r) => r.id);
    setSelected(base.filter((id) => runs.some((r) => r.id === id)).slice(0, 6));
  }, [runs.length, seedKey]);

  const selRuns = selected.map((id) => runs.find((r) => r.id === id)).filter((r): r is EnrichedRun => !!r);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 6 ? [...s, id] : s));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 500, letterSpacing: "-0.03em", margin: 0, color: "var(--ink-strong)" }}>Compare</h1>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 14 }}>{project.name} · {selRuns.length} runs selected</p>
        </div>
        <Segmented value={tab} onChange={setTab} options={[
          { value: "metrics", label: "Metrics", icon: "activity" },
          { value: "ab", label: "A/B player", icon: "headphones" },
          { value: "grid", label: "Prompt grid", icon: "grid" },
        ]} />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
        {runs.map((r) => {
          const on = selected.includes(r.id);
          return (
            <button key={r.id} onClick={() => toggle(r.id)}
              style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 12px", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
                border: `1.5px solid ${on ? runColor(r.id) : "var(--line)"}`, background: on ? `color-mix(in srgb, ${runColor(r.id)} 12%, transparent)` : "var(--panel)", color: "var(--ink)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: runColor(r.id), opacity: on ? 1 : 0.4 }} />
              {r.display_name ?? r.id.slice(0, 8)}
            </button>
          );
        })}
        {runs.length === 0 && <Empty msg="No runs in this project to compare." />}
      </div>

      {tab === "metrics" && <CompareMetrics runs={selRuns} chartStyle={chartStyle} />}
      {tab === "ab" && <ABPlayer runs={selRuns} colormap={colormap} />}
      {tab === "grid" && <PromptGrid runs={selRuns} colormap={colormap} />}
    </div>
  );
}

// ── Metrics tab ──
function CompareMetrics({ runs, chartStyle }: { runs: EnrichedRun[]; chartStyle: ChartStyle }) {
  const [data, setData] = useState<Record<string, MetricPoint[]>>({}); // key `${runId}::${name}`
  const names = useMemo(() => {
    const set = new Set<string>();
    runs.forEach((r) => r.metricNames.forEach((n) => set.add(n)));
    return [...set].sort().slice(0, 8);
  }, [runs.map((r) => r.id).join(",")]);
  const cols = useMemo(() => {
    const set = new Set<string>();
    runs.forEach((r) => Object.keys(r.evalv).forEach((k) => set.add(k)));
    return [...set].sort().slice(0, 4);
  }, [runs]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const acc: Record<string, MetricPoint[]> = {};
      await Promise.all(
        runs.flatMap((r) =>
          names.map(async (n) => {
            if (!r.metricNames.includes(n)) return;
            try {
              acc[`${r.id}::${n}`] = await api.metrics(r.id, n);
            } catch {
              /* ignore */
            }
          })
        )
      );
      if (alive) setData(acc);
    })();
    return () => {
      alive = false;
    };
  }, [runs.map((r) => r.id).join(","), names.join(",")]);

  const bests: Record<string, number> = {};
  cols.forEach((c) => {
    const vals = runs.map((r) => r.evalv[c]).filter((v): v is number => v != null);
    if (vals.length) bests[c] = isLrMetric(c) ? Math.min(...vals) : Math.max(...vals);
  });

  if (!runs.length) return <Empty msg="Select runs above to compare." />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {cols.length > 0 && (
        <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line)" }}>
                  <th style={{ textAlign: "left", padding: "14px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Run</th>
                  {cols.map((c) => <th key={c} style={{ textAlign: "right", padding: "14px 16px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>{colLabel(c)}</th>)}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                    <td style={{ padding: "12px 16px" }}><RunChip run={r} /></td>
                    {cols.map((c) => {
                      const v = r.evalv[c];
                      const best = v != null && v === bests[c];
                      return <td key={c} style={{ padding: "12px 16px", textAlign: "right", fontFamily: "var(--mono)", color: best ? "var(--accent)" : "var(--ink)", fontWeight: best ? 700 : 500 }}>{v != null ? fmtMetric(c, v) : "—"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        {names.map((n) => {
          const series: ChartSeries[] = runs
            .map((r) => ({ name: r.display_name ?? r.id, color: runColor(r.id), points: data[`${r.id}::${n}`] || [] }))
            .filter((s) => s.points.length);
          return (
            <div key={n} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>{n}</div>
              <MetricChart series={series} style={chartStyle} yKind={isLrMetric(n) ? "lr" : undefined} height={170} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── A/B synced player with blind test ──
interface Track { uid: string; runId: string; label: string; sha: string; url: string; peaks?: string; spec?: string; step: number | null; muted: boolean }

function ABPlayer({ runs, colormap }: { runs: EnrichedRun[]; colormap: ColormapName }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [keyName, setKeyName] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [blind, setBlind] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const testId = useRef(`test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  const { tr, playing, time, dur, play, pause, seek } = useTransport();

  // keys available across the first selected run (most relevant)
  useEffect(() => {
    if (!runs.length) {
      setKeys([]);
      return;
    }
    api.audioKeys(runs[0].id).then((k) => {
      const sorted = [...k].sort();
      setKeys(sorted);
      setKeyName((cur) => (cur && sorted.includes(cur) ? cur : sorted[0] ?? null));
    }).catch(() => setKeys([]));
  }, [runs.map((r) => r.id).join(",")]);

  // build tracks: latest sample per run for the chosen key
  useEffect(() => {
    tr.clear();
    if (!keyName || !runs.length) {
      setTracks([]);
      setOrder([]);
      return;
    }
    let alive = true;
    let uid = 0;
    (async () => {
      const built: Track[] = [];
      for (const r of runs) {
        try {
          const entries = await fetchAllEntries(r.id, keyName);
          const e: AudioEntry | undefined = entries[entries.length - 1];
          if (!e) continue;
          const url = await api.presign(e.asset_sha, "original");
          const peaks = e.has_peaks ? await api.presign(e.asset_sha, "peaks").catch(() => undefined) : undefined;
          const spec = e.has_spectrogram ? await api.presign(e.asset_sha, "spectrogram").catch(() => undefined) : undefined;
          const id = `t${uid++}`;
          built.push({ uid: id, runId: r.id, label: r.display_name ?? r.id.slice(0, 8), sha: e.asset_sha, url, peaks, spec, step: e.step, muted: false });
        } catch {
          /* skip run with no audio */
        }
      }
      if (!alive) return;
      built.forEach((t) => tr.set(t.uid, t.url));
      setTracks(built);
      setOrder(built.map((t) => t.uid));
      setBlind(false);
      setRevealed(false);
      setScores({});
    })();
    return () => {
      alive = false;
    };
  }, [keyName, runs.map((r) => r.id).join(",")]);

  const startBlind = () => { pause(); setOrder(shuffle(tracks.map((t) => t.uid))); setScores({}); setRevealed(false); setBlind(true); };
  const reveal = () => {
    setRevealed(true);
    for (const t of tracks) {
      const s = scores[t.uid];
      if (s) void api.createRating({ test_id: testId.current, asset_sha: t.sha, run_id: t.runId, label: t.label, score: s, blind: true }).catch(() => {});
    }
  };
  const toggleMute = (uid: string) =>
    setTracks((ts) => ts.map((t) => {
      if (t.uid !== uid) return t;
      const m = !t.muted;
      tr.setMuted(uid, m);
      return { ...t, muted: m };
    }));

  const ordered = order.map((uid) => tracks.find((t) => t.uid === uid)).filter((t): t is Track => !!t);
  const progress = transportProgress(time, dur);

  if (!runs.length) return <Empty msg="Select runs above to A/B compare them." />;
  if (keys.length === 0) return <Empty msg="No logged audio for these runs yet." />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        {keyName && <Segmented mono value={keyName} onChange={setKeyName} options={keys.map((k) => ({ value: k, label: k }))} />}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!blind && <Btn kind="outline" icon="shuffle" onClick={startBlind} disabled={tracks.length < 2}>Blind test</Btn>}
          {blind && !revealed && <Btn kind="primary" icon="eye" onClick={reveal}>Reveal + log</Btn>}
          {blind && <Btn kind="soft" icon="x" onClick={() => { setBlind(false); setRevealed(false); }}>Exit blind</Btn>}
        </div>
      </div>

      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button onClick={() => (playing ? pause() : play())} style={playBtnStyle(48)}>
            <Icon name={playing ? "pause" : "play"} size={20} fill={playing ? "none" : "current"} stroke={playing ? 2.4 : 0} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)" }}>{keyName}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--muted)" }}>{fmt.time(time)} / {fmt.time(dur)} · synced</span>
            </div>
            <div onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur); }}
              style={{ height: 7, borderRadius: 999, background: "var(--panel-3)", cursor: "pointer", overflow: "hidden" }}>
              <div style={{ width: `${progress * 100}%`, height: "100%", background: "var(--accent)" }} />
            </div>
          </div>
        </div>
        {blind && !revealed && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--warn)", display: "flex", alignItems: "center", gap: 7 }}><Icon name="eye-off" size={14} />Blind mode — labels hidden & order shuffled. Play all, rate each, then reveal.</div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {ordered.map((t, i) => {
          const label = blind && !revealed ? `Track ${String.fromCharCode(65 + i)}` : t.label;
          const col = blind && !revealed ? "var(--muted)" : runColor(t.runId);
          return (
            <div key={t.uid} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: col }} />
                  <span style={{ fontWeight: 600, color: "var(--ink-strong)", fontSize: 14 }}>{label}</span>
                  {!(blind && !revealed) && t.step != null && <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--faint)" }}>step {fmt.int(t.step)}</span>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {blind && (
                    <div style={{ display: "flex", gap: 3, marginRight: 4 }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button key={s} onClick={() => setScores((sc) => ({ ...sc, [t.uid]: s }))} title={`${s} stars`}
                          style={{ border: 0, background: "transparent", cursor: "pointer", padding: 1, color: (scores[t.uid] || 0) >= s ? "var(--accent)" : "var(--faint)" }}>
                          <Icon name="star" size={16} fill={(scores[t.uid] || 0) >= s ? "current" : "none"} stroke={(scores[t.uid] || 0) >= s ? 0 : 1.8} />
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => toggleMute(t.uid)} title={t.muted ? "unmute" : "mute"} style={{ border: 0, background: "transparent", cursor: "pointer", color: t.muted ? "var(--faint)" : "var(--ink)" }}>
                    <Icon name="volume" size={17} />
                  </button>
                </div>
              </div>
              <Waveform peaksUrl={t.peaks} progress={progress} color={col} height={40} onSeek={(f) => seek(f * dur)} />
              <div style={{ marginTop: 8 }}>
                <Spectrogram imageUrl={t.spec} colormap={colormap} progress={progress} height={84} onSeek={(f) => seek(f * dur)} />
              </div>
            </div>
          );
        })}
      </div>

      {blind && revealed && <BlindResults tracks={ordered} runs={runs} scores={scores} />}
    </div>
  );
}

function BlindResults({ tracks, runs, scores }: { tracks: Track[]; runs: EnrichedRun[]; scores: Record<string, number> }) {
  const ranked = [...tracks].sort((a, b) => (scores[b.uid] || 0) - (scores[a.uid] || 0));
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginTop: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>Blind test results · logged to /v1/ratings</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {ranked.map((t, i) => {
          const run = runs.find((r) => r.id === t.runId);
          return (
            <div key={t.uid} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: i === 0 ? "var(--accent)" : "var(--faint)", width: 22 }}>{i + 1}</span>
              {run && <RunChip run={run} />}
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 2 }}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <Icon key={s} name="star" size={14} fill={(scores[t.uid] || 0) >= s ? "current" : "none"} stroke={(scores[t.uid] || 0) >= s ? 0 : 1.6} style={{ color: (scores[t.uid] || 0) >= s ? "var(--accent)" : "var(--faint)" }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Prompt grid: same key across runs, side by side ──
function PromptGrid({ runs, colormap }: { runs: EnrichedRun[]; colormap: ColormapName }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [keyName, setKeyName] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const { tr, playing, time, dur, play, pause, seek } = useTransport();

  useEffect(() => {
    if (!runs.length) return;
    api.audioKeys(runs[0].id).then((k) => {
      const sorted = [...k].sort();
      setKeys(sorted);
      setKeyName((cur) => (cur && sorted.includes(cur) ? cur : sorted[0] ?? null));
    }).catch(() => setKeys([]));
  }, [runs.map((r) => r.id).join(",")]);

  useEffect(() => {
    tr.clear();
    if (!keyName || !runs.length) {
      setTracks([]);
      return;
    }
    let alive = true;
    (async () => {
      const built: Track[] = [];
      for (const r of runs) {
        try {
          const entries = await fetchAllEntries(r.id, keyName);
          const e = entries[entries.length - 1];
          if (!e) continue;
          const url = await api.presign(e.asset_sha, "original");
          const peaks = e.has_peaks ? await api.presign(e.asset_sha, "peaks").catch(() => undefined) : undefined;
          const spec = e.has_spectrogram ? await api.presign(e.asset_sha, "spectrogram").catch(() => undefined) : undefined;
          built.push({ uid: r.id, runId: r.id, label: r.display_name ?? r.id.slice(0, 8), sha: e.asset_sha, url, peaks, spec, step: e.step, muted: false });
        } catch {
          /* skip */
        }
      }
      if (!alive) return;
      built.forEach((t) => tr.set(t.uid, t.url));
      setTracks(built);
    })();
    return () => {
      alive = false;
    };
  }, [keyName, runs.map((r) => r.id).join(",")]);

  const progress = transportProgress(time, dur);
  if (!runs.length) return <Empty msg="Select runs above to lay them out side by side." />;
  if (keys.length === 0) return <Empty msg="No logged audio for these runs yet." />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        {keyName && <Segmented mono value={keyName} onChange={setKeyName} options={keys.map((k) => ({ value: k, label: k }))} />}
        <Btn kind="primary" icon={playing ? "pause" : "play"} onClick={() => (playing ? pause() : play())}>{playing ? "Pause all" : "Play all synced"}</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {tracks.map((t) => {
          const run = runs.find((r) => r.id === t.runId);
          return (
            <div key={t.uid} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                {run && <RunChip run={run} />}
                {t.step != null && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)" }}>step {fmt.step(t.step)}</span>}
              </div>
              <Spectrogram imageUrl={t.spec} colormap={colormap} progress={progress} height={120} onSeek={(f) => seek(f * dur)} showAxis />
              <div style={{ marginTop: 8 }}>
                <Waveform peaksUrl={t.peaks} progress={progress} color={runColor(t.runId)} height={34} onSeek={(f) => seek(f * dur)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
