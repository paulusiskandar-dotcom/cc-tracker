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

// Pending (not-yet-billed-out) amount for a CC — same logic as Dashboard.
function computePendingDue(cc, ledger, today) {
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

// Due date (this calendar month) for a monthly obligation.
function dueDateInMonth(dayOfMonth, base) {
  const d = Number(dayOfMonth);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(d, last));
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

// ─── Component ────────────────────────────────────────────────────
export default function Billing({
  ledger = [], creditCards = [], liabilities = [],
  recurTemplates = [], installments = [],
}) {
  const [tab, setTab] = useState("cards");
  const today = new Date();
  const curMonth = ym(today.toISOString().slice(0, 10));

  const { cards, cicilan, rutinManual, subs } = useMemo(() => {
    const dayLeft = (dt) => Math.round(
      (new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime()
        - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000
    );

    // 💳 Credit Card — unpaid only (pending > 0)
    const cards = (creditCards || [])
      .filter(c => c.is_active !== false && c.due_day)
      .map(c => {
        const pending = computePendingDue(c, ledger, today);
        const when = dueDateInMonth(c.due_day, today);
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
  }, [ledger, creditCards, liabilities, recurTemplates, installments, curMonth]); // eslint-disable-line

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
            <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>💸 Total perlu disiapkan bulan ini</div>
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
