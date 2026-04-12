import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { fmtIDR, todayStr } from "../utils";
import { ASSET_ICON } from "../constants";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { EmptyState, showToast } from "./shared/Card";
import Modal from "./shared/Modal";
import Button from "./shared/Button";
import Input, { Field, AmountInput, FormRow } from "./shared/Input";
import { accountsApi, ledgerApi, getTxFromToTypes } from "../api";

const FF = "Figtree, sans-serif";

// Format date as "Apr 2025"
const fmtMonthYear = (d) => {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  } catch { return d; }
};

const fmtDateShort = (d) => {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString("id-ID", {
      day: "2-digit", month: "short", year: "numeric",
    });
  } catch { return d; }
};

const ym = (d) => (d || "").slice(0, 7);

// ─── METRIC CARD ─────────────────────────────────────────────
function MetricCard({ label, value, extra, color, bg }) {
  return (
    <div style={{ background: bg || "#f9fafb", borderRadius: 12, padding: "14px 16px", border: "0.5px solid #e5e7eb", flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: color || "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, marginBottom: 6, opacity: 0.8 }}>
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: color || "#111827", fontFamily: FF, lineHeight: 1.2 }}>
        {value}
      </div>
      {extra && (
        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 3 }}>{extra}</div>
      )}
    </div>
  );
}

// ─── TIMELINE EVENT ROW ───────────────────────────────────────
function EventRow({ icon, iconBg, iconColor, title, badge, badgeColor, badgeBg, subtitle, valueStr, valueColor }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
      {/* Dot */}
      <div style={{
        width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
        background: iconBg || "#f3f4f6",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16, color: iconColor,
      }}>
        {icon}
      </div>
      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: FF }}>{title}</span>
          {badge && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: badgeBg || "#f3f4f6", color: badgeColor || "#6b7280", textTransform: "uppercase", fontFamily: FF }}>
              {badge}
            </span>
          )}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {/* Value */}
      {valueStr && (
        <div style={{ fontSize: 13, fontWeight: 700, color: valueColor || "#111827", fontFamily: FF, flexShrink: 0 }}>
          {valueStr}
        </div>
      )}
    </div>
  );
}

