// Theme tokens, run colors, and number formatting — the Epidemic Sound-grounded design system.
// themeVars() builds the CSS custom properties consumed (as `var(--token)`) across every component.

export type Density = "compact" | "balanced" | "comfy";
export type ChartStyle = "line" | "area" | "bold";
export type LayoutVariant = "topnav" | "sidebar";
export type RunsViewMode = "table" | "cards";
export type ColormapName = "viridis" | "magma" | "grayscale" | "azure" | "ember";

export interface Tweaks {
  dark: boolean;
  accent: string;
  density: Density;
  chartStyle: ChartStyle;
  colormap: ColormapName;
  layout: LayoutVariant;
  runsView: RunsViewMode;
}

export const TWEAK_DEFAULTS: Tweaks = {
  dark: false,
  accent: "#20afff",
  density: "balanced",
  chartStyle: "area",
  colormap: "magma",
  layout: "topnav",
  runsView: "table",
};

export function contrastInk(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.6 ? "#0b0c0f" : "#ffffff";
}

// Build the CSS custom-property bag for the active tweaks. Spread onto a root element's style.
export function themeVars(t: Tweaks): React.CSSProperties {
  const dark = t.dark;
  const accent = t.accent || "#20afff";
  const base = dark
    ? {
        bg: "#191b20", panel: "#23262d", panel2: "#2b2f37", panel3: "#31353e",
        ink: "#f1f0eb", inkStrong: "#ffffff", muted: "#969cab", faint: "#6b7180",
        line: "rgba(255,255,255,0.10)", lineSoft: "rgba(255,255,255,0.055)",
        shadow: "0 12px 32px rgba(0,0,0,0.5)", scrim: "rgba(0,0,0,0.6)",
      }
    : {
        bg: "#f1f0eb", panel: "#ffffff", panel2: "#f6f5f0", panel3: "#efede6",
        ink: "#292c33", inkStrong: "#000000", muted: "#5a5e6a", faint: "#8a8e98",
        line: "rgba(0,0,0,0.11)", lineSoft: "rgba(0,0,0,0.055)",
        shadow: "0 12px 32px rgba(0,0,0,0.14)", scrim: "rgba(0,0,0,0.4)",
      };
  const dens =
    t.density === "compact"
      ? { rowH: 34, pad: 14, gap: 12, fs: 13 }
      : t.density === "comfy"
        ? { rowH: 52, pad: 26, gap: 22, fs: 15 }
        : { rowH: 42, pad: 20, gap: 16, fs: 14 };
  return {
    "--bg": base.bg, "--panel": base.panel, "--panel-2": base.panel2, "--panel-3": base.panel3,
    "--ink": base.ink, "--ink-strong": base.inkStrong, "--muted": base.muted, "--faint": base.faint,
    "--line": base.line, "--line-soft": base.lineSoft, "--shadow": base.shadow, "--scrim": base.scrim,
    "--accent": accent, "--accent-ink": contrastInk(accent),
    "--row-h": dens.rowH + "px", "--pad": dens.pad + "px", "--gap": dens.gap + "px", "--fs": dens.fs + "px",
    "--ok": dark ? "#5ad363" : "#1f9d4d", "--warn": "#ff9b26", "--bad": "#ff6138",
    "--mono": "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
  } as React.CSSProperties;
}

// Stable per-run colors from the extended ES palette.
const RUN_PALETTE = [
  "#20afff", "#ff82c2", "#5ad363", "#bb76ff", "#ff9b26",
  "#ffda40", "#6792ff", "#ff6138", "#91ceda", "#d6832b",
];
export function runColor(runId: string): string {
  let h = 0;
  for (let i = 0; i < runId.length; i++) h = (h * 31 + runId.charCodeAt(i)) >>> 0;
  return RUN_PALETTE[h % RUN_PALETTE.length];
}

export const ACCENTS: { v: string; n: string }[] = [
  { v: "#20afff", n: "Azure" }, { v: "#ff82c2", n: "Pink" }, { v: "#5ad363", n: "Green" },
  { v: "#bb76ff", n: "Purple" }, { v: "#ff9b26", n: "Orange" }, { v: "#ffda40", n: "Yellow" },
];

// Number / time formatting helpers.
export const fmt = {
  int: (n: number) => n.toLocaleString("en-US"),
  compact: (n: number) =>
    Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n),
  pct: (n: number) => `${Math.round(n * 100)}%`,
  step: (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : `${n}`),
  dur: (h: number) => (h >= 24 ? `${(h / 24).toFixed(1)}d` : `${h.toFixed(1)}h`),
  ago: (iso: string) => {
    const d = (Date.now() - Date.parse(iso)) / 86400000;
    if (Number.isNaN(d)) return "—";
    if (d < 1) return "today";
    if (d < 2) return "yesterday";
    if (d < 30) return `${Math.round(d)}d ago`;
    return `${Math.round(d / 30)}mo ago`;
  },
  time: (s: number) => {
    if (!Number.isFinite(s)) s = 0;
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${m}:${ss.toString().padStart(2, "0")}`;
  },
  initials: (u: string) =>
    u.split(/[.\s_-]/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join(""),
};
