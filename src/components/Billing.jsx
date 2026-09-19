import { useMemo, useState } from "react";
import { fmtIDR, ym } from "../utils";

// ─── Helpers (self-contained; no schema/data changes) ─────────────
// Last statement date for a CC, given statement_day and "today".
function getLastStatementDate(statementDay, today) {
  if (!statementDay) return null;
  const day = Number(statementDay);
  const candidate = new Date(today.getFullYear(), today.getMonth(), day);
  if (candidate < today) return candidate;
  return new Date(today.getFullYear(), today.getMonth() - 1, day);
}

// Pending (amount actually due now) for a CC.
function computePendingDue(cc, ledger, today) {
  // STATEMENT-BASED (accurate): if we know the last statement's amount + date,
  // pending = statement bill − payments/credits to the card since that date.
  // Charges after the statement belong to the NEXT bill and are ignored here.
  if (cc.last_statement_amount != null && cc.last_statement_date) {
    const paidSince = (ledger || [])
      .filter(e => e.to_id === cc.id && e.to_type === "account" && e.tx_date && e.tx_date >= cc.last_statement_date)
      .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    return Math.max(0, Number(cc.last_statement_amount) - paidSince);
  }
  // FALLBACK (estimate): outstanding − charges booked after the cutoff.
  const outstanding = Number(cc.outstanding_amount || 0);
  if (outstanding <= 0) return 0;
  if (!cc.statement_day) return outstanding;
  const lastStmt = getLastStatementDate(cc.statement_day, today);
  if (!lastStmt) return outstanding;
  const lastStmtStr = lastStmt.toISOString().slice(0, 10);
  // charges AFTER cutoff belong to the NEXT statement (due next month), so they
  // must be excluded from the current bill. A charge on a card = the card is the
  // from-account (matches recalculateBalance): from_id===card && from_type==="account".
  const chargesAfter = ledger
    .filter(e => e.tx_date && e.tx_date > lastStmtStr
      && e.from_id === cc.id && e.from_type === "account")
    .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  return Math.max(0, outstanding - chargesAfter);
}

// Due date (this calendar month) for a simple monthly obligation (cicilan, bills).
function dueDateInMonth(dayOfMonth, base) {
  const d = Number(dayOfMonth);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(d, last));
}

// Due date of a CC's CURRENT (last-closed) statement. When due_day falls BEFORE
// the statement cut-off day, the payment is due the month AFTER the cut-off.
// e.g. stmt 18 / due 4 → statement closed on the 18th is due on the 4th NEXT month.
function ccDueDate(cc, today) {
  const dd = Number(cc.due_day);
  const sd = cc.statement_day ? Number(cc.statement_day) : null;
  if (!sd) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    let d = new Date(today.getFullYear(), today.getMonth(), dd);
    if (d < start) d = new Date(today.getFullYear(), today.getMonth() + 1, dd);
    return d;
  }
  const ls = getLastStatementDate(sd, today);          // most recent cut-off ≤ today
  const offset = dd < sd ? 1 : 0;                       // due before cut-off → next month
  return new Date(ls.getFullYear(), ls.getMonth() + offset, dd);
}

const MONTHS_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

const SUBTABS = [
  { key: "cards",         label: "Credit Card" },
  { key: "installments",  label: "Installments" },
  { key: "recurring",     label: "Recurring" },
  { key: "subscriptions", label: "Subscriptions" },
];

// Manual-pay recurring bills (utilities, property, tax, telco) vs auto-charged
// subscriptions on a card. Classified by name since there's no schema field.
const MANUAL_RE = /listrik|metro|apart|internet|wifi|indihome|\bpph\b|pajak|telkomsel|\bipl\b|pdam|bpjs|iuran|residence|riverside|circleone/i;

