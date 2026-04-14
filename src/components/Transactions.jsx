import { useState, useMemo } from "react";
import { ledgerApi, gmailApi, getTxFromToTypes, recalculateBalance } from "../api";
import { EXPENSE_CATEGORIES, ENTITIES } from "../constants";
import { fmtIDR, fmtCur, todayStr, ym, groupByDate, fmtDateLabel } from "../utils";
import { ConfirmModal } from "./shared/Modal";
import { EmptyState, showToast } from "./shared/Card";
import SortDropdown from "./shared/SortDropdown";
import TransactionModal from "./shared/TransactionModal";

// ─── SUBTABS ─────────────────────────────────────────────────
const SUBTABS = [
  { id: "all",       label: "All" },
  { id: "expense",   label: "Expenses" },
  { id: "income",    label: "Income" },
  { id: "transfer",  label: "Transfers" },
  { id: "reimburse", label: "Reimburse" },
];

// ─── MAIN COMPONENT ──────────────────────────────────────────
export default function Transactions({
  user, accounts, ledger, categories, fxRates, CURRENCIES: C,
  bankAccounts, creditCards, assets, liabilities, receivables,
  onRefresh, setLedger, pendingSyncs, setPendingSyncs, incomeSrcs,
  employeeLoans = [], setEmployeeLoans,
  accountCurrencies = [],
}) {
  const allCurrencies = C || [];
  const pendingCount  = pendingSyncs?.length || 0;

  // ── UI state ──
  const [txSort,  setTxSort]  = useState(() => localStorage.getItem("sort_transactions") || "date_desc");
  const [subTab,  setSubTab]  = useState("all");
  const [txModal, setTxModal] = useState({ open: false, mode: "add", entry: null });
  const [deleteEntry, setDeleteEntry] = useState(null);

  // ── Filters ──
  const [filterMonth,  setFilterMonth]  = useState("");
  const [filterEntity, setFilterEntity] = useState("");
  const [filterAccId,  setFilterAccId]  = useState("");
  const [search,       setSearch]       = useState("");

  // ── Filtering ──
  const filtered = useMemo(() => {
    let list = [...ledger];
    if (subTab === "expense")   list = list.filter(e => e.tx_type === "expense");
    else if (subTab === "income")    list = list.filter(e => e.tx_type === "income");
    else if (subTab === "transfer")  list = list.filter(e => ["transfer","pay_cc","fx_exchange"].includes(e.tx_type));
    else if (subTab === "reimburse") list = list.filter(e => e.is_reimburse || e.tx_type === "reimburse_out" || e.tx_type === "reimburse_in");
    if (filterMonth)  list = list.filter(e => ym(e.tx_date) === filterMonth);
    if (filterEntity) list = list.filter(e => e.entity === filterEntity);
    if (filterAccId)  list = list.filter(e => e.from_id === filterAccId || e.to_id === filterAccId);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.description?.toLowerCase().includes(q) ||
        e.merchant_name?.toLowerCase().includes(q) ||
        e.category_name?.toLowerCase().includes(q));
    }
    return list;
  }, [ledger, subTab, filterMonth, filterEntity, filterAccId, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const byName = (a, b) => (a.description || a.merchant_name || "").localeCompare(b.description || b.merchant_name || "");
    switch (txSort) {
      case "date_asc":    return arr.sort((a, b) => a.tx_date.localeCompare(b.tx_date));
      case "amount_desc": return arr.sort((a, b) => Number(b.amount_idr || b.amount || 0) - Number(a.amount_idr || a.amount || 0));
      case "amount_asc":  return arr.sort((a, b) => Number(a.amount_idr || a.amount || 0) - Number(b.amount_idr || b.amount || 0));
      case "name_asc":    return arr.sort(byName);
      case "name_desc":   return arr.sort((a, b) => byName(b, a));
      default:            return arr.sort((a, b) => b.tx_date.localeCompare(a.tx_date));
    }
  }, [filtered, txSort]);

  const grouped = useMemo(() => groupByDate(sorted), [sorted]);

  // ── Totals ──
  const outTotal = useMemo(() =>
    filtered.filter(e => ["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan"].includes(e.tx_type))
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [filtered]);

  const inTotal = useMemo(() =>
    filtered.filter(e => ["income","sell_asset","reimburse_in","collect_loan"].includes(e.tx_type))
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [filtered]);

  const missingTypeCount = useMemo(() => filtered.filter(e => !e.tx_type).length, [filtered]);

  // ── Open add ──
  const openAdd = () => setTxModal({ open: true, mode: "add", entry: null });

  // ── Open edit ──
  const openEdit = (e) => setTxModal({ open: true, mode: "edit", entry: e });



  // ── Delete ──
  const confirmDelete = async () => {
    if (!deleteEntry) return;
    try {
      await ledgerApi.delete(deleteEntry.id, deleteEntry, accounts);
      setLedger(p => p.filter(e => e.id !== deleteEntry.id));
      // Sync current_balance for all affected bank accounts
      const affectedIds = [
        ...(deleteEntry.from_type === "account" && deleteEntry.from_id ? [deleteEntry.from_id] : []),
        ...(deleteEntry.to_type   === "account" && deleteEntry.to_id   ? [deleteEntry.to_id]   : []),
      ];
      await Promise.all([...new Set(affectedIds)].map(id => recalculateBalance(id, user.id)));
      showToast("Deleted");
      await onRefresh();
    } catch (e) { showToast(e.message, "error"); }
    setDeleteEntry(null);
  };

  // ── Months for filter ──
  const monthOptions = useMemo(() => {
    const seen = new Set();
    ledger.forEach(e => seen.add(ym(e.tx_date)));
    return Array.from(seen).sort((a, b) => b.localeCompare(a)).slice(0, 12).map(m => ({
      value: m,
      label: new Date(m + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    }));
  }, [ledger]);

  // ─── RENDER ───────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── ACTION BAR ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, position: "relative" }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search transactions…"
            style={{
              width: "100%", height: 36, padding: "0 12px 0 32px",
              border: "1.5px solid #e5e7eb", borderRadius: 10,
              fontFamily: "Figtree, sans-serif", fontSize: 13, fontWeight: 500,
              color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box",
            }}
          />
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "#9ca3af" }}>🔍</span>
        </div>
        <button onClick={openAdd} style={BTN_PRIMARY}>+ Add</button>
      </div>

      {/* ── FILTERS ROW ── */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={FILTER_SELECT}>
          <option value="">All months</option>
          {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} style={FILTER_SELECT}>
          <option value="">All entities</option>
          {ENTITIES.map(en => <option key={en} value={en}>{en}</option>)}
        </select>
        <select value={filterAccId} onChange={e => setFilterAccId(e.target.value)} style={FILTER_SELECT}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {(filterMonth || filterEntity || filterAccId || search) && (
          <button
            onClick={() => { setFilterMonth(""); setFilterEntity(""); setFilterAccId(""); setSearch(""); }}
            style={{ ...FILTER_SELECT, background: "#fee2e2", color: "#dc2626", border: "1.5px solid #fecaca", cursor: "pointer" }}
          >
            ✕ Clear
          </button>
        )}
      </div>

      {/* ── SUBTABS + SORT ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
          {[...SUBTABS, ...(pendingCount > 0 ? [{ id: "pending", label: `Pending (${pendingCount})` }] : [])].map(t => {
            const active = subTab === t.id;
            return (
              <button key={t.id} onClick={() => setSubTab(t.id)} style={{
                height: 30, padding: "0 12px", borderRadius: 20,
                border: `1.5px solid ${active ? "#111827" : "#e5e7eb"}`,
                background: active ? "#111827" : "#fff",
                color: active ? "#fff" : "#6b7280",
                fontSize: 12, fontWeight: active ? 700 : 500,
                cursor: "pointer", fontFamily: "Figtree, sans-serif",
                display: "flex", alignItems: "center", gap: 5,
              }}>
                {t.label}
                {t.id === "all" && missingTypeCount > 0 && (
                  <span style={{
                    background: "#C0392B", color: "#fff",
                    fontSize: 10, fontWeight: 700,
                    padding: "0 5px", borderRadius: 99, lineHeight: "16px",
                    minWidth: 16, textAlign: "center",
                  }}>{missingTypeCount}</span>
                )}
              </button>
            );
          })}
        </div>
        <SortDropdown
          storageKey="sort_transactions"
          options={[
            { key: "date",   label: "Date",   defaultDir: "desc" },
            { key: "amount", label: "Amount", defaultDir: "desc" },
            { key: "name",   label: "Name",   defaultDir: "asc"  },
          ]}
          value={txSort}
          onChange={v => setTxSort(v)}
        />
      </div>

      {/* ── SUMMARY STRIP ── */}
      {subTab !== "pending" && (
        <div style={{
          display: "flex", gap: 16, alignItems: "center",
          padding: "8px 0", borderBottom: "1px solid #f3f4f6",
          fontSize: 12, fontFamily: "Figtree, sans-serif",
        }}>
          <span style={{ color: "#9ca3af" }}>{filtered.length} transactions</span>
          <span style={{ color: "#dc2626", fontWeight: 700 }}>−{fmtIDR(outTotal, true)}</span>
          <span style={{ color: "#059669", fontWeight: 700 }}>+{fmtIDR(inTotal, true)}</span>
          {missingTypeCount > 0 && (
            <span style={{
              background: "#fee2e2", color: "#dc2626", fontWeight: 700,
              padding: "2px 7px", borderRadius: 99, fontSize: 11,
            }}>
              ⚠ {missingTypeCount} missing type
            </span>
          )}
          <span style={{ color: inTotal - outTotal >= 0 ? "#059669" : "#dc2626", fontWeight: 700, marginLeft: "auto" }}>
            Net: {inTotal - outTotal >= 0 ? "+" : ""}{fmtIDR(inTotal - outTotal, true)}
          </span>
        </div>
      )}

      {/* ── PENDING TAB ── */}
      {subTab === "pending" && (
        <PendingTab
          pendingSyncs={pendingSyncs} setPendingSyncs={setPendingSyncs}
          accounts={accounts} categories={categories} user={user}
          ledger={ledger} setLedger={setLedger} onRefresh={onRefresh}
        />
      )}

      {/* ── TRANSACTION LIST ── */}
      {subTab !== "pending" && (
        grouped.length === 0
          ? <EmptyState icon="📋" title="No transactions" message="Add your first transaction or adjust the filters." />
          : grouped.map(([date, rows]) => {
              const dayNet = rows.reduce((sum, e) => {
                const a = Number(e.amount_idr || e.amount || 0);
                if (["income","reimburse_in","collect_loan","sell_asset"].includes(e.tx_type)) return sum + a;
                if (["transfer","pay_cc","fx_exchange","opening_balance"].includes(e.tx_type)) return sum;
                return sum - a;
              }, 0);

              return (
                <div key={date}>
                  {/* Date header */}
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 0 6px",
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: "#9ca3af",
                      textTransform: "uppercase", letterSpacing: "0.5px",
                      fontFamily: "Figtree, sans-serif",
                    }}>
                      {fmtDateLabel(date)}
                    </div>
                    <div style={{
                      fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif",
                      color: dayNet >= 0 ? "#059669" : "#dc2626",
                    }}>
                      {dayNet >= 0 ? "+" : ""}{fmtIDR(dayNet, true)}
                    </div>
                  </div>

                  {/* Rows */}
                  {rows.map(e => (
                    <TxRow
                      key={e.id}
                      entry={e}
                      accounts={accounts}
                      categories={categories}
                      onEdit={() => openEdit(e)}
                      onDelete={() => setDeleteEntry(e)}
                    />
                  ))}
                </div>
              );
            })
      )}

      {/* ── ADD / EDIT MODAL ── */}
      <TransactionModal
        open={txModal.open}
        mode={txModal.mode}
        initialData={txModal.entry}
        onSave={() => {}}
        onDelete={() => {}}
        onClose={() => setTxModal({ open: false, mode: "add", entry: null })}
        user={user}
        accounts={accounts}
        setLedger={setLedger}
        categories={categories}
        fxRates={fxRates}
        allCurrencies={allCurrencies}
        bankAccounts={bankAccounts}
        creditCards={creditCards}
        assets={assets}
        liabilities={liabilities}
        receivables={receivables}
        incomeSrcs={incomeSrcs}
        employeeLoans={employeeLoans}
        setEmployeeLoans={setEmployeeLoans}
        accountCurrencies={accountCurrencies}
        onRefresh={onRefresh}
      />

      {/* ── DELETE CONFIRM ── */}
      <ConfirmModal
        isOpen={!!deleteEntry}
        onClose={() => setDeleteEntry(null)}
        onConfirm={confirmDelete}
        title="Delete Transaction"
        message={`Delete "${deleteEntry?.description}"? This cannot be undone and will reverse the balance update.`}
        danger
      />
    </div>
  );
}

