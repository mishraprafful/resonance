// Runs leaderboard — sortable table + card grid, eval columns derived from the run's eval/* metrics,
// trend sparklines, summary stat strip, search, and state filter.
import { useMemo, useState } from "react";
import type { Project } from "./api";
import { fmt, runColor, type ColormapName } from "./design/theme";
import { Icon } from "./design/icons";
import { Btn, Empty, PageTitle, ProgressBar, RunChip, Sparkline, StatTile, StatusDot, Tag, ViewToggle } from "./design/ui";
import { Spectrogram } from "./design/audioviz";
import { useHeroSpectrogram } from "./audioData";
import { fmtMetric, useEnrichedRuns, type EnrichedRun, type EvalCol } from "./runsData";

type SortState = { key: string; dir: "asc" | "desc" };

export function RunsView({
  project, runsView, onOpenRun, onCompare, colormap,
}: {
  project: Project;
  runsView: { value: "table" | "cards"; set: (v: "table" | "cards") => void };
  onOpenRun: (id: string) => void;
  onCompare: () => void;
  colormap: ColormapName;
}) {
  const { runs, cols, loading, error } = useEnrichedRuns(project.slug);
  const [sort, setSort] = useState<SortState | null>(null);
  const [q, setQ] = useState("");
  const [stateFilter, setStateFilter] = useState("all");

  const bests = useMemo(() => {
    const b: Record<string, number> = {};
    cols.forEach((c) => {
      const vals = runs.map((r) => r.evalv[c.key]).filter((v): v is number => v != null);
      if (vals.length) b[c.key] = c.better === "up" ? Math.max(...vals) : Math.min(...vals);
    });
    return b;
  }, [runs, cols]);

  const effectiveSort: SortState | null = sort ?? (cols[0] ? { key: cols[0].key, dir: cols[0].better === "up" ? "desc" : "asc" } : null);

  let filtered = runs.filter(
    (r) =>
      (stateFilter === "all" || r.state === stateFilter) &&
      (!q ||
        (r.display_name ?? "").toLowerCase().includes(q.toLowerCase()) ||
        String(r.config.model ?? "").toLowerCase().includes(q.toLowerCase()))
  );
  if (effectiveSort) {
    const s = effectiveSort;
    filtered = [...filtered].sort((a, b) => {
      const va = a.evalv[s.key] ?? (s.key === "progress" ? a.curStep : 0);
      const vb = b.evalv[s.key] ?? (s.key === "progress" ? b.curStep : 0);
      return s.dir === "desc" ? vb - va : va - vb;
    });
  }

  const setSortKey = (key: string, defBetter: "up" | "down") =>
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: defBetter === "up" ? "desc" : "asc" }));

  const running = runs.filter((r) => r.state === "running").length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <PageTitle eyebrow="Project" size={36}>{project.name}</PageTitle>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14, maxWidth: 560 }}>
            <span style={{ fontFamily: "var(--mono)" }}>{project.slug}</span> · {runs.length} runs · created {fmt.ago(project.created_at)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn kind="outline" icon="columns" onClick={onCompare}>Compare</Btn>
          <Btn kind="primary" icon="plus">New run</Btn>
        </div>
      </div>

      {/* summary stat strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 22 }}>
        <StatTile label="Runs" value={fmt.int(runs.length)} sub={`${running} running`} />
        {cols[0] && bests[cols[0].key] != null && (
          <StatTile label={`${cols[0].label} · best`} value={fmtMetric(cols[0].key, bests[cols[0].key])} accent sub="leader" />
        )}
        {cols[1] && bests[cols[1].key] != null && (
          <StatTile label={`${cols[1].label} · best`} value={fmtMetric(cols[1].key, bests[cols[1].key])} sub={cols[1].better === "down" ? "lower better" : "higher better"} />
        )}
        <StatTile label="States" value={`${runs.filter((r) => r.state === "finished").length} done`} sub={`${runs.filter((r) => r.state === "failed").length} failed`} />
      </div>

      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "7px 11px", minWidth: 220, flex: "0 1 280px" }}>
          <Icon name="search" size={15} style={{ color: "var(--faint)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs or models…"
            style={{ border: 0, outline: 0, background: "transparent", color: "var(--ink)", fontSize: 13.5, fontFamily: "var(--font-body)", width: "100%" }} />
        </div>
        <div style={{ display: "flex", gap: 4, background: "var(--panel-2)", padding: 3, borderRadius: "var(--r-md)", border: "1px solid var(--line-soft)" }}>
          {["all", "running", "finished", "failed"].map((s) => (
            <button key={s} onClick={() => setStateFilter(s)}
              style={{ border: 0, cursor: "pointer", padding: "6px 11px", borderRadius: "var(--r-sm)", fontSize: 12.5, fontWeight: 600, textTransform: "capitalize",
                background: stateFilter === s ? "var(--panel)" : "transparent", color: stateFilter === s ? "var(--ink)" : "var(--muted)" }}>{s}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <ViewToggle value={runsView.value} onChange={runsView.set} />
      </div>

      {error && <Empty msg={`Couldn't load runs: ${error}`} />}
      {!error && loading && runs.length === 0 && <Empty msg="Loading runs…" />}
      {!error && !loading && runs.length === 0 && <Empty msg="No runs yet. Start one with the SDK." />}

      {runs.length > 0 &&
        (runsView.value === "table" ? (
          <RunsTable runs={filtered} cols={cols} bests={bests} sort={effectiveSort} setSortKey={setSortKey} onOpenRun={onOpenRun} />
        ) : (
          <RunsCards runs={filtered} cols={cols} bests={bests} onOpenRun={onOpenRun} colormap={colormap} />
        ))}
    </div>
  );
}

function RunsTable({
  runs, cols, bests, sort, setSortKey, onOpenRun,
}: {
  runs: EnrichedRun[]; cols: EvalCol[]; bests: Record<string, number>;
  sort: SortState | null; setSortKey: (key: string, better: "up" | "down") => void; onOpenRun: (id: string) => void;
}) {
  const Th = ({ children, sortKey, better = "up", align = "left", w }: { children: React.ReactNode; sortKey?: string; better?: "up" | "down"; align?: "left" | "right"; w?: number }) => (
    <th onClick={sortKey ? () => setSortKey(sortKey, better) : undefined}
      style={{ textAlign: align, padding: "0 14px 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
        color: sort?.key === sortKey ? "var(--ink)" : "var(--muted)", cursor: sortKey ? "pointer" : "default", whiteSpace: "nowrap", width: w, userSelect: "none" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexDirection: align === "right" ? "row-reverse" : "row" }}>
        {children}
        {sortKey && sort?.key === sortKey && <Icon name={sort.dir === "desc" ? "trending-down" : "trending-up"} size={12} />}
      </span>
    </th>
  );
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs)" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "16px 14px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Run</th>
              <Th>Model</Th>
              <th style={{ padding: "0 14px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Trend</th>
              {cols.map((c) => (
                <Th key={c.key} sortKey={c.key} better={c.better} align="right">{c.label}</Th>
              ))}
              <Th sortKey="progress" better="up" align="right">Steps</Th>
              <th style={{ padding: "0 16px 10px" }}></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} onClick={() => onOpenRun(r.id)} className="res-row" style={{ borderBottom: "1px solid var(--line-soft)", cursor: "pointer" }}>
                <td style={{ padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: runColor(r.id), flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 500, color: "var(--ink-strong)", letterSpacing: "-0.01em" }}>{r.display_name ?? r.id.slice(0, 8)}</div>
                      <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 2 }}><StatusDot state={r.state} /></div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "12px 14px" }}>{r.config.model ? <Tag>{String(r.config.model)}</Tag> : <span style={{ color: "var(--faint)" }}>—</span>}</td>
                <td style={{ padding: "12px 14px" }}><Sparkline points={r.primary} color={runColor(r.id)} w={84} h={26} /></td>
                {cols.map((c) => {
                  const v = r.evalv[c.key];
                  const isBest = v != null && v === bests[c.key];
                  return (
                    <td key={c.key} style={{ padding: "12px 14px", textAlign: "right", fontFamily: "var(--mono)", fontSize: 13, color: isBest ? "var(--accent)" : "var(--ink)", fontWeight: isBest ? 700 : 500 }}>
                      {v != null ? fmtMetric(c.key, v) : "—"}
                    </td>
                  );
                })}
                <td style={{ padding: "12px 14px", textAlign: "right" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>{fmt.step(r.curStep)}</span>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right" }}><Icon name="chevron-right" size={16} style={{ color: "var(--faint)" }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunCard({ run, cols, bests, onOpenRun, colormap }: { run: EnrichedRun; cols: EvalCol[]; bests: Record<string, number>; onOpenRun: (id: string) => void; colormap: ColormapName }) {
  const heroUrl = useHeroSpectrogram(run.id);
  return (
    <div onClick={() => onOpenRun(run.id)} className="res-card"
      style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 16, cursor: "pointer", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div>
          <RunChip run={run} />
          {run.config.model != null && (
            <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
              <Tag>{String(run.config.model)}</Tag>
            </div>
          )}
        </div>
        <StatusDot state={run.state} />
      </div>
      <div style={{ borderRadius: "var(--r-sm)", overflow: "hidden", border: "1px solid var(--line-soft)" }}>
        <Spectrogram imageUrl={heroUrl} colormap={colormap} height={56} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", gap: 16 }}>
          {cols.slice(0, 2).map((c) => {
            const v = run.evalv[c.key];
            const isBest = v != null && v === bests[c.key];
            return (
              <div key={c.key}>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>{c.label}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: isBest ? 700 : 500, color: isBest ? "var(--accent)" : "var(--ink-strong)", marginTop: 2 }}>{v != null ? fmtMetric(c.key, v) : "—"}</div>
              </div>
            );
          })}
        </div>
        <Sparkline points={run.primary} color={runColor(run.id)} w={72} h={30} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ProgressBar value={run.state === "finished" ? 1 : 0.6} color={runColor(run.id)} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", whiteSpace: "nowrap" }}>{fmt.step(run.curStep)}</span>
      </div>
    </div>
  );
}

function RunsCards({ runs, cols, bests, onOpenRun, colormap }: { runs: EnrichedRun[]; cols: EvalCol[]; bests: Record<string, number>; onOpenRun: (id: string) => void; colormap: ColormapName }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
      {runs.map((r) => (
        <RunCard key={r.id} run={r} cols={cols} bests={bests} onOpenRun={onOpenRun} colormap={colormap} />
      ))}
    </div>
  );
}
