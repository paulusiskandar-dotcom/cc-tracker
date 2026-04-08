import { fmtIDR, fmtDateLabel } from "../../utils";
import { EXPENSE_CATEGORIES, TX_TYPE_MAP } from "../../constants";

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
  const fromAcc = accounts.find(a => a.id === entry.from_account_id);
  const toAcc   = accounts.find(a => a.id === entry.to_account_id);

  // Account display: "from → to" for transfers, else whichever exists
  const accLabel = (() => {
    if (entry.type === "transfer" || entry.type === "pay_cc" || entry.type === "fx_exchange") {
      const from = fromAcc?.name || "?";
      const to   = toAcc?.name   || "?";
      return `${from} → ${to}`;
    }
    return fromAcc?.name || toAcc?.name || "";
  })();

  const color  = amountColor(entry.type);
  const prefix = amountPrefix(entry.type);
  const amount = fmtIDR(entry.amount_idr || entry.amount);

  // Meta line: account · category · entity
  const meta = [
    accLabel,
    entry.category_label || entry.category,
    entry.entity !== "Personal" ? entry.entity : null,
  ].filter(Boolean).join(" · ");

  return (
    <div
      onClick={onClick}
      style={{
        display:      "flex",
        alignItems:   "center",
        gap:          12,
        padding:      compact ? "10px 0" : "12px 0",
        borderBottom: "1px solid #f3f4f6",
        cursor:       onClick ? "pointer" : "default",
        position:     "relative",
      }}
    >
      <CategoryIcon categoryId={entry.category} txType={entry.type} size={compact ? 32 : 36} />

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
          if (["income","reimburse_in","collect_loan","sell_asset"].includes(e.type)) return sum + a;
          if (["transfer","pay_cc","fx_exchange","opening_balance"].includes(e.type)) return sum;
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
