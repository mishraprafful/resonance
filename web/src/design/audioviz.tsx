// Audio visualization + playback, wired to the real API.
//   Waveform     — drawn from the worker's precomputed peaks.json (no client-side audio decode).
//   Spectrogram  — the server's precomputed PNG derivation; recolored by luminance through the
//                  active colormap when the image pixels are readable (CORS), else shown as-is.
//   MetricChart  — dependency-free multi-series SVG chart with a hover crosshair.
//   useAudioPlayer / Transport — HTMLAudioElement playback over presigned ORIGINAL-quality URLs.
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { COLORMAPS } from "./colormaps";
import { fmt, type ChartStyle, type ColormapName } from "./theme";

// ── peaks.json loader (cached per URL) ──
const _peaksCache = new Map<string, Promise<[number, number][]>>();
function loadPeaks(url: string): Promise<[number, number][]> {
  if (!_peaksCache.has(url)) {
    _peaksCache.set(
      url,
      fetch(url)
        .then((r) => r.json())
        .then((d) => (d.buckets as [number, number][]) ?? [])
        .catch(() => [] as [number, number][])
    );
  }
  return _peaksCache.get(url)!;
}

// ── Waveform canvas (from peaks) ──
export function Waveform({
  peaksUrl, progress = 0, color = "var(--accent)", height = 56, onSeek,
}: {
  peaksUrl?: string; progress?: number; color?: string; height?: number; onSeek?: (frac: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [buckets, setBuckets] = useState<[number, number][] | null>(null);

  useEffect(() => {
    let alive = true;
    if (!peaksUrl) {
      setBuckets([]);
      return;
    }
    loadPeaks(peaksUrl).then((b) => alive && setBuckets(b));
    return () => {
      alive = false;
    };
  }, [peaksUrl]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !buckets) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300;
    const h = height;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(cv);
    const faint = (cs.getPropertyValue("--faint") || "#888").trim() || "#888";
    const accCol = color.startsWith("var(") ? (cs.getPropertyValue("--accent") || "#20afff").trim() : color;
    const n = buckets.length || 1;
    const mid = h / 2;
    const played = Math.floor(progress * n);
    const bw = w / n;
    for (let i = 0; i < n; i++) {
      const [mn, mx] = buckets[i] || [0, 0];
      const y0 = mid - mx * mid * 0.92;
      const y1 = mid - mn * mid * 0.92;
      ctx.fillStyle = i <= played ? accCol : faint;
      ctx.globalAlpha = i <= played ? 0.95 : 0.45;
      ctx.fillRect(i * bw, y0, Math.max(0.7, bw * 0.7), Math.max(1, y1 - y0));
    }
    ctx.globalAlpha = 1;
    if (progress > 0 && progress < 1) {
      ctx.fillStyle = accCol;
      ctx.fillRect(progress * w - 0.75, 0, 1.5, h);
    }
  }, [buckets, progress, height, color]);

  const click = (e: React.MouseEvent) => {
    if (!onSeek || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    onSeek((e.clientX - r.left) / r.width);
  };
  return (
    <canvas ref={ref} onClick={click}
      style={{ width: "100%", height, display: "block", cursor: onSeek ? "pointer" : "default", borderRadius: 4 }} />
  );
}

// ── Spectrogram: server PNG, optionally recolored via the active colormap ──
const _imgCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!_imgCache.has(url)) {
    _imgCache.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      })
    );
  }
  return _imgCache.get(url)!;
}

export function Spectrogram({
  imageUrl, colormap = "magma", progress = 0, height = 120, onSeek, showAxis,
}: {
  imageUrl?: string; colormap?: ColormapName; progress?: number; height?: number;
  onSeek?: (frac: number) => void; showAxis?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!imageUrl) {
      setImg(null);
      return;
    }
    loadImage(imageUrl).then((i) => alive && setImg(i));
    return () => {
      alive = false;
    };
  }, [imageUrl]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300;
    const h = height;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    if (img) {
      // Draw at native size to an offscreen canvas so we can (try to) read + recolor pixels.
      try {
        const off = document.createElement("canvas");
        off.width = img.naturalWidth || 1;
        off.height = img.naturalHeight || 1;
        const octx = off.getContext("2d");
        if (octx) {
          octx.drawImage(img, 0, 0);
          const id = octx.getImageData(0, 0, off.width, off.height); // throws if tainted
          const cmap = COLORMAPS[colormap] || COLORMAPS.magma;
          const data = id.data;
          for (let p = 0; p < data.length; p += 4) {
            const lum = (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114) / 255;
            const [r, g, b] = cmap(lum);
            data[p] = r;
            data[p + 1] = g;
            data[p + 2] = b;
          }
          octx.putImageData(id, 0, 0);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(off, 0, 0, w, h);
        }
      } catch {
        // Cross-origin (presigned) image — can't read pixels; draw the original directly.
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, 0, 0, w, h);
      }
    }
    if (progress > 0 && progress < 1) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(progress * w - 0.75, 0, 1.5, h);
    }
  }, [img, colormap, progress, height]);

  const click = (e: React.MouseEvent) => {
    if (!onSeek || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    onSeek((e.clientX - r.left) / r.width);
  };
  return (
    <div style={{ position: "relative" }}>
      <canvas ref={ref} onClick={click}
        style={{ width: "100%", height, display: "block", cursor: onSeek ? "pointer" : "default", borderRadius: 4, background: "#000" }} />
      {img === null && imageUrl === undefined && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)", fontSize: 11, fontFamily: "var(--mono)" }}>
          no spectrogram
        </div>
      )}
      {showAxis && (
        <div style={{ position: "absolute", left: 4, top: 3, fontSize: 9, fontFamily: "var(--mono)", color: "rgba(255,255,255,0.7)", letterSpacing: "0.04em" }}>kHz</div>
      )}
    </div>
  );
}