// ─── SPARKLINE CUSTOM TOOLTIP ─────────────────────────────────
function SparkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", fontFamily: FF }}>
      <div style={{ fontSize: 10, color: "#9ca3af" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#3b5bdb" }}>{fmtIDR(payload[0].value)}</div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────
export default function AssetTimeline({ asset, user, accounts, ledger, onBack, onRefresh, setAccounts }) {
  const [valueHistory, setValueHistory] = useState([]);
  const [histLoading,  setHistLoading]  = useState(true);

  // Update value modal
  const [updateModal, setUpdateModal] = useState(false);
  const [updateForm,  setUpdateForm]  = useState({ value: "", date: todayStr(), notes: "" });
  const [saving,      setSaving]      = useState(false);

  // Add transaction modal (buy_asset only — simplified)
  const [txModal,  setTxModal]  = useState(false);
  const [txForm,   setTxForm]   = useState({ amount: "", date: todayStr(), description: "", from_id: "", notes: "" });
  const [txSaving, setTxSaving] = useState(false);

  const bankAccounts = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const icon = ASSET_ICON[asset.subtype] || "📦";

  useEffect(() => {
    if (!asset?.id) return;
    setHistLoading(true);
    supabase
      .from("asset_value_history")
      .select("*")
      .eq("account_id", asset.id)
      .order("date", { ascending: true })
      .then(({ data }) => {
        setValueHistory(data || []);
        setHistLoading(false);
      });
  }, [asset?.id]);

  // ── Derived metrics ──────────────────────────────────────────
  const assetLedger = useMemo(() =>
    ledger.filter(e => e.from_id === asset.id || e.to_id === asset.id)
  , [ledger, asset.id]);

  // Cost basis: purchase_price + all buy_asset additions
  const costBasis = useMemo(() => {
    const base = Number(asset.purchase_price || 0);
    const adds = assetLedger
      .filter(e => e.tx_type === "buy_asset" && e.to_id === asset.id)
      .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    return base + adds;
  }, [asset, assetLedger]);

  const currentValue = Number(asset.current_value || 0);
  const unrealizedPL = currentValue - costBasis;
  const returnPct    = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;

  // ── Sparkline data ────────────────────────────────────────────
  const sparkData = useMemo(() => {
    const points = [];
    // Add initial purchase point if available
    if (asset.purchase_date && Number(asset.purchase_price || 0) > 0) {
      points.push({ date: asset.purchase_date, value: Number(asset.purchase_price) });
    }
    // Add value history points
    valueHistory.forEach(h => {
      points.push({ date: h.date, value: Number(h.new_value || 0) });
    });
    // Add current value as last point if not already there
    const lastDate = todayStr();
    if (points.length === 0 || points[points.length - 1].value !== currentValue) {
      points.push({ date: lastDate, value: currentValue });
    }
    return points.map(p => ({
      date: p.date,
      label: fmtDateShort(p.date),
      value: p.value,
    }));
  }, [asset, valueHistory, currentValue]);

  // ── Timeline rows (newest first, grouped by month) ───────────
  const allEvents = useMemo(() => {
    const events = [];

    // Value history events
    valueHistory.forEach((h, i) => {
      const oldVal = Number(h.old_value || 0);
      const newVal = Number(h.new_value || 0);
      events.push({ _type: "value_update", _date: h.date, _sort: `${h.date}_${i}`, data: h, oldVal, newVal });
    });

    // Ledger events
    assetLedger.forEach(e => {
      events.push({ _type: "ledger", _date: e.tx_date, _sort: `${e.tx_date}_${e.id}`, data: e });
    });

    // Sort newest first
    events.sort((a, b) => b._sort.localeCompare(a._sort));
    return events;
  }, [valueHistory, assetLedger]);

  // Group by month
  const grouped = useMemo(() => {
    const map = {};
    allEvents.forEach(ev => {
      const m = ym(ev._date);
      if (!map[m]) map[m] = [];
      map[m].push(ev);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [allEvents]);

  // ── Actions ───────────────────────────────────────────────────
  const handleUpdateValue = async () => {
    if (!updateForm.value) { showToast("Enter a value", "error"); return; }
    setSaving(true);
    try {
      const newVal   = Number(updateForm.value);
      const { data: current } = await supabase.from("accounts").select("current_value").eq("id", asset.id).single();
      const oldValue = current?.current_value || 0;

      await supabase.from("accounts").update({ current_value: newVal }).eq("id", asset.id);
      const { error: histErr } = await supabase.from("asset_value_history").insert({
        account_id: asset.id,
        user_id:    user.id,
        old_value:  oldValue,
        new_value:  newVal,
        date:       updateForm.date || todayStr(),
        notes:      updateForm.notes || "Manual update",
      });
      if (histErr) throw new Error(histErr.message);

      if (setAccounts) setAccounts(p => p.map(a => a.id === asset.id ? { ...a, current_value: newVal } : a));
      setValueHistory(p => [...p, { account_id: asset.id, old_value: oldValue, new_value: newVal, date: updateForm.date || todayStr(), notes: updateForm.notes || "Manual update" }]);
      showToast("Value updated");
      setUpdateModal(false);
      if (onRefresh) onRefresh();
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleAddTx = async () => {
    if (!txForm.amount || !txForm.from_id) { showToast("Fill amount and source account", "error"); return; }
    setTxSaving(true);
    try {
      const amt = Number(txForm.amount);
      const { from_type, to_type } = getTxFromToTypes("buy_asset");
      await ledgerApi.create(user.id, {
        tx_type:     "buy_asset",
        tx_date:     txForm.date || todayStr(),
        amount:      amt,
        currency:    "IDR",
        amount_idr:  amt,
        description: txForm.description || `Additional cost: ${asset.name}`,
        from_id:     txForm.from_id,
        to_id:       asset.id,
        from_type,
        to_type,
        entity:      "Personal",
        notes:       txForm.notes || null,
      }, accounts);
      showToast("Transaction added");
      setTxModal(false);
      setTxForm({ amount: "", date: todayStr(), description: "", from_id: "", notes: "" });
      if (onRefresh) onRefresh();
    } catch (e) { showToast(e.message, "error"); }
    setTxSaving(false);
  };

  const plColor  = unrealizedPL >= 0 ? "#059669" : "#dc2626";
  const plBg     = unrealizedPL >= 0 ? "#f0fdf4" : "#fff1f2";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: FF }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#374151", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FF }}
        >← Back</button>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>{asset.name}</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>{asset.subtype || "Asset"}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Button variant="secondary" size="sm" onClick={() => {
            setUpdateForm({ value: String(asset.current_value || ""), date: todayStr(), notes: "" });
            setUpdateModal(true);
          }}>
            📈 Update Value
          </Button>
          <Button size="sm" onClick={() => {
            setTxForm({ amount: "", date: todayStr(), description: "", from_id: "", notes: "" });
            setTxModal(true);
          }}>
            + Transaction
          </Button>
        </div>
      </div>

      {/* ── Metrics ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <MetricCard label="Current Value" value={fmtIDR(currentValue)} color="#3b5bdb" bg="#eff6ff" />
        <MetricCard label="Cost Basis"    value={fmtIDR(costBasis)}    color="#111827" bg="#f9fafb" />
        <MetricCard
          label="Unrealized P&L"
          value={`${unrealizedPL >= 0 ? "+" : ""}${fmtIDR(Math.abs(unrealizedPL))}`}
          color={plColor} bg={plBg}
        />
        <MetricCard
          label="Return %"
          value={`${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`}
          color={plColor} bg={plBg}
        />
      </div>

      {/* ── Sparkline chart ── */}
      {sparkData.length >= 2 && (
        <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", padding: "16px 16px 8px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
            Value History
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={sparkData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id="assetGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b5bdb" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b5bdb" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#9ca3af", fontFamily: FF }} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip content={<SparkTooltip />} />
              <Area
                type="monotone" dataKey="value"
                stroke="#3b5bdb" strokeWidth={2}
                fill="url(#assetGrad)"
                dot={{ r: 3, fill: "#3b5bdb", strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Timeline ── */}
      <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", padding: "16px 20px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
          Timeline
        </div>

        {histLoading ? (
          <div style={{ textAlign: "center", padding: 24, color: "#9ca3af", fontSize: 13 }}>Loading…</div>
        ) : allEvents.length === 0 ? (
          <EmptyState icon="📋" message="No history for this asset yet" />
        ) : (
          grouped.map(([month, events]) => (
            <div key={month}>
              {/* Month label */}
              <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", padding: "8px 0 4px", marginTop: 8 }}>
                {fmtMonthYear(month + "-01")}
              </div>

              {events.map((ev, idx) => {
                if (ev._type === "value_update") {
                  const h    = ev.data;
                  const diff = ev.newVal - ev.oldVal;
                  const up   = diff >= 0;
                  return (
                    <EventRow
                      key={`vh-${h.id || idx}`}
                      icon="📈"
                      iconBg={up ? "#f0fdf4" : "#fff1f2"}
                      title="Value Updated"
                      badge="Update"
                      badgeBg="#f0f9ff"
                      badgeColor="#0369a1"
                      subtitle={`${fmtDateShort(h.date)} · ${fmtIDR(ev.oldVal)} → ${fmtIDR(ev.newVal)}${h.notes && h.notes !== "Manual update" ? ` · ${h.notes}` : ""}`}
                      valueStr={`${up ? "▲ +" : "▼ −"}${fmtIDR(Math.abs(diff))}`}
                      valueColor={up ? "#059669" : "#dc2626"}
                    />
                  );
                }

                // Ledger event
                const e     = ev.data;
                const isBuy  = e.tx_type === "buy_asset"  && e.to_id   === asset.id;
                const isSell = e.tx_type === "sell_asset" && e.from_id === asset.id;
                const other  = accounts.find(a => a.id === (isBuy ? e.from_id : e.to_id));
                const amt    = Number(e.amount_idr || 0);
                return (
                  <EventRow
                    key={`tx-${e.id}`}
                    icon={isBuy ? "💰" : isSell ? "💵" : "💸"}
                    iconBg={isBuy ? "#e0f2fe" : isSell ? "#fef9c3" : "#fde8e8"}
                    title={e.description || (isBuy ? "Asset Purchase" : isSell ? "Asset Sale" : e.tx_type)}
                    badge={isBuy ? "Purchase" : isSell ? "Sale" : "Expense"}
                    badgeBg={isBuy ? "#e0f2fe" : isSell ? "#fef9c3" : "#fde8e8"}
                    badgeColor={isBuy ? "#0369a1" : isSell ? "#92400e" : "#b91c1c"}
                    subtitle={`${fmtDateShort(e.tx_date)}${other ? ` · ${isBuy ? "from" : "to"} ${other.name}` : ""}`}
                    valueStr={`${isSell ? "+" : ""}${fmtIDR(amt)}`}
                    valueColor={isSell ? "#059669" : "#A32D2D"}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* ── Update Value Modal ── */}
      <Modal
        isOpen={updateModal}
        onClose={() => setUpdateModal(false)}
        title="Update Asset Value"
        footer={<Button fullWidth onClick={handleUpdateValue} busy={saving}>Update →</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <AmountInput label="New Value (IDR)" value={updateForm.value} onChange={v => setUpdateForm(f => ({ ...f, value: v }))} />
          <Input label="Date" type="date" value={updateForm.date} onChange={e => setUpdateForm(f => ({ ...f, date: e.target.value }))} />
          <Field label="Notes (optional)">
            <textarea value={updateForm.notes} onChange={e => setUpdateForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: FF, fontSize: 14, fontWeight: 500, color: "#111827", background: "#fff", outline: "none", resize: "vertical", boxSizing: "border-box" }}
              placeholder="Optional notes…" />
          </Field>
        </div>
      </Modal>

      {/* ── Add Transaction Modal ── */}
      <Modal
        isOpen={txModal}
        onClose={() => setTxModal(false)}
        title="+ Add Transaction"
        footer={<Button fullWidth onClick={handleAddTx} busy={txSaving}>Add Transaction →</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "10px 12px", background: "#f0f9ff", borderRadius: 10, fontSize: 12, color: "#0369a1", fontFamily: FF }}>
            Records a buy_asset transaction — adds to cost basis.
          </div>
          <AmountInput label="Amount (IDR) *" value={txForm.amount} onChange={v => setTxForm(f => ({ ...f, amount: v }))} />
          <Input label="Date" type="date" value={txForm.date} onChange={e => setTxForm(f => ({ ...f, date: e.target.value }))} />
          <Input label="Description" value={txForm.description} onChange={e => setTxForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Renovation cost" />
          <Field label="From Account *">
            <select value={txForm.from_id} onChange={e => setTxForm(f => ({ ...f, from_id: e.target.value }))}
              style={{ width: "100%", height: 44, padding: "0 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: FF, fontSize: 14, fontWeight: 500, color: "#111827", background: "#fff", outline: "none", appearance: "none", WebkitAppearance: "none", boxSizing: "border-box" }}>
              <option value="">Select account…</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Notes (optional)">
            <textarea value={txForm.notes} onChange={e => setTxForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              style={{ width: "100%", padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: FF, fontSize: 14, fontWeight: 500, color: "#111827", background: "#fff", outline: "none", resize: "vertical", boxSizing: "border-box" }}
              placeholder="Optional notes…" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
