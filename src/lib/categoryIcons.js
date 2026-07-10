// ─── CATEGORY VISUAL SYSTEM (Arah A — lucide + pastel tile) ───
// Replaces the emoji in expense_categories.icon. One source of truth:
// category NAME → { Icon (lucide component), bg, fg } pastel tile.
// The DB icon column is now legacy/unused for rendering.
// New/unknown categories fall back to a hashed tint + Tag icon.
import {
  Landmark, Lightbulb, Heart, Coffee, BookOpen, Smartphone, Clapperboard,
  Users, Shirt, Utensils, Fuel, ShoppingCart, Activity, Home, Calendar,
  MoreHorizontal, Sparkles, Building2, TrendingDown, ShoppingBag, Briefcase,
  Repeat, Percent, Car, Plane, Tag,
  // income sources
  Wallet, KeyRound, PiggyBank, Laptop, BadgePercent, Gift, RotateCcw,
} from "lucide-react";

// Pastel tints from the Ryūsei token palette (LIGHT theme values;
// tiles keep these in dark mode too — they read as colored chips).
export const TINTS = {
  blue:   { bg: "#dbeafe", fg: "#3b5bdb" },
  green:  { bg: "#dcfce7", fg: "#059669" },
  red:    { bg: "#fee2e2", fg: "#dc2626" },
  amber:  { bg: "#fef3c7", fg: "#b45309" },
  purple: { bg: "#ede9fe", fg: "#6d28d9" },
  teal:   { bg: "#cffafe", fg: "#0e7490" },
  grey:   { bg: "#f3f4f6", fg: "#6b7280" },
};

const CAT_VISUAL = {
  "bank charges":          { Icon: Landmark,       tint: "blue"   },
  "bills (utilities)":     { Icon: Lightbulb,      tint: "amber"  },
  "charity":               { Icon: Heart,          tint: "red"    },
  "coffee & snacks":       { Icon: Coffee,         tint: "amber"  },
  "education":             { Icon: BookOpen,       tint: "blue"   },
  "electronics & gadgets": { Icon: Smartphone,     tint: "purple" },
  "entertainment":         { Icon: Clapperboard,   tint: "purple" },
  "family":                { Icon: Users,          tint: "teal"   },
  "fashion & apparel":     { Icon: Shirt,          tint: "purple" },
  "food & drink":          { Icon: Utensils,       tint: "amber"  },
  "fuel & vehicle":        { Icon: Fuel,           tint: "blue"   },
  "groceries":             { Icon: ShoppingCart,   tint: "green"  },
  "health":                { Icon: Activity,       tint: "green"  },
  "home & furniture":      { Icon: Home,           tint: "teal"   },
  "installment":           { Icon: Calendar,       tint: "blue"   },
  "materai":               { Icon: Percent,        tint: "grey"   },
  "other":                 { Icon: MoreHorizontal, tint: "grey"   },
  "personal care":         { Icon: Sparkles,       tint: "purple" },
  "property & ipl":        { Icon: Building2,      tint: "teal"   },
  "reimbursable loss":     { Icon: TrendingDown,   tint: "red"    },
  "shopping":              { Icon: ShoppingBag,    tint: "purple" },
  "staff & salary":        { Icon: Briefcase,      tint: "blue"   },
  "subscription":          { Icon: Repeat,         tint: "teal"   },
  "tax":                   { Icon: Percent,        tint: "grey"   },
  "transport":             { Icon: Car,            tint: "blue"   },
  "travel":                { Icon: Plane,          tint: "teal"   },
};

// Income sources get the same treatment
const SRC_VISUAL = {
  "salary":               { Icon: Wallet,       tint: "green"  },
  "rental income":        { Icon: KeyRound,     tint: "teal"   },
  "dividend":             { Icon: PiggyBank,    tint: "green"  },
  "freelance":            { Icon: Laptop,       tint: "blue"   },
  "bank interest":        { Icon: BadgePercent, tint: "green"  },
  "cashback":             { Icon: Gift,         tint: "purple" },
  "other income":         { Icon: MoreHorizontal, tint: "grey" },
  "reimbursable surplus": { Icon: RotateCcw,    tint: "green"  },
};

const TINT_KEYS = ["blue", "green", "amber", "purple", "teal", "red"];
const hashTint = (name) => {
  let h = 0;
  for (const ch of String(name || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINT_KEYS[h % TINT_KEYS.length];
};

export function getCategoryVisual(name) {
  const key = String(name || "").trim().toLowerCase();
  const hit = CAT_VISUAL[key] || SRC_VISUAL[key];
  const tint = TINTS[hit?.tint || hashTint(key)] || TINTS.grey;
  return { Icon: hit?.Icon || Tag, bg: tint.bg, fg: tint.fg };
}

// Small pastel tile with a lucide icon — the standard category marker.
// size = outer box px (icon scales to ~55%).
export function CategoryIcon({ name, size = 26, radius, style }) {
  const { Icon, bg, fg } = getCategoryVisual(name);
  return (
    <span style={{
      width: size, height: size, borderRadius: radius ?? Math.round(size * 0.3),
      background: bg, color: fg, display: "inline-flex",
      alignItems: "center", justifyContent: "center", flexShrink: 0, ...style,
    }}>
      <Icon size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  );
}

// Sort helper — categories are always presented alphabetically.
export const byName = (a, b) => String(a.name || a.label || "").localeCompare(String(b.name || b.label || ""));