// What is still unpaid this month, in four groups. Shared with the phone Bills screen
// (src/components/mobile/MobileBills.jsx) so both always show the same bills.
// The phone screens pass `actionable: true`: only what Paulus himself has to go and pay
// (decided 18 Sep 2026). Under that rule —
//   · a card's bill comes from its newest statement, finalized or not (the bank's figure is
//     final the day it is issued), with the due date printed on that statement;
//   · instalments and auto-charged subscriptions on a credit card are NOT bills: they are
//     already inside that card's bill, so they live in the card's own detail;
//   · a bill counts as paid when any row this month is tied to its template, whatever the
//     type (an electricity bill fronted for SDC is a reimburse_out, not an expense).
// The desktop Bills page calls this without the flag and keeps its old behaviour.
export function buildBills({ ledger = [], creditCards = [], liabilities = [], recurTemplates = [], installments = [], reconSessions = [], actionable = false }, today = new Date()) {
  const curMonth = ym(today.toISOString().slice(0, 10));
  if (actionable) return buildToPay({ ledger, creditCards, liabilities, recurTemplates, reconSessions }, today, curMonth);

    const dayLeft = (dt) => Math.round(
      (new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime()
        - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000
    );

    // 💳 Credit Card — unpaid only (pending > 0)
    const cards = (creditCards || [])
      .filter(c => c.is_active !== false && c.due_day)
      .map(c => {
        const pending = computePendingDue(c, ledger, today);
        const when = ccDueDate(c, today);
        return { id: c.id, name: c.name, when, dayLeft: dayLeft(when), amount: pending, known: true };
      })
      .filter(c => c.amount >= 25000)                  // hide already-paid + ignore trivial (< Rp 25rb)
      .sort((a, b) => a.when - b.when);

    // 📆 Installments — liability cicilan (BYD) + installments table (ongoing)
    const cicilan = [];
    for (const l of (liabilities || [])) {
      if (l.is_active === false || !l.due_day || !Number(l.monthly_installment)) continue;
      const when = dueDateInMonth(l.due_day, today);
      cicilan.push({ id: "l" + l.id, name: `${l.name} (cicilan)`, when, dayLeft: dayLeft(when), amount: Number(l.monthly_installment), known: true });
    }
    for (const it of (installments || [])) {
      if (it.is_active === false || it.status === "completed") continue;
      const day = it.due_day || it.day_of_month;
      const amt = Number(it.monthly_amount ?? it.amount);
      if (!day || !amt) continue;
      const when = dueDateInMonth(day, today);
      cicilan.push({ id: "i" + it.id, name: it.name || it.description || "Cicilan", when, dayLeft: dayLeft(when), amount: amt, known: true });
    }
    cicilan.sort((a, b) => a.when - b.when);

    // 🧾 Recurring — templates (non-income) with day_of_month, unpaid only
    const thisMonthExp = (ledger || []).filter(e => ym(e.tx_date) === curMonth && e.tx_type === "expense");
    const rutin = (recurTemplates || [])
      .filter(t => t.is_active !== false && t.day_of_month && t.tx_type !== "income")
      .map(t => {
        const when = dueDateInMonth(t.day_of_month, today);
        const amt = Number(t.amount || 0);
        const paid = thisMonthExp.some(e =>
          (t.id && e.recurring_template_id === t.id) ||
          (t.name && e.description && e.description.toLowerCase().includes(String(t.name).toLowerCase()))
        );
        return { id: t.id, name: t.name, when, dayLeft: dayLeft(when), amount: amt, known: amt > 0, paid };
      })
      .filter(r => !r.paid)                            // hide already-paid
      .sort((a, b) => a.when - b.when);

    const rutinManual = rutin.filter(r => MANUAL_RE.test(r.name || ""));
    const subs        = rutin.filter(r => !MANUAL_RE.test(r.name || ""));

    return { cards, cicilan, rutinManual, subs };
}

function buildToPay({ ledger, creditCards, liabilities, recurTemplates, reconSessions }, today, curMonth) {
  const day0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dayLeft = dt => Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - day0) / 86400000);
  const asDate = s => new Date(`${String(s).slice(0, 10)}T00:00:00`);

  const cards = (creditCards || []).filter(c => c.is_active !== false).map(c => {
    // Newest statement for this card: a reconcile session (any status) or the last finalized one.
    const sess = (reconSessions || []).filter(r => r.account_id === c.id && r.statement_date && r.closing_balance != null)
      .sort((a, b) => String(b.statement_date).localeCompare(String(a.statement_date)))[0];
    const useSess = sess && (!c.last_statement_date || String(sess.statement_date).slice(0, 10) >= String(c.last_statement_date).slice(0, 10));
    const stmtDate = useSess ? String(sess.statement_date).slice(0, 10) : c.last_statement_date;
    const stmtAmt = useSess ? Number(sess.closing_balance) : (c.last_statement_amount != null ? Number(c.last_statement_amount) : null);
    if (!stmtDate || stmtAmt == null) return null;
    const paidSince = ledger.filter(e => e.to_id === c.id && e.to_type === "account" && e.tx_date && e.tx_date >= stmtDate).reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    const when = useSess && sess.due_date ? asDate(sess.due_date) : (c.due_day ? ccDueDate(c, today) : null);
    if (!when) return null;
    // The bank's own "minimum payment" decides whether there is anything to pay (20 Sep 2026):
    // 0 = nothing is due, however the balance reads; above 0 = it is a bill, even Rp 4.695.
    // The row still shows the FULL remaining bill and stays until that is paid off.
    // Statements parsed before this field existed fall back to "any balance is a bill".
    const minPay = useSess && sess.minimum_payment != null ? Number(sess.minimum_payment) : null;
    if (minPay === 0) return null;
    return { id: c.id, name: c.name, when, dayLeft: dayLeft(when), amount: Math.max(0, stmtAmt - paidSince), minimum: minPay, known: true };
  }).filter(c => c && c.amount > 0).sort((a, b) => a.when - b.when);

  const monthRows = ledger.filter(e => ym(e.tx_date) === curMonth);
  const isCard = id => (creditCards || []).some(c => c.id === id);
  const rutin = (recurTemplates || [])
    .filter(t => t.is_active !== false && t.day_of_month && t.tx_type !== "income")
    // auto-charged to a credit card → part of that card's bill, not something to go and pay
    .filter(t => MANUAL_RE.test(t.name || "") || !isCard(t.from_id))
    .map(t => {
      const when = dueDateInMonth(t.day_of_month, today); const amt = Number(t.amount || 0);
      const paid = monthRows.some(e => (t.id && e.recurring_template_id === t.id) || (t.name && e.description && e.description.toLowerCase().includes(String(t.name).toLowerCase())));
      return { id: t.id, name: t.name, when, dayLeft: dayLeft(when), amount: amt, known: amt > 0, paid };
    }).filter(r => !r.paid).sort((a, b) => a.when - b.when);

  const loans = (liabilities || []).filter(l => l.is_active !== false && l.due_day && Number(l.monthly_installment))
    .map(l => { const when = dueDateInMonth(l.due_day, today); return { id: "l" + l.id, name: l.name, when, dayLeft: dayLeft(when), amount: Number(l.monthly_installment), known: true, paid: monthRows.some(e => e.to_id === l.id) }; })
    .filter(l => !l.paid).sort((a, b) => a.when - b.when);

  return { cards, cicilan: loans, rutinManual: rutin, subs: [] };
}

