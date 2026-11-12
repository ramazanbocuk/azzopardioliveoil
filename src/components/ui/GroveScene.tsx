export type SceneTone = "dawn" | "noon" | "dusk";

const PALETTES: Record<SceneTone, { sky: [string, string]; sun: string; hills: string[]; trees: string[] }> = {
  dawn: {
    sky: ["#cdd0c9", "#f0e4ca"],
    sun: "#fbefd0",
    hills: ["#aeb39d", "#838f6c", "#56643f", "#2f3a22"],
    trees: ["#949d82", "#687552", "#3f4c2d", "#1c2413"],
  },
  noon: {
    sky: ["#d9e0dc", "#f7f3ea"],
    sun: "#fffbee",
    hills: ["#bcc2a4", "#909c6f", "#627242", "#36441f"],
    trees: ["#a3ab89", "#748256", "#48572c", "#222c12"],
  },
  dusk: {
    sky: ["#c99a6c", "#efdcb2"],
    sun: "#fbe3ab",
    hills: ["#a8936a", "#7c774a", "#4c5331", "#262d18"],
    trees: ["#8e7b54", "#625f38", "#373d22", "#161b0d"],
  },
};

const W = 1600;
const H = 1000;

/** Deterministic 0..1 noise so server and client render identical markup. */
function noise(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const round = (n: number) => Math.round(n * 10) / 10;

function ridge(layer: number, seed: number) {
  const base = 640 + layer * 82;
  const amp = 42 - layer * 5;
  const len = 250 + layer * 70;
  return (x: number) => base + amp * Math.sin(x / len + seed + layer * 1.7) + amp * 0.35 * Math.sin(x / (len * 0.37) + seed * 2.3);
}

function hillPath(y: (x: number) => number): string {
  let d = `M-60 ${H + 260}`;
  for (let x = -60; x <= W + 60; x += 24) d += ` L${x} ${round(y(x))}`;
  return `${d} L${W + 60} ${H + 260} Z`;
}

function trees(layer: number, y: (x: number) => number, seed: number) {
  const rowGap = 20 + layer * 13;
  const step = 27 + layer * 17;
  const radius = 5.5 + layer * 3.6;
  const rows = layer === 3 ? 9 : 2 + layer;
  const out: { cx: number; cy: number; rx: number; ry: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 ? step / 2 : 0;
    for (let x = -40 + offset; x < W + 40; x += step) {
      const n = noise(x * 0.13 + row * 17.3 + layer * 101 + seed);
      const grow = 1 + row * 0.08;
      out.push({
        cx: round(x + (n - 0.5) * step * 0.28),
        cy: round(y(x) + 16 + layer * 6 + row * rowGap),
        rx: round(radius * grow * (1.05 + n * 0.25)),
        ry: round(radius * grow * (0.82 + n * 0.16)),
      });
    }
  }
  return out;
}

type GroveSceneProps = {
  tone?: SceneTone;
  seed?: number;
  className?: string;
  /** Unique id prefix when several scenes share a page. */
  id?: string;
};

/**
 * Illustrated olive grove used wherever photography will go. Layers carry
 * `data-depth` (0 = far, 1 = near) so the hero can drift them at different
 * speeds. Decorative: hidden from assistive technology.
 */
export function GroveScene({ tone = "dawn", seed = 1, className, id = "grove" }: GroveSceneProps) {
  const p = PALETTES[tone];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="0.62" stopColor={p.sky[1]} />
        </linearGradient>
        <radialGradient id={`${id}-sun`}>
          <stop offset="0" stopColor={p.sun} stopOpacity="1" />
          <stop offset="0.28" stopColor={p.sun} stopOpacity="0.55" />
          <stop offset="1" stopColor={p.sun} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="-60" y="-400" width={W + 120} height={H + 660} fill={`url(#${id}-sky)`} />
      <g data-depth="0">
        <circle cx="1010" cy="610" r="420" fill={`url(#${id}-sun)`} />
        <circle cx="1010" cy="610" r="54" fill={p.sun} />
      </g>
      {[0, 1, 2, 3].map((layer) => {
        const y = ridge(layer, seed);
        return (
          <g key={layer} data-depth={(layer + 1) / 4}>
            <path d={hillPath(y)} fill={p.hills[layer]} />
            <g fill={p.trees[layer]}>
              {trees(layer, y, seed).map((t, i) => (
                <ellipse key={i} cx={t.cx} cy={t.cy} rx={t.rx} ry={t.ry} />
              ))}
            </g>
          </g>
        );
      })}
    </svg>
  );
}
