// Bridges the generic /v1 API (runs + arbitrary metric names) to the leaderboard's eval columns.
// The real API has no per-run "eval" object, so we derive headline eval numbers from the last
// point of each `eval/*` metric series, and pick a primary metric for the trend sparkline.
import { useEffect, useState } from "react";
import { api, type MetricPoint, type Run } from "./api";

export interface EvalCol {
  key: string; // full metric name, e.g. "eval/clap"
  label: string; // e.g. "CLAP"
  better: "up" | "down";
}

const LOWER_BETTER = /loss|fad|mcd|latency|error|\bkl\b|wer|cer|nll|perplex|rtf|mae|mse|rmse/i;

export function colLabel(metric: string): string {
  const tail = metric.includes("/") ? metric.slice(metric.lastIndexOf("/") + 1) : metric;
  // Acronyms stay upper; underscores become hyphens (si_sdr -> SI-SDR).
  return tail
    .split("_")
    .map((p) => p.toUpperCase())
    .join("-");
}

export function betterDir(metric: string): "up" | "down" {
  return LOWER_BETTER.test(metric) ? "down" : "up";
}

export function fmtMetric(metric: string, v: number): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (/latency|_ms\b|ms$/i.test(metric)) return `${v.toFixed(0)}ms`;
  if (/\bpref|preference|win|rate\b/i.test(metric) && v <= 1) return `${Math.round(v * 100)}%`;
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export interface EnrichedRun extends Run {
  evalv: Record<string, number>;
  primary: MetricPoint[];
  primaryName: string | null;
  metricNames: string[];
  curStep: number;
}

function pickEvalNames(names: string[]): string[] {
  const evals = names.filter((n) => n.toLowerCase().startsWith("eval/"));
  return (evals.length ? evals : names).slice(0, 6);
}

export function pickPrimary(names: string[]): string | null {
  const ev = names.find((n) => n.toLowerCase().startsWith("eval/"));
  if (ev) return ev;
  const loss = names.find((n) => n.toLowerCase().startsWith("loss"));
  return loss ?? names[0] ?? null;
}

// Fetch runs for a project and enrich each with eval headline values + a primary trend series.
export function useEnrichedRuns(projectSlug: string | null) {
  const [runs, setRuns] = useState<EnrichedRun[]>([]);
  const [cols, setCols] = useState<EvalCol[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectSlug) {
      setRuns([]);
      setCols([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      const base = await api.runs(projectSlug);
      const enriched = await Promise.all(
        base.map(async (r): Promise<EnrichedRun> => {
          let names: string[] = [];
          try {
            names = await api.metricNames(r.id);
          } catch {
            names = [];
          }
          const evalNames = pickEvalNames(names);
          const primaryName = pickPrimary(names);
          const evalv: Record<string, number> = {};
          let primary: MetricPoint[] = [];
          let curStep = 0;
          await Promise.all([
            ...evalNames.map(async (n) => {
              try {
                const pts = await api.metrics(r.id, n);
                if (pts.length) {
                  evalv[n] = pts[pts.length - 1].value;
                  curStep = Math.max(curStep, pts[pts.length - 1].step);
                }
              } catch {
                /* ignore */
              }
            }),
            (async () => {
              if (!primaryName) return;
              try {
                primary = await api.metrics(r.id, primaryName);
                if (primary.length) curStep = Math.max(curStep, primary[primary.length - 1].step);
              } catch {
                /* ignore */
              }
            })(),
          ]);
          return { ...r, evalv, primary, primaryName, metricNames: names, curStep };
        })
      );
      if (!alive) return;
      // Eval columns = union of eval metric names across runs (capped), sorted with eval/* first.
      const colSet = new Set<string>();
      enriched.forEach((r) => Object.keys(r.evalv).forEach((k) => colSet.add(k)));
      const colNames = [...colSet].sort().slice(0, 4);
      setCols(colNames.map((key) => ({ key, label: colLabel(key), better: betterDir(key) })));
      setRuns(enriched);
      setLoading(false);
    })().catch((e) => {
      if (alive) {
        setError(String(e));
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [projectSlug]);

  return { runs, cols, loading, error };
}

export function metricLabel(name: string): string {
  const map: Record<string, string> = {
    "loss/total": "Total loss",
    "loss/diffusion": "Diffusion loss",
    "loss/gen": "Generator loss",
    "loss/disc": "Discriminator loss",
    "loss/mel": "Mel loss",
    "eval/clap": "CLAP score",
    "eval/fad": "FAD",
    "eval/pesq": "PESQ",
    "eval/sdr": "SDR",
    "eval/si_sdr": "SI-SDR",
    lr: "Learning rate",
  };
  return map[name] ?? name;
}

export const isLrMetric = (name: string) => name === "lr" || /learning.?rate/i.test(name);
