import { useState, useMemo, useCallback } from "react";
import { EmptyState } from "./shared/index";
import ReconcileModal from "./ReconcileModal";

const MO_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const F = "Figtree, sans-serif";

// Google favicon proxy — same pattern used on Bank page
const bankFavicon = (bankName) => {
  if (!bankName) return null;
  const domain = bankName.toLowerCase().replace(/\s+/g, "")
    .replace(/bca/i, "bca.co.id").replace(/mandiri/i, "bankmandiri.co.id")
    .replace(/bni/i, "bni.co.id").replace(/bri/i, "bri.co.id")
    .replace(/cimb/i, "cimbniaga.co.id").replace(/ocbc/i, "ocbc.id")
    .replace(/danamon/i, "danamon.co.id").replace(/maybank/i, "maybank.co.id")
    .replace(/uob/i, "uob.co.id").replace(/hsbc/i, "hsbc.co.id")
    .replace(/jenius/i, "jenius.com").replace(/permata/i, "permatabank.com")
    .replace(/mega/i, "bankmega.com").replace(/btn/i, "btn.co.id")
    .replace(/superbank/i, "superbank.id").replace(/blu/i, "blu.co.id");
  if (!domain.includes(".")) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
};

export default function Reconcile({
  user, accounts, ledger, setLedger, categories,
  reconSessions = [], onRefresh, dark,
  bankAccounts, creditCards, assets, liabilities, receivables,
  incomeSrcs, fxRates, CURRENCIES, accountCurrencies,
}) {
  const [modal, setModal] = useState(null);
  const [typeFilter,  setTypeFilter]  = useState("all");
  const [monthFilter, setMonthFilter] = useState(0);

  const now = new Date();
  const curYear = now.getFullYear();
  const curMo   = now.getMonth() + 1;
  const curYearMonths = [];
  for (let m = 1; m <= curMo; m++) curYearMonths.push(m);

  const reconAccounts = useMemo(() =>
    accounts.filter(a => ["bank","credit_card"].includes(a.type) && a.is_active),
  [accounts]);

  const earliestByAccount = useMemo(() => {
    const map = {};
    for (const e of (ledger || [])) {
      const d = e.tx_date || "";
      if (!d) continue;
      [e.from_id, e.to_id].forEach(aid => {
        if (!aid) return;
        if (!map[aid] || d < map[aid]) map[aid] = d;
      });
    }
    return map;
  }, [ledger]);

  const getMonthsForAccount = useCallback((accountId) => {
    const earliest = earliestByAccount[accountId];
    let startY, startM;
    if (earliest) { startY = Number(earliest.slice(0, 4)); startM = Number(earliest.slice(5, 7)); }
    else { startY = curYear; startM = 1; }
    const pills = [];
    let y = startY, m = startM;
    while (y < curYear || (y === curYear && m <= curMo)) {
      pills.push({ year: y, month: m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return pills;
  }, [earliestByAccount, curYear, curMo]);

  const completedSet = useMemo(() => new Set(
    reconSessions.filter(s => s.status === "completed").map(s => `${s.account_id}-${s.period_year}-${s.period_month}`)
  ), [reconSessions]);
  const inProgressSet = useMemo(() => new Set(
    reconSessions.filter(s => s.status !== "completed").map(s => `${s.account_id}-${s.period_year}-${s.period_month}`)
  ), [reconSessions]);

  const totalPending = reconAccounts.reduce((c, a) => c + getMonthsForAccount(a.id).filter(p => !completedSet.has(`${a.id}-${p.year}-${p.month}`)).length, 0);
  const totalDone    = reconAccounts.reduce((c, a) => c + getMonthsForAccount(a.id).filter(p => completedSet.has(`${a.id}-${p.year}-${p.month}`)).length, 0);

  const filteredAccounts = useMemo(() => {
    let list = reconAccounts;
    if (typeFilter === "bank") list = list.filter(a => a.type === "bank");
    else if (typeFilter === "cc") list = list.filter(a => a.type === "credit_card");
    return list;
  }, [reconAccounts, typeFilter]);

  const pill = (active) => ({
    padding: "3px 10px", fontSize: 10, fontWeight: active ? 700 : 500,
    borderRadius: 20, border: active ? "none" : "0.5px solid #e5e7eb",
    cursor: "pointer", fontFamily: F, background: active ? "#111827" : "#fff",
    color: active ? "#fff" : "#6b7280", transition: "all .15s",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 960 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", fontFamily: F, margin: 0 }}>Reconcile</h2>
          <div style={{ fontSize: 12, color: "#6b7280", fontFamily: F, marginTop: 2 }}>Match your statements against transactions</div>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: F }}>
          <span style={{ color: "#059669", fontWeight: 700 }}>{totalDone}</span> completed
          {" · "}
          <span style={{ color: "#d97706", fontWeight: 700 }}>{totalPending}</span> pending
          {" · "}
          <span style={{ fontWeight: 600 }}>{reconAccounts.length}</span> accounts
        </div>
      </div>

      {/* ── Filters (single row) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {[
          { id: "all", label: "All" }, { id: "bank", label: "Bank" }, { id: "cc", label: "Credit Card" },
        ].map(f => (
          <button key={f.id} onClick={() => setTypeFilter(f.id)} style={pill(typeFilter === f.id)}>{f.label}</button>
        ))}
        <span style={{ width: 1, height: 16, background: "#e5e7eb", flexShrink: 0 }} />
        <button onClick={() => setMonthFilter(0)} style={pill(monthFilter === 0)}>All</button>
        {curYearMonths.map(m => (
          <button key={m} onClick={() => setMonthFilter(m)} style={pill(monthFilter === m)}>{MO_LABELS[m - 1]}</button>
        ))}
      </div>

      {/* ── Account list ── */}
      {filteredAccounts.length === 0 ? (
        <EmptyState icon="📋" message="No accounts match the selected filters." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredAccounts.map(a => {
            const isCC = a.type === "credit_card";
            const acctMonths = getMonthsForAccount(a.id);
            const pendingMonths = acctMonths.filter(p => !completedSet.has(`${a.id}-${p.year}-${p.month}`));
            const hasReady = pendingMonths.length > 0;
            const last4 = a.card_last4 || a.last4 || (a.account_no ? String(a.account_no).replace(/\D/g, "").slice(-4) : "");
            const favicon = bankFavicon(a.bank_name);

            return (
              <div key={a.id} style={{
                background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb",
                borderLeft: `3px solid ${isCC ? "#7c3aed" : "#3b5bdb"}`,
                padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
              }}>
                {/* Bank icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 10, background: "#f3f4f6",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, overflow: "hidden",
                }}>
                  {favicon ? (
                    <img src={favicon} alt="" style={{ width: 20, height: 20 }} onError={e => { e.target.style.display = "none"; }} />
                  ) : (
                    <span style={{ fontSize: 16 }}>{isCC ? "💳" : "🏦"}</span>
                  )}
                </div>

                {/* Name + details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: F }}>{a.name}</div>
                  <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: F, display: "flex", gap: 6, flexWrap: "wrap", marginTop: 1 }}>
                    {a.bank_name && a.bank_name !== a.name && <span>{a.bank_name}</span>}
                    {last4 && <span>···{last4}</span>}
                    <span style={{ color: isCC ? "#7c3aed" : "#3b5bdb" }}>{isCC ? "Credit Card" : "Bank"}</span>
                    {acctMonths.length > 0 && (
                      <span>
                        {MO_LABELS[acctMonths[0].month - 1]} {acctMonths[0].year !== curYear ? acctMonths[0].year : ""}
                        {" – "}
                        {MO_LABELS[acctMonths[acctMonths.length - 1].month - 1]} {acctMonths[acctMonths.length - 1].year}
                      </span>
                    )}
                    {completedSet.size > 0 && (() => {
                      const done = acctMonths.filter(p => completedSet.has(`${a.id}-${p.year}-${p.month}`)).length;
                      return done > 0 ? <span style={{ color: "#059669", fontWeight: 600 }}>{done} ✓</span> : null;
                    })()}
                    {pendingMonths.length > 0 && (
                      <span style={{ color: "#d97706", fontWeight: 600 }}>{pendingMonths.length} pending</span>
                    )}
                  </div>
                </div>

                {/* Reconcile button */}
                <button
                  onClick={() => setModal({ account: a })}
                  style={{
                    fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8,
                    cursor: "pointer", fontFamily: F, flexShrink: 0,
                    border: hasReady ? "none" : "0.5px solid #e5e7eb",
                    background: hasReady ? "#3b5bdb" : "transparent",
                    color: hasReady ? "#fff" : "#9ca3af",
                  }}>
                  Reconcile {hasReady ? "→" : ""}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Reconcile Modal */}
      {modal && (
        <ReconcileModal
          isOpen={!!modal}
          onClose={() => { setModal(null); onRefresh?.(); }}
          account={modal.account}
          user={user}
          accounts={accounts}
          categories={categories}
          ledger={ledger}
          setLedger={setLedger}
          onRefresh={onRefresh}
          bankAccounts={bankAccounts}
          creditCards={creditCards}
          assets={assets}
          liabilities={liabilities}
          receivables={receivables}
          incomeSrcs={incomeSrcs}
          fxRates={fxRates}
          allCurrencies={CURRENCIES}
          accountCurrencies={accountCurrencies}
          reconSessions={reconSessions}
          earliestTxDate={earliestByAccount[modal.account?.id]}
        />
      )}
    </div>
  );
}
