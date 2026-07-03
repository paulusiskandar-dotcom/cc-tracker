import { useMemo } from "react";
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
  const chargesAfter = ledger
    .filter(e => {
      if (!e.tx_date || e.tx_date <= lastStmtStr) return false;
      if (e.tx_type === "expense"       && e.to_id   === cc.id) return true;
      if (e.tx_type === "reimburse_out" && e.from_id === cc.id) return true;
      if (e.tx_type === "buy_asset"     && e.from_id === cc.id) return true;
      return false;
    })
    .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  return Math.max(0, outstanding - chargesAfter);
}

// Due date (this calendar month) for a monthly obligation.
function dueDateInMonth(dayOfMonth, base) {
  const d = Number(dayOfMonth);
  // clamp to month length
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return new Date(base.getFullYear(), base.getMonth(), Math.min(d, last));
}

const MONTHS_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

// ─── Component ────────────────────────────────────────────────────
export default function Billing({
  ledger = [], creditCards = [], liabilities = [], assets = [],
  recurTemplates = [], installments = [],
}) {
  const today = new Date();
  const curMonth = ym(today.toISOString().slice(0, 10));
  const todayDay = today.getDate();

  const { groups, totalKnown, hasUnpaid } = useMemo(() => {
    const dayLeft = (dt) => Math.round(
      (new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime()
        - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000
    );

    // 💳 Kartu Kredit
    const cards = (creditCards || [])
      .filter(c => c.is_active !== false && c.due_day)
      .map(c => {
        const pending = computePendingDue(c, ledger, today);
        const when = dueDateInMonth(c.due_day, today);
        return {
          id: c.id, name: c.name, when, dayLeft: dayLeft(when),
          amount: pending, paid: pending <= 0, known: true,
        };
      })
      .sort((a, b) => a.when - b.when);

    // 📆 Cicilan — liability (BYD dll) + installments table
    const cicilan = [];
    for (const l of (liabilities || [])) {
      if (l.is_active === false || !l.due_day || !Number(l.monthly_installment)) continue;
      const when = dueDateInMonth(l.due_day, today);
      cicilan.push({ id: l.id, name: `${l.name} (cicilan)`, when, dayLeft: dayLeft(when),
        amount: Number(l.monthly_installment), paid: false, known: true });
    }
    for (const it of (installments || [])) {
      if (it.is_active === false || it.status === "completed") continue;
      const day = it.due_day || it.day_of_month;
      if (!day || !Number(it.monthly_amount ?? it.amount)) continue;
      const when = dueDateInMonth(day, today);
      cicilan.push({ id: it.id, name: it.name || it.description || "Cicilan", when, dayLeft: dayLeft(when),
        amount: Number(it.monthly_amount ?? it.amount), paid: false, known: true });
    }
    cicilan.sort((a, b) => a.when - b.when);

    // 🧾 Rutin — recurring templates (non-income) with day_of_month
    const thisMonthExp = (ledger || []).filter(e => ym(e.tx_date) === curMonth && e.tx_type === "expense");
    const rutin = (recurTemplates || [])
      .filter(t => t.is_active !== false && t.day_of_month && t.tx_type !== "income")
      .map(t => {
        const when = dueDateInMonth(t.day_of_month, today);
        const amt = Number(t.amount || 0);
        // paid if an expense this month matches by template id or name
        const paid = thisMonthExp.some(e =>
          (t.id && (e.recurring_template_id === t.id)) ||
          (t.name && e.description && e.description.toLowerCase().includes(String(t.name).toLowerCase()))
        );
        return { id: t.id, name: t.name, when, dayLeft: dayLeft(when),
          amount: amt, paid, known: amt > 0 };
      })
      .sort((a, b) => a.when - b.when);

    // 🏦 Deposito jatuh tempo bulan ini
    const depo = (assets || [])
      .filter(a => (a.subtype || "").toLowerCase().includes("deposito") && a.maturity_date)
      .filter(a => ym(a.maturity_date) === curMonth)
      .map(a => {
        const md = new Date(a.maturity_date);
        return { id: a.id, name: `${a.name} (jatuh tempo)`, when: md, dayLeft: dayLeft(md),
          amount: Number(a.current_value ?? a.initial_balance ?? 0), paid: false, known: true, positive: true };
      })
      .sort((a, b) => a.when - b.when);

    const groups = [
      { key: "cc",    icon: "💳", title: "Kartu Kredit",        items: cards },
      { key: "cic",   icon: "📆", title: "Cicilan",             items: cicilan },
      { key: "rutin", icon: "🧾", title: "Tagihan Rutin",       items: rutin },
      { key: "depo",  icon: "🏦", title: "Deposito Jatuh Tempo", items: depo },
    ].filter(g => g.items.length);

    // total to prepare = unpaid + known + not a cash-inflow (depo excluded)
    let totalKnown = 0, hasUnpaid = false;
    for (const g of groups) for (const it of g.items) {
      if (it.paid || it.positive) continue;
      hasUnpaid = true;
      if (it.known) totalKnown += it.amount;
    }
    return { groups, totalKnown, hasUnpaid };
  }, [ledger, creditCards, liabilities, assets, recurTemplates, installments, curMonth]); // eslint-disable-line

  const monthLabel = `${MONTHS_ID[today.getMonth()]} ${today.getFullYear()}`;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "8px 0 40px", fontFamily: "Figtree, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 16px 12px" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: 0 }}>Tagihan</h1>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}>{monthLabel}</span>
      </div>

      {/* Summary */}
      <div style={{ margin: "0 16px 16px", background: hasUnpaid ? "#fff7ed" : "#ecfdf5",
        border: `1px solid ${hasUnpaid ? "#fed7aa" : "#a7f3d0"}`, borderRadius: 16, padding: "14px 16px" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", opacity: hasUnpaid ? 1 : 0 }}>
          💸 Total perlu disiapkan bulan ini
        </div>
        {hasUnpaid ? (
          <div style={{ fontSize: 24, fontWeight: 800, color: "#111827", marginTop: 2 }}>{fmtIDR(totalKnown)}</div>
        ) : (
          <div style={{ fontSize: 15, fontWeight: 700, color: "#065f46" }}>✅ Semua tagihan bulan ini sudah beres</div>
        )}
      </div>

      {groups.length === 0 && (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: "40px 0", fontSize: 14 }}>
          Tidak ada tagihan bulan ini 🎉
        </div>
      )}

      {groups.map(g => {
        const sub = g.items.filter(it => !it.paid && !it.positive && it.known)
          .reduce((s, it) => s + it.amount, 0);
        return (
          <div key={g.key} style={{ margin: "0 16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#374151" }}>{g.icon} {g.title}</div>
              {sub > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: "#6b7280" }}>{fmtIDR(sub, true)}</div>}
            </div>
            <div style={{ background: "#fff", border: "1px solid #f0f0f0", borderRadius: 14, overflow: "hidden" }}>
              {g.items.map((it, i) => <Row key={it.id || i} it={it} first={i === 0} todayDay={todayDay} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ it, first, todayDay }) {
  const dl = it.dayLeft;
  let chip, chipBg, chipColor;
  if (it.paid) { chip = "Lunas"; chipBg = "#dcfce7"; chipColor = "#166534"; }
  else if (dl < 0) { chip = `lewat ${Math.abs(dl)} hr`; chipBg = "#fee2e2"; chipColor = "#b91c1c"; }
  else if (dl === 0) { chip = "HARI INI"; chipBg = "#fee2e2"; chipColor = "#b91c1c"; }
  else if (dl === 1) { chip = "besok"; chipBg = "#ffedd5"; chipColor = "#c2410c"; }
  else { chip = `${dl} hari lagi`; chipBg = "#f3f4f6"; chipColor = "#4b5563"; }

  const d = it.when;
  const dateStr = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
      borderTop: first ? "none" : "1px solid #f3f4f6", opacity: it.paid ? 0.6 : 1 }}>
      <div style={{ minWidth: 44, textAlign: "center" }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: it.paid ? "#9ca3af" : "#111827", lineHeight: 1 }}>{d.getDate()}</div>
        <div style={{ fontSize: 9, fontWeight: 600, color: "#9ca3af", marginTop: 2 }}>{dateStr}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.name}</div>
        <span style={{ display: "inline-block", marginTop: 3, fontSize: 10, fontWeight: 700,
          background: chipBg, color: chipColor, padding: "2px 7px", borderRadius: 20 }}>{chip}</span>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: it.positive ? "#059669" : (it.paid ? "#9ca3af" : "#111827") }}>
          {it.known ? (it.positive ? "+" : "") + fmtIDR(it.amount, true) : "nilai belum pasti"}
        </div>
      </div>
    </div>
  );
}
