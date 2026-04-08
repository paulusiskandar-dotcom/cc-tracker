// ─── DESIGN TOKENS ────────────────────────────────────────────
// Paulus Finance v2.1.1 — Bento / soft pastel design system

export const LIGHT = {
  // Base
  bg:      "#f8f9fb",
  surface: "#ffffff",
  border:  "#e5e7eb",
  text:    "#111827",
  text2:   "#6b7280",
  text3:   "#9ca3af",

  // Accent (blue)
  ac:    "#3b5bdb",
  acBg:  "#dbeafe",

  // Semantic
  gr:    "#059669",
  grBg:  "#dcfce7",
  rd:    "#dc2626",
  rdBg:  "#fee2e2",
  am:    "#d97706",
  amBg:  "#fef3c7",
  pu:    "#7c3aed",
  puBg:  "#ede9fe",
  te:    "#0891b2",
  teBg:  "#cffafe",

  // Pastel card backgrounds
  bankBg:    "#e8f4fd",
  ccBg:      "#fde8e8",
  assetBg:   "#e8fdf0",
  recvBg:    "#fdf6e8",
  incomeBg:  "#f0e8fd",
  pendingBg: "#fef9ec",

  // Dark hero card
  dark:     "#111827",
  darkText: "#ffffff",

  // Surface aliases (for backward compat)
  sur:   "#ffffff",
  sur2:  "#f3f4f6",
  sur3:  "#e5e7eb",
  bor:   "#e5e7eb",
  bor2:  "#d1d5db",
  tx:    "#111827",
  tx2:   "#374151",
  tx3:   "#9ca3af",

  // Shadows
  sh:  "0 1px 3px rgba(0,0,0,.06)",
  sh2: "0 4px 16px rgba(0,0,0,.08)",

  nav: "#ffffff",
};

export const DARK = {
  bg:      "#0f1117",
  surface: "#1a1d27",
  border:  "#2a2d42",
  text:    "#f3f4f6",
  text2:   "#9ca3af",
  text3:   "#6b7280",

  ac:    "#7c8ff0",
  acBg:  "#1a1f3a",

  gr:    "#34d399",
  grBg:  "#0d2420",
  rd:    "#f87171",
  rdBg:  "#2d1515",
  am:    "#fbbf24",
  amBg:  "#2a2000",
  pu:    "#b197fc",
  puBg:  "#1e1530",
  te:    "#67e8f9",
  teBg:  "#0d2426",

  bankBg:    "#0d1f2d",
  ccBg:      "#2d0d0d",
  assetBg:   "#0d2d1a",
  recvBg:    "#2d2000",
  incomeBg:  "#1e0d2d",
  pendingBg: "#2d2800",

  dark:     "#f3f4f6",
  darkText: "#111827",

  sur:   "#1a1d27",
  sur2:  "#1f2235",
  sur3:  "#252840",
  bor:   "#2a2d42",
  bor2:  "#343759",
  tx:    "#f3f4f6",
  tx2:   "#9ca3af",
  tx3:   "#6b7280",

  sh:  "0 1px 2px rgba(0,0,0,.3)",
  sh2: "0 4px 12px rgba(0,0,0,.4)",

  nav: "#1a1d27",
};

export const getTheme = (isDark) => isDark ? DARK : LIGHT;

// ─── RADIUS ────────────────────────────────────────────────────
export const R = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
};

// ─── ENTITY COLORS ─────────────────────────────────────────────
export const ENT_COL = {
  Personal: "#3b5bdb",
  Hamasa:   "#059669",
  SDC:      "#d97706",
  Travelio: "#0891b2",
};

export const ENT_BG = {
  Personal: "#dbeafe",
  Hamasa:   "#dcfce7",
  SDC:      "#fef3c7",
  Travelio: "#cffafe",
};