// ─── Component ────────────────────────────────────────────────────
export default function Billing({
  ledger = [], creditCards = [], liabilities = [],
  recurTemplates = [], installments = [],
}) {
  const [tab, setTab] = useState("cards");
  const today = new Date();
  const curMonth = ym(today.toISOString().slice(0, 10));

  const { cards, cicilan, rutinManual, subs } = useMemo(() => buildBills({ ledger, creditCards, liabilities, recurTemplates, installments }, today),
    [ledger, creditCards, liabilities, recurTemplates, installments, curMonth]); // eslint-disable-line

  const byTab = { cards, installments: cicilan, recurring: rutinManual, subscriptions: subs };
  const items = byTab[tab] || [];
  const countOf = (k) => (byTab[k] || []).length;

  const totalAll = [...cards, ...cicilan, ...rutinManual, ...subs].filter(i => i.known).reduce((s, i) => s + i.amount, 0);
  const hasUnpaid = cards.length + cicilan.length + rutinManual.length + subs.length > 0;
  const tabTotal = items.filter(i => i.known).reduce((s, i) => s + i.amount, 0);

  const monthLabel = `${MONTHS_ID[today.getMonth()]} ${today.getFullYear()}`;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "8px 0 40px", fontFamily: "Figtree, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 16px 12px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: 0 }}>Bills</h1>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}>{monthLabel}</span>
      </div>

      {/* Summary */}
      <div style={{ margin: "0 16px 14px", background: hasUnpaid ? "#fff7ed" : "#ecfdf5",
        border: `1px solid ${hasUnpaid ? "#fed7aa" : "#a7f3d0"}`, borderRadius: 16, padding: "14px 16px" }}>
        {hasUnpaid ? (
          <>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>Total perlu disiapkan bulan ini</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 2 }}>{fmtIDR(totalAll)}</div>
          </>
        ) : (
          <div style={{ fontSize: 15, fontWeight: 700, color: "#065f46" }}>✅ Semua tagihan bulan ini sudah beres</div>
        )}
      </div>

      {/* Sub-tabs — same pill style as Transactions */}
      <div style={{ display: "flex", gap: 6, padding: "0 16px 14px", flexWrap: "wrap" }}>
        {SUBTABS.map(st => {
          const active = tab === st.key;
          const n = countOf(st.key);
          return (
            <button key={st.key} onClick={() => setTab(st.key)} style={{
              height: 30, padding: "0 12px", borderRadius: 20,
              border: `1.5px solid ${active ? "#111827" : "#e5e7eb"}`,
              background: active ? "#111827" : "#fff",
              color: active ? "#fff" : "#6b7280",
              fontSize: 12, fontWeight: active ? 700 : 500,
              cursor: "pointer", fontFamily: "Figtree, sans-serif",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              {st.label}
              {n > 0 && <span style={{
                background: active ? "rgba(255,255,255,0.22)" : "#f3f4f6",
                color: active ? "#fff" : "#6b7280",
                fontSize: 10, fontWeight: 700, padding: "0 6px",
                borderRadius: 99, lineHeight: "16px", minWidth: 16, textAlign: "center",
              }}>{n}</span>}
            </button>
          );
        })}
      </div>

      {/* Tab subtotal */}
      {tabTotal > 0 && (
        <div style={{ padding: "0 16px 8px", fontSize: 12, fontWeight: 700, color: "#6b7280", textAlign: "right" }}>
          Subtotal: {fmtIDR(tabTotal)}
        </div>
      )}

      {/* List */}
      {items.length === 0 ? (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: "44px 16px", fontSize: 14 }}>
          ✅ Nggak ada yang belum dibayar di sini
        </div>
      ) : (
        <div style={{ margin: "0 16px", background: "#fff", border: "1px solid #f0f0f0", borderRadius: 14, overflow: "hidden" }}>
          {items.map((it, i) => <Row key={it.id || i} it={it} first={i === 0} />)}
        </div>
      )}
    </div>
  );
}

