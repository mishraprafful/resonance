// Single run: eval tiles, live metric charts (poll 2s), config/system/dataset rails, and the audio
// panel — key tabs → step scrubber → synced waveform + spectrogram → A/B output-vs-reference.
import { useEffect, useState } from "react";
import { api, type AudioEntry, type MetricPoint, type Project, type Run } from "./api";
import { fmt, runColor, type ChartStyle, type ColormapName } from "./design/theme";
import { Icon } from "./design/icons";
import { Btn, Empty, KV, Panel, SectionLabel, StatusDot } from "./design/ui";
import { MetricChart, Spectrogram, Waveform, playBtnStyle, useAudioPlayer } from "./design/audioviz";
import { useAudioEntries, useAudioKeys, useEntryUrls } from "./audioData";
import { betterDir, colLabel, fmtMetric, isLrMetric } from "./runsData";

const POLL_MS = 2000;

export function RunDetail({
  runId, project, onBack, onCompare, chartStyle, colormap,
}: {
  runId: string; project: Project; onBack: () => void; onCompare: (id: string) => void;
  chartStyle: ChartStyle; colormap: ColormapName;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [series, setSeries] = useState<Record<string, MetricPoint[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await api.run(runId);
        const ns = await api.metricNames(runId);
        const entries = await Promise.all(ns.map(async (n) => [n, await api.metrics(runId, n)] as const));
        if (!alive) return;
        setRun(r);
        setNames(ns);
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

  if (error) return <Empty msg={error} />;
  if (!run) return <Empty msg="Loading run…" />;

  const evalNames = names.filter((n) => n.toLowerCase().startsWith("eval/")).slice(0, 4);
  const curStep = Object.values(series).reduce((m, pts) => (pts.length ? Math.max(m, pts[pts.length - 1].step) : m), 0);
  const cfg = run.config || {};

  return (
    <div>
      {/* breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13, color: "var(--muted)" }}>
        <button onClick={onBack} className="res-link" style={{ border: 0, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 13, padding: 0, fontFamily: "var(--font-body)" }}>{project.name}</button>
        <Icon name="chevron-right" size={14} />
        <span style={{ color: "var(--ink)" }}>{run.display_name ?? run.id.slice(0, 8)}</span>
      </div>

      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 22 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 13, height: 13, borderRadius: 4, background: runColor(run.id) }} />
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 500, letterSpacing: "-0.03em", margin: 0, color: "var(--ink-strong)" }}>{run.display_name ?? run.id.slice(0, 8)}</h1>
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 10, alignItems: "center", color: "var(--muted)", fontSize: 13, flexWrap: "wrap" }}>
            <StatusDot state={run.state} />
            {cfg.model != null && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icon name="cpu" size={14} />{String(cfg.model)}</span>}
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icon name="activity" size={14} />{fmt.step(curStep)} steps</span>
            <span>created {fmt.ago(run.created_at)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="outline" icon="columns" onClick={() => onCompare(run.id)}>Add to compare</Btn>
          <Btn kind="soft" icon="download">Export</Btn>
        </div>
      </div>

      {/* eval tiles */}
      {evalNames.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
          {evalNames.map((n) => {
            const pts = series[n] || [];
            const v = pts.length ? pts[pts.length - 1].value : null;
            return (
              <div key={n} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{colLabel(n)}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 6, color: "var(--ink-strong)" }}>{v != null ? fmtMetric(n, v) : "—"}</div>
                <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 3 }}>{betterDir(n) === "down" ? "lower better" : "higher better"}</div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 22, alignItems: "start" }} className="res-detail-grid">
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 24 }}>
          {/* metric charts */}
          <div>
            <SectionLabel right={run.state === "running" ? <span style={{ fontSize: 12, color: "var(--faint)" }}>live · polling 2s</span> : undefined}>Metrics</SectionLabel>
            {names.length === 0 ? (
              <Empty msg="No metrics logged yet." />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {names.map((n) => {
                  const pts = series[n] || [];
                  const last = pts.length ? pts[pts.length - 1].value : null;
                  const lr = isLrMetric(n);
                  return (
                    <div key={n} style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--muted)" }}>{n}</div>
                        <div style={{ fontFamily: "var(--mono)", fontSize: 14, fontWeight: 600, color: "var(--ink-strong)" }}>{last == null ? "—" : lr ? last.toExponential(1) : last.toFixed(3)}</div>
                      </div>
                      <MetricChart series={[{ name: n, color: runColor(run.id), points: pts }]} style={chartStyle} yKind={lr ? "lr" : undefined} height={150} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* audio panel */}
          <RunAudioPanel runId={run.id} colormap={colormap} />
        </div>

        {/* right rail */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }} className="res-rail">
          <Panel title="Config">
            {Object.entries(cfg).map(([k, v]) => (
              <KV key={k} k={k} v={typeof v === "object" ? JSON.stringify(v) : String(v)} />
            ))}
            {Object.keys(cfg).length === 0 && <span style={{ color: "var(--faint)", fontSize: 12.5 }}>No config logged.</span>}
          </Panel>
          <Panel title="System">
            <KV k="state" v={run.state} />
            <KV k="steps" v={fmt.int(curStep)} />
            <KV k="created" v={fmt.ago(run.created_at)} />
            {run.finished_at && <KV k="finished" v={fmt.ago(run.finished_at)} />}
          </Panel>
          {cfg.dataset != null && (
            <Panel title="Dataset">
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink)" }}>
                <Icon name="database" size={15} style={{ color: "var(--accent)" }} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>{String(cfg.dataset)}</span>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Audio panel ──
function RunAudioPanel({ runId, colormap }: { runId: string; colormap: ColormapName }) {
  const keys = useAudioKeys(runId);
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    if (keys.length && (!key || !keys.includes(key))) setKey(keys[0]);
  }, [keys, key]);

  if (keys.length === 0) return null;
  return (
    <div>
      <SectionLabel right={<div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--faint)" }}><Icon name="music" size={13} />original quality</div>}>Generated audio</SectionLabel>
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 2, padding: 8, borderBottom: "1px solid var(--line)", overflowX: "auto" }}>
          {keys.map((k) => (
            <button key={k} onClick={() => setKey(k)}
              style={{ border: 0, cursor: "pointer", padding: "8px 12px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
                background: key === k ? "var(--panel-3)" : "transparent", color: key === k ? "var(--ink-strong)" : "var(--muted)", fontFamily: "var(--mono)" }}>{k}</button>
          ))}
        </div>
        {key && <KeyPanel runId={runId} keyName={key} colormap={colormap} />}
      </div>
    </div>
  );
}

function KeyPanel({ runId, keyName, colormap }: { runId: string; keyName: string; colormap: ColormapName }) {
  const entries = useAudioEntries(runId, keyName);
  const [stepIdx, setStepIdx] = useState(0);
  useEffect(() => { setStepIdx(Math.max(0, entries.length - 1)); }, [entries.length, keyName]);
  const entry: AudioEntry | undefined = entries[Math.min(stepIdx, entries.length - 1)];
  const urls = useEntryUrls(entry);
  const [solo, setSolo] = useState<"out" | "ref">("out");
  const hasRef = !!entry?.reference_sha && !!urls.reference;
  useEffect(() => { if (!hasRef) setSolo("out"); }, [hasRef]);

  const activeUrl = solo === "out" ? urls.audio : urls.reference;
  const player = useAudioPlayer(activeUrl);
  const peaks = solo === "out" ? urls.peaks : urls.refPeaks;
  const spec = solo === "out" ? urls.spectrogram : urls.refSpectrogram;
  const progress = player.duration ? player.time / player.duration : 0;

  if (!entry) return <div style={{ padding: 18, color: "var(--faint)" }}>No samples for this key yet.</div>;

  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>{entry.caption ? "Prompt" : "Sample"}</span>
          {entry.caption && <span style={{ fontStyle: "italic", fontFamily: "var(--font-display)", fontSize: 18, color: "var(--ink-strong)" }}>“{entry.caption}”</span>}
        </div>
        {hasRef && (
          <div style={{ display: "flex", gap: 3, background: "var(--panel-2)", padding: 3, borderRadius: 8, border: "1px solid var(--line-soft)" }}>
            {(["out", "ref"] as const).map((v) => (
              <button key={v} onClick={() => setSolo(v)}
                style={{ border: 0, cursor: "pointer", padding: "6px 13px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
                  background: solo === v ? "var(--accent)" : "transparent", color: solo === v ? "var(--accent-ink)" : "var(--muted)" }}>{v === "out" ? "Output" : "Reference"}</button>
            ))}
          </div>
        )}
      </div>

      {entries.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap" }}>Step</span>
          <input type="range" min={0} max={entries.length - 1} value={Math.min(stepIdx, entries.length - 1)} onChange={(e) => setStepIdx(Number(e.target.value))} style={{ flex: 1 }} />
          <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-strong)", minWidth: 64, textAlign: "right" }}>{entry.step != null ? fmt.int(entry.step) : "—"}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>
        <button onClick={player.toggle} style={{ ...playBtnStyle(52), alignSelf: "center" }}>
          <Icon name={player.playing ? "pause" : "play"} size={22} fill={player.playing ? "none" : "current"} stroke={player.playing ? 2.4 : 0} />
        </button>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)" }}>
            <span>{solo === "out" ? "output waveform" : "reference waveform"}</span>
            <span>{fmt.time(player.time)} / {fmt.time(player.duration)}</span>
          </div>
          <Waveform peaksUrl={peaks} progress={progress} color={runColor(runId)} height={48} onSeek={(f) => player.seek(f * player.duration)} />
          <div style={{ fontSize: 11, color: "var(--faint)", fontFamily: "var(--mono)", marginTop: 2 }}>spectrogram</div>
          <Spectrogram imageUrl={spec} colormap={colormap} progress={progress} height={104} onSeek={(f) => player.seek(f * player.duration)} showAxis />
        </div>
      </div>
      {entries.length > 1 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}>
          <Icon name="sparkles" size={13} style={{ color: "var(--accent)" }} />
          Scrub the step slider to hear how this sample converges as training progresses.
        </div>
      )}
    </div>
  );
}
