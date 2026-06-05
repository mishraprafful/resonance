// Dependency-free SVG line chart. Phase 2/3 may swap in uPlot for large series; this keeps the
// Phase-1 UI buildable with zero charting deps.
import type { MetricPoint } from "./api";

export function LineChart({
  title,
  points,
  width = 420,
  height = 160,
}: {
  title: string;
  points: MetricPoint[];
  width?: number;
  height?: number;
}) {
  const pad = 28;
  const xs = points.map((p) => p.step);
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (width - pad * 2);
  const sy = (y: number) =>
    height - pad - ((y - minY) / (maxY - minY || 1)) * (height - pad * 2);
  const path = points.map((p, i) => `${i ? "L" : "M"}${sx(p.step)},${sy(p.value)}`).join(" ");

  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        {title} <span style={{ color: "#888", fontWeight: 400 }}>({points.length} pts)</span>
      </figcaption>
      <svg width={width} height={height} style={{ border: "1px solid #eee", borderRadius: 6 }}>
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#ddd" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#ddd" />
        {points.length > 0 && (
          <path d={path} fill="none" stroke="#4f46e5" strokeWidth={1.5} />
        )}
        <text x={pad} y={14} fontSize={10} fill="#888">
          {maxY.toFixed(3)}
        </text>
        <text x={pad} y={height - pad + 12} fontSize={10} fill="#888">
          {minY.toFixed(3)}
        </text>
      </svg>
    </figure>
  );
}
