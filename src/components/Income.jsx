import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { ledgerApi, incomeSrcApi } from "../api";
import { fmtIDR, todayStr, ym, mlShort } from "../utils";
import { LIGHT, DARK } from "../theme";
import { showToast } from "./shared/Card";

const FF = "Figtree, sans-serif";

// ── Helpers ───────────────────────────────────────────────────────
const sn = (v) => { const n = Number(v); return (!v && v !== 0) || isNaN(n) ? 0 : n; };

function fmtDaysAgo(txDate) {
  const days = Math.floor((Date.now() - new Date(txDate + "T00:00:00")) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const RECURRENCE_LABELS = {
  monthly: "Monthly", quarterly: "Quarterly",
  yearly: "Yearly", ad_hoc: "Ad-hoc",
};

// ── SourceCard ────────────────────────────────────────────────────
function SourceCard({ src, onEdit, onAddIncome }) {
  const max = Math.max(...src.sparkline, 1);
  const barColor = src.color || "#059669";

  return (
    <div style={{
      background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16,
      padding: 16, position: "relative", overflow: "hidden",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: barColor,
      }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{src.icon || "💰"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: FF }}>{src.name}</div>
          {src.recurrence !== "ad_hoc" && (
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: FF, textTransform: "uppercase", letterSpacing: "0.5px", marginTop: 2 }}>
              {RECURRENCE_LABELS[src.recurrence]}{src.expected_day ? ` · day ${src.expected_day}` : ""}
            </div>
          )}
        </div>
        <button
          onClick={onEdit}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#9ca3af", fontSize: 13 }}
          title="Edit source"
        >✎</button>
      </div>

      {/* This month */}
      <div>
        <div style={{
          fontSize: 22, fontWeight: 800, fontFamily: FF,
          color: src.thisMonthAmount > 0 ? "#059669" : "#d1d5db",
        }}>
          {fmtIDR(src.thisMonthAmount)}
        </div>
        <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: FF, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          This month
        </div>
      </div>

      {/* Progress bar (only if target set) */}
      {src.monthly_target > 0 && (
        <div>
          <div style={{ height: 6, background: "#f3f4f6", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${src.progressPct}%`,
              background: src.progressPct >= 100 ? "#059669" : barColor,
              borderRadius: 3, transition: "width 0.3s",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "#6b7280", fontFamily: FF }}>
            <span>{src.progressPct}%</span>
            <span>Target {fmtIDR(src.monthly_target, true)}</span>
          </div>
        </div>
      )}

      {/* Sparkline */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 30 }}>
        {src.sparkline.map((val, i) => (
          <div key={i} style={{
            flex: 1, borderRadius: 2,
            height: val > 0 ? `${Math.max(10, (val / max) * 100)}%` : 3,
            background: i === 5 ? barColor : "#e5e7eb",
            opacity: i === 5 ? 1 : 0.6,
            minHeight: 2,
          }} />
        ))}
      </div>
      <div style={{ fontSize: 9, color: "#c4c4c4", fontFamily: FF, textAlign: "right", marginTop: -6 }}>6 mo</div>

      {/* Last received + quick add */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF }}>
          {src.lastReceived
            ? `Last: ${fmtDaysAgo(src.lastReceived)}`
            : "Never received"}
        </div>
        <button
          onClick={onAddIncome}
          style={{
            fontSize: 11, fontWeight: 600, fontFamily: FF,
            padding: "3px 10px", borderRadius: 6,
            border: `1px solid ${barColor}`,
            background: "none", color: barColor, cursor: "pointer",
          }}
        >+ Log</button>
      </div>
    </div>
  );
}

// ── SourceEditModal ───────────────────────────────────────────────
function SourceEditModal({ source, onSave, onClose, saving }) {
  const [name,          setName]          = useState(source.name || "");
  const [icon,          setIcon]          = useState(source.icon || "💰");
  const [color,         setColor]         = useState(source.color || "#059669");
  const [monthlyTarget, setMonthlyTarget] = useState(
    String(source.monthly_target || source.expected_amount || 0)
  );
  const [recurrence,    setRecurrence]    = useState(source.recurrence || "ad_hoc");
  const [expectedDay,   setExpectedDay]   = useState(source.expected_day || "");
  const [currency,      setCurrency]      = useState(source.currency || "IDR");

  const handleSave = () => {
    if (!name.trim()) return showToast("Name required", "error");
    onSave({
      name: name.trim(), icon, color,
      monthly_target: sn(monthlyTarget),
      recurrence,
      expected_day: recurrence !== "ad_hoc" ? (Number(expectedDay) || null) : null,
      currency,
    });
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 16, padding: 24,
        width: "min(420px, 92vw)", maxHeight: "90vh", overflowY: "auto",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#111827", fontFamily: FF }}>
          {source.id ? "Edit Income Source" : "New Income Source"}
        </div>

        {/* Name */}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Name</span>
          <input value={name} onChange={e => setName(e.target.value)}
            style={{ padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontFamily: FF }} />
        </label>

        {/* Icon + Color row */}
        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Icon</span>
            <input value={icon} onChange={e => setIcon(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 22, width: "100%", fontFamily: FF }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Color</span>
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              style={{ padding: 4, border: "1px solid #e5e7eb", borderRadius: 8, height: 40, width: "100%", cursor: "pointer" }} />
          </label>
        </div>

        {/* Monthly target */}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Monthly Target (Rp, 0 = no target)</span>
          <input type="number" min="0" value={monthlyTarget} onChange={e => setMonthlyTarget(e.target.value)}
            style={{ padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontFamily: FF }} />
        </label>

        {/* Recurrence */}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Recurrence</span>
          <select value={recurrence} onChange={e => setRecurrence(e.target.value)}
            style={{ padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontFamily: FF }}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
            <option value="ad_hoc">Ad-hoc / Variable</option>
          </select>
        </label>

        {/* Expected day — only for non ad-hoc */}
        {recurrence !== "ad_hoc" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Expected Day of {recurrence === "monthly" ? "Month" : "Period"} (1–31)</span>
            <input type="number" min="1" max="31" value={expectedDay} onChange={e => setExpectedDay(e.target.value)}
              style={{ padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontFamily: FF }}
              placeholder="e.g. 28" />
          </label>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button onClick={onClose} style={{
            padding: "10px 18px", border: "1px solid #e5e7eb", borderRadius: 8,
            background: "#fff", fontSize: 14, cursor: "pointer", fontFamily: FF,
          }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: "10px 18px", border: "none", borderRadius: 8,
            background: "#111827", color: "#fff", fontSize: 14, fontWeight: 700,
            cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: FF,
          }}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

// ── AddIncomeModal (keep existing logic) ──────────────────────────
function AddIncomeModal({ incomeSrcs, bankAccounts, onSave, onClose, saving }) {
  const [form, setForm] = useState({
    tx_date: todayStr(), description: "", amount: "", currency: "IDR",
    to_account_id: bankAccounts[0]?.id || "",
    income_source_id: incomeSrcs.find(s => s.is_active !== false)?.id || incomeSrcs[0]?.id || "",
    notes: "",
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.income_source_id) return showToast("Select income source", "error");
    if (!form.amount)           return showToast("Enter amount", "error");
    if (!form.to_account_id)    return showToast("Select account", "error");
    const src = incomeSrcs.find(s => s.id === form.income_source_id);
    onSave({
      tx_date: form.tx_date,
      description: form.description || (src?.name || "Income"),
      amount: sn(form.amount), currency: form.currency || "IDR",
      amount_idr: sn(form.amount),
      tx_type: "income", from_type: "income_source", to_type: "account",
      from_id: form.income_source_id, to_id: form.to_account_id,
      entity: "Personal", notes: form.notes || "",
    });
  };

  const INP = { padding: "9px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 14, fontFamily: FF, width: "100%" };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, width: "min(400px, 92vw)", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#111827", fontFamily: FF }}>Log Income</div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Source</span>
          <select value={form.income_source_id} onChange={e => set("income_source_id", e.target.value)} style={INP}>
            {incomeSrcs.map(s => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}
          </select>
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Date</span>
            <input type="date" value={form.tx_date} onChange={e => set("tx_date", e.target.value)} style={INP} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Amount (Rp)</span>
            <input type="number" min="0" value={form.amount} onChange={e => set("amount", e.target.value)} style={INP} placeholder="0" />
          </label>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>To Account</span>
          <select value={form.to_account_id} onChange={e => set("to_account_id", e.target.value)} style={INP}>
            <option value="">— select —</option>
            {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>Description (optional)</span>
          <input value={form.description} onChange={e => set("description", e.target.value)} style={INP} placeholder="e.g. April salary" />
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button onClick={onClose} style={{ padding: "10px 18px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", fontSize: 14, cursor: "pointer", fontFamily: FF }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: "10px 18px", border: "none", borderRadius: 8, background: "#059669", color: "#fff", fontSize: 14, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1, fontFamily: FF }}>
            {saving ? "Saving…" : "Add Income"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ForecastCard ─────────────────────────────────────────────────
function ForecastCard({ forecast }) {
  const max = Math.max(...forecast.monthsAhead.map(m => m.amount), 1);

  return (
    <div style={{
      background: "#fff",
      border: "0.5px solid #e5e7eb",
      borderRadius: 16,
      padding: 24,
      marginBottom: 16,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: "linear-gradient(90deg, #3b5bdb, #8b5cf6)",
      }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: FF }}>Forecast</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#111827", marginTop: 2, fontFamily: FF }}>Projected Income</div>
        </div>
      </div>

      {/* 30/60/90 windows */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        {[
          { label: "Next 30 days", amount: forecast.w30 },
          { label: "Next 60 days", amount: forecast.w60 },
          { label: "Next 90 days", amount: forecast.w90 },
        ].map(w => (
          <div key={w.label} style={{
            background: "#f9fafb",
            border: "0.5px solid #e5e7eb",
            borderRadius: 12,
            padding: 16,
          }}>
            <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, fontFamily: FF }}>{w.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#3b5bdb", marginTop: 6, fontFamily: FF }}>
              {fmtIDR(w.amount)}
            </div>
          </div>
        ))}
      </div>

      {/* 6-month breakdown */}
      <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 12, fontFamily: FF }}>
        Next 6 Months
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 80 }}>
        {forecast.monthsAhead.map((m, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, fontFamily: FF }}>
              {fmtIDR(m.amount, true)}
            </div>
            <div style={{
              width: "100%",
              height: `${(m.amount / max) * 50}px`,
              minHeight: 4,
              background: "linear-gradient(180deg, #3b5bdb, #8b5cf6)",
              borderRadius: 4,
            }} />
            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: FF }}>{m.label}</div>
          </div>
        ))}
      </div>

      {forecast.totalMonthlyProjection === 0 && (
        <div style={{ marginTop: 16, fontSize: 13, color: "#9ca3af", textAlign: "center", fontStyle: "italic", fontFamily: FF }}>
          Forecast akan muncul setelah Paulus set monthly_target atau ada historical income data
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function Income({
  user, accounts, ledger, incomeSrcs, fxRates, curMonth,
  onRefresh, setLedger, setIncomeSrcs, dark,
}) {
  const [tab,           setTab]           = useState("overview");
  const [editingSource, setEditingSource] = useState(null);
  const [addIncModal,   setAddIncModal]   = useState(false);
  const [presetSrcId,   setPresetSrcId]   = useState(null);
  const [saving,        setSaving]        = useState(false);

  const bankAccounts = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);

  // ── Date ranges ──────────────────────────────────────────────
  const now           = new Date();
  const thisMonthKey  = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey  = lastMonthDate.toISOString().slice(0, 7);

  // ── Income ledger slices ─────────────────────────────────────
  const incomeLedger = useMemo(() =>
    ledger.filter(e => e.tx_type === "income"), [ledger]);

  const thisMonthIncome = useMemo(() =>
    incomeLedger.filter(e => ym(e.tx_date) === thisMonthKey), [incomeLedger, thisMonthKey]);

  const lastMonthIncome = useMemo(() =>
    incomeLedger.filter(e => ym(e.tx_date) === lastMonthKey), [incomeLedger, lastMonthKey]);

  // ── Hero KPIs ────────────────────────────────────────────────
  const totalThisMonth = useMemo(() =>
    thisMonthIncome.reduce((s, e) => s + Number(e.amount_idr || 0), 0), [thisMonthIncome]);

  const totalLastMonth = useMemo(() =>
    lastMonthIncome.reduce((s, e) => s + Number(e.amount_idr || 0), 0), [lastMonthIncome]);

  const totalTarget = useMemo(() =>
    incomeSrcs.reduce((s, src) => s + Number(src.monthly_target || 0), 0), [incomeSrcs]);

  const deltaPct = totalLastMonth > 0
    ? Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 100)
    : null;

  const achievementPct = totalTarget > 0
    ? Math.min(999, Math.round((totalThisMonth / totalTarget) * 100))
    : null;

  // ── Per-source stats ─────────────────────────────────────────
  const sourceStats = useMemo(() => {
    return incomeSrcs.map(src => {
      const srcIncome = thisMonthIncome.filter(e => e.from_id === src.id);
      const thisMonthAmount = srcIncome.reduce((s, e) => s + Number(e.amount_idr || 0), 0);

      // 6-month sparkline
      const sparkline = [];
      for (let i = 5; i >= 0; i--) {
        const mDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mKey  = mDate.toISOString().slice(0, 7);
        const total = incomeLedger
          .filter(e => e.from_id === src.id && ym(e.tx_date) === mKey)
          .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
        sparkline.push(total);
      }

      // Last received date
      const sorted = incomeLedger
        .filter(e => e.from_id === src.id)
        .sort((a, b) => b.tx_date.localeCompare(a.tx_date));
      const lastReceived = sorted[0]?.tx_date || null;

      return {
        ...src,
        thisMonthAmount,
        sparkline,
        lastReceived,
        progressPct: src.monthly_target > 0
          ? Math.min(100, Math.round((thisMonthAmount / src.monthly_target) * 100))
          : 0,
      };
    }).sort((a, b) => b.thisMonthAmount - a.thisMonthAmount);
  }, [incomeSrcs, incomeLedger, thisMonthIncome, now]);

  // ── Forecast computation ─────────────────────────────────────
  const forecast = useMemo(() => {
    const perSource = incomeSrcs.map(src => {
      let projectedMonthly = 0;

      // Historical avg (last 3 months)
      let last3Total = 0;
      for (let i = 1; i <= 3; i++) {
        const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const mEnd   = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        const monthSum = ledger
          .filter(tx => tx.tx_type === "income" && tx.from_id === src.id
            && new Date(tx.tx_date) >= mStart && new Date(tx.tx_date) <= mEnd)
          .reduce((s, tx) => s + Number(tx.amount_idr || 0), 0);
        last3Total += monthSum;
      }
      const last3Avg = last3Total / 3;

      if (src.recurrence === "monthly") {
        projectedMonthly = Number(src.monthly_target || 0) > 0
          ? Number(src.monthly_target)
          : last3Avg;
      } else if (src.recurrence === "quarterly") {
        let last3qTotal = 0;
        for (let q = 1; q <= 3; q++) {
          const qStart = new Date(now.getFullYear(), now.getMonth() - (q * 3), 1);
          const qEnd   = new Date(now.getFullYear(), now.getMonth() - (q * 3) + 3, 0, 23, 59, 59);
          const qSum = ledger
            .filter(tx => tx.tx_type === "income" && tx.from_id === src.id
              && new Date(tx.tx_date) >= qStart && new Date(tx.tx_date) <= qEnd)
            .reduce((s, tx) => s + Number(tx.amount_idr || 0), 0);
          last3qTotal += qSum;
        }
        projectedMonthly = (last3qTotal / 3) / 3;
      } else if (src.recurrence === "yearly") {
        const yStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
        const yEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        const yearSum = ledger
          .filter(tx => tx.tx_type === "income" && tx.from_id === src.id
            && new Date(tx.tx_date) >= yStart && new Date(tx.tx_date) <= yEnd)
          .reduce((s, tx) => s + Number(tx.amount_idr || 0), 0);
        projectedMonthly = yearSum / 12;
      } else {
        projectedMonthly = last3Avg;
      }

      return { ...src, projectedMonthly };
    });

    const totalMonthlyProjection = perSource.reduce((s, src) => s + src.projectedMonthly, 0);
    const w30 = totalMonthlyProjection;
    const w60 = totalMonthlyProjection * 2;
    const w90 = totalMonthlyProjection * 3;

    const monthsAhead = [];
    for (let i = 1; i <= 6; i++) {
      const targetMonth = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthLabel  = targetMonth.toLocaleDateString("id-ID", { month: "short", year: "numeric" });
      monthsAhead.push({ label: monthLabel, amount: totalMonthlyProjection });
    }

    return { perSource, totalMonthlyProjection, w30, w60, w90, monthsAhead };
  }, [incomeSrcs, ledger, now]);

  // ── CRUD handlers ────────────────────────────────────────────
  const handleSaveSource = async (patch) => {
    setSaving(true);
    try {
      if (editingSource?.id) {
        const updated = await incomeSrcApi.update(editingSource.id, patch);
        setIncomeSrcs(prev => prev.map(s => s.id === editingSource.id ? updated : s));
        showToast("Source updated");
      } else {
        const created = await incomeSrcApi.create(user.id, patch);
        setIncomeSrcs(prev => [...prev, created]);
        showToast("Source added");
      }
      setEditingSource(null);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleAddIncome = async (entry) => {
    setSaving(true);
    try {
      const created = await ledgerApi.create(user.id, entry, accounts);
      setLedger(prev => [created, ...prev]);
      setAddIncModal(false);
      showToast("Income recorded");
      onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const openAddIncome = (srcId = null) => {
    setPresetSrcId(srcId);
    setAddIncModal(true);
  };

  // ── TAB BUTTON STYLE ─────────────────────────────────────────
  const tabBtn = (id) => ({
    padding: "8px 18px", border: "none", borderRadius: 99, fontFamily: FF,
    background: tab === id ? "#111827" : "#f3f4f6",
    color: tab === id ? "#fff" : "#6b7280",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
  });

  // ── RENDER ───────────────────────────────────────────────────
  return (
    <div style={{ padding: "0 16px 80px", fontFamily: FF }}>

      {/* ── Top bar: tabs + actions ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <button style={tabBtn("overview")} onClick={() => setTab("overview")}>Overview</button>
        <button style={tabBtn("history")}  onClick={() => setTab("history")}>History</button>
        <button style={tabBtn("cashflow")} onClick={() => setTab("cashflow")}>Cash Flow</button>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setEditingSource({})}
          style={{ padding: "8px 14px", border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: FF, color: "#374151" }}
        >+ Source</button>
        <button
          onClick={() => openAddIncome()}
          style={{ padding: "8px 14px", border: "none", borderRadius: 8, background: "#059669", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FF }}
        >+ Income</button>
      </div>

      {/* ── Overview tab ── */}
      {tab === "overview" && (
        <>
          {/* Hero KPI card */}
          <div style={{
            background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16,
            padding: "20px 24px", marginBottom: 20, position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #059669, #10b981)" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 24 }}>

              {/* This month */}
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, fontFamily: FF }}>This Month</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#111827", fontFamily: FF, lineHeight: 1.1 }}>
                  {fmtIDR(totalThisMonth)}
                </div>
                {deltaPct !== null && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: 12, fontFamily: FF, color: deltaPct >= 0 ? "#059669" : "#dc2626" }}>
                    {deltaPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    <span>{Math.abs(deltaPct)}% vs last month</span>
                  </div>
                )}
              </div>

              {/* Target */}
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, fontFamily: FF }}>Monthly Target</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#111827", fontFamily: FF, lineHeight: 1.1 }}>
                  {totalTarget > 0 ? fmtIDR(totalTarget) : <span style={{ color: "#d1d5db" }}>—</span>}
                </div>
                {achievementPct !== null && (
                  <div style={{ marginTop: 8, fontSize: 12, fontFamily: FF, color: achievementPct >= 100 ? "#059669" : "#6b7280" }}>
                    {achievementPct}% achieved
                  </div>
                )}
              </div>

              {/* Last month */}
              <div>
                <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8, fontFamily: FF }}>Last Month</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#111827", fontFamily: FF, lineHeight: 1.1 }}>
                  {fmtIDR(totalLastMonth)}
                </div>
              </div>
            </div>
          </div>

          <ForecastCard forecast={forecast} />

          {/* Per-source grid */}
          {incomeSrcs.length === 0 ? (
            <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "48px 24px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
              No income sources yet. Click "+ Source" to add one.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
              {sourceStats.map(src => (
                <SourceCard
                  key={src.id}
                  src={src}
                  onEdit={() => setEditingSource(src)}
                  onAddIncome={() => openAddIncome(src.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── History tab (placeholder C-2) ── */}
      {tab === "history" && (
        <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "48px 24px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
          History view — coming in C-2
        </div>
      )}

      {/* ── Cash Flow tab (placeholder C-2) ── */}
      {tab === "cashflow" && (
        <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: "48px 24px", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
          Cash Flow view — coming in C-2
        </div>
      )}

      {/* ── Source Edit Modal ── */}
      {editingSource !== null && (
        <SourceEditModal
          source={editingSource}
          onSave={handleSaveSource}
          onClose={() => setEditingSource(null)}
          saving={saving}
        />
      )}

      {/* ── Add Income Modal ── */}
      {addIncModal && (
        <AddIncomeModal
          incomeSrcs={presetSrcId
            ? [incomeSrcs.find(s => s.id === presetSrcId), ...incomeSrcs.filter(s => s.id !== presetSrcId)].filter(Boolean)
            : incomeSrcs}
          bankAccounts={bankAccounts}
          onSave={handleAddIncome}
          onClose={() => setAddIncModal(false)}
          saving={saving}
        />
      )}
    </div>
  );
}
