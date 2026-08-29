/**
 * Bendera mata uang sebagai SVG bulat.
 *
 * Kenapa bukan emoji: emoji bendera digambar berbeda oleh tiap sistem operasi,
 * dan tidak bisa diberi bingkai, sudut, atau redaman mengikuti tema — itu yang
 * membuat ubin mata uang terlihat asing di antara komponen lain. SVG sama di
 * semua perangkat dan ikut aturan gaya yang sama.
 *
 * Bendera rumit (Union Jack, bauhinia Hong Kong) disederhanakan dengan sengaja:
 * pada 36 piksel, detail aslinya jadi bubur. Yang dikejar adalah dikenali
 * sekilas, bukan ketepatan vexillologis.
 */

const S = { width: "100%", height: "100%", display: "block" };

// Bintang kecil: pada ukuran ini lingkaran terbaca lebih bersih daripada
// segi lima yang ujung-ujungnya hilang.
const Bintang = ({ cx, cy, r = 1.15, fill = "#fff" }) => <circle cx={cx} cy={cy} r={r} fill={fill} />;

const UnionJack = ({ x = 0, y = 0, w = 24, h = 24, opacity = 1 }) => (
  <g transform={`translate(${x} ${y}) scale(${w / 24} ${h / 24})`} opacity={opacity}>
    <rect width="24" height="24" fill="#012169" />
    <path d="M0 0 L24 24 M24 0 L0 24" stroke="#fff" strokeWidth="5" />
    <path d="M0 0 L24 24 M24 0 L0 24" stroke="#C8102E" strokeWidth="2.5" />
    <path d="M12 0 V24 M0 12 H24" stroke="#fff" strokeWidth="8" />
    <path d="M12 0 V24 M0 12 H24" stroke="#C8102E" strokeWidth="4.5" />
  </g>
);

const BENDERA = {
  IDR: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="12" fill="#CE1126" /><rect y="12" width="24" height="12" fill="#fff" />
    </svg>
  ),
  JPY: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#fff" /><circle cx="12" cy="12" r="6" fill="#BC002D" />
    </svg>
  ),
  THB: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#fff" />
      <rect width="24" height="4" fill="#A51931" /><rect y="20" width="24" height="4" fill="#A51931" />
      <rect y="8" width="24" height="8" fill="#2D2A4A" />
    </svg>
  ),
  USD: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#fff" />
      {[0, 2, 4, 6, 8, 10].map(i => <rect key={i} y={i * 2} width="24" height="2" fill="#B22234" />)}
      <rect width="12" height="13" fill="#3C3B6E" />
      {[[3, 3], [7, 3], [5, 6], [9, 6], [3, 9], [7, 9]].map(([cx, cy], i) => <Bintang key={i} cx={cx} cy={cy} r={0.9} />)}
    </svg>
  ),
  SGD: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="12" fill="#EF3340" /><rect y="12" width="24" height="12" fill="#fff" />
      <circle cx="6" cy="6" r="4" fill="#fff" /><circle cx="7.8" cy="6" r="3.4" fill="#EF3340" />
      {[[10.5, 3.6], [13, 5.4], [12, 8.2], [9, 8.2], [8, 5.4]].map(([cx, cy], i) => <Bintang key={i} cx={cx} cy={cy} r={0.75} />)}
    </svg>
  ),
  EUR: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#003399" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        return <Bintang key={i} cx={12 + 7 * Math.sin(a)} cy={12 - 7 * Math.cos(a)} r={0.85} fill="#FFCC00" />;
      })}
    </svg>
  ),
  GBP: <svg viewBox="0 0 24 24" style={S}><UnionJack /></svg>,
  AUD: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#012169" />
      <UnionJack x={0} y={0} w={12} h={12} />
      <Bintang cx={6} cy={18} r={1.5} />
      <Bintang cx={17} cy={6} r={0.9} /><Bintang cx={20} cy={11} r={0.9} />
      <Bintang cx={16} cy={15} r={0.9} /><Bintang cx={19} cy={18} r={0.9} />
    </svg>
  ),
  MYR: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#fff" />
      {[0, 1, 2, 3, 4, 5].map(i => <rect key={i} y={i * 4} width="24" height="2" fill="#CC0001" />)}
      <rect width="13" height="14" fill="#010066" />
      <circle cx="6" cy="7" r="4" fill="#FFCC00" /><circle cx="7.6" cy="7" r="3.4" fill="#010066" />
      <Bintang cx={10.5} cy={7} r={1.3} fill="#FFCC00" />
    </svg>
  ),
  CHF: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#D52B1E" />
      <rect x="10" y="5" width="4" height="14" fill="#fff" /><rect x="5" y="10" width="14" height="4" fill="#fff" />
    </svg>
  ),
  CNY: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#DE2910" />
      <Bintang cx={6} cy={7} r={2.4} fill="#FFDE00" />
      <Bintang cx={11} cy={3.5} r={0.9} fill="#FFDE00" /><Bintang cx={13} cy={6} r={0.9} fill="#FFDE00" />
      <Bintang cx={13} cy={9} r={0.9} fill="#FFDE00" /><Bintang cx={11} cy={11.5} r={0.9} fill="#FFDE00" />
    </svg>
  ),
  HKD: (
    <svg viewBox="0 0 24 24" style={S}>
      <rect width="24" height="24" fill="#DE2910" />
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 5;
        return <ellipse key={i} cx={12 + 4.4 * Math.sin(a)} cy={12 - 4.4 * Math.cos(a)} rx="1.7" ry="3"
          fill="#fff" transform={`rotate(${(i * 360) / 5} ${12 + 4.4 * Math.sin(a)} ${12 - 4.4 * Math.cos(a)})`} />;
      })}
    </svg>
  ),
};

/**
 * @param code  kode mata uang ISO ("USD", "JPY", …)
 * @param size  sisi ubin dalam piksel
 * Mata uang tanpa bendera jatuh ke ubin kode — tetap terbaca, tidak kosong.
 */
export default function CurrencyFlag({ code, size = 36, warna = "#059669" }) {
  const f = BENDERA[String(code || "").toUpperCase()];
  const dasar = {
    width: size, height: size, borderRadius: "50%", flexShrink: 0,
    overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
    // Cincin tipis memberi tepi pada bendera yang sisinya putih (Jepang, Thailand)
    // supaya tidak lumer ke latar kartu.
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
  };
  if (!f) {
    return (
      <div style={{ ...dasar, background: warna + "22", color: warna,
        fontSize: size * 0.3, fontWeight: 800, fontFamily: "Figtree, sans-serif", letterSpacing: "-0.3px" }}>
        {String(code || "").toUpperCase().slice(0, 3)}
      </div>
    );
  }
  return <div style={dasar} title={String(code || "").toUpperCase()}>{f}</div>;
}
