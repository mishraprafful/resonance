// Audio sample gallery — every generated sample for a key across the project's runs, with inline
// spectrograms + waveforms. Click a tile for the full-screen spectrogram focus viewer (live colormap
// switching, playback). All audio is presigned original quality, lazily.
import { useEffect, useState } from "react";
import { api, type AudioEntry, type Project } from "./api";
import { fmt, runColor, type ColormapName } from "./design/theme";
import { Icon } from "./design/icons";
import { Btn, ColormapPicker, Empty, Segmented } from "./design/ui";
import { Spectrogram, Waveform, playBtnStyle, useAudioPlayer } from "./design/audioviz";
import { fetchAllEntries } from "./audioData";
import { useEnrichedRuns, type EnrichedRun } from "./runsData";

interface Card { run: EnrichedRun; entry: AudioEntry; url?: string; peaks?: string; spec?: string }

export function GalleryPage({ project, colormap }: { project: Project; colormap: ColormapName }) {
  const { runs } = useEnrichedRuns(project.slug);
  const [keys, setKeys] = useState<string[]>([]);
  const [keyName, setKeyName] = useState<string | null>(null);
  const [allSteps, setAllSteps] = useState(false);
  const [runFilter, setRunFilter] = useState<string[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [focus, setFocus] = useState<Card | null>(null);

  useEffect(() => {
    setRunFilter(runs.slice(0, 6).map((r) => r.id));
  }, [runs.map((r) => r.id).join(",")]);

  useEffect(() => {
    if (!runs.length) return;
    api.audioKeys(runs[0].id).then((k) => {
      const sorted = [...k].sort();
      setKeys(sorted);
      setKeyName((cur) => (cur && sorted.includes(cur) ? cur : sorted[0] ?? null));
    }).catch(() => setKeys([]));
  }, [runs.map((r) => r.id).join(",")]);

  const filterKey = runFilter.join(",");
  useEffect(() => {
    if (!keyName) {
      setCards([]);
      return;
    }
    let alive = true;
    (async () => {
      const sel = runs.filter((r) => runFilter.includes(r.id));
      const built: Card[] = [];
      for (const r of sel) {
        try {
          const entries = await fetchAllEntries(r.id, keyName);
          const chosen = allSteps ? entries : entries.slice(-1);
          for (const e of chosen) {
            const [url, peaks, spec] = await Promise.all([
              api.presign(e.asset_sha, "original").catch(() => undefined),
              e.has_peaks ? api.presign(e.asset_sha, "peaks").catch(() => undefined) : Promise.resolve(undefined),
              e.has_spectrogram ? api.presign(e.asset_sha, "spectrogram").catch(() => undefined) : Promise.resolve(undefined),
            ]);
            built.push({ run: r, entry: e, url, peaks, spec });
          }
        } catch {
          /* skip */
        }
      }
      if (alive) setCards(built);
    })();
    return () => {
      alive = false;
    };
  }, [keyName, allSteps, filterKey, runs.map((r) => r.id).join(",")]);

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 34, fontWeight: 500, letterSpacing: "-0.03em", margin: 0, color: "var(--ink-strong)" }}>Sample gallery</h1>
        <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 14 }}>{project.name} · every generated sample, with inline spectrograms. Click a tile to open the viewer.</p>
      </div>

      {runs.length === 0 && <Empty msg="No runs in this project." />}
      {runs.length > 0 && keys.length === 0 && <Empty msg="No audio logged for these runs yet." />}

      {keys.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
            {keyName && <Segmented mono value={keyName} onChange={setKeyName} options={keys.map((k) => ({ value: k, label: k }))} />}
            <Btn kind={allSteps ? "primary" : "outline"} icon="layers" size="sm" onClick={() => setAllSteps((s) => !s)}>{allSteps ? "All steps" : "Latest step"}</Btn>
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 20 }}>
            {runs.map((r) => {
              const on = runFilter.includes(r.id);
              return (
                <button key={r.id} onClick={() => setRunFilter((s) => (on ? s.filter((x) => x !== r.id) : [...s, r.id]))}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 600,
                    border: `1px solid ${on ? runColor(r.id) : "var(--line)"}`, background: on ? `color-mix(in srgb, ${runColor(r.id)} 10%, transparent)` : "transparent", color: on ? "var(--ink)" : "var(--faint)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: runColor(r.id), opacity: on ? 1 : 0.4 }} />
                  {r.display_name ?? r.id.slice(0, 8)}
                </button>
              );
            })}
          </div>

          {cards.length === 0 ? (
            <Empty msg="No samples for the current filters." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {cards.map((c) => (
                <div key={c.entry.id} onClick={() => setFocus(c)} className="res-card"
                  style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", cursor: "pointer" }}>
                  <Spectrogram imageUrl={c.spec} colormap={colormap} height={96} />
                  <div style={{ padding: "10px 12px" }}>
                    <Waveform peaksUrl={c.peaks} color={runColor(c.run.id)} height={26} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <PlayBtn url={c.url} size={32} />
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-strong)", display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: runColor(c.run.id) }} />{c.run.display_name ?? c.run.id.slice(0, 8)}
                          </div>
                          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--faint)", marginTop: 2 }}>
                            {c.entry.step != null ? `step ${fmt.int(c.entry.step)}` : "—"}{c.entry.duration_s ? ` · ${c.entry.duration_s.toFixed(1)}s` : ""}
                          </div>
                        </div>
                      </div>
                      <Icon name="maximize" size={15} style={{ color: "var(--faint)" }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {focus && <SpectrogramFocus card={focus} initialColormap={colormap} onClose={() => setFocus(null)} />}
    </div>
  );
}

function PlayBtn({ url, size = 36 }: { url?: string; size?: number }) {
  const { playing, toggle } = useAudioPlayer(url);
  return (
    <button onClick={(e) => { e.stopPropagation(); toggle(); }} style={playBtnStyle(size)}>
      <Icon name={playing ? "pause" : "play"} size={size * 0.45} fill={playing ? "none" : "current"} stroke={playing ? 2.4 : 0} />
    </button>
  );
}

function SpectrogramFocus({ card, initialColormap, onClose }: { card: Card; initialColormap: ColormapName; onClose: () => void }) {
  const [cmap, setCmap] = useState<ColormapName>(initialColormap);
  const { playing, time, duration, toggle, seek } = useAudioPlayer(card.url);
  const progress = duration ? time / duration : 0;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "var(--scrim)", backdropFilter: "blur(6px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 28 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(960px, 100%)", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 16, boxShadow: "var(--shadow)", overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "18px 20px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: runColor(card.run.id) }} />
              <span style={{ fontWeight: 700, color: "var(--ink-strong)", fontSize: 15 }}>{card.run.display_name ?? card.run.id.slice(0, 8)}</span>
              {card.entry.step != null && <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--faint)" }}>step {fmt.int(card.entry.step)}</span>}
            </div>
            {card.entry.caption && <div style={{ fontStyle: "italic", fontFamily: "var(--font-display)", fontSize: 17, color: "var(--ink)", marginTop: 6 }}>“{card.entry.caption}”</div>}
          </div>
          <button onClick={onClose} style={{ border: 0, background: "var(--panel-2)", borderRadius: 8, width: 34, height: 34, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink)" }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <Spectrogram imageUrl={card.spec} colormap={cmap} progress={progress} height={300} onSeek={(f) => seek(f * duration)} showAxis />
          <div style={{ marginTop: 10 }}>
            <Waveform peaksUrl={card.peaks} progress={progress} color={runColor(card.run.id)} height={56} onSeek={(f) => seek(f * duration)} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button onClick={toggle} style={playBtnStyle(48)}>
                <Icon name={playing ? "pause" : "play"} size={20} fill={playing ? "none" : "current"} stroke={playing ? 2.4 : 0} />
              </button>
              <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--muted)" }}>{fmt.time(time)} / {fmt.time(duration)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Colormap</span>
              <ColormapPicker value={cmap} onChange={setCmap} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
