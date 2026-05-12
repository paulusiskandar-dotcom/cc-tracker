import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { ledgerApi, incomeSrcApi, recurringApi } from "../api";
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

// ── NetForecastCard ───────────────────────────────────────────────
function NetForecastCard({ netForecast, period, onPeriodChange }) {
  const mult        = period === "3month" ? 3 : period === "yearly" ? 12 : 1;
  const periodLabel = period === "3month" ? "Next 3 Months" : period === "yearly" ? "Yearly" : "Monthly";
  const isHealthy   = netForecast.net >= 0;
  const totalIncomeP  = netForecast.totalIncome  * mult;
  const totalOutflowP = netForecast.totalOutflow * mult;
  const netP          = netForecast.net          * mult;

  const totalOutflow = netForecast.totalOutflow || 0;
  const pctBills    = totalOutflow > 0 ? Math.round((netForecast.totalBillsBank  / totalOutflow) * 100) : 0;
  const pctCCSubs   = totalOutflow > 0 ? Math.round((netForecast.totalCCSubs     / totalOutflow) * 100) : 0;
  const pctCicilan  = totalOutflow > 0 ? Math.round((netForecast.totalCicilan    / totalOutflow) * 100) : 0;
  const pctLiability= totalOutflow > 0 ? Math.round((netForecast.totalLiability  / totalOutflow) * 100) : 0;

  return (
    <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, overflow: "hidden", marginBottom: 16, fontFamily: FF }}>
      <div style={{ height: 3, background: isHealthy ? "linear-gradient(90deg,#059669,#10b981)" : "linear-gradient(90deg,#dc2626,#f59e0b)" }} />
      <div style={{ padding: "20px 24px" }}>

        {/* Header + period toggle */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>Net Forecast</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 4 }}>{periodLabel} Commitment Overview</div>
          </div>
          <div style={{ display: "flex", gap: 4, background: "#f3f4f6", padding: 3, borderRadius: 8 }}>
            {[{ key: "monthly", label: "Monthly" }, { key: "3month", label: "3-Month" }, { key: "yearly", label: "Yearly" }].map(opt => (
              <button key={opt.key} onClick={() => onPeriodChange(opt.key)} style={{
                padding: "6px 14px", border: "none", borderRadius: 6,
                background: period === opt.key ? "#fff" : "transparent",
                color: period === opt.key ? "#111827" : "#6b7280",
                fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FF,
                boxShadow: period === opt.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}>{opt.label}</button>
            ))}
          </div>
        </div>

        {/* Income */}
        <NfSectionHeader icon="📈" label="Income" amount={totalIncomeP} color="#059669" />

        {/* Spacer */}
        <div style={{ height: 12 }} />

        {/* Outflow */}
        <NfSectionHeader icon="📉" label="Outflow" amount={-totalOutflowP} color="#dc2626" />

        {netForecast.billsBank.length > 0 && (
          <NfSubGroup
            title={`Bills Bank (${netForecast.billsBank.length})`}
            total={netForecast.totalBillsBank * mult}
            percentage={pctBills}
            items={netForecast.billsBank.map(b => ({ label: b.name, amount: b.monthly * mult, hint: b.isEstimate ? "est" : "last paid" }))}
          />
        )}

        {netForecast.ccSubs.length > 0 && (
          <NfSubGroup
            title={`CC Subscriptions (${netForecast.ccSubs.length})`}
            total={netForecast.totalCCSubs * mult}
            percentage={pctCCSubs}
            items={netForecast.ccSubs.map(c => ({ label: c.name, amount: c.monthly * mult, hint: c.isEstimate ? "est" : "last paid" }))}
          />
        )}

        {netForecast.activeCicilan.length > 0 && (
          <NfSubGroup
            title={`Cicilan (${netForecast.activeCicilan.length})`}
            total={netForecast.totalCicilan * mult}
            percentage={pctCicilan}
            items={netForecast.activeCicilan.map(c => ({ label: c.description, amount: c.monthly * mult, hint: `${c.remaining}/${c.total} mo left` }))}
          />
        )}

        {netForecast.liabilities.length > 0 ? (
          <NfSubGroup
            title={`Liability (${netForecast.liabilities.length})`}
            total={netForecast.totalLiability * mult}
            percentage={pctLiability}
            items={netForecast.liabilities.map(l => ({ label: l.name, amount: l.monthly * mult }))}
          />
        ) : (
          <div style={{
            padding: "8px 12px", marginTop: 10, fontSize: 11, color: "#9ca3af",
            fontStyle: "italic", background: "#fafafa", border: "1px solid #f3f4f6", borderRadius: 8,
          }}>
            Liability (placeholder — cicilan mobil soon)
          </div>
        )}

        {/* Divider + Net Monthly — big, prominent */}
        <div style={{ borderTop: "2px solid #e5e7eb", paddingTop: 16, marginTop: 20, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>💰 Net {periodLabel}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: isHealthy ? "#059669" : "#dc2626", letterSpacing: -0.5 }}>
            {netP >= 0 ? "+" : ""}{fmtIDR(netP)}
          </div>
        </div>

        {/* Health banner */}
        <div style={{
          marginTop: 12, padding: "12px 16px", borderRadius: 8,
          background: isHealthy ? "#ecfdf5" : "#fef2f2",
          border: `1px solid ${isHealthy ? "#d1fae5" : "#fee2e2"}`,
          fontSize: 12, fontWeight: 600,
          color: isHealthy ? "#059669" : "#dc2626",
        }}>
          {isHealthy
            ? `✅ Net positive${netForecast.netPct !== null ? ` (+${netForecast.netPct}%)` : ""}`
            : `⚠️ Net negative — outflow exceeds income by ${fmtIDR(Math.abs(netP))}`}
        </div>
      </div>
    </div>
  );
}