function Row({ it, first }) {
  const dl = it.dayLeft;
  let chip, chipBg, chipColor;
  if (dl < 0) { chip = `lewat ${Math.abs(dl)} hr`; chipBg = "#fee2e2"; chipColor = "#b91c1c"; }
  else if (dl === 0) { chip = "HARI INI"; chipBg = "#fee2e2"; chipColor = "#b91c1c"; }
  else if (dl === 1) { chip = "besok"; chipBg = "#ffedd5"; chipColor = "#c2410c"; }
  else { chip = `${dl} hari lagi`; chipBg = "#f3f4f6"; chipColor = "#4b5563"; }

  const d = it.when;
  const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
      borderTop: first ? "none" : "1px solid #f3f4f6" }}>
      <div style={{ minWidth: 44, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#111827", lineHeight: 1 }}>{d.getDate()}</div>
        <div style={{ fontSize: 9, fontWeight: 600, color: "#9ca3af", marginTop: 2 }}>{dateStr}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
        <span style={{ display: "inline-block", marginTop: 3, fontSize: 10, fontWeight: 700,
          background: chipBg, color: chipColor, padding: "2px 7px", borderRadius: 20 }}>{chip}</span>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>
          {it.known ? fmtIDR(it.amount) : "nilai belum pasti"}
        </div>
      </div>
    </div>
  );
}
