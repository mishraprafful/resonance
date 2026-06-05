// Lucide-style 2px-stroke icons (24x24). Multi-path icons separate paths with "|".
import type { CSSProperties } from "react";

const ICONS: Record<string, string> = {
  "chevron-right": "M9 18l6-6-6-6",
  "chevron-down": "M6 9l6 6 6-6",
  "chevron-left": "M15 18l-6-6 6-6",
  search: "M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0|M21 21l-4.3-4.3",
  play: "M6 4l14 8-14 8z",
  pause: "M7 5v14M17 5v14",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  grid: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  columns: "M4 4h16v16H4zM12 4v16",
  headphones: "M3 14v-2a9 9 0 0 1 18 0v2M21 16a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2zM3 16a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2z",
  shuffle: "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z|M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  "eye-off": "M9.9 4.2A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13 13 0 0 1-2.16 2.92M6.6 6.6A13 13 0 0 0 2 11s3.5 7 10 7a9 9 0 0 0 4-.9M3 3l18 18",
  star: "M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17l-6.2 3.9 1.6-6.8L2.2 8.9l6.9-.6z",
  plus: "M12 5v14M5 12h14",
  x: "M18 6L6 18M6 6l12 12",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  check: "M20 6L9 17l-5-5",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  database: "M12 5c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z|M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  music: "M9 18V5l12-2v13|M9 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0|M21 16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
  gauge: "M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0",
  clock: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0|M12 7v5l3 2",
  cpu: "M5 5h14v14H5zM9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3",
  "arrow-up-right": "M7 17L17 7M7 7h10v10",
  "more-horizontal": "M5 12h.01M12 12h.01M19 12h.01",
  volume: "M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14",
  filter: "M22 3H2l8 9.46V19l4 2v-8.54z",
  "git-branch": "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM15 6a9 9 0 0 1-9 9",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7",
  circle: "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
  square: "M5 5h14v14H5z",
  repeat: "M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3",
  table: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
  waveform: "M2 12h2l2-7 3 16 3-12 2 7 2-4h4",
  "trending-down": "M22 17l-8.5-8.5-5 5L2 7M16 17h6v-6",
  "trending-up": "M22 7l-8.5 8.5-5-5L2 17M16 7h6v6",
  sparkles: "M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9zM19 14l.9 2.1 2.1.9-2.1.9L19 20l-.9-2.1L16 17l2.1-.9zM5 14l.7 1.6 1.6.7-1.6.7L5 19.6l-.7-1.6L2.7 17l1.6-.7z",
  layers: "M12 2l9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5",
  maximize: "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3",
  zap: "M13 2L3 14h9l-1 8 10-12h-9z",
  beaker: "M9 3h6M10 3v6.5L5 19a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 19l-5-9.5V3",
};

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 16,
  stroke = 2,
  fill = "none",
  style,
  className,
}: {
  name: string;
  size?: number;
  stroke?: number;
  fill?: "none" | "current";
  style?: CSSProperties;
  className?: string;
}) {
  const d = ICONS[name] || "";
  const parts = d.split("|");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill === "current" ? "currentColor" : "none"}
      stroke={fill === "current" ? "none" : "currentColor"}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block", ...style }}
      className={className}
    >
      {parts.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}
