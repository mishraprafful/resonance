// Draws a waveform from the worker's precomputed peaks.json (decimated min/max pairs).
// The browser never downloads or decodes the audio just to render the waveform.
import { useEffect, useState } from "react";

export function Waveform({ peaksUrl, width = 420, height = 80 }: {
  peaksUrl: string;
  width?: number;
  height?: number;
}) {
  const [buckets, setBuckets] = useState<[number, number][] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(peaksUrl)
      .then((r) => r.json())
      .then((d) => alive && setBuckets(d.buckets))
      .catch(() => alive && setBuckets([]));
    return () => {
      alive = false;
    };
  }, [peaksUrl]);

  if (!buckets) return <div style={{ height, color: "#aaa", fontSize: 12 }}>loading waveform…</div>;
  const mid = height / 2;
  const bw = width / Math.max(1, buckets.length);
  return (
    <svg width={width} height={height} style={{ background: "#fafafa", borderRadius: 6 }}>
      {buckets.map(([lo, hi], i) => (
        <line
          key={i}
          x1={i * bw}
          x2={i * bw}
          y1={mid - hi * mid}
          y2={mid - lo * mid}
          stroke="#4f46e5"
          strokeWidth={Math.max(1, bw)}
        />
      ))}
    </svg>
  );
}
