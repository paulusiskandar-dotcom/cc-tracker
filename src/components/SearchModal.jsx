import { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, X, ArrowUp, ArrowDown, CornerDownLeft,
  Receipt, Landmark, CreditCard, Wallet, LayoutGrid, Command,
} from "lucide-react";
import { fmtIDR } from "../utils";

const FF = "Figtree, sans-serif";

const TAB_NAV = [
  { id: "dashboard",    label: "Dashboard",     IconComp: LayoutGrid  },
  { id: "transactions", label: "Transactions",  IconComp: Receipt     },
  { id: "bank",         label: "Bank",          IconComp: Landmark    },
  { id: "cash",         label: "Cash",          IconComp: Wallet      },
  { id: "cards",        label: "Credit Cards",  IconComp: CreditCard  },
  { id: "assets",       label: "Assets",        IconComp: LayoutGrid  },
  { id: "receivables",  label: "Receivables",   IconComp: LayoutGrid  },
  { id: "income",       label: "Income",        IconComp: LayoutGrid  },
  { id: "reports",      label: "Reports",       IconComp: LayoutGrid  },
  { id: "budget",       label: "Budget",        IconComp: LayoutGrid  },
  { id: "calendar",     label: "Calendar",      IconComp: LayoutGrid  },
  { id: "reconcile",    label: "Reconcile",     IconComp: LayoutGrid  },
  { id: "settings",     label: "Settings",      IconComp: LayoutGrid  },
];

const TX_TYPE_COLOR = {
  expense:       "#dc2626",
  income:        "#059669",
  transfer:      "#3b5bdb",
  pay_cc:        "#d97706",
  reimburse_in:  "#059669",
  reimburse_out: "#dc2626",
  give_loan:     "#d97706",
  collect_loan:  "#059669",
};

const ACCOUNT_TAB = {
  bank:        "bank",
  credit_card: "cards",
  asset:       "assets",
  liability:   "assets",
  receivable:  "receivables",
};

