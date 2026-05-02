import { useState } from "react";
import { fmtIDR, fmtDateLabel, fmtCur } from "../../utils";
import { EXPENSE_CATEGORIES, TX_TYPE_MAP } from "../../constants";

// ─── TWO-DIRECTIONAL TYPES ────────────────────────────────────
const TWO_DIR_TYPES = new Set(["transfer", "pay_cc"]);

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

  const color  = amountColor(entry.tx_type);
  const prefix = amountPrefix(entry.tx_type);
  const entryCurrency = entry.currency && entry.currency !== "IDR" ? entry.currency : null;
  const amount = entryCurrency
    ? fmtCur(entry.amount || 0, entryCurrency)
    : fmtIDR(entry.amount_idr || entry.amount);

  const iconSize = compact ? 32 : 36;
  // indent = icon width + gap (12) — no chevron anymore
  const expandedIndent = iconSize + 12;

  // ── Build meta line with teal clickable for two-dir ──────────
  const catLabel    = entry.category_name || entry.category || null;
  const tealLabel   = expandedContent?.label || null;

  // ── Type badge / missing-type warning ────────────────────────
  const TX_BADGE = {
    expense:       { bg: "#FDE8E8", color: "#C0392B", label: "Expense"       },
    income:        { bg: "#DFF5E8", color: "#1A7A42", label: "Income"        },
    transfer:      { bg: "#E0EAFF", color: "#2255C4", label: "Transfer"      },
    pay_cc:        { bg: "#EDE8FF", color: "#5B2DC4", label: "Pay CC"        },
    buy_asset:     { bg: "#FDE8E8", color: "#C0392B", label: "Buy Asset"     },
    sell_asset:    { bg: "#DFF5E8", color: "#1A7A42", label: "Sell Asset"    },
    fx_exchange:   { bg: "#FFF4DC", color: "#A0620A", label: "FX Exchange"   },
    reimburse_out: { bg: "#FDE8E8", color: "#C0392B", label: "Reimburse Out" },
    reimburse_in:  { bg: "#DFF5E8", color: "#1A7A42", label: "Reimburse In"  },
    give_loan:     { bg: "#FDE8E8", color: "#C0392B", label: "Give Loan"     },
    collect_loan:  { bg: "#DFF5E8", color: "#1A7A42", label: "Collect Loan"  },
    pay_liability: { bg: "#FFE8DC", color: "#A04A0A", label: "Pay Liability" },
  };
  const bdg = entry.tx_type ? TX_BADGE[entry.tx_type] : null;
  const badgeEl = entry.tx_type ? (bdg ? (
    <span key="badge" style={{
      display:       "inline-block",
      fontSize:      10,
      fontWeight:    500,
      lineHeight:    "1",
      padding:       "1px 6px",
      borderRadius:  4,
      background:    bdg.bg,
      color:         bdg.color,
      marginRight:   4,
      verticalAlign: "middle",
      whiteSpace:    "nowrap",
    }}>{bdg.label}</span>
  ) : null) : (
    <span key="badge" style={{
      display:       "inline-block",
      fontSize:      10,
      fontWeight:    500,
      lineHeight:    "1",
      padding:       "1px 6px",
      borderRadius:  4,
      background:    "#FDE8E8",
      color:         "#C0392B",
      marginRight:   4,
      verticalAlign: "middle",
      whiteSpace:    "nowrap",
    }}>! missing type</span>
  );

  const renderMeta = () => {
    if (!isTwoDir || !tealLabel) {
      // Single-directional: plain text
      const accLabel = fromAcc?.name || toAcc?.name || "";
      const textParts = [accLabel, entry.tx_type !== "reimburse_out" ? catLabel : null, entry.entity !== "Personal" ? entry.entity : null].filter(Boolean);
      const textStr = textParts.join(" · ");
      if (!badgeEl && !textStr) return null;
      if (!badgeEl) return textStr;
      return [badgeEl, <span key="txt">{textStr}</span>];
    }

    // Two-directional: build JSX with teal label
    const tealStyle = {
      color:          "#0D9488",
      cursor:         "pointer",
      textDecoration: expanded ? "underline" : "none",
      fontWeight:     500,
    };

    const handleTealClick = (e) => {
      e.stopPropagation();
      setExpanded(v => !v);
    };

    const tealSpan = (
      <span key="teal" style={tealStyle} onClick={handleTealClick}>
        {tealLabel}
      </span>
    );

    const parts = badgeEl ? [badgeEl] : [];

    if (entry.tx_type === "transfer" || entry.tx_type === "pay_cc" || entry.tx_type === "fx_exchange") {
      // "From → To" where To is teal
      const fromName = fromAcc?.name || "?";
      parts.push(
        <span key="arrow">{fromName} → </span>,
        tealSpan,
      );
    } else {
      // Show the main account, then teal as the "other side"
      const mainAcc = fromAcc?.name || toAcc?.name || "";
      if (mainAcc && mainAcc !== tealLabel) {
        parts.push(<span key="acc">{mainAcc}</span>);
        parts.push(<span key="sep1"> · </span>);
      }
      parts.push(tealSpan);
    }

    if (catLabel) {
      parts.push(<span key="sep2"> · </span>);
      parts.push(<span key="cat">{catLabel}</span>);
    }

    return parts;
  };

  const meta = renderMeta();

  return (
    <div style={{ borderBottom: "1px solid #f3f4f6" }}>
      {/* ── Main row ── */}
      <div
        onClick={onClick}
        style={{
          display:    "flex",
          alignItems: "center",
          gap:        12,
          padding:    compact ? "10px 0" : "12px 0",
          cursor:     onClick ? "pointer" : "default",
          position:   "relative",
        }}
      >
        <CategoryIcon categoryId={entry.category} txType={entry.tx_type} size={iconSize} />

        {/* Center: name + meta */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize:     compact ? 13 : 14,
            fontWeight:   600,
            color:        "#111827",
            fontFamily:   "Figtree, sans-serif",
            whiteSpace:   "nowrap",
            overflow:     "hidden",
            textOverflow: "ellipsis",
          }}>
            {entry.description || entry.merchant_name || "—"}
          </div>
          {meta && (
            <div style={{
              fontSize:     11,
              fontWeight:   500,
              color:        "#9ca3af",
              fontFamily:   "Figtree, sans-serif",
              marginTop:    2,
              whiteSpace:   "nowrap",
              overflow:     "hidden",
              textOverflow: "ellipsis",
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
          {!compact && (fromAcc?.bank_name || toAcc?.bank_name) && (
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
              fontSize:    12,
              color:       "var(--color-text-secondary, #9ca3af)",
              fontFamily:  "Figtree, sans-serif",
              overflow:    "hidden",
              textOverflow:"ellipsis",
              whiteSpace:  "nowrap",
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
export function DateGroupHeader({ dateStr, style = {} }) {
  return (
    <div style={{
      padding: "14px 0 6px",
      ...style,
    }}>
      <div style={{
        fontSize:      11,
        fontWeight:    700,
        color:         "#9ca3af",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        fontFamily:    "Figtree, sans-serif",
      }}>
        {fmtDateLabel(dateStr)}
      </div>
    </div>
  );
}

// ─── GROUPED TRANSACTION LIST ─────────────────────────────────
export function GroupedTransactionList({ groups, accounts, onRowClick, compact = false }) {
  if (!groups || groups.length === 0) return null;

  return (
    <div>
      {groups.map(([date, entries]) => {
        return (
          <div key={date}>
            <DateGroupHeader dateStr={date} />
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
