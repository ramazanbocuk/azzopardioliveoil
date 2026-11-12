import type { CSSProperties } from "react";

type BottleProps = {
  ml: number;
  lot: string | null;
  className?: string;
  style?: CSSProperties;
  title?: string;
};

/**
 * Illustrated stand-in for product photography. Deliberately a drawing, so it
 * cannot be mistaken for a photograph of the real bottle.
 */
export function Bottle({ ml, lot, className, style, title }: BottleProps) {
  return (
    <svg viewBox="0 0 200 560" className={className} style={style} role="img" aria-label={title ?? `Illustration of a ${ml} ml bottle`}>
      <defs>
        <linearGradient id="glass" x1="0" x2="1">
          <stop offset="0" stopColor="#11160c" />
          <stop offset="0.35" stopColor="#2a3420" />
          <stop offset="0.7" stopColor="#1b2213" />
          <stop offset="1" stopColor="#0d1109" />
        </linearGradient>
        <linearGradient id="cap" x1="0" x2="1">
          <stop offset="0" stopColor="#6e5626" />
          <stop offset="0.4" stopColor="#c9aa6a" />
          <stop offset="1" stopColor="#6e5626" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="548" rx="74" ry="7" fill="#1a1c16" opacity="0.18" />
      <rect x="79" y="8" width="42" height="46" rx="3" fill="url(#cap)" />
      <rect x="83" y="54" width="34" height="70" fill="url(#glass)" />
      <path d="M83 122c0 34-45 44-45 96v296c0 16 10 26 26 26h72c16 0 26-10 26-26V218c0-52-45-62-45-96Z" fill="url(#glass)" />
      <path d="M52 232c0-30 18-44 30-62" stroke="#f4efe4" strokeOpacity="0.14" strokeWidth="5" strokeLinecap="round" fill="none" />
      <rect x="52" y="250" width="5" height="250" rx="2.5" fill="#f4efe4" opacity="0.08" />
      {/* Label */}
      <rect x="48" y="292" width="104" height="168" fill="#f4efe4" />
      <rect x="54" y="298" width="92" height="156" fill="none" stroke="#1a1c16" strokeOpacity="0.35" strokeWidth="0.6" />
      <text x="100" y="334" textAnchor="middle" fontSize="13.5" letterSpacing="2.2" fill="#1f2716" style={{ fontFamily: "var(--serif)" }}>
        AZZOPARDI
      </text>
      <line x1="84" y1="346" x2="116" y2="346" stroke="#b08d4a" strokeWidth="0.8" />
      <text x="100" y="366" textAnchor="middle" fontSize="7.5" fontStyle="italic" fill="#1f2716" style={{ fontFamily: "var(--serif)" }}>
        Extra Virgin Olive Oil
      </text>
      <text x="100" y="380" textAnchor="middle" fontSize="5.2" letterSpacing="1.4" fill="#6b6558" style={{ fontFamily: "var(--sans)" }}>
        SICILIA
      </text>
      <line x1="60" y1="420" x2="140" y2="420" stroke="#1a1c16" strokeOpacity="0.35" strokeWidth="0.6" strokeDasharray="2 2" />
      <text x="60" y="436" fontSize="5.4" letterSpacing="0.6" fill="#1a1c16" style={{ fontFamily: "var(--mono)" }}>
        LOT {lot ?? "—"}
      </text>
      <text x="140" y="436" textAnchor="end" fontSize="5.4" letterSpacing="0.6" fill="#1a1c16" style={{ fontFamily: "var(--mono)" }}>
        {ml} ML
      </text>
    </svg>
  );
}