// ─── TWO-DIRECTIONAL TYPES ────────────────────────────────────
const TWO_DIR_TYPES = new Set(["transfer", "pay_cc"]);

function getTxExpandedContent(e, fromAcc, toAcc) {
  const amtIDR = Number(e.amount_idr || e.amount || 0);
  switch (e.tx_type) {
    case "transfer":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "pay_cc":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "buy_asset":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "sell_asset":
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "fx_exchange": {
      const desc = e.description || "";
      const foreignCurrency = desc.split(" ")[1] || "";
      const rate = Number(e.fx_rate_used || 0);
      const isBuy = desc.startsWith("Buy");
      if (isBuy && foreignCurrency && rate > 0) {
        const foreignAmt = Math.round((amtIDR / rate) * 100) / 100;
        return { label: toAcc?.name || "?", amount: `+${fmtCur(foreignAmt, foreignCurrency)}`, positive: true };
      }
      return { label: toAcc?.name || "?", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    }
    case "reimburse_out": {
      const entityLabel = e.entity && e.entity !== "Personal" ? e.entity : (toAcc?.name || "?");
      return { label: entityLabel, amount: `+${fmtIDR(amtIDR)}`, positive: true };
    }
    case "reimburse_in":
      return { label: fromAcc?.name || "?", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    case "give_loan":
      // from_id = account, to_id = null (employee_loan). Show the source account.
      return { label: fromAcc?.name || "Loan", amount: `+${fmtIDR(amtIDR)}`, positive: true };
    case "collect_loan":
      // from_id = null (employee_loan), to_id = account. Show the destination account.
      return { label: toAcc?.name || "Repayment", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    case "pay_liability":
      return { label: toAcc?.name || "?", amount: `-${fmtIDR(amtIDR)}`, positive: false };
    default:
      return null;
  }
}

// ─── TRANSACTION ROW ─────────────────────────────────────────
function TxRow({ entry: e, accounts, categories = [], onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const isTwoDir = TWO_DIR_TYPES.has(e.tx_type);

  const fromAcc = accounts.find(a => a.id === e.from_id);
  const toAcc   = accounts.find(a => a.id === e.to_id);
  const amt     = Number(e.amount_idr || e.amount || 0);

  const isOut    = ["expense","pay_cc","buy_asset","pay_liability","reimburse_out","give_loan"].includes(e.tx_type);
  const isIn     = ["income","sell_asset","reimburse_in","collect_loan"].includes(e.tx_type);
  const isMove   = ["transfer","fx_exchange"].includes(e.tx_type);

  // Lookup: try slug match (EXPENSE_CATEGORIES) first, then DB category (UUID match)
  const catDef   = EXPENSE_CATEGORIES.find(c => c.id === e.category_id || c.id === e.category)
                || categories?.find(c => c.id === e.category_id);
  const amtColor = isOut ? "#dc2626" : isIn ? "#059669" : "#3b5bdb";
  const prefix   = isOut ? "−" : isIn ? "+" : "";

  const iconEmoji = catDef?.icon || (isOut ? "↑" : isIn ? "↓" : "↔");
  const iconBg    = catDef ? catDef.color + "18" : isOut ? "#fee2e2" : isIn ? "#dcfce7" : "#dbeafe";

  const expandedContent = isTwoDir ? getTxExpandedContent(e, fromAcc, toAcc) : null;
  const tealLabel = expandedContent?.label || null;
  // indent = icon (36) + gap (12)
  const expandedIndent = 48;

  const catLabel = e.category_name || catDef?.label || catDef?.name || null;

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
  const bdg = e.tx_type ? TX_BADGE[e.tx_type] : null;
  const badgeEl = e.tx_type ? (bdg ? (
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
      const accLabel = isMove
        ? `${fromAcc?.name || "?"} → ${toAcc?.name || "?"}`
        : fromAcc?.name || toAcc?.name || "";
      const textStr = [accLabel, catLabel, e.entity && e.entity !== "Personal" ? e.entity : null]
        .filter(Boolean).join(" · ");
      if (!badgeEl && !textStr) return null;
      if (!badgeEl) return textStr;
      return [badgeEl, <span key="txt">{textStr}</span>];
    }

    const tealStyle = {
      color: "#0D9488", cursor: "pointer",
      textDecoration: expanded ? "underline" : "none", fontWeight: 500,
    };
    const handleTealClick = (ev) => { ev.stopPropagation(); setExpanded(x => !x); };
    const tealSpan = <span key="teal" style={tealStyle} onClick={handleTealClick}>{tealLabel}</span>;

    const parts = badgeEl ? [badgeEl] : [];
    if (e.tx_type === "transfer" || e.tx_type === "pay_cc" || e.tx_type === "fx_exchange") {
      parts.push(<span key="arrow">{fromAcc?.name || "?"} → </span>, tealSpan);
    } else {
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
    <div style={{ borderBottom: "1px solid #f9fafb" }}>
      {/* ── Main row ── */}
      <div
        onClick={onEdit}
        style={{
          display:    "flex",
          alignItems: "center",
          gap:        12,
          padding:    "10px 0",
          cursor:     "pointer",
        }}
      >
        {/* Icon */}
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: iconBg,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16, flexShrink: 0,
        }}>
          {iconEmoji}
        </div>

        {/* Center */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: "#111827",
            fontFamily: "Figtree, sans-serif",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {e.description || "—"}
          </div>
          {meta && (
            <div style={{
              fontSize: 11, color: "#9ca3af",
              fontFamily: "Figtree, sans-serif",
              marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {meta}
            </div>
          )}
        </div>

        {/* Amount */}
        <div style={{
          fontSize: 13, fontWeight: 700,
          color: amtColor, fontFamily: "Figtree, sans-serif",
          flexShrink: 0, textAlign: "right",
        }}>
          {prefix}{fmtIDR(amt)}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={ev => { ev.stopPropagation(); onEdit(); }} style={ROW_BTN}>✎</button>
          <button onClick={ev => { ev.stopPropagation(); onDelete(); }} style={{ ...ROW_BTN, color: "#dc2626", borderColor: "#fecaca" }}>✕</button>
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
            background:    "#f9fafb",
            borderRadius:  "0 0 6px 6px",
          }}>
            <span style={{
              fontSize:    12,
              color:       "#9ca3af",
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

// ─── PENDING TAB ─────────────────────────────────────────────
function PendingTab({ pendingSyncs, setPendingSyncs, accounts, categories, user, ledger, setLedger, onRefresh }) {
  const [checked,   setChecked]   = useState(() => new Set((pendingSyncs || []).map(s => s.id)));
  const [importing, setImporting] = useState(false);
  const [progress,  setProgress]  = useState({ done: 0, total: 0 });

  if (!pendingSyncs?.length) return (
    <EmptyState icon="📧" title="No pending emails" message="Gmail sync will surface transactions here for review." />
  );

  const selectedSyncs = pendingSyncs.filter(s => checked.has(s.id));
  const allChecked    = selectedSyncs.length === pendingSyncs.length && pendingSyncs.length > 0;

  const buildEntry = (sync) => {
    const txType = sync.tx_type || "expense";
    const { from_type, to_type } = getTxFromToTypes(txType);
    const catMatch = categories.find(c =>
      c.name?.toLowerCase() === (sync.suggested_category_label || "").toLowerCase()
    );
    return {
      tx_date:       sync.transaction_date || sync.received_at?.slice(0, 10) || todayStr(),
      description:   sync.merchant_name || sync.subject || "Gmail transaction",
      amount:        Number(sync.amount || 0),
      currency:      sync.currency || "IDR",
      amount_idr:    Number(sync.amount_idr || sync.amount || 0),
      tx_type:       txType, from_type, to_type,
      from_id:       sync.matched_account_id || null,
      to_id:         null,
      category_id:   catMatch?.id || null,
      category_name: catMatch?.name || null,
      entity:        sync.entity || "Personal",
      notes:         `Imported from Gmail: ${sync.subject || ""}`,
    };
  };

  const removeOne = (id) => {
    setPendingSyncs(p => p.filter(s => s.id !== id));
    setChecked(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const confirm = async (sync) => {
    try {
      const created = await ledgerApi.create(user.id, buildEntry(sync), accounts);
      setLedger(p => [created, ...p]);
      await gmailApi.updateSync(sync.email_sync_id || sync.id, { status: "confirmed" });
      removeOne(sync.id);
      showToast("Imported");
      onRefresh();
    } catch (e) { showToast(e.message, "error"); }
  };

  const skip = async (sync) => {
    try {
      await gmailApi.updateSync(sync.email_sync_id || sync.id, { status: "skipped" });
      removeOne(sync.id);
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };

  const importAll = async () => {
    const toImport = [...selectedSyncs];
    if (!toImport.length) return;
    setImporting(true);
    setProgress({ done: 0, total: toImport.length });
    let count = 0;
    for (const sync of toImport) {
      try {
        const created = await ledgerApi.create(user.id, buildEntry(sync), accounts);
        setLedger(p => [created, ...p]);
        await gmailApi.updateSync(sync.email_sync_id || sync.id, { status: "confirmed" });
        setPendingSyncs(p => p.filter(s => s.id !== sync.id));
        setChecked(prev => { const n = new Set(prev); n.delete(sync.id); return n; });
        count++;
        setProgress({ done: count, total: toImport.length });
      } catch (_) { /* skip failures, continue */ }
    }
    setImporting(false);
    showToast(`${count} transaction${count !== 1 ? "s" : ""} imported`);
    onRefresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* ── Bulk action bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px", background: "#ffffff",
        border: "0.5px solid #e5e7eb", borderRadius: 12,
      }}>
        <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif", flex: 1 }}>
          {importing
            ? `${progress.done} of ${progress.total}…`
            : `${selectedSyncs.length} of ${pendingSyncs.length} selected`}
        </span>
        <button
          onClick={() => setChecked(allChecked ? new Set() : new Set(pendingSyncs.map(s => s.id)))}
          disabled={importing}
          style={{ height: 28, padding: "0 10px", border: "1px solid #e5e7eb", borderRadius: 7, cursor: "pointer", background: "#fff", color: "#6b7280", fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
        >
          {allChecked ? "Deselect All" : "Select All"}
        </button>
        <button
          onClick={importAll}
          disabled={importing || !selectedSyncs.length}
          style={{
            height: 28, padding: "0 12px", border: "none", borderRadius: 7,
            cursor: importing || !selectedSyncs.length ? "not-allowed" : "pointer",
            background: !importing && selectedSyncs.length ? "#111827" : "#e5e7eb",
            color:      !importing && selectedSyncs.length ? "#fff"     : "#9ca3af",
            fontSize: 11, fontWeight: 700, fontFamily: "Figtree, sans-serif",
          }}
        >
          {importing ? `Importing…` : "Confirm All ✓"}
        </button>
      </div>

      {/* ── Transaction rows ── */}
      {pendingSyncs.map(s => (
        <div key={s.id} style={{
          background: "#fef9ec", border: "1.5px solid #fde68a",
          borderRadius: 12, padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <input
            type="checkbox"
            checked={checked.has(s.id)}
            onChange={() => setChecked(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
            disabled={importing}
            style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#111827", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
              {s.merchant_name || s.subject || "Gmail transaction"}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
              {s.transaction_date || s.received_at?.slice(0, 10)}
              {s.amount && ` · ${fmtIDR(s.amount)}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => confirm(s)} disabled={importing} style={{ ...BTN_CONFIRM, opacity: importing ? 0.5 : 1 }}>✓</button>
            <button onClick={() => skip(s)}    disabled={importing} style={{ ...BTN_SKIP,    opacity: importing ? 0.5 : 1 }}>Skip</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────
const BTN_PRIMARY = {
  height: 36, padding: "0 14px", borderRadius: 10, border: "none",
  background: "#111827", color: "#fff", fontSize: 13, fontWeight: 700,
  cursor: "pointer", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", flexShrink: 0,
};

const FILTER_SELECT = {
  height: 32, padding: "0 10px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", background: "#fff",
  fontFamily: "Figtree, sans-serif", fontSize: 12, fontWeight: 500,
  color: "#374151", outline: "none", cursor: "pointer",
  appearance: "none", WebkitAppearance: "none",
};

const ROW_BTN = {
  width: 26, height: 26, borderRadius: 6,
  border: "1px solid #e5e7eb", background: "#f9fafb",
  color: "#9ca3af", fontSize: 11, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif",
};

const BTN_CONFIRM = {
  height: 30, padding: "0 12px", borderRadius: 8, border: "none",
  background: "#dcfce7", color: "#059669", fontSize: 11, fontWeight: 700,
  cursor: "pointer", fontFamily: "Figtree, sans-serif",
};

const BTN_SKIP = {
  height: 30, padding: "0 10px", borderRadius: 8,
  border: "1px solid #e5e7eb", background: "#fff",
  color: "#9ca3af", fontSize: 11, fontWeight: 600,
  cursor: "pointer", fontFamily: "Figtree, sans-serif",
};
