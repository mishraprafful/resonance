// Shared UI atoms: buttons, badges, status dots, tags, run chips, sparklines, stat tiles,
// progress bars, panels, section labels, empty states, colormap swatches, and view toggles.
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { Icon } from "./icons";
import { runColor } from "./theme";
import { COLORMAPS, COLORMAP_NAMES } from "./colormaps";
import type { ColormapName } from "./theme";
import type { MetricPoint, Run } from "../api";

type BtnKind = "primary" | "solid" | "ghost" | "outline" | "soft";
type BtnSize = "sm" | "md" | "lg";

export function Btn({
  children, kind = "ghost", size = "md", icon, iconRight, active, onClick, title, style, disabled,
}: {
  children?: ReactNode; kind?: BtnKind; size?: BtnSize; icon?: string; iconRight?: string;
  active?: boolean; onClick?: () => void; title?: string; style?: CSSProperties; disabled?: boolean;
}) {
  const pad = size === "sm" ? "6px 10px" : size === "lg" ? "12px 20px" : "9px 14px";
  const fs = size === "sm" ? 12.5 : size === "lg" ? 15 : 13.5;
  const base: CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 7, padding: pad, fontSize: fs,
    fontFamily: "var(--font-body)", fontWeight: 600, letterSpacing: "-0.01em",
    borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", border: "1px solid transparent",
    lineHeight: 1, opacity: disabled ? 0.5 : 1,
    transition: "background var(--dur-fast,120ms), border-color var(--dur-fast,120ms), transform var(--dur-fast,120ms)",
    whiteSpace: "nowrap", userSelect: "none",
  };
  const kinds: Record<BtnKind, CSSProperties> = {
    primary: { background: "var(--accent)", color: "var(--accent-ink)" },
    solid: { background: "var(--ink-strong)", color: "var(--bg)" },
    ghost: { background: active ? "var(--panel-3)" : "transparent", color: "var(--ink)", borderColor: "transparent" },
    outline: { background: "transparent", color: "var(--ink)", borderColor: "var(--line)" },
    soft: { background: "var(--panel-2)", color: "var(--ink)", border: "1px solid var(--line-soft)" },
  };
  return (
    <button title={title} onClick={onClick} disabled={disabled} className="res-btn" data-kind={kind}
      style={{ ...base, ...kinds[kind], ...style }}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 14 : 16} />}
    </button>
  );
}

type BadgeTone = "neutral" | "accent" | "ok" | "warn" | "bad";
export function Badge({ children, tone = "neutral", style }: { children: ReactNode; tone?: BadgeTone; style?: CSSProperties }) {
  const tones: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: "var(--panel-3)", fg: "var(--muted)" },
    accent: { bg: "color-mix(in srgb, var(--accent) 18%, transparent)", fg: "var(--accent)" },
    ok: { bg: "color-mix(in srgb, var(--ok) 16%, transparent)", fg: "var(--ok)" },
    warn: { bg: "color-mix(in srgb, var(--warn) 18%, transparent)", fg: "var(--warn)" },
    bad: { bg: "color-mix(in srgb, var(--bad) 18%, transparent)", fg: "var(--bad)" },
  };
  const c = tones[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.01em", background: c.bg, color: c.fg, ...style }}>
      {children}
    </span>
  );
}

export function StatusDot({ state }: { state: string }) {
  const map: Record<string, { c: string; pulse?: boolean; label: string }> = {
    running: { c: "var(--ok)", pulse: true, label: "running" },
    finished: { c: "var(--muted)", label: "finished" },
    failed: { c: "var(--bad)", label: "failed" },
    queued: { c: "var(--warn)", label: "queued" },
  };
  const s = map[state] || { c: "var(--muted)", label: state || "—" };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--ink)", textTransform: "capitalize" }}>
      <span style={{ position: "relative", width: 8, height: 8 }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: s.c }} />
        {s.pulse && <span className="res-pulse" style={{ position: "absolute", inset: 0, borderRadius: 999, background: s.c }} />}
      </span>
      {s.label}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: "var(--mono)", fontSize: 11, padding: "2px 6px", borderRadius: 4,
      background: "var(--panel-2)", border: "1px solid var(--line-soft)", color: "var(--muted)" }}>
      {children}
    </span>
  );
}

