import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { fmtIDR, todayStr } from "../utils";
import { ASSET_ICON } from "../constants";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { EmptyState, showToast } from "./shared/Card";
import Modal from "./shared/Modal";
import Button from "./shared/Button";
import Input, { Field, AmountInput } from "./shared/Input";
import { accountsApi, ledgerApi, recalculateBalance } from "../api";
import TxVerticalBig from "./shared/TxVerticalBig";
import * as XLSX from "xlsx";

const FF = "Figtree, sans-serif";

const fmtMonthYear = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { month: "long", year: "numeric" }); }
  catch { return d; }
};
const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
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
      {extra && <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 3 }}>{extra}</div>}
    </div>
  );
}

// ─── TIMELINE EVENT ROW ───────────────────────────────────────
function EventRow({ icon, iconBg, title, badge, badgeColor, badgeBg, subtitle, valueStr, valueColor, onEdit, onDelete }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: "1px solid #f3f4f6" }}>
      <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, background: iconBg || "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: FF }}>{title}</span>
          {badge && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: badgeBg || "#f3f4f6", color: badgeColor || "#6b7280", textTransform: "uppercase", fontFamily: FF }}>
              {badge}
            </span>
          )}
        </div>
        {subtitle && <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 2 }}>{subtitle}</div>}
        {(onEdit || onDelete) && (
          <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
            {onEdit && (
              <button onClick={onEdit} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#374151", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                Edit
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, border: "1px solid #fee2e2", background: "#fff5f5", color: "#dc2626", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
      {valueStr && (
        <div style={{ fontSize: 13, fontWeight: 700, color: valueColor || "#111827", fontFamily: FF, flexShrink: 0 }}>
          {valueStr}
        </div>
      )}
    </div>
  );
}

// ─── SPARKLINE TOOLTIP ────────────────────────────────────────
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
export default function AssetTimeline({
  asset, user, accounts, ledger, setLedger, onBack, onRefresh, setAccounts,
  categories = [], fxRates = {}, allCurrencies = [],
}) {
  const [valueHistory, setValueHistory] = useState([]);
  const [histLoading,  setHistLoading]  = useState(true);

  // Update Value modal
  const [updateModal, setUpdateModal] = useState(false);
  const [updateForm,  setUpdateForm]  = useState({ value: "", date: todayStr(), notes: "" });
  const [saving,      setSaving]      = useState(false);

  // TransactionModal
  const [txOpen,    setTxOpen]    = useState(false);
  const [txMode,    setTxMode]    = useState("add");
  const [txInitial, setTxInitial] = useState(null);

  // Delete confirm
  const [delEntry,    setDelEntry]    = useState(null);
  const [delVH,       setDelVH]       = useState(null);
  const [delConfirm,  setDelConfirm]  = useState(false);
  const [delSaving,   setDelSaving]   = useState(false);

  const bankAccounts = useMemo(() => accounts.filter(a => a.type === "bank" || a.subtype === "cash"), [accounts]);
  const ccAccounts   = useMemo(() => accounts.filter(a => a.type === "credit_card"), [accounts]);
  const assetAccs    = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);
  const icon = ASSET_ICON[asset.subtype] || "📦";

  useEffect(() => {
    if (!asset?.id) return;
    setHistLoading(true);
    supabase
      .from("asset_value_history")
      .select("*")
      .eq("account_id", asset.id)
      .order("date", { ascending: true })
      .then(({ data }) => { setValueHistory(data || []); setHistLoading(false); });
  }, [asset?.id]);

  // ── Derived metrics ──────────────────────────────────────────
  const assetLedger = useMemo(() =>
    ledger.filter(e => e.from_id === asset.id || e.to_id === asset.id)
  , [ledger, asset.id]);

  const costBasis = useMemo(() => {
    const buyTotal = assetLedger
      .filter(e => e.tx_type === "buy_asset" && e.to_id === asset.id)
      .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    const sellTotal = assetLedger
      .filter(e => e.tx_type === "sell_asset" && e.from_id === asset.id)
      .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    // Ledger entries are source of truth. purchase_price is fallback for manually-added assets.
    const ledgerBasis = buyTotal - sellTotal;
    return ledgerBasis > 0 ? ledgerBasis : Number(asset.purchase_price || 0);
  }, [asset, assetLedger]);

  const currentValue = Number(asset.current_value || 0);
  const unrealizedPL = currentValue - costBasis;
  const returnPct    = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;
  const plColor      = unrealizedPL >= 0 ? "#059669" : "#dc2626";
  const plBg         = unrealizedPL >= 0 ? "#f0fdf4" : "#fff1f2";

  // ── Sparkline data ────────────────────────────────────────────
  const sparkData = useMemo(() => {
    const points = [];
    if (asset.purchase_date && Number(asset.purchase_price || 0) > 0)
      points.push({ date: asset.purchase_date, value: Number(asset.purchase_price) });
    valueHistory.forEach(h => points.push({ date: h.date, value: Number(h.new_value || 0) }));
    const lastDate = todayStr();
    if (points.length === 0 || points[points.length - 1].value !== currentValue)
      points.push({ date: lastDate, value: currentValue });
    return points.map(p => ({ date: p.date, label: fmtDateShort(p.date), value: p.value }));
  }, [asset, valueHistory, currentValue]);

  // ── Timeline rows (newest first, grouped by month) ───────────
  const allEvents = useMemo(() => {
    const events = [];
    valueHistory.forEach((h, i) => {
      const oldVal = Number(h.old_value || 0);
      const newVal = Number(h.new_value || 0);
      events.push({ _type: "value_update", _date: h.date, _sort: `${h.date}_${i}`, data: h, oldVal, newVal });
    });
    assetLedger.forEach(e => {
      events.push({ _type: "ledger", _date: e.tx_date, _sort: `${e.tx_date}_${e.id}`, data: e });
    });
    events.sort((a, b) => b._sort.localeCompare(a._sort));
    return events;
  }, [valueHistory, assetLedger]);

  const grouped = useMemo(() => {
    const map = {};
    allEvents.forEach(ev => {
      const m = ym(ev._date);
      if (!map[m]) map[m] = [];
      map[m].push(ev);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [allEvents]);

  // ── Update Value ─────────────────────────────────────────────
  const handleUpdateValue = async () => {
    if (!updateForm.value) { showToast("Enter a value", "error"); return; }
    setSaving(true);
    try {
      const newVal = Number(updateForm.value);
      const { data: current } = await supabase.from("accounts").select("current_value").eq("id", asset.id).single();
      const oldValue = current?.current_value || 0;
      await supabase.from("accounts").update({ current_value: newVal }).eq("id", asset.id);
      await supabase.from("asset_value_history").insert({
        account_id: asset.id, user_id: user.id,
        old_value: oldValue, new_value: newVal,
        date: updateForm.date || todayStr(),
        notes: updateForm.notes || "Manual update",
      });
      if (setAccounts) setAccounts(p => p.map(a => a.id === asset.id ? { ...a, current_value: newVal } : a));
      setValueHistory(p => [...p, { account_id: asset.id, old_value: oldValue, new_value: newVal, date: updateForm.date || todayStr(), notes: updateForm.notes || "Manual update" }]);
      showToast("Value updated");
      setUpdateModal(false);
      onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Delete ledger entry ───────────────────────────────────────
  const handleDeleteEntry = async () => {
    if (!delEntry) return;
    setDelSaving(true);
    try {
      await ledgerApi.delete(delEntry.id, delEntry, accounts);
      setLedger?.(p => p.filter(e => e.id !== delEntry.id));
      const ids = [delEntry.from_id, delEntry.to_id].filter(Boolean);
      await Promise.all(ids.map(id => recalculateBalance(id, user.id)));
      showToast("Transaction deleted");
      setDelConfirm(false);
      setDelEntry(null);
      onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setDelSaving(false);
  };

  // ── Delete value history entry ────────────────────────────────
  const handleDeleteVH = async () => {
    if (!delVH) return;
    setDelSaving(true);
    try {
      await supabase.from("asset_value_history").delete().eq("id", delVH.id);
      setValueHistory(p => p.filter(h => h.id !== delVH.id));
      showToast("Value record deleted");
      setDelConfirm(false);
      setDelVH(null);
    } catch (e) { showToast(e.message, "error"); }
    setDelSaving(false);
  };

  // ── Export ────────────────────────────────────────────────────
  const exportPDF = () => window.print();

  const exportExcel = () => {
    const wb  = XLSX.utils.book_new();
    const nm  = (asset.name || "Asset").replace(/[^a-zA-Z0-9]/g, "_");

    const summaryRows = [
      ["Asset Timeline — Paulus Finance"],
      ["Asset",        asset.name],
      ["Type",         asset.subtype || "Asset"],
      [],
      ["Current Value", currentValue],
      ["Cost Basis",    costBasis],
      ["Unrealized P&L", unrealizedPL],
      ["Return %",      returnPct.toFixed(2) + "%"],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryRows), "Summary");

    const txHdr = ["Date", "Type", "Description", "Amount (IDR)", "From / To"];
    const txRows = assetLedger.map(e => [
      e.tx_date,
      e.tx_type,
      e.description || "",
      Number(e.amount_idr || 0),
      accounts.find(a => a.id === (e.to_id === asset.id ? e.from_id : e.to_id))?.name || "",
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([txHdr, ...txRows]), "Transactions");

    const vhHdr = ["Date", "Old Value", "New Value", "Change", "Notes"];
    const vhRows = valueHistory.map(h => [
      h.date,
      Number(h.old_value || 0),
      Number(h.new_value || 0),
      Number(h.new_value || 0) - Number(h.old_value || 0),
      h.notes || "",
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([vhHdr, ...vhRows]), "Value History");

    XLSX.writeFile(wb, `${nm}_Timeline_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const BTN = (extra = {}) => ({
    height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb",
    background: "#f9fafb", color: "#374151", fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: FF, ...extra,
  });

  // Derived account lists for TransactionModal
  const bankAccs  = accounts.filter(a => a.type === "bank" && a.subtype !== "cash" && a.is_active !== false);
  const cashAccs  = accounts.filter(a => a.is_active !== false && a.subtype === "cash");
  const ccAccs    = accounts.filter(a => a.is_active !== false && a.type === "credit_card");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: FF }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} style={BTN()}>← Back</button>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: "#eff6ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>{asset.name}</div>
          <div style={{ fontSize: 12, color: "#9ca3af" }}>{asset.subtype || "Asset"}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
          <button style={BTN()} onClick={exportPDF}>🖨 PDF</button>
          <button style={BTN()} onClick={exportExcel}>📊 Excel</button>
          <button style={BTN()} onClick={() => { setUpdateForm({ value: String(asset.current_value || ""), date: todayStr(), notes: "" }); setUpdateModal(true); }}>
            📈 Update Value
          </button>
          <button style={BTN({ background: "#111827", color: "#fff", border: "none" })} onClick={() => { setTxMode("add"); setTxInitial(null); setTxOpen(true); }}>
            + Transaction
          </button>
        </div>
      </div>

      {/* ── Metrics ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <MetricCard label="Current Value"   value={fmtIDR(currentValue)} color="#3b5bdb" bg="#eff6ff" />
        <MetricCard label="Cost Basis"      value={fmtIDR(costBasis)}    color="#111827" bg="#f9fafb" />
        <MetricCard label="Unrealized P&L"  value={`${unrealizedPL >= 0 ? "+" : ""}${fmtIDR(Math.abs(unrealizedPL))}`} color={plColor} bg={plBg} />
        <MetricCard label="Return %"        value={`${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`} color={plColor} bg={plBg} />
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
              <Area type="monotone" dataKey="value" stroke="#3b5bdb" strokeWidth={2} fill="url(#assetGrad)"
                dot={{ r: 3, fill: "#3b5bdb", strokeWidth: 0 }} activeDot={{ r: 5 }} />
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
                      badgeBg="#f0f9ff" badgeColor="#0369a1"
                      subtitle={`${fmtDateShort(h.date)} · ${fmtIDR(ev.oldVal)} → ${fmtIDR(ev.newVal)}${h.notes && h.notes !== "Manual update" ? ` · ${h.notes}` : ""}`}
                      valueStr={`${up ? "▲ +" : "▼ −"}${fmtIDR(Math.abs(diff))}`}
                      valueColor={up ? "#059669" : "#dc2626"}
                      onDelete={h.id ? () => { setDelVH(h); setDelEntry(null); setDelConfirm(true); } : undefined}
                    />
                  );
                }

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
                    valueStr={`${isSell ? "+" : "-"}${fmtIDR(amt)}`}
                    valueColor={isSell ? "#059669" : "#A32D2D"}
                    onEdit={() => { setTxMode("edit"); setTxInitial(e); setTxOpen(true); }}
                    onDelete={() => { setDelEntry(e); setDelVH(null); setDelConfirm(true); }}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* ── Update Value Modal ── */}
      <Modal isOpen={updateModal} onClose={() => setUpdateModal(false)} title="Update Asset Value"
        footer={<Button fullWidth onClick={handleUpdateValue} busy={saving}>Update →</Button>}>
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

      {/* ── TxVerticalBig (add + edit) ── */}
      <TxVerticalBig
        open={txOpen}
        mode={txMode}
        initialData={txInitial}
        defaultGroup="asset"
        defaultTxType={txMode === "add" ? "buy_asset" : undefined}
        defaultAccount={txMode === "add" ? { to_id: asset.id } : undefined}
        onSave={() => { setTxOpen(false); onRefresh?.(); }}
        onDelete={() => { setTxOpen(false); onRefresh?.(); }}
        onClose={() => setTxOpen(false)}
        user={user}
        accounts={accounts}
        setLedger={setLedger}
        categories={categories}
        fxRates={fxRates}
        allCurrencies={allCurrencies}
        bankAccounts={bankAccs}
        creditCards={ccAccs}
        assets={assetAccs}
        liabilities={[]}
        receivables={[]}
        incomeSrcs={[]}
        onRefresh={onRefresh}
      />

      {/* ── Delete confirm ── */}
      {delConfirm && (
        <div onClick={e => { if (e.target === e.currentTarget) { setDelConfirm(false); setDelEntry(null); setDelVH(null); } }}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 360, width: "100%", fontFamily: FF }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 8 }}>
              {delVH ? "Delete value record?" : "Delete transaction?"}
            </div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>This cannot be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setDelConfirm(false); setDelEntry(null); setDelVH(null); }}
                style={{ flex: 1, height: 40, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#fff", color: "#374151", fontFamily: FF, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={delVH ? handleDeleteVH : handleDeleteEntry} disabled={delSaving}
                style={{ flex: 1, height: 40, borderRadius: 8, border: "none", background: "#fee2e2", color: "#dc2626", fontFamily: FF, fontSize: 13, fontWeight: 700, cursor: delSaving ? "default" : "pointer", opacity: delSaving ? 0.6 : 1 }}>
                {delSaving ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
