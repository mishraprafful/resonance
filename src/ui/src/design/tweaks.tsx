// Tweaks: a real settings panel (localStorage-backed) — the production analogue of the prototype's
// host-driven edit panel. Controls theme, accent, spectrogram colormap, chart style, density,
// nav layout, and the runs view. A floating button toggles the panel open.
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Icon } from "./icons";
import { ColormapSwatch } from "./ui";
import { ACCENTS, TWEAK_DEFAULTS, type Tweaks } from "./theme";
import { COLORMAP_NAMES } from "./colormaps";

const STORAGE_KEY = "res_tweaks_v2";

export function useTweaks(): [Tweaks, <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void] {
  const [values, setValues] = useState<Tweaks>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...TWEAK_DEFAULTS, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return TWEAK_DEFAULTS;
  });
  const setTweak = useCallback(<K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  return [values, setTweak];
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)" }}>{label}</div>
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
    <div style={{ display: "flex", gap: 2, background: "var(--panel-2)", padding: 2, borderRadius: "var(--r-md)", border: "1px solid var(--line)" }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          style={{ flex: 1, border: 0, cursor: "pointer", padding: "6px 8px", borderRadius: "var(--r-sm)", fontSize: 12, fontWeight: 600, textTransform: "capitalize",
            background: value === o ? "var(--panel-3)" : "transparent", color: value === o ? "var(--ink-strong)" : "var(--muted)",
            boxShadow: value === o ? "inset 0 0 0 1px var(--line)" : "none" }}>
          {o}
        </button>
      ))}
    </div>
  );
}

function Section({ label }: { label: string }) {
  return <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--accent-2)", marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--line-soft)" }}>{label}</div>;
}

export function TweaksPanel({ t, setTweak }: { t: Tweaks; setTweak: <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => void }) {
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
        style={{ position: "fixed", right: 20, bottom: 20, zIndex: 90, width: 42, height: 42, borderRadius: "var(--r-lg)", border: "1px solid var(--line)",
          background: "var(--panel)", color: "var(--ink)", boxShadow: "var(--shadow)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon name="sliders" size={20} />
      </button>
      {open && (
        <div style={{ position: "fixed", right: 20, bottom: 78, zIndex: 91, width: 288, maxHeight: "calc(100vh - 110px)", overflowY: "auto",
          background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--ink-strong)" }}>Tweaks</span>
            <button onClick={() => setOpen(false)} style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--muted)" }}><Icon name="x" size={16} /></button>
          </div>

          <Section label="Theme" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Dark mode</span>
            <Toggle value={t.dark} onChange={(v) => setTweak("dark", v)} />
          </div>
          <Row label="Accent">
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ACCENTS.map((a) => (
                <button key={a.v} onClick={() => setTweak("accent", a.v)} title={a.n}
                  style={{ width: 26, height: 26, borderRadius: "var(--r-md)", background: a.v, cursor: "pointer",
                    border: t.accent === a.v ? "2px solid var(--panel)" : "2px solid transparent",
                    boxShadow: t.accent === a.v ? "0 0 0 2px rgba(127,127,127,0.5)" : "none" }} />
              ))}
            </div>
          </Row>

          <Section label="Spectrogram" />
          <Row label="Colormap">
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {COLORMAP_NAMES.map((m) => (
                <button key={m} onClick={() => setTweak("colormap", m)} title={m}
                  style={{ border: t.colormap === m ? "2px solid var(--accent)" : "2px solid transparent", borderRadius: "var(--r-sm)", padding: 0, cursor: "pointer", lineHeight: 0, overflow: "hidden" }}>
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