export function RunChip({ run, dot = true }: { run: Run; dot?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em" }}>
      {dot && <span style={{ width: 9, height: 9, borderRadius: 3, background: runColor(run.id), flexShrink: 0 }} />}
      {run.display_name ?? run.id.slice(0, 8)}
    </span>
  );
}

export function Sparkline({ points, color = "var(--accent)", w = 96, h = 28, fillArea = true }: {
  points: MetricPoint[]; color?: string; w?: number; h?: number; fillArea?: boolean;
}) {
  if (!points || points.length < 2) return <svg width={w} height={h} />;
  const ys = points.map((p) => p.value);
  const mn = Math.min(...ys), mx = Math.max(...ys), rg = mx - mn || 1;
  const n = points.length;
  const sx = (i: number) => (i / (n - 1)) * w;
  const sy = (v: number) => h - 3 - ((v - mn) / rg) * (h - 6);
  const line = points.map((p, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = "sg" + Math.random().toString(36).slice(2, 7);
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      {fillArea && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.22" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

export function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 6, color: accent ? "var(--accent)" : "var(--ink-strong)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <div style={{ height: 5, borderRadius: 999, background: "var(--panel-3)", overflow: "hidden", minWidth: 60 }}>
      <div style={{ width: `${Math.round(value * 100)}%`, height: "100%", background: color || "var(--accent)", borderRadius: 999 }} />
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 12 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>{children}</div>
    </div>
  );
}

export function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5 }}>
      <span style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>{k}</span>
      <span style={{ color: "var(--ink)", fontFamily: "var(--mono)", textAlign: "right", wordBreak: "break-all" }}>{v}</span>
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--muted)", whiteSpace: "nowrap" }}>{children}</div>
      {right}
    </div>
  );
}

export function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: 48, textAlign: "center", color: "var(--muted)", background: "var(--panel)", border: "1px dashed var(--line)", borderRadius: 12 }}>{msg}</div>;
}

export function ColormapSwatch({ map, w = 40, h = 22 }: { map: ColormapName; w?: number; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const cmap = COLORMAPS[map];
    for (let x = 0; x < w; x++) {
      const [r, g, b] = cmap(x / (w - 1));
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x, 0, 1, h);
    }
  }, [map, w, h]);
  return <canvas ref={ref} width={w} height={h} style={{ display: "block", borderRadius: 5 }} />;
}

export function ColormapPicker({ value, onChange, names = COLORMAP_NAMES }: {
  value: ColormapName; onChange: (m: ColormapName) => void; names?: ColormapName[];
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {names.map((m) => (
        <button key={m} onClick={() => onChange(m)} title={m}
          style={{ border: value === m ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 7, padding: 0, cursor: "pointer", overflow: "hidden", lineHeight: 0 }}>
          <ColormapSwatch map={m} />
        </button>
      ))}
    </div>
  );
}

export function ViewToggle({ value, onChange }: { value: string; onChange: (v: "table" | "cards") => void }) {
  const opts: [string, string][] = [["table", "list"], ["cards", "grid"]];
  return (
    <div style={{ display: "flex", gap: 3, background: "var(--panel-2)", padding: 3, borderRadius: 8, border: "1px solid var(--line-soft)" }}>
      {opts.map(([v, ic]) => (
        <button key={v} onClick={() => onChange(v as "table" | "cards")} title={v}
          style={{ border: 0, cursor: "pointer", padding: "6px 9px", borderRadius: 6, display: "flex", alignItems: "center",
            background: value === v ? "var(--panel)" : "transparent", color: value === v ? "var(--ink)" : "var(--muted)" }}>
          <Icon name={ic} size={16} />
        </button>
      ))}
    </div>
  );
}

// Segmented tab control used across toolbars (filters, view tabs, prompt tabs).
export function Segmented<T extends string>({ value, options, onChange, mono }: {
  value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void; mono?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 3, background: "var(--panel-2)", padding: 3, borderRadius: 9, border: "1px solid var(--line-soft)", overflowX: "auto" }}>
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          style={{ border: 0, cursor: "pointer", padding: o.icon ? "8px 14px" : "7px 12px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
            fontFamily: mono ? "var(--mono)" : "var(--font-body)",
            background: value === o.value ? "var(--panel)" : "transparent",
            color: value === o.value ? "var(--ink-strong)" : "var(--muted)",
            boxShadow: value === o.value && o.icon ? "var(--shadow)" : "none" }}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