export default function SearchModal({ open, onClose, ledger = [], accounts = [], categories = [], setTab }) {
  const [query,     setQuery]     = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef   = useRef(null);
  const resultsRef = useRef(null);

  // Reset + focus on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Build full index once (recomputed only when source data changes)
  const allItems = useMemo(() => {
    const items = [];

    // Transactions — last 365 days only for perf
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    for (const e of ledger) {
      if (!e.tx_date || e.tx_date < cutoffStr) continue;
      const isIn = ["income", "reimburse_in", "collect_loan", "sell_asset"].includes(e.tx_type);
      items.push({
        kind:         "transaction",
        id:           e.id,
        title:        e.description || e.merchant_name || "—",
        subtitle:     `${e.category_name || e.tx_type || "—"} · ${e.tx_date}`,
        amount:       e.amount_idr || e.amount || 0,
        amountColor:  TX_TYPE_COLOR[e.tx_type] || "#6b7280",
        amountPrefix: isIn ? "+" : "−",
        searchText:   [e.description, e.merchant_name, e.category_name, e.entity].filter(Boolean).join(" ").toLowerCase(),
        raw:          e,
      });
    }

    // Active accounts
    for (const a of accounts) {
      if (a.is_active === false) continue;
      const bal = a.type === "credit_card"
        ? Number(a.outstanding_amount || 0)
        : Number(a.current_balance || 0);
      items.push({
        kind:        "account",
        id:          a.id,
        title:       a.name,
        subtitle:    [
          a.type === "credit_card" ? "Credit Card" : a.type === "bank" ? "Bank" : a.type,
          a.bank_name,
          a.currency && a.currency !== "IDR" ? a.currency : null,
        ].filter(Boolean).join(" · "),
        amount:      bal,
        amountColor: a.type === "credit_card" && bal > 0 ? "#dc2626" : "#374151",
        amountPrefix:"",
        searchText:  [a.name, a.bank_name, a.card_last4, a.type].filter(Boolean).join(" ").toLowerCase(),
        accountType: a.type,
      });
    }

    // Navigation
    for (const t of TAB_NAV) {
      items.push({
        kind:       "navigation",
        id:         t.id,
        title:      `Go to ${t.label}`,
        subtitle:   "Navigation",
        searchText: `${t.label} ${t.id}`.toLowerCase(),
        tabId:      t.id,
        IconComp:   t.IconComp,
        amount:     undefined,
      });
    }

    return items;
  }, [ledger, accounts]);

  // Filtered + grouped results
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return [{ label: "Navigate to", items: allItems.filter(i => i.kind === "navigation").slice(0, 8) }];
    }
    const matched = allItems.filter(i => i.searchText.includes(q));
    const nav   = matched.filter(i => i.kind === "navigation").slice(0, 5);
    const accs  = matched.filter(i => i.kind === "account").slice(0, 5);
    const txs   = matched.filter(i => i.kind === "transaction").slice(0, 5);
    const out = [];
    if (nav.length)  out.push({ label: "Navigation",    items: nav  });
    if (accs.length) out.push({ label: "Accounts",      items: accs });
    if (txs.length)  out.push({ label: "Transactions",  items: txs  });
    return out;
  }, [query, allItems]);

  // Flat list for keyboard nav
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  // Reset active when query changes
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Keyboard: Escape / ↑↓ / Enter
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape")    { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(p => Math.min(p + 1, flat.length - 1)); }
      else if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(p => Math.max(p - 1, 0)); }
      else if (e.key === "Enter")     { e.preventDefault(); const item = flat[activeIdx]; if (item) handleSelect(item); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flat, activeIdx]);

  // Scroll active into view
  useEffect(() => {
    const el = resultsRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const handleSelect = (item) => {
    if (item.kind === "navigation") setTab?.(item.tabId);
    else if (item.kind === "account")     setTab?.(ACCOUNT_TAB[item.accountType] || "bank");
    else if (item.kind === "transaction") setTab?.("transactions");
    onClose();
  };

  if (!open) return null;

  let rowIdx = -1;

  return (
    <div
      onClick={onClose}
      style={{
        position:           "fixed",
        inset:              0,
        zIndex:             1200,
        background:         "rgba(15, 23, 42, 0.5)",
        backdropFilter:     "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display:            "flex",
        justifyContent:     "center",
        alignItems:         "flex-start",
        paddingTop:         "10vh",
        padding:            "10vh 16px 0",
        fontFamily:         FF,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:    "#fff",
          borderRadius:  16,
          width:         "100%",
          maxWidth:      600,
          maxHeight:     "76vh",
          display:       "flex",
          flexDirection: "column",
          boxShadow:     "0 20px 60px rgba(0,0,0,0.3)",
          overflow:      "hidden",
        }}
      >
        {/* ── Input row ── */}
        <div style={{
          display:      "flex",
          alignItems:   "center",
          gap:          12,
          padding:      "14px 18px",
          borderBottom: "0.5px solid #e5e7eb",
          flexShrink:   0,
        }}>
          <Search size={18} color="#9ca3af" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search transactions, accounts, or navigate…"
            style={{
              flex:       1,
              border:     "none",
              outline:    "none",
              fontSize:   15,
              fontFamily: FF,
              color:      "#111827",
              background: "transparent",
            }}
          />
          <button
            onClick={onClose}
            style={{
              background: "none",
              border:     "none",
              cursor:     "pointer",
              padding:    4,
              borderRadius: 4,
              display:    "flex",
              color:      "#6b7280",
            }}
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* ── Results ── */}
        <div
          ref={resultsRef}
          style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}
        >
          {groups.length === 0 && query && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              No results for "{query}"
            </div>
          )}

          {groups.map((group, gi) => (
            <div key={gi}>
              <div style={{
                fontSize:      10,
                fontWeight:    700,
                color:         "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.6px",
                padding:       "8px 18px 3px",
              }}>
                {group.label}
              </div>
              {group.items.map(item => {
                rowIdx++;
                const idx      = rowIdx;
                const isActive = idx === activeIdx;
                return (
                  <div
                    key={item.kind + item.id}
                    data-idx={idx}
                    onClick={() => handleSelect(item)}
                    onMouseEnter={() => setActiveIdx(idx)}
                    style={{
                      display:    "flex",
                      alignItems: "center",
                      gap:        12,
                      padding:    "9px 18px",
                      cursor:     "pointer",
                      background: isActive ? "#f3f4f6" : "transparent",
                    }}
                  >
                    {/* Icon badge */}
                    <div style={{
                      width:           32,
                      height:          32,
                      borderRadius:    8,
                      flexShrink:      0,
                      display:         "flex",
                      alignItems:      "center",
                      justifyContent:  "center",
                      background:
                        item.kind === "navigation"  ? "#eff6ff" :
                        item.kind === "account"     ? "#f0fdf4" : "#fef3c7",
                    }}>
                      {item.kind === "navigation" && item.IconComp &&
                        <item.IconComp size={15} color="#3b5bdb" strokeWidth={1.5} />}
                      {item.kind === "account" && (
                        item.accountType === "credit_card" ? <CreditCard size={15} color="#059669" strokeWidth={1.5} /> :
                        item.accountType === "bank"        ? <Landmark   size={15} color="#059669" strokeWidth={1.5} /> :
                                                             <Wallet     size={15} color="#059669" strokeWidth={1.5} />
                      )}
                      {item.kind === "transaction" &&
                        <Receipt size={15} color="#d97706" strokeWidth={1.5} />}
                    </div>

                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize:     13,
                        fontWeight:   500,
                        color:        "#111827",
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                      }}>
                        {item.title}
                      </div>
                      <div style={{
                        fontSize:     11,
                        color:        "#9ca3af",
                        marginTop:    2,
                        overflow:     "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace:   "nowrap",
                      }}>
                        {item.subtitle}
                      </div>
                    </div>

                    {/* Amount */}
                    {item.amount !== undefined && item.kind !== "navigation" && (
                      <div style={{ fontSize: 13, fontWeight: 600, color: item.amountColor, flexShrink: 0 }}>
                        {item.amountPrefix}{fmtIDR(item.amount)}
                      </div>
                    )}

                    {/* Enter hint on active */}
                    {isActive && (
                      <CornerDownLeft size={13} color="#9ca3af" strokeWidth={1.5} style={{ flexShrink: 0 }} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Footer hints ── */}
        <div style={{
          display:      "flex",
          alignItems:   "center",
          gap:          14,
          padding:      "9px 18px",
          borderTop:    "0.5px solid #e5e7eb",
          fontSize:     11,
          color:        "#9ca3af",
          background:   "#fafafa",
          flexShrink:   0,
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <ArrowUp size={11} /><ArrowDown size={11} /> navigate
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <CornerDownLeft size={11} /> select
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <kbd style={{
              padding: "1px 5px", background: "#fff",
              border: "0.5px solid #e5e7eb", borderRadius: 4,
              fontSize: 10, fontFamily: FF,
            }}>Esc</kbd> close
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3 }}>
            <Command size={11} /> K
          </span>
        </div>
      </div>
    </div>
  );
}
