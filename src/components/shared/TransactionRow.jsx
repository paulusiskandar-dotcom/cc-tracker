import { useState } from "react";
import { fmtIDR, fmtDateLabel, fmtCur } from "../../utils";
import { EXPENSE_CATEGORIES, TX_TYPE_MAP } from "../../constants";

// ─── TWO-DIRECTIONAL TYPES ────────────────────────────────────
const TWO_DIR_TYPES = new Set([
  "transfer", "pay_cc", "buy_asset", "sell_asset", "fx_exchange",
  "reimburse_out", "reimburse_in", "give_loan", "collect_loan", "pay_liability",
]);

// ─── EXPANDED ROW CONTENT ─────────────────────────────────────
function getExpandedContent(entry, accounts) {
  const fromAcc = accounts.find(a => a.id === entry.from_id);
  const toAcc   = accounts.find(a => a.id === entry.to_id);
  const amtIDR  = Number(entry.amount_idr || entry.amount || 0);

  switch (entry.tx_type) {
    case "transfer":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "pay_cc":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "buy_asset":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "sell_asset":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "fx_exchange": {
      const desc = entry.description || "";
      const foreignCurrency = desc.split(" ")[1] || "";
      const rate = Number(entry.fx_rate_used || 0);
      const isBuy = desc.startsWith("Buy");
      if (isBuy && foreignCurrency && rate > 0) {
        const foreignAmt = Math.round((amtIDR / rate) * 100) / 100;
        return { label: toAcc?.name || "?", amount: `+${fmtCur(foreignAmt, foreignCurrency)}`, positive: true };
      }
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    }
    case "reimburse_out": {
      const entityLabel = entry.entity && entry.entity !== "Personal" ? entry.entity : (toAcc?.name || "?");
      return { label: entityLabel, amount: `+${fmtIDR(amtIDR)}`, positive: true };
    }
    case "reimburse_in":
      return { label: fromAcc?.name || "?", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    case "give_loan":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "collect_loan":
      return { label: fromAcc?.name || "?", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    case "pay_liability":
      return { label: toAcc?.name || "?", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    default:
      return null;
  }
}

// ─── CATEGORY ICON ────────────────────────────────────────────
function CategoryIcon({ categoryId, txType, size = 36 }) {
  // Pick icon: category > tx type > fallback
  let icon  = "💸";
  let color = "#9ca3af";
  let bg    = "#f3f4f6";

  const cat = EXPENSE_CATEGORIES.find(c => c.id === categoryId);
  const tx  = TX_TYPE_MAP[txType];

  if (cat) {
    icon  = cat.icon;
    color = cat.color;
    bg    = cat.color + "18";
  } else if (tx) {
    icon  = tx.icon;
    color = tx.color;
    bg    = tx.color + "18";
  }

  return (
    <div style={{
      width:           size,
      height:          size,
      borderRadius:    size * 0.3,
      background:      bg,
      display:         "flex",
      alignItems:      "center",
      justifyContent:  "center",
      fontSize:        size * 0.46,
      flexShrink:      0,
      color:           color,
    }}>
      {icon}
    </div>
  );
}

// ─── AMOUNT COLOR ─────────────────────────────────────────────
function amountColor(txType) {
  if (["income", "reimburse_in", "collect_loan", "sell_asset"].includes(txType)) return "#059669";
  if (["transfer", "fx_exchange"].includes(txType)) return "#3b5bdb";
  return "#dc2626";
}

function amountPrefix(txType) {
  if (["income", "reimburse_in", "collect_loan", "sell_asset"].includes(txType)) return "+";
  if (["transfer", "fx_exchange"].includes(txType)) return "";
  return "-";
}

// ─── TRANSACTION ROW ──────────────────────────────────────────
export default function TransactionRow({
  entry,
  accounts = [],
  onClick,
  onDelete,
  compact = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const isTwoDir = TWO_DIR_TYPES.has(entry.tx_type);
  const expandedContent = isTwoDir ? getExpandedContent(entry, accounts) : null;

  const fromAcc = accounts.find(a => a.id === entry.from_id);
  const toAcc   = accounts.find(a => a.id === entry.to_id);

  // Account display: "from → to" for transfers, else whichever exists
  const accLabel = (() => {
    if (entry.tx_type === "transfer" || entry.tx_type === "pay_cc" || entry.tx_type === "fx_exchange") {
      const from = fromAcc?.name || "?";
      const to   = toAcc?.name   || "?";
      return `${from} → ${to}`;
    }
    return fromAcc?.name || toAcc?.name || "";
  })();

  const color  = amountColor(entry.tx_type);
  const prefix = amountPrefix(entry.tx_type);
  const amount = fmtIDR(entry.amount_idr || entry.amount);

  // Meta line: account · category · entity
  const meta = [
    accLabel,
    entry.category_name || entry.category,
    entry.entity !== "Personal" ? entry.entity : null,
  ].filter(Boolean).join(" · ");

  const iconSize = compact ? 32 : 36;
  // indent = chevron width (20) + gap (8) + icon width + gap (12)
  const expandedIndent = 20 + 8 + iconSize + 12;

  const handleClick = () => {
    if (isTwoDir) setExpanded(e => !e);
    onClick?.();
  };

  return (
    <div style={{ borderBottom: "1px solid #f3f4f6" }}>
      {/* ── Main row ── */}
      <div
        onClick={handleClick}
        style={{
          display:    "flex",
          alignItems: "center",
          gap:        12,
          padding:    compact ? "10px 0" : "12px 0",
          cursor:     isTwoDir ? "pointer" : (onClick ? "pointer" : "default"),
          position:   "relative",
        }}
      >
        {/* Chevron */}
        <div style={{ width: 20, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {isTwoDir && (
            <span style={{
              fontSize:   14,
              color:      "#9ca3af",
              display:    "inline-block",
              transform:  expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
              lineHeight: 1,
              userSelect: "none",
            }}>
              ›
            </span>
          )}
        </div>

        <CategoryIcon categoryId={entry.category} txType={entry.tx_type} size={iconSize} />

        {/* Center: name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize:    compact ? 13 : 14,
            fontWeight:  600,
            color:       "#111827",
            fontFamily:  "Figtree, sans-serif",
            whiteSpace:  "nowrap",
            overflow:    "hidden",
            textOverflow:"ellipsis",
          }}>
            {entry.description || entry.merchant_name || "—"}
          </div>
          {meta && (
            <div style={{
              fontSize:    11,
              fontWeight:  500,
              color:       "#9ca3af",
              fontFamily:  "Figtree, sans-serif",
              marginTop:   2,
              whiteSpace:  "nowrap",
              overflow:    "hidden",
              textOverflow:"ellipsis",
            }}>
              {meta}
            </div>
          )}
        </div>

        {/* Right: amount */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{
            fontSize:   compact ? 13 : 14,
            fontWeight: 700,
            color:      color,
            fontFamily: "Figtree, sans-serif",
          }}>
            {prefix}{amount}
          </div>
          {!compact && accLabel && (
            <div style={{
              fontSize:   10,
              color:      "#9ca3af",
              fontFamily: "Figtree, sans-serif",
              marginTop:  2,
            }}>
              {fromAcc?.bank_name || toAcc?.bank_name || ""}
            </div>
          )}
        </div>
      </div>

      {/* ── Expanded row ── */}
      {isTwoDir && expandedContent && (
        <div style={{
          overflow:   "hidden",
          maxHeight:  expanded ? "48px" : "0px",
          transition: "max-height 0.2s ease",
        }}>
          <div style={{
            paddingLeft:   expandedIndent,
            paddingRight:  8,
            paddingBottom: 8,
            paddingTop:    2,
            display:       "flex",
            alignItems:    "center",
            justifyContent:"space-between",
            background:    "var(--color-background-secondary, #f9fafb)",
            borderRadius:  "0 0 6px 6px",
          }}>
            <span style={{
              fontSize:   12,
              color:      "var(--color-text-secondary, #9ca3af)",
              fontFamily: "Figtree, sans-serif",
              overflow:   "hidden",
              textOverflow:"ellipsis",
              whiteSpace: "nowrap",
            }}>
              {expandedContent.label}
            </span>
            <span style={{
              fontSize:   12,
              fontWeight: 600,
              color:      expandedContent.positive ? "#059669" : "#dc2626",
              fontFamily: "Figtree, sans-serif",
              flexShrink: 0,
              marginLeft: 12,
            }}>
              {expandedContent.amount}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DATE GROUP HEADER ────────────────────────────────────────
export function DateGroupHeader({ dateStr, total, style = {} }) {
  return (
    <div style={{
      display:        "flex",
      justifyContent: "space-between",
      alignItems:     "center",
      padding:        "14px 0 6px",
      ...style,
    }}>
      <div style={{
        fontSize:   11,
        fontWeight: 700,
        color:      "#9ca3af",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        fontFamily: "Figtree, sans-serif",
      }}>
        {fmtDateLabel(dateStr)}
      </div>
      {total != null && (
        <div style={{
          fontSize:   11,
          fontWeight: 600,
          color:      total >= 0 ? "#059669" : "#dc2626",
          fontFamily: "Figtree, sans-serif",
        }}>
          {total >= 0 ? "+" : ""}{fmtIDR(total)}
        </div>
      )}
    </div>
  );
}

// ─── GROUPED TRANSACTION LIST ─────────────────────────────────
export function GroupedTransactionList({ groups, accounts, onRowClick, compact = false }) {
  if (!groups || groups.length === 0) return null;

  return (
    <div>
      {groups.map(([date, entries]) => {
        // Net for the day (income - expense)
        const dayNet = entries.reduce((sum, e) => {
          const a = Number(e.amount_idr || e.amount || 0);
          if (["income","reimburse_in","collect_loan","sell_asset"].includes(e.tx_type)) return sum + a;
          if (["transfer","pay_cc","fx_exchange","opening_balance"].includes(e.tx_type)) return sum;
          return sum - a;
        }, 0);

        return (
          <div key={date}>
            <DateGroupHeader dateStr={date} total={dayNet} />
            {entries.map(e => (
              <TransactionRow
                key={e.id}
                entry={e}
                accounts={accounts}
                onClick={() => onRowClick?.(e)}
                compact={compact}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
