import { useState, useMemo } from "react";
import { fmtIDR } from "../utils";
import { EmptyState } from "./shared/index";
import ReconcileModal from "./ReconcileModal";

const MO_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function Reconcile({
  user, accounts, ledger, setLedger, categories,
  reconSessions = [], onRefresh, dark,
}) {
  const [modal, setModal] = useState(null); // { account, year, month }

  const now = new Date();
  const curYear = now.getFullYear();
  const curMo   = now.getMonth() + 1;
  const months  = [];
  for (let m = 1; m <= curMo; m++) months.push(m);

  const reconAccounts = useMemo(() =>
    accounts.filter(a => ["bank","credit_card"].includes(a.type) && a.is_active),
  [accounts]);

  const completedSet = useMemo(() => new Set(
    reconSessions.filter(s => s.status === "completed")
      .map(s => `${s.account_id}-${s.period_year}-${s.period_month}`)
  ), [reconSessions]);

  const totalPending = reconAccounts.reduce((cnt, a) =>
    cnt + months.filter(m => !completedSet.has(`${a.id}-${curYear}-${m}`)).length, 0
  );
  const totalDone = reconAccounts.reduce((cnt, a) =>
    cnt + months.filter(m => completedSet.has(`${a.id}-${curYear}-${m}`)).length, 0
  );

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

      {/* Account list */}
      {reconAccounts.length === 0 ? (
        <EmptyState icon="📋" message="No bank or credit card accounts to reconcile." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {reconAccounts.map(a => {
            const isCC = a.type === "credit_card";
            const pendingMonths = months.filter(m => !completedSet.has(`${a.id}-${curYear}-${m}`));
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
                      {a.bank_name && a.bank_name !== a.name && (
                        <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>{a.bank_name}</div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const firstPending = pendingMonths[0] || curMo;
                      setModal({ account: a, year: curYear, month: firstPending });
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
                  {months.map(m => {
                    const done = completedSet.has(`${a.id}-${curYear}-${m}`);
                    const session = reconSessions.find(s =>
                      s.account_id === a.id && s.period_year === curYear && s.period_month === m && s.status === "completed"
                    );
                    return (
                      <button key={m}
                        onClick={() => setModal({ account: a, year: curYear, month: m })}
                        title={done && session ? `${session.total_match || 0} match, ${session.total_missing || 0} missing, ${session.total_extra || 0} extra` : "Not reconciled"}
                        style={{
                          fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6,
                          border: "none", cursor: "pointer", fontFamily: "Figtree, sans-serif",
                          background: done ? "#dcfce7" : "#f3f4f6",
                          color: done ? "#059669" : "#9ca3af",
                          transition: "all .15s",
                        }}>
                        {MO_LABELS[m - 1]}
                        {done && " ✓"}
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
        />
      )}
    </div>
  );
}
