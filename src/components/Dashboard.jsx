import { useMemo, useState } from "react";
import { ledgerApi, recurringApi } from "../api";
import { EXPENSE_CATEGORIES } from "../constants";
import { fmtIDR, ym, mlShort, daysUntilDate, getGreeting, todayStr, groupByDate } from "../utils";
import { showToast, Spinner, EmptyState } from "./shared/index";
import { GroupedTransactionList } from "./shared/TransactionRow";

export default function Dashboard({
  user, accounts, ledger, thisMonthLedger, categories,
  reminders, recurTemplates, netWorth, bankAccounts,
  creditCards, assets, receivables, liabilities,
  installments = [],
  curMonth, pendingSyncs, setTab,
  setLedger, setReminders, onRefresh,
  employeeLoans = [], loanPayments = [],
}) {
  const [confirmingId, setConfirmingId] = useState(null);

  // ─── DERIVED STATS ───────────────────────────────────────────
  const nw = netWorth || { total: 0, bank: 0, assets: 0, receivables: 0, ccDebt: 0, liabilities: 0 };

  const thisMonthIncome = useMemo(() =>
    thisMonthLedger
      .filter(e => e.tx_type === "income")
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [thisMonthLedger]);

  const thisMonthExpense = useMemo(() =>
    thisMonthLedger
      .filter(e => e.tx_type === "expense")
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [thisMonthLedger]);

  const surplus = thisMonthIncome - thisMonthExpense;

  const totalCCDebt = useMemo(() =>
    creditCards.reduce((s, c) => s + Number(c.current_balance || 0), 0),
  [creditCards]);

  const thisMonthCCSpend = useMemo(() =>
    thisMonthLedger
      .filter(e => e.tx_type === "expense" && creditCards.some(c => c.id === e.from_id))
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0),
  [thisMonthLedger, creditCards]);

  const totalAssets = useMemo(() =>
    assets.reduce((s, a) => s + Number(a.current_value || 0), 0),
  [assets]);

  const totalReceivables = useMemo(() =>
    receivables.reduce((s, r) => s + Number(r.receivable_outstanding || 0), 0),
  [receivables]);

  const totalEmpLoans = useMemo(() => netWorth?.employeeLoanTotal || 0, [netWorth]);

  // Last 6 months cash flow (for mini chart)
  const cashFlowData = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const m = d.toISOString().slice(0, 7);
      const income  = ledger.filter(e => ym(e.tx_date) === m && e.tx_type === "income")
        .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
      const expense = ledger.filter(e => ym(e.tx_date) === m && e.tx_type === "expense")
        .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
      months.push({ month: mlShort(m), income, expense, m });
    }
    return months;
  }, [ledger]);

  const maxCF = Math.max(...cashFlowData.flatMap(d => [d.income, d.expense]), 1);

  // Recent transactions, grouped by date (last 10)
  const recentGroups = useMemo(() => {
    const recent = ledger.slice(0, 10);
    return groupByDate(recent);
  }, [ledger]);

  // Next 5 pending reminders
  const upcomingReminders = useMemo(() =>
    [...reminders]
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 5),
  [reminders]);

  // Upcoming CC installments (active, next billing)
  const upcomingInstallments = useMemo(() => {
    const now = new Date();
    return installments
      .filter(inst => (inst.paid_months || 0) < (inst.months || 0))
      .map(inst => {
        const cc = creditCards.find(c => c.id === inst.account_id);
        return { ...inst, ccName: cc?.name || "CC" };
      })
      .slice(0, 3);
  }, [installments, creditCards]);

  // Last sync time
  const lastSyncMins = useMemo(() => {
    if (!pendingSyncs?.length) return null;
    const latest = pendingSyncs.reduce((max, s) =>
      new Date(s.received_at) > new Date(max.received_at) ? s : max
    );
    return Math.floor((Date.now() - new Date(latest.received_at)) / 60000);
  }, [pendingSyncs]);

  // Month-over-month net worth change
  const prevMonthLedger = useMemo(() => {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
    return ledger.filter(e => ym(e.tx_date) === prev);
  }, [ledger]);

  const monthlyChange = useMemo(() => {
    const inc  = thisMonthLedger.filter(e => e.tx_type === "income").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
    const exp  = thisMonthLedger.filter(e => e.tx_type === "expense").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
    return inc - exp;
  }, [thisMonthLedger]);

  // ─── REMINDER ACTIONS ────────────────────────────────────────
  const confirmReminder = async (r) => {
    if (confirmingId === r.id) return;
    setConfirmingId(r.id);
    const tmpl = r.recurring_templates || {};
    try {
      await recurringApi.confirmReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      showToast(`✓ Confirmed: ${tmpl.name || "Reminder"}`);
      await onRefresh?.();
    } catch (e) {
      showToast(e.message, "error");
    }
    setConfirmingId(null);
  };

  const skipReminder = async (r) => {
    const tmpl = r.recurring_templates || {};
    try {
      await recurringApi.skipReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      showToast(`Skipped: ${tmpl.name || "Reminder"}`);
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── GREETING ── */}
      <div style={{ fontSize: 15, fontWeight: 600, color: "#6b7280", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>
        {getGreeting()}, Paulus 👋
      </div>

      {/* ── GMAIL PENDING BANNER ── */}
      {pendingSyncs?.length > 0 && (
        <div style={{
          background:   "#fef9ec",
          border:       "1.5px solid #fde68a",
          borderRadius: 14,
          padding:      "14px 16px",
          display:      "flex",
          alignItems:   "center",
          justifyContent: "space-between",
          gap:          12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>📧</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#92400e", fontFamily: "Figtree, sans-serif" }}>
                {pendingSyncs.length} transaction{pendingSyncs.length > 1 ? "s" : ""} from Gmail need review
              </div>
              <div style={{ fontSize: 11, color: "#b45309", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                {lastSyncMins != null
                  ? `Last sync ${lastSyncMins < 1 ? "just now" : `${lastSyncMins} min ago`}`
                  : "Gmail sync found new transactions"}
              </div>
            </div>
          </div>
          <button
            onClick={() => setTab?.("transactions")}
            style={{
              background:   "#d97706",
              color:        "#fff",
              border:       "none",
              borderRadius: 8,
              padding:      "7px 14px",
              fontSize:     12,
              fontWeight:   700,
              cursor:       "pointer",
              fontFamily:   "Figtree, sans-serif",
              whiteSpace:   "nowrap",
              flexShrink:   0,
            }}
          >
            Review Now →
          </button>
        </div>
      )}

      {/* ── BENTO GRID ── */}
      <div className="bento-grid" style={GRID}>

        {/* [1] Net Worth — dark hero, spans 2 cols */}
        <div className="bento-span2" style={{ ...BENTO_DARK, gridColumn: "span 2" }}>
          <div style={DARK_LABEL}>Total Net Worth</div>
          <div style={DARK_VALUE}>{fmtIDR(nw.total)}</div>
          {monthlyChange !== 0 && (
            <div style={{
              fontSize:   12,
              fontWeight: 600,
              color:      monthlyChange >= 0 ? "#4ade80" : "#f87171",
              fontFamily: "Figtree, sans-serif",
              marginBottom: 14,
            }}>
              {monthlyChange >= 0 ? "↑" : "↓"} {fmtIDR(Math.abs(monthlyChange), true)} this month
            </div>
          )}
          <div style={DARK_STATS}>
            {[
              { label: "Bank",    value: fmtIDR(nw.bank, true),              color: "#a5f3fc" },
              { label: "Assets",  value: fmtIDR(nw.assets, true),            color: "#86efac" },
              { label: "Recv",    value: fmtIDR(nw.receivables, true),       color: "#fde68a" },
              { label: "Loans",   value: fmtIDR(nw.employeeLoanTotal, true), color: "#fde68a" },
              { label: "CC Debt", value: fmtIDR(nw.ccDebt, true),            color: "#fca5a5" },
            ].filter(s => {
              const n = Number(s.value.replace(/[^0-9]/g, ""));
              return n > 0;
            }).map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: s.color, fontFamily: "Figtree, sans-serif" }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* [2] CC This Month */}
        <BentoTile
          bg="#fde8e8" icon="💳" iconBg="rgba(220,38,38,0.12)"
          label="CC This Month"
          value={fmtIDR(thisMonthCCSpend)}
          sub={`Debt: ${fmtIDR(totalCCDebt, true)}`}
          badge={creditCards.length > 0 ? `${creditCards.length} cards` : null}
          badgeColor="#dc2626"
        />

        {/* [3] Bank Total */}
        <BentoTile
          bg="#e8f4fd" icon="🏦" iconBg="rgba(59,91,219,0.12)"
          label="Bank & Cash"
          value={fmtIDR(nw.bank)}
          sub={`${bankAccounts.length} account${bankAccounts.length !== 1 ? "s" : ""}`}
          badge={bankAccounts.length > 0 ? `${bankAccounts.length} accs` : null}
          badgeColor="#3b5bdb"
        />

        {/* [4] Assets */}
        <BentoTile
          bg="#e8fdf0" icon="📈" iconBg="rgba(5,150,105,0.12)"
          label="Assets"
          value={fmtIDR(totalAssets)}
          sub={`${assets.length} item${assets.length !== 1 ? "s" : ""}`}
          badge={assets.length > 0 ? `${assets.length} items` : null}
          badgeColor="#059669"
        />

        {/* [5] Receivables */}
        <BentoTile
          bg="#fdf6e8" icon="📋" iconBg="rgba(217,119,6,0.12)"
          label="Receivables"
          value={fmtIDR(totalReceivables + totalEmpLoans)}
          sub={`Reimburse: ${fmtIDR(totalReceivables, true)}${totalEmpLoans > 0 ? ` · Loans: ${fmtIDR(totalEmpLoans, true)}` : ""}`}
          badge={totalReceivables + totalEmpLoans > 0 ? "View →" : null}
          badgeColor="#d97706"
          onClick={() => setTab?.("receivables")}
        />

        {/* [6] Cash Flow — spans 2 cols */}
        <div className="bento-span2" style={{ ...BENTO_WHITE, gridColumn: "span 2" }}>
          <div style={CARD_ROW}>
            <div style={CARD_TITLE}>Cash Flow</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <LegendDot color="#059669" label="Income" />
              <LegendDot color="#dc2626" label="Expense" />
            </div>
          </div>

          {/* Numbers */}
          <div style={{ display: "flex", gap: 20, marginBottom: 14 }}>
            <div>
              <div style={STAT_LABEL}>Income</div>
              <div style={{ ...STAT_VAL, color: "#059669" }}>{fmtIDR(thisMonthIncome, true)}</div>
            </div>
            <div>
              <div style={STAT_LABEL}>Expense</div>
              <div style={{ ...STAT_VAL, color: "#dc2626" }}>{fmtIDR(thisMonthExpense, true)}</div>
            </div>
            <div>
              <div style={STAT_LABEL}>Surplus</div>
              <div style={{ ...STAT_VAL, color: surplus >= 0 ? "#059669" : "#dc2626" }}>
                {surplus >= 0 ? "+" : ""}{fmtIDR(surplus, true)}
              </div>
            </div>
          </div>

          {/* Bar chart */}
          <MiniBarChart data={cashFlowData} max={maxCF} />
        </div>

        {/* [7] Upcoming Reminders */}
        <div style={BENTO_WHITE}>
          <div style={{ ...CARD_ROW, marginBottom: 8 }}>
            <div style={CARD_TITLE}>Upcoming</div>
            {(upcomingReminders.length > 0 || upcomingInstallments.length > 0) && (
              <button onClick={() => setTab?.("upcoming")} style={LINK_BTN}>See all →</button>
            )}
          </div>
          {upcomingReminders.length === 0 && upcomingInstallments.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 8 }}>
              No upcoming items
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {upcomingReminders.map(r => {
                const tmpl      = r.recurring_templates || {};
                const daysLeft  = Math.ceil(daysUntilDate(r.due_date));
                const isOverdue = daysLeft <= 0;
                const isUrgent  = daysLeft <= 3;
                const dotColor  = isOverdue ? "#dc2626" : isUrgent ? "#d97706" : "#059669";
                return (
                  <div key={r.id} style={{
                    display:   "flex",
                    alignItems: "flex-start",
                    gap:       8,
                    padding:   "8px 10px",
                    background: isOverdue ? "#fff1f2" : isUrgent ? "#fffbeb" : "#f9fafb",
                    borderRadius: 10,
                    border:    `1px solid ${isOverdue ? "#fecaca" : isUrgent ? "#fde68a" : "#f3f4f6"}`,
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: dotColor, flexShrink: 0, marginTop: 4,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600, color: "#111827",
                        fontFamily: "Figtree, sans-serif",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {tmpl.name || "Reminder"}
                      </div>
                      <div style={{ fontSize: 10, color: dotColor, fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
                        {isOverdue ? "Overdue!" : daysLeft === 0 ? "Today" : daysLeft === 1 ? "Tomorrow" : `${daysLeft}d`}
                        {" · "}{fmtIDR(Number(tmpl.amount || 0), true)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => confirmReminder(r)}
                        disabled={confirmingId === r.id}
                        style={REMIND_BTN_PRIMARY}
                      >
                        {confirmingId === r.id ? "…" : "✓"}
                      </button>
                      <button onClick={() => skipReminder(r)} style={REMIND_BTN_GHOST}>
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* CC Installments — info only */}
              {upcomingInstallments.map(inst => (
                <div key={inst.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "8px 10px", background: "#f9fafb",
                  borderRadius: 10, border: "1px solid #f3f4f6",
                }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: "#9ca3af", flexShrink: 0, marginTop: 4,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: "#6b7280",
                      fontFamily: "Figtree, sans-serif",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>
                      📅 {inst.description}
                    </div>
                    <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
                      {inst.ccName} · {inst.paid_months}/{inst.months} paid · {fmtIDR(inst.monthly_amount, true)}/mo
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── RECENT TRANSACTIONS ── */}
      <div style={{ ...BENTO_WHITE, marginTop: 4 }}>
        <div style={CARD_ROW}>
          <div style={CARD_TITLE}>Recent Transactions</div>
          <button
            onClick={() => setTab?.("transactions")}
            style={LINK_BTN}
          >
            View all →
          </button>
        </div>

        {recentGroups.length === 0 ? (
          <EmptyState icon="📋" message="No transactions yet" />
        ) : (
          <GroupedTransactionList
            groups={recentGroups}
            accounts={accounts}
            compact
          />
        )}
      </div>

    </div>
  );
}

// ─── BENTO TILE ───────────────────────────────────────────────
function BentoTile({ bg, icon, iconBg, label, value, sub, badge, badgeColor, onClick }) {
  return (
    <div onClick={onClick} style={{ ...BENTO_BASE, background: bg, cursor: onClick ? "pointer" : "default" }}>
      {/* Badge */}
      {badge && (
        <div style={{
          position:     "absolute", top: 12, right: 12,
          fontSize:     9, fontWeight: 700,
          fontFamily:   "Figtree, sans-serif",
          background:   badgeColor + "20",
          color:        badgeColor,
          padding:      "2px 6px",
          borderRadius: 20,
        }}>
          {badge}
        </div>
      )}
      {/* Icon */}
      <div style={{
        width: 34, height: 34, borderRadius: 10,
        background: iconBg || "rgba(0,0,0,0.07)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, marginBottom: 10,
      }}>
        {icon}
      </div>
      {/* Label */}
      <div style={{
        fontSize: 10, fontWeight: 700, color: "#9ca3af",
        textTransform: "uppercase", letterSpacing: "0.5px",
        fontFamily: "Figtree, sans-serif", marginBottom: 4,
      }}>
        {label}
      </div>
      {/* Value */}
      <div style={{
        fontSize: 16, fontWeight: 800, color: "#111827",
        fontFamily: "Figtree, sans-serif", lineHeight: 1.2,
        marginBottom: sub ? 4 : 0,
      }}>
        {value}
      </div>
      {/* Sub */}
      {sub && (
        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── MINI BAR CHART ──────────────────────────────────────────
function MiniBarChart({ data, max }) {
  const BAR_H = 72;
  const BAR_W = 10;
  const GAP   = 4;
  const GROUP = BAR_W * 2 + GAP + 8; // pair width + group gap

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: BAR_H + 20 }}>
      {data.map((d, i) => {
        const incH = max > 0 ? Math.round((d.income  / max) * BAR_H) : 0;
        const expH = max > 0 ? Math.round((d.expense / max) * BAR_H) : 0;
        const isCurrent = i === data.length - 1;
        return (
          <div key={d.m} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
            {/* Bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: BAR_H }}>
              <div style={{
                width:        BAR_W,
                height:       Math.max(incH, 2),
                borderRadius: "3px 3px 0 0",
                background:   isCurrent ? "#059669" : "#bbf7d0",
                transition:   "height 0.3s",
                flexShrink:   0,
              }} />
              <div style={{
                width:        BAR_W,
                height:       Math.max(expH, 2),
                borderRadius: "3px 3px 0 0",
                background:   isCurrent ? "#dc2626" : "#fecaca",
                transition:   "height 0.3s",
                flexShrink:   0,
              }} />
            </div>
            {/* Month label */}
            <div style={{
              fontSize:   9,
              fontWeight: isCurrent ? 700 : 500,
              color:      isCurrent ? "#111827" : "#9ca3af",
              fontFamily: "Figtree, sans-serif",
              marginTop:  4,
              whiteSpace: "nowrap",
            }}>
              {d.month}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── LEGEND DOT ───────────────────────────────────────────────
function LegendDot({ color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>{label}</span>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────
const GRID = {
  display:             "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap:                 10,
};

const BENTO_BASE = {
  borderRadius: 16,
  padding:      "16px 16px 14px",
  position:     "relative",
  overflow:     "hidden",
};

const BENTO_WHITE = {
  ...BENTO_BASE,
  background: "#ffffff",
};

const BENTO_DARK = {
  ...BENTO_BASE,
  background: "linear-gradient(135deg, #1e3a5f 0%, #4338ca 100%)",
};

const DARK_LABEL = {
  fontSize:      10,
  fontWeight:    600,
  color:         "rgba(255,255,255,0.45)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  fontFamily:    "Figtree, sans-serif",
  marginBottom:  6,
};

const DARK_VALUE = {
  fontSize:     28,
  fontWeight:   900,
  color:        "#ffffff",
  fontFamily:   "Figtree, sans-serif",
  lineHeight:   1.1,
  marginBottom: 6,
};

const DARK_STATS = {
  display:             "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap:                 8,
  paddingTop:          12,
  borderTop:           "1px solid rgba(255,255,255,0.08)",
};

const CARD_TITLE = {
  fontSize:   13,
  fontWeight: 700,
  color:      "#111827",
  fontFamily: "Figtree, sans-serif",
};

const CARD_ROW = {
  display:        "flex",
  justifyContent: "space-between",
  alignItems:     "center",
  marginBottom:   12,
};

const STAT_LABEL = {
  fontSize:      9,
  fontWeight:    700,
  color:         "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  fontFamily:    "Figtree, sans-serif",
  marginBottom:  2,
};

const STAT_VAL = {
  fontSize:   13,
  fontWeight: 800,
  fontFamily: "Figtree, sans-serif",
};

const LINK_BTN = {
  background:  "none",
  border:      "none",
  color:       "#3b5bdb",
  fontSize:    12,
  fontWeight:  700,
  cursor:      "pointer",
  fontFamily:  "Figtree, sans-serif",
  padding:     0,
};

const REMIND_BTN_PRIMARY = {
  width:        26,
  height:       26,
  borderRadius: 7,
  border:       "none",
  background:   "#dcfce7",
  color:        "#059669",
  fontSize:     12,
  fontWeight:   700,
  cursor:       "pointer",
  fontFamily:   "Figtree, sans-serif",
  display:      "flex",
  alignItems:   "center",
  justifyContent: "center",
  flexShrink:   0,
};

const REMIND_BTN_GHOST = {
  width:        26,
  height:       26,
  borderRadius: 7,
  border:       "1px solid #e5e7eb",
  background:   "#f9fafb",
  color:        "#9ca3af",
  fontSize:     11,
  cursor:       "pointer",
  fontFamily:   "Figtree, sans-serif",
  display:      "flex",
  alignItems:   "center",
  justifyContent: "center",
  flexShrink:   0,
};