function NfSectionHeader({ icon, label, amount, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{icon} {label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color }}>{amount >= 0 ? "+" : ""}{fmtIDR(amount)}</div>
    </div>
  );
}

function NfSubGroup({ title, total, percentage, items, defaultCollapsed = true }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div style={{ marginTop: 10 }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 12px", background: "#f9fafb", border: "1px solid #f3f4f6",
          borderRadius: 8, cursor: "pointer", userSelect: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 10, color: "#6b7280", display: "inline-block",
            transition: "transform 0.15s",
            transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
          }}>▶</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#374151", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {title}
          </span>
          {percentage != null && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: "#6b7280",
              background: "#fff", padding: "1px 6px", borderRadius: 4, border: "1px solid #e5e7eb",
            }}>{percentage}%</span>
          )}
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{fmtIDR(total)}</span>
      </div>
      {!collapsed && (
        <div style={{ paddingLeft: 24, marginTop: 4 }}>
          {items.map((item, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              padding: "4px 8px", fontSize: 13, color: "#374151",
            }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: 6, flex: 1, minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                {item.hint && (
                  <span style={{ fontSize: 10, color: "#9ca3af", fontStyle: "italic", flexShrink: 0 }}>({item.hint})</span>
                )}
              </span>
              <span style={{ fontWeight: 600, color: "#111827", marginLeft: 12, flexShrink: 0 }}>{fmtIDR(item.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CashFlowKPI({ label, value, color, sublabel, prefix = "" }) {
  return (
    <div style={{
      background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12,
      padding: "14px 16px", borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color, marginTop: 4 }}>
        {prefix}{fmtIDR(value)}
      </div>
      <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 4 }}>{sublabel}</div>
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
  recurTemplates = [],
  installments   = [],
}) {
  const [tab,            setTab]            = useState("overview");
  const [forecastPeriod, setForecastPeriod] = useState("monthly");
  const [editingSource,  setEditingSource]  = useState(null);
  const [addIncModal,   setAddIncModal]   = useState(false);
  const [presetSrcId,   setPresetSrcId]   = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [historyFilterSrc, setHistoryFilterSrc] = useState("");

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

  // ── Net Forecast computation ──────────────────────────────────
  const netForecast = useMemo(() => {
    const totalIncome = forecast.totalMonthlyProjection || 0;

    const getLastPaid = (templateId) => {
      if (!templateId || !ledger) return null;
      const latest = ledger
        .filter(e => e.recurring_template_id === templateId)
        .sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || ""))[0];
      return latest ? Number(latest.amount_idr || 0) : null;
    };

    const billsBank = (recurTemplates || [])
      .filter(t => t.tx_type === "expense" && t.is_active !== false && t.from_type === "account")
      .map(t => {
        const lastPaid = getLastPaid(t.id);
        return { id: t.id, name: t.name, monthly: lastPaid !== null ? lastPaid : Number(t.amount || 0), isEstimate: lastPaid === null };
      })
      .sort((a, b) => b.monthly - a.monthly);
    const totalBillsBank = billsBank.reduce((s, b) => s + b.monthly, 0);

    const ccSubs = (recurTemplates || [])
      .filter(t => t.tx_type === "expense" && t.is_active !== false && t.from_type === "credit_card")
      .map(t => {
        const lastPaid = getLastPaid(t.id);
        return { id: t.id, name: t.name, monthly: lastPaid !== null ? lastPaid : Number(t.amount || 0), isEstimate: lastPaid === null };
      })
      .sort((a, b) => b.monthly - a.monthly);
    const totalCCSubs = ccSubs.reduce((s, c) => s + c.monthly, 0);

    const activeCicilan = (installments || [])
      .filter(i => i.status === "active" && Number(i.paid_months ?? 0) < Number(i.total_months ?? 0))
      .map(i => ({
        id: i.id,
        description: i.description,
        monthly:   Number(i.monthly_amount || 0),
        remaining: Math.max(0, Number(i.total_months || 0) - Number(i.paid_months || 0)),
        total:     Number(i.total_months || 0),
      }))
      .sort((a, b) => b.monthly - a.monthly);
    const totalCicilan = activeCicilan.reduce((s, c) => s + c.monthly, 0);

    const liabilities = (recurTemplates || [])
      .filter(t => t.tx_type === "pay_liability" && t.is_active !== false)
      .map(t => ({ id: t.id, name: t.name, monthly: Number(t.amount || 0) }));
    const totalLiability = liabilities.reduce((s, l) => s + l.monthly, 0);

    const totalOutflow = totalBillsBank + totalCCSubs + totalCicilan + totalLiability;
    const net    = totalIncome - totalOutflow;
    const netPct = totalIncome > 0 ? Math.round((net / totalIncome) * 100) : null;

    return {
      totalIncome,
      billsBank, totalBillsBank,
      ccSubs, totalCCSubs,
      activeCicilan, totalCicilan,
      liabilities, totalLiability,
      totalOutflow, net, netPct,
    };
  }, [forecast.totalMonthlyProjection, recurTemplates, installments, ledger]);

  // ── History data: last 12 months grouped income ──────────────
  const historyData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = ym(d.toISOString().slice(0, 10));
      const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const txs = (ledger || [])
        .filter(e => e.tx_type === "income" && ym(e.tx_date) === key)
        .sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || ""));
      const total = txs.reduce((s, e) => s + Number(e.amount_idr || 0), 0);
      months.push({ key, label, txs, total, count: txs.length });
    }
    return months;
  }, [ledger]);

  // ── Cash flow data: income vs spend last 12 months ───────────
  const cashFlowData = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = ym(d.toISOString().slice(0, 10));
      const label = d.toLocaleDateString("en-US", { month: "short" });
      const monthLedger = (ledger || []).filter(e => ym(e.tx_date) === key);
      const income = monthLedger
        .filter(e => e.tx_type === "income")
        .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
      const spend = monthLedger
        .filter(e => (e.tx_type === "expense" || e.tx_type === "buy_asset") && !e.is_reimburse)
        .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
      months.push({ key, label, income, spend, net: income - spend });
    }
    const totalIncome = months.reduce((s, m) => s + m.income, 0);
    const totalSpend  = months.reduce((s, m) => s + m.spend,  0);
    const totalNet    = totalIncome - totalSpend;
    const maxValue    = Math.max(...months.map(m => Math.max(m.income, m.spend)), 1);
    return {
      months,
      avgIncome: totalIncome / 12,
      avgSpend:  totalSpend  / 12,
      avgNet:    totalNet    / 12,
      maxValue,
    };
  }, [ledger]);

  // ── CRUD handlers ────────────────────────────────────────────
  const handleSaveSource = async (patch) => {
    setSaving(true);
    try {
      let savedSrc;
      if (editingSource?.id) {
        savedSrc = await incomeSrcApi.update(editingSource.id, patch);
        setIncomeSrcs(prev => prev.map(s => s.id === editingSource.id ? savedSrc : s));
        showToast("Source updated");
      } else {
        savedSrc = await incomeSrcApi.create(user.id, patch);
        setIncomeSrcs(prev => [...prev, savedSrc]);
        showToast("Source added");
      }
      setEditingSource(null);
      // Non-blocking: sync recurring template — failure doesn't affect source save
      if (savedSrc?.id) {
        recurringApi.upsertForIncomeSource(user.id, savedSrc).catch(err =>
          console.error("Failed to sync recurring template:", err)
        );
      }
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

          <NetForecastCard
            netForecast={netForecast}
            period={forecastPeriod}
            onPeriodChange={setForecastPeriod}
          />

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

      {/* ── History tab ── */}
      {tab === "history" && (
        <>
          {/* Filter bar */}
          <div style={{
            background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12,
            padding: "12px 16px", marginBottom: 16,
            display: "flex", gap: 12, alignItems: "center", fontFamily: FF,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Filter source
            </span>
            <select
              value={historyFilterSrc}
              onChange={e => setHistoryFilterSrc(e.target.value)}
              style={{
                padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 6,
                fontSize: 13, fontFamily: FF, background: "#fff", minWidth: 180,
              }}
            >
              <option value="">All sources</option>
              {(incomeSrcs || []).map(src => (
                <option key={src.id} value={src.id}>{src.name}</option>
              ))}
            </select>
          </div>

          {/* Monthly groups */}
          {historyData.map(m => {
            const filteredTxs = historyFilterSrc
              ? m.txs.filter(tx => tx.from_id === historyFilterSrc)
              : m.txs;
            const filteredTotal = filteredTxs.reduce((s, tx) => s + Number(tx.amount_idr || 0), 0);
            if (filteredTxs.length === 0 && historyFilterSrc) return null;
            return (
              <div key={m.key} style={{
                background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12,
                marginBottom: 12, overflow: "hidden", fontFamily: FF,
              }}>
                {/* Month header */}
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  padding: "12px 16px", background: "#fafafa", borderBottom: "1px solid #f3f4f6",
                }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#111827" }}>{m.label}</span>
                    <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 8 }}>
                      {filteredTxs.length} {filteredTxs.length === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "#059669" }}>
                    +{fmtIDR(filteredTotal)}
                  </span>
                </div>
                {/* Tx list */}
                {filteredTxs.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "#9ca3af", fontSize: 12 }}>
                    No income in this month
                  </div>
                ) : (
                  filteredTxs.map(tx => {
                    const source  = (incomeSrcs || []).find(s => s.id === tx.from_id);
                    const account = (accounts    || []).find(a => a.id === tx.to_id);
                    return (
                      <div key={tx.id} style={{
                        display: "flex", justifyContent: "space-between", alignItems: "baseline",
                        padding: "10px 16px", borderBottom: "1px solid #f3f4f6", fontSize: 13,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: "#111827", marginBottom: 2 }}>
                            {tx.description || source?.name || "Income"}
                          </div>
                          <div style={{ fontSize: 11, color: "#6b7280" }}>
                            {tx.tx_date} · {source?.name || "—"} · {account?.name || "—"}
                          </div>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#059669" }}>
                          +{fmtIDR(Number(tx.amount_idr || 0))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}

          {historyData.every(m => m.txs.length === 0) && (
            <div style={{
              background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12,
              padding: "48px 24px", textAlign: "center", color: "#9ca3af", fontSize: 13,
            }}>
              No income history in the last 12 months
            </div>
          )}
        </>
      )}

      {/* ── Cash Flow tab ── */}
      {tab === "cashflow" && (
        <>
          {/* KPI Hero */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12, marginBottom: 16, fontFamily: FF,
          }}>
            <CashFlowKPI label="Avg Income" value={cashFlowData.avgIncome} color="#059669" sublabel="Last 12 months" />
            <CashFlowKPI label="Avg Spend"  value={cashFlowData.avgSpend}  color="#dc2626" sublabel="Last 12 months" />
            <CashFlowKPI
              label="Avg Net"
              value={cashFlowData.avgNet}
              color={cashFlowData.avgNet >= 0 ? "#059669" : "#dc2626"}
              sublabel="Last 12 months"
              prefix={cashFlowData.avgNet >= 0 ? "+" : ""}
            />
          </div>

          {/* 12-month bar chart */}
          <div style={{
            background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16,
            padding: "20px 24px", fontFamily: FF,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Cash Flow
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#111827", marginTop: 4, marginBottom: 20 }}>
              Last 12 Months
            </div>

            {/* Bar columns */}
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(12, 1fr)",
              gap: 6, height: 140, alignItems: "flex-end", marginBottom: 12,
            }}>
              {cashFlowData.months.map(m => {
                const incomeH = (m.income / cashFlowData.maxValue) * 100;
                const spendH  = (m.spend  / cashFlowData.maxValue) * 100;
                return (
                  <div key={m.key} style={{
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "flex-end",
                    gap: 4, height: "100%",
                  }}>
                    <div style={{
                      display: "flex", gap: 2, alignItems: "flex-end",
                      height: 100, width: "100%", justifyContent: "center",
                    }}>
                      <div
                        title={`Income: ${fmtIDR(m.income)}`}
                        style={{
                          width: "45%", minWidth: 6,
                          height: `${Math.max(incomeH, m.income > 0 ? 2 : 0)}%`,
                          background: "linear-gradient(180deg, #10b981, #059669)",
                          borderRadius: "3px 3px 0 0",
                        }}
                      />
                      <div
                        title={`Spend: ${fmtIDR(m.spend)}`}
                        style={{
                          width: "45%", minWidth: 6,
                          height: `${Math.max(spendH, m.spend > 0 ? 2 : 0)}%`,
                          background: "linear-gradient(180deg, #f87171, #dc2626)",
                          borderRadius: "3px 3px 0 0",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 600 }}>{m.label}</div>
                    <div style={{ fontSize: 8, fontWeight: 700, color: m.net >= 0 ? "#059669" : "#dc2626" }}>
                      {m.net >= 0 ? "+" : ""}{fmtIDR(m.net, true)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{
              display: "flex", gap: 16, justifyContent: "center",
              marginTop: 16, fontSize: 11, color: "#6b7280", fontWeight: 600,
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, background: "#059669", borderRadius: 2, display: "inline-block" }} />
                Income
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, background: "#dc2626", borderRadius: 2, display: "inline-block" }} />
                Spend
              </span>
            </div>
          </div>
        </>
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