// Decorative procedural "spectrogram" for the auth brand panel — no audio, just a deterministic
// pattern pushed through the active colormap so the panel reads as audio-native.
export function DecorSpectrogram({ colormap = "magma", height = 120, seed = 7 }: { colormap?: ColormapName; height?: number; seed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 360;
    const h = height;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cmap = COLORMAPS[colormap] || COLORMAPS.magma;
    const cols = 160;
    const rows = 64;
    const cw = w / cols;
    const ch = h / rows;
    let a = seed >>> 0;
    const rnd = () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
    for (let x = 0; x < cols; x++) {
      const t = x / cols;
      for (let y = 0; y < rows; y++) {
        const f = y / rows;
        // a few drifting harmonic bands + decaying energy toward high freq + noise
        const band = Math.exp(-Math.pow((f - (0.18 + 0.06 * Math.sin(t * 6))) * 6, 2))
          + 0.7 * Math.exp(-Math.pow((f - (0.4 + 0.05 * Math.sin(t * 4 + 1))) * 7, 2))
          + 0.4 * Math.exp(-Math.pow((f - 0.62) * 9, 2));
        const v = Math.min(1, band * (0.6 + 0.5 * Math.sin(t * 9 + f * 3)) * (1 - f * 0.4) + rnd() * 0.07);
        const [r, g, b] = cmap(Math.max(0, v));
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(x * cw, h - (y + 1) * ch, cw + 1, ch + 1);
      }
    }
  }, [colormap, height, seed]);
  return <canvas ref={ref} style={{ width: "100%", height, display: "block", background: "#000" }} />;
}

// ── Multi-series metric chart (SVG) with hover crosshair ──
export interface ChartSeries {
  name: string;
  color: string;
  points: { step: number; value: number }[];
}

