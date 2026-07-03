// ─── RYŪSEI 隆盛 KANJI MARK ───────────────────────────────────
// Logo mark for Ryusei — the kanji 隆盛 ("prosperity / flourishing"),
// stacked vertically like a traditional seal (hanko).
// white=true  → white glyphs, for dark/gradient backgrounds
// white=false → #1e3a5f glyphs, for light backgrounds
//
// Component name kept as `PILogo` so existing imports keep working.

const KANJI_FONT =
  "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP','Songti SC','Source Han Serif',serif";

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
      role="img"
      aria-label="Ryusei 隆盛"
    >
      <text
        x="50" y="27"
        textAnchor="middle" dominantBaseline="central"
        fontSize="50" fontWeight="700" fontFamily={KANJI_FONT} fill={ink}
      >隆</text>
      <text
        x="50" y="73"
        textAnchor="middle" dominantBaseline="central"
        fontSize="50" fontWeight="700" fontFamily={KANJI_FONT} fill={ink}
      >盛</text>
    </svg>
  );
}
