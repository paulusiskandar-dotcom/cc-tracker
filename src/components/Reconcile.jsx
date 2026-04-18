import { useState, useMemo, useCallback } from "react";
import { fmtIDR } from "../utils";
import { EmptyState } from "./shared/index";
import ReconcileModal from "./ReconcileModal";

const MO_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function Reconcile({
  user, accounts, ledger, setLedger, categories,
  reconSessions = [], onRefresh, dark,
  // Forwarded to ReconcileModal for its Add/Edit Transaction flows.
  bankAccounts, creditCards, assets, liabilities, receivables,
  incomeSrcs, fxRates, CURRENCIES, accountCurrencies,
}) {
  const [modal, setModal] = useState(null); // { account, year, month }
  const [typeFilter,  setTypeFilter]  = useState("all"); // all | bank | cc
  const [monthFilter, setMonthFilter] = useState(0);     // 0 = all, 1-12 = specific month

  const now = new Date();
  const curYear = now.getFullYear();
  const curMo   = now.getMonth() + 1;

  // Current year months for the filter bar
  const curYearMonths = [];
  for (let m = 1; m <= curMo; m++) curYearMonths.push(m);

  const reconAccounts = useMemo(() =>
    accounts.filter(a => ["bank","credit_card"].includes(a.type) && a.is_active),
  [accounts]);

  // Compute earliest tx month per account from ledger
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

  // Generate month pills for a given account: from earliest tx month to current month
  const getMonthsForAccount = useCallback((accountId) => {
    const earliest = earliestByAccount[accountId];
    let startY, startM;
    if (earliest) {
      startY = Number(earliest.slice(0, 4));
      startM = Number(earliest.slice(5, 7));
    } else {
      startY = curYear;
      startM = 1;
    }
    const pills = [];
    let y = startY, m = startM;
    while (y < curYear || (y === curYear && m <= curMo)) {
      pills.push({ year: y, month: m });
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return pills;
  }, [earliestByAccount, curYear, curMo]);

  const completedSet = useMemo(() => new Set(
    reconSessions.filter(s => s.status === "completed")
      .map(s => `${s.account_id}-${s.period_year}-${s.period_month}`)
  ), [reconSessions]);

  // Sessions that exist but not completed (in_progress or have PDF processed)
  const inProgressSet = useMemo(() => new Set(
    reconSessions.filter(s => s.status !== "completed")
      .map(s => `${s.account_id}-${s.period_year}-${s.period_month}`)
  ), [reconSessions]);

  const totalPending = reconAccounts.reduce((cnt, a) =>
    cnt + getMonthsForAccount(a.id).filter(p => !completedSet.has(`${a.id}-${p.year}-${p.month}`)).length, 0
  );
  const totalDone = reconAccounts.reduce((cnt, a) =>
    cnt + getMonthsForAccount(a.id).filter(p => completedSet.has(`${a.id}-${p.year}-${p.month}`)).length, 0
  );

  const filteredAccounts = useMemo(() => {
    let list = reconAccounts;
    if (typeFilter === "bank") list = list.filter(a => a.type === "bank" || a.type === "cash");
    else if (typeFilter === "cc") list = list.filter(a => a.type === "credit_card");
    if (monthFilter > 0) {
      list = list.filter(a => {
        const hasPending = !completedSet.has(`${a.id}-${curYear}-${monthFilter}`);
        const hasCompleted = completedSet.has(`${a.id}-${curYear}-${monthFilter}`);
        return hasPending || hasCompleted; // show all accounts for the month (they all have that month)
      });
    }
    return list;
  }, [reconAccounts, typeFilter, monthFilter, completedSet, curYear]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif", margin: 0 }}>
            Reconcile
          </h2>
          <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
            Match your bank statements against ledger entries
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {[
          { label: "To Reconcile", value: String(totalPending), color: "#d97706", bg: "#fef3c7" },
          { label: "Completed",    value: String(totalDone),    color: "#059669", bg: "#dcfce7" },
          { label: "Accounts",     value: String(reconAccounts.length), color: "#3b5bdb", bg: "#dbeafe" },
        ].map(s => (
          <div key={s.label} style={{ background: "#fff", borderRadius: 12, border: "0.5px solid #e5e7eb", padding: "12px 14px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", fontFamily: "Figtree, sans-serif", marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color, fontFamily: "Figtree, sans-serif" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      {(() => {
        const PILL = (active) => ({
          padding: "5px 14px", fontSize: 11, fontWeight: active ? 700 : 500,
          borderRadius: 20, border: active ? "none" : "1px solid #e5e7eb",
          cursor: "pointer", fontFamily: "Figtree, sans-serif",
          background: active ? "#111827" : "#fff",
          color: active ? "#fff" : "#6b7280",
          transition: "all .15s",
        });
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Type filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", fontFamily: "Figtree, sans-serif", marginRight: 4 }}>Type</span>
              {[
                { id: "all",  label: "All" },
                { id: "bank", label: "Bank" },
                { id: "cc",   label: "Credit Card" },
              ].map(f => (
                <button key={f.id} onClick={() => setTypeFilter(f.id)} style={PILL(typeFilter === f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            {/* Month filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", fontFamily: "Figtree, sans-serif", marginRight: 4 }}>Month</span>
              <button onClick={() => setMonthFilter(0)} style={PILL(monthFilter === 0)}>All</button>
              {curYearMonths.map(m => (
                <button key={m} onClick={() => setMonthFilter(m)} style={PILL(monthFilter === m)}>
                  {MO_LABELS[m - 1]}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Account list */}
      {filteredAccounts.length === 0 ? (
        <EmptyState icon="📋" message="No accounts match the selected filters." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredAccounts.map(a => {
            const isCC = a.type === "credit_card";
            const acctMonths = getMonthsForAccount(a.id);
            const pendingMonths = acctMonths.filter(p => !completedSet.has(`${a.id}-${p.year}-${p.month}`));
            const hasReady = pendingMonths.length > 0;
            return (
              <div key={a.id} style={{
                background: "#fff", borderRadius: 14, border: "0.5px solid #e5e7eb",
                padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
              }}>
                {/* Account header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16 }}>{isCC ? "💳" : "🏦"}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                        {a.name}
                      </div>
                      {(() => {
                        const last4 = a.card_last4 || (a.account_no ? String(a.account_no).replace(/\D/g, "").slice(-4) : "");
                        const parts = [];
                        if (a.bank_name && a.bank_name !== a.name) parts.push(a.bank_name);
                        if (last4) parts.push(`···${last4}`);
                        if (parts.length === 0) return null;
                        return (
                          <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                            {parts.join(" · ")}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const fp = pendingMonths[0] || { year: curYear, month: curMo };
                      setModal({ account: a, year: fp.year, month: fp.month });
                    }}
                    style={{
                      fontSize: 11, fontWeight: 700, padding: "5px 14px", borderRadius: 8,
                      border: "none", cursor: "pointer", fontFamily: "Figtree, sans-serif",
                      background: hasReady ? "#3b5bdb" : "#f3f4f6",
                      color: hasReady ? "#fff" : "#9ca3af",
                    }}>
                    {hasReady ? "Reconcile ↗" : "Reconcile"}
                  </button>
                </div>

                {/* Month pills */}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {acctMonths.map(p => {
                    const key = `${a.id}-${p.year}-${p.month}`;
                    const done = completedSet.has(key);
                    const inProg = inProgressSet.has(key);
                    const isHighlighted = monthFilter === p.month && p.year === curYear;
                    const session = reconSessions.find(s =>
                      s.account_id === a.id && s.period_year === p.year && s.period_month === p.month
                    );
                    let tooltip = done ? `${session?.total_match || 0} match, ${session?.total_missing || 0} missing, ${session?.total_extra || 0} extra` : inProg ? "In progress — click to continue" : "Not reconciled";
                    if (isCC && a.statement_day) {
                      const stDay = Number(a.statement_day);
                      const endD = new Date(p.year, p.month - 1, stDay);
                      const startD = new Date(endD); startD.setMonth(startD.getMonth() - 1); startD.setDate(startD.getDate() + 1);
                      const fmt = d => d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
                      tooltip = `${fmt(startD)} – ${fmt(endD)} · ${tooltip}`;
                    }
                    const pillBg = done ? "#dcfce7" : inProg ? "#fef3c7" : isHighlighted ? "#dbeafe" : "#f3f4f6";
                    const pillColor = done ? "#059669" : inProg ? "#d97706" : isHighlighted ? "#3b5bdb" : "#9ca3af";
                    const shortYear = p.year !== curYear ? ` '${String(p.year).slice(2)}` : "";
                    return (
                      <button key={`${p.year}-${p.month}`}
                        onClick={() => setModal({ account: a, year: p.year, month: p.month })}
                        title={tooltip}
                        style={{
                          fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                          border: isHighlighted ? "1.5px solid #3b5bdb" : "none",
                          cursor: "pointer", fontFamily: "Figtree, sans-serif",
                          background: pillBg,
                          color: pillColor,
                          transition: "all .15s",
                        }}>
                        {MO_LABELS[p.month - 1]}{shortYear}
                        {done ? " ✓" : inProg ? " ●" : ""}
                      </button>
                    );
                  })}
                </div>
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
          year={modal.year}
          month={modal.month}
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
        />
      )}
    </div>
  );
}