export function MetricChart({
  series, height = 190, style = "line", yKind,
}: {
  series: ChartSeries[]; height?: number; style?: ChartStyle; yKind?: "lr";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(420);
  const [hover, setHover] = useState<{ mx: number; step: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const padL = 44, padR = 12, padT = 10, padB = 24;
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <div ref={wrapRef} style={{ height }} />;
  const xs = all.map((p) => p.step);
  const ys = all.map((p) => p.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs, 1);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const padY = (maxY - minY) * 0.08 || 0.1;
  minY -= padY;
  maxY += padY;
  const sx = (x: number) => padL + ((x - minX) / (maxX - minX || 1)) * (w - padL - padR);
  const sy = (y: number) => padT + (1 - (y - minY) / (maxY - minY || 1)) * (height - padT - padB);
  const fmtY = (v: number) => (yKind === "lr" ? v.toExponential(0) : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => minY + f * (maxY - minY));
  const onMove = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const step = minX + ((mx - padL) / (w - padL - padR)) * (maxX - minX);
    setHover({ mx, step });
  };
  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block", overflow: "visible" }}>
        {gridYs.map((gy, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={sy(gy)} y2={sy(gy)} stroke="var(--line-soft)" />
            <text x={padL - 8} y={sy(gy) + 3} textAnchor="end" fontSize="9.5" fill="var(--faint)" fontFamily="var(--mono)">{fmtY(gy)}</text>
          </g>
        ))}
        <text x={padL} y={height - 4} fontSize="9.5" fill="var(--faint)" fontFamily="var(--mono)">{fmt.step(minX)}</text>
        <text x={w - padR} y={height - 4} textAnchor="end" fontSize="9.5" fill="var(--faint)" fontFamily="var(--mono)">{fmt.step(maxX)}</text>
        {series.map((s, si) => {
          if (!s.points.length) return null;
          const line = s.points.map((p, i) => `${i ? "L" : "M"}${sx(p.step).toFixed(1)},${sy(p.value).toFixed(1)}`).join(" ");
          const area = `${line} L${sx(s.points[s.points.length - 1].step)},${sy(minY)} L${sx(s.points[0].step)},${sy(minY)} Z`;
          const gid = `mg${si}${Math.random().toString(36).slice(2, 6)}`;
          return (
            <g key={si}>
              {style === "area" && (
                <>
                  <defs>
                    <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={s.color} stopOpacity="0.28" />
                      <stop offset="1" stopColor={s.color} stopOpacity="0.02" />
                    </linearGradient>
                  </defs>
                  <path d={area} fill={`url(#${gid})`} />
                </>
              )}
              <path d={line} fill="none" stroke={s.color} strokeWidth={style === "bold" ? 2.6 : 1.8} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {hover && <line x1={hover.mx} x2={hover.mx} y1={padT} y2={height - padB} stroke="var(--muted)" strokeDasharray="3 3" />}
        {hover && series.map((s, si) => {
          if (!s.points.length) return null;
          let best = s.points[0];
          for (const p of s.points) if (Math.abs(p.step - hover.step) < Math.abs(best.step - hover.step)) best = p;
          return <circle key={si} cx={sx(best.step)} cy={sy(best.value)} r="3.2" fill={s.color} stroke="var(--panel)" strokeWidth="1.5" />;
        })}
      </svg>
    </div>
  );
}

// ── Single-clip HTMLAudioElement player hook ──
export function useAudioPlayer(url?: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.preload = "none";
  }

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime);
    const onMeta = () => setDuration(a.duration || 0);
    const onEnd = () => { setPlaying(false); setTime(0); };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    setPlaying(false);
    setTime(0);
    if (url) a.src = url;
    else a.removeAttribute("src");
  }, [url]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !url) return;
    if (a.paused) {
      void a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      a.pause();
      setPlaying(false);
    }
  };
  const seek = (t: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || t, t));
    setTime(a.currentTime);
  };
  return { playing, time, duration, toggle, seek };
}

// ── Transport: synced playback of multiple clips (compare A/B + prompt grid) ──
export class Transport {
  private players = new Map<string, HTMLAudioElement>();
  set(uid: string, url: string) {
    let a = this.players.get(uid);
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      this.players.set(uid, a);
    }
    a.src = url;
  }
  remove(uid: string) {
    const a = this.players.get(uid);
    if (a) a.pause();
    this.players.delete(uid);
  }
  clear() {
    this.players.forEach((a) => a.pause());
    this.players.clear();
  }
  setMuted(uid: string, muted: boolean) {
    const a = this.players.get(uid);
    if (a) a.muted = muted;
  }
  playAll(offset = 0) {
    this.players.forEach((a) => {
      a.currentTime = offset;
      void a.play().catch(() => {});
    });
  }
  pauseAll() {
    this.players.forEach((a) => a.pause());
  }
  seekAll(t: number) {
    this.players.forEach((a) => { a.currentTime = t; });
  }
  state() {
    let time = 0, dur = 0, anyPlaying = false;
    this.players.forEach((a) => {
      time = Math.max(time, a.currentTime);
      dur = Math.max(dur, a.duration || 0);
      if (!a.paused) anyPlaying = true;
    });
    return { time, dur, anyPlaying };
  }
}

export function useTransport() {
  const tr = useMemo(() => new Transport(), []);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const raf = useRef(0);

  const loop = () => {
    const s = tr.state();
    setTime(s.time);
    setDur(s.dur);
    if (s.anyPlaying) raf.current = requestAnimationFrame(loop);
    else setPlaying(false);
  };
  const play = (offset?: number) => {
    tr.playAll(offset != null ? offset : time >= dur - 0.05 ? 0 : time);
    setPlaying(true);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(loop);
  };
  const pause = () => {
    tr.pauseAll();
    setPlaying(false);
    cancelAnimationFrame(raf.current);
  };
  const seek = (t: number) => {
    tr.seekAll(t);
    setTime(t);
  };
  useEffect(() => () => { tr.clear(); cancelAnimationFrame(raf.current); }, [tr]);
  return { tr, playing, time, dur, play, pause, seek };
}

export const transportProgress = (time: number, dur: number) => (dur > 0 ? time / dur : 0);

// Shared style for the circular transport play button.
export const playBtnStyle = (size: number): CSSProperties => ({
  flexShrink: 0, width: size, height: size, borderRadius: 999, border: 0, cursor: "pointer",
  background: "var(--accent)", color: "var(--accent-ink)", display: "flex", alignItems: "center", justifyContent: "center",
});
