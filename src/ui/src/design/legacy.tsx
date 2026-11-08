import { type CSSProperties, type ReactNode, useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";
import { ColormapSwatch } from "./ui";

type LegacyColormap = "viridis" | "magma" | "grayscale" | "azure" | "ember";

interface LegacyTweaks {
  dark: boolean;
  accent: string;
  density: "compact" | "balanced" | "comfy";
  chartStyle: "line" | "area" | "bold";
  colormap: LegacyColormap;
  layout: "topnav" | "sidebar";
  runsView: "table" | "cards";
}

const LEGACY_DEFAULTS: LegacyTweaks = {
  dark: false,
  accent: "#20afff",
  density: "balanced",
  chartStyle: "area",
  colormap: "magma",
  layout: "topnav",
  runsView: "table",
};

const LEGACY_STORAGE_KEY = "res_tweaks";

const LEGACY_COLORMAPS: LegacyColormap[] = ["viridis", "magma", "grayscale", "azure", "ember"];

const LEGACY_ACCENTS: { v: string; n: string }[] = [
  { v: "#20afff", n: "Azure" }, { v: "#ff82c2", n: "Pink" }, { v: "#5ad363", n: "Green" },
  { v: "#bb76ff", n: "Purple" }, { v: "#ff9b26", n: "Orange" }, { v: "#ffda40", n: "Yellow" },
];

function legacyContrastInk(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.6 ? "#0b0c0f" : "#ffffff";
}

function legacyThemeVars(t: LegacyTweaks): CSSProperties {
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
    "--accent": accent, "--accent-ink": legacyContrastInk(accent),
    "--row-h": dens.rowH + "px", "--pad": dens.pad + "px", "--gap": dens.gap + "px", "--fs": dens.fs + "px",
    "--ok": dark ? "#5ad363" : "#1f9d4d", "--warn": "#ff9b26", "--bad": "#ff6138",
    "--mono": "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",
    "--font-display": "'Roboto Serif', 'Times New Roman', serif",
    "--font-body": "'Inter', Helvetica, Arial, sans-serif",
    "--font-cta": "'Poppins', 'Inter', sans-serif",
  } as CSSProperties;
}

function useLegacyTweaks(): [LegacyTweaks, <K extends keyof LegacyTweaks>(key: K, value: LegacyTweaks[K]) => void] {
  const [values, setValues] = useState<LegacyTweaks>(() => {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) return { ...LEGACY_DEFAULTS, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return LEGACY_DEFAULTS;
  });
  const setTweak = useCallback(<K extends keyof LegacyTweaks>(key: K, value: LegacyTweaks[K]) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [values, setTweak];
}

type BtnKind = "primary" | "solid" | "ghost" | "outline" | "soft";
type BtnSize = "sm" | "md" | "lg";

export function LegacyBtn({
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{label}</div>
      {children}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} role="switch" aria-checked={value}
      style={{ position: "relative", width: 38, height: 22, border: 0, borderRadius: 999, cursor: "pointer", padding: 0,
        background: value ? "var(--accent)" : "var(--panel-3)", transition: "background 150ms" }}>
      <span style={{ position: "absolute", top: 2, left: value ? 18 : 2, width: 18, height: 18, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.3)", transition: "left 150ms" }} />
    </button>
  );
}

function Radio<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "flex", gap: 3, background: "var(--panel-2)", padding: 3, borderRadius: 8, border: "1px solid var(--line-soft)" }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          style={{ flex: 1, border: 0, cursor: "pointer", padding: "6px 8px", borderRadius: 6, fontSize: 12, fontWeight: 600, textTransform: "capitalize",
            background: value === o ? "var(--panel)" : "transparent", color: value === o ? "var(--ink-strong)" : "var(--muted)" }}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Section({ label }: { label: string }) {
  return <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)", marginTop: 4 }}>{label}</div>;
}

function LegacyTweaksPanel({ t, setTweak }: { t: LegacyTweaks; setTweak: <K extends keyof LegacyTweaks>(key: K, value: LegacyTweaks[K]) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") setOpen((o) => !o);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  return (
    <>
      <button onClick={() => setOpen((o) => !o)} title="Tweaks (⌘.)"
        style={{ position: "fixed", right: 20, bottom: 20, zIndex: 90, width: 46, height: 46, borderRadius: 999, border: "1px solid var(--line)",
          background: "var(--panel)", color: "var(--ink)", boxShadow: "var(--shadow)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="sliders" size={20} />
      </button>
      {open && (
        <div style={{ position: "fixed", right: 20, bottom: 78, zIndex: 91, width: 288, maxHeight: "calc(100vh - 110px)", overflowY: "auto",
          background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--shadow)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500, color: "var(--ink-strong)" }}>Tweaks</span>
            <button onClick={() => setOpen(false)} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)" }}><Icon name="x" size={16} /></button>
          </div>

          <Section label="Theme" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Dark mode</span>
            <Toggle value={t.dark} onChange={(v) => setTweak("dark", v)} />
          </div>
          <Row label="Accent">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LEGACY_ACCENTS.map((a) => (
                <button key={a.v} onClick={() => setTweak("accent", a.v)} title={a.n}
                  style={{ width: 26, height: 26, borderRadius: 7, background: a.v, cursor: "pointer",
                    border: t.accent === a.v ? "2px solid var(--panel)" : "2px solid transparent",
                    boxShadow: t.accent === a.v ? "0 0 0 2px rgba(127,127,127,0.5)" : "none" }} />
              ))}
            </div>
          </Row>

          <Section label="Spectrogram" />
          <Row label="Colormap">
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {LEGACY_COLORMAPS.map((m) => (
                <button key={m} onClick={() => setTweak("colormap", m)} title={m}
                  style={{ border: t.colormap === m ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: 6, padding: 0, cursor: "pointer", lineHeight: 0, overflow: "hidden" }}>
                  <ColormapSwatch map={m} w={38} h={20} />
                </button>
              ))}
            </div>
          </Row>

          <Section label="Charts" />
          <Row label="Style"><Radio value={t.chartStyle} options={["line", "area", "bold"]} onChange={(v) => setTweak("chartStyle", v)} /></Row>

          <Section label="Layout" />
          <Row label="Density"><Radio value={t.density} options={["compact", "balanced", "comfy"]} onChange={(v) => setTweak("density", v)} /></Row>
          <Row label="Nav"><Radio value={t.layout} options={["sidebar", "topnav"]} onChange={(v) => setTweak("layout", v)} /></Row>
          <Row label="Runs view"><Radio value={t.runsView} options={["table", "cards"]} onChange={(v) => setTweak("runsView", v)} /></Row>
        </div>
      )}
    </>
  );
}

export function LegacyFrame({ children }: { children: (colormap: LegacyColormap) => ReactNode }) {
  const [t, setTweak] = useLegacyTweaks();
  return (
    <div style={{ ...legacyThemeVars(t), background: "var(--bg)", color: "var(--ink)", minHeight: "100vh", fontFamily: "var(--font-body)", fontSize: "var(--fs)", letterSpacing: "-0.01em" }}>
      {children(t.colormap)}
      <LegacyTweaksPanel t={t} setTweak={setTweak} />
    </div>
  );
}
