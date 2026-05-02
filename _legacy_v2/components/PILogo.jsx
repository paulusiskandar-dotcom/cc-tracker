// ─── PI CALLIGRAPHY MONOGRAM ──────────────────────────────────
// Elegant "PI" lettermark for Paulus Finance.
// white=true  → white strokes, for dark/gradient backgrounds
// white=false → #1e3a5f strokes, for light backgrounds

export default function PILogo({ size = 30, white = false }) {
  const ink = white ? "#ffffff" : "#1e3a5f";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* ── P — vertical stem ───────────────────────────────── */}
      <path
        d="M18 82 L18 18"
        stroke={ink} strokeWidth="7" strokeLinecap="round"
      />
      {/* P — bowl (elegant open curve) */}
      <path
        d="M18 18 C18 18 56 14 60 30 C64 46 18 50 18 50"
        stroke={ink} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round"
        fill="none"
      />
      {/* P — subtle baseline swash */}
      <path
        d="M14 82 Q18 86 24 82"
        stroke={ink} strokeWidth="3.5" strokeLinecap="round" fill="none"
        opacity="0.5"
      />

      {/* ── I — vertical stem ───────────────────────────────── */}
      <path
        d="M74 18 L74 82"
        stroke={ink} strokeWidth="7" strokeLinecap="round"
      />
      {/* I — top serif */}
      <path
        d="M66 18 L82 18"
        stroke={ink} strokeWidth="4.5" strokeLinecap="round"
      />
      {/* I — bottom serif */}
      <path
        d="M66 82 L82 82"
        stroke={ink} strokeWidth="4.5" strokeLinecap="round"
      />

      {/* ── Ligature flourish connecting P and I ────────────── */}
      <path
        d="M18 50 Q46 52 66 50"
        stroke={ink} strokeWidth="2.5" strokeLinecap="round" fill="none"
        opacity="0.3"
        strokeDasharray="2 4"
      />
    </svg>
  );
}
