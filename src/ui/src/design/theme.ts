// Theme tokens, run colors, and number formatting for the Resonance Signal design system.
// themeVars() builds the CSS custom properties consumed (as `var(--token)`) across every component.

export type Density = "compact" | "balanced" | "comfy";
export type ChartStyle = "line" | "area" | "bold";
export type LayoutVariant = "topnav" | "sidebar";
export type RunsViewMode = "table" | "cards";
export type ColormapName = "signal" | "viridis" | "magma" | "grayscale" | "azure" | "ember";
export type ThemeChoice = "system" | "light" | "dark";
export const THEME_CHOICES: ThemeChoice[] = ["system", "light", "dark"];

export interface Tweaks {
  theme: ThemeChoice;
  accent: string;
  density: Density;
  chartStyle: ChartStyle;
  colormap: ColormapName;
  layout: LayoutVariant;
  runsView: RunsViewMode;
}

export const TWEAK_DEFAULTS: Tweaks = {
  theme: "system",
  accent: "#8b7bff",
  density: "balanced",
  chartStyle: "line",
  colormap: "signal",
  layout: "sidebar",
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
export function themeVars(t: Tweaks, dark: boolean): React.CSSProperties {
  const accent = accentFor(t.accent || "#8b7bff", dark);
  const base = dark
    ? {
        bg: "#0a0c10", panel: "#11141a", panel2: "#161a22", panel3: "#1d222c",
        ink: "#d9dee8", inkStrong: "#f5f7fb", muted: "#8a93a6", faint: "#656d80",
        line: "rgba(148,163,184,0.14)", lineSoft: "rgba(148,163,184,0.07)", grid: "rgba(148,163,184,0.045)",
        shadow: "0 18px 48px rgba(0,0,0,0.55)", scrim: "rgba(3,4,8,0.7)",
      }
    : {
        bg: "#f4f5f8", panel: "#ffffff", panel2: "#f7f8fb", panel3: "#eceef3",
        ink: "#1a1f2b", inkStrong: "#0a0d14", muted: "#535c6e", faint: "#687083",
        line: "rgba(15,23,42,0.12)", lineSoft: "rgba(15,23,42,0.06)", grid: "rgba(15,23,42,0.04)",
        shadow: "0 18px 48px rgba(15,23,42,0.14)", scrim: "rgba(15,23,42,0.45)",
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
    "--line": base.line, "--line-soft": base.lineSoft, "--grid": base.grid, "--shadow": base.shadow, "--scrim": base.scrim,
    "--accent": accent, "--accent-ink": contrastInk(accent), "--accent-2": dark ? "#2de2c4" : "#0f766e",
    "--accent-soft": `color-mix(in srgb, ${accent} 14%, transparent)`,
    "--row-h": dens.rowH + "px", "--pad": dens.pad + "px", "--gap": dens.gap + "px", "--fs": dens.fs + "px",
    "--ok": dark ? "#34d399" : "#047857", "--warn": dark ? "#fbbf24" : "#b45309", "--bad": dark ? "#f87171" : "#dc2626",
    "--r-sm": "4px", "--r-md": "6px", "--r-lg": "10px",
    "--font-display": "'Space Grotesk', 'IBM Plex Sans', system-ui, sans-serif",
    "--font-body": "'IBM Plex Sans', system-ui, sans-serif",
    "--font-cta": "'Space Grotesk', 'IBM Plex Sans', sans-serif",
    "--mono": "'IBM Plex Mono', ui-monospace, Menlo, monospace",
  } as React.CSSProperties;
}

const RUN_PALETTE_DARK = [
  "#8b7bff", "#2de2c4", "#fbbf24", "#f472b6", "#60a5fa",
  "#a3e635", "#fb923c", "#c084fc", "#22d3ee", "#f87171",
];
const RUN_PALETTE_LIGHT = [
  "#5b47e0", "#0f766e", "#b45309", "#be185d", "#1d4ed8",
  "#4d7c0f", "#c2410c", "#7e22ce", "#0e7490", "#b91c1c",
];
let runPalette = RUN_PALETTE_DARK;
export function setRunPalette(dark: boolean): void {
  runPalette = dark ? RUN_PALETTE_DARK : RUN_PALETTE_LIGHT;
}
export function runColor(runId: string): string {
  let h = 0;
  for (let i = 0; i < runId.length; i++) h = (h * 31 + runId.charCodeAt(i)) >>> 0;
  return runPalette[h % runPalette.length];
}

export const ACCENTS: { v: string; light: string; n: string }[] = [
  { v: "#8b7bff", light: "#5b47e0", n: "Violet" }, { v: "#2de2c4", light: "#0f766e", n: "Teal" },
  { v: "#60a5fa", light: "#1d4ed8", n: "Sky" }, { v: "#a3e635", light: "#4d7c0f", n: "Lime" },
  { v: "#fbbf24", light: "#b45309", n: "Amber" }, { v: "#f472b6", light: "#be185d", n: "Rose" },
];
export function accentFor(accent: string, dark: boolean): string {
  if (dark) return accent;
  return ACCENTS.find((a) => a.v === accent)?.light ?? accent;
}

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
