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

const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
};
const fmtDateLabel = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }); }
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

  const assetAccs = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);
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
    const base = Number(asset.purchase_price || 0);
    const adds = assetLedger
      .filter(e => e.tx_type === "buy_asset" && e.to_id === asset.id)
      .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
    return base + adds;
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
    if (points.length === 0 || points[points.length - 1].value !== currentValue)
      points.push({ date: todayStr(), value: currentValue });
    return points.map(p => ({ date: p.date, label: fmtDateShort(p.date), value: p.value }));
  }, [asset, valueHistory, currentValue]);

  // ── All events sorted chronologically (oldest first) ─────────
  const allEvents = useMemo(() => {
    const events = [];
    valueHistory.forEach((h, i) => {
      const oldVal = Number(h.old_value || 0);
      const newVal = Number(h.new_value || 0);
      events.push({ _type: "value_update", _date: h.date, _sort: `${h.date}_v${i}`, data: h, oldVal, newVal });
    });
    assetLedger.forEach(e => {
      events.push({ _type: "ledger", _date: e.tx_date, _sort: `${e.tx_date}_l${e.id}`, data: e });
    });
    return events.sort((a, b) => a._sort.localeCompare(b._sort));
  }, [valueHistory, assetLedger]);

  // ── Attach running value to each event ────────────────────────
  const eventsWithValue = useMemo(() => {
    let runVal = Number(asset.purchase_price || 0);
    return allEvents.map(ev => {
      if (ev._type === "value_update") runVal = ev.newVal;
      return { ...ev, _runValue: runVal };
    });
  }, [allEvents, asset]);

  // ── Group by date ─────────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = {};
    eventsWithValue.forEach(ev => {
      if (!map[ev._date]) map[ev._date] = [];
      map[ev._date].push(ev);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [eventsWithValue]);

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
      setDelConfirm(false); setDelEntry(null);
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
      setDelConfirm(false); setDelVH(null);
    } catch (e) { showToast(e.message, "error"); }
    setDelSaving(false);
  };

  // ── Export ────────────────────────────────────────────────────
  const exportPDF = () => window.print();

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const nm = (asset.name || "Asset").replace(/[^a-zA-Z0-9]/g, "_");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Asset Statement — Paulus Finance"],
      ["Asset", asset.name], ["Type", asset.subtype || "Asset"], [],
      ["Current Value", currentValue], ["Cost Basis", costBasis],
      ["Unrealized P&L", unrealizedPL], ["Return %", returnPct.toFixed(2) + "%"],
    ]), "Summary");
    const hdr = ["Tanggal", "Keterangan", "Jenis", "Debit", "Kredit", "Nilai"];
    const rows = eventsWithValue.map(ev => {
      if (ev._type === "value_update") {
        const diff = ev.newVal - ev.oldVal;
        return [ev._date, ev.data.notes || "Update Nilai", "Value Update",
          diff < 0 ? Math.abs(diff) : "", diff >= 0 ? diff : "", ev.newVal];
      }
      const e = ev.data;
      const isBuy  = e.tx_type === "buy_asset"  && e.to_id   === asset.id;
      const isSell = e.tx_type === "sell_asset" && e.from_id === asset.id;
      const amt = Number(e.amount_idr || 0);
      return [e.tx_date, e.description || e.tx_type,
        isBuy ? "Purchase" : isSell ? "Sale" : e.tx_type,
        isBuy ? amt : "", isSell ? amt : "", ev._runValue];
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...rows]), "Transactions");
    XLSX.writeFile(wb, `${nm}_Statement_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const BTN = (extra = {}) => ({
    height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb",
    background: "#f9fafb", color: "#374151", fontSize: 12, fontWeight: 600,
    cursor: "pointer", fontFamily: FF, ...extra,
  });

  const ccAccs   = accounts.filter(a => a.is_active !== false && a.type === "credit_card");
  const bankAccs = accounts.filter(a => a.type === "bank" && a.subtype !== "cash" && a.is_active !== false);
  const cashAccs = accounts.filter(a => a.is_active !== false && a.subtype === "cash");

  // ── Grid constants ────────────────────────────────────────────
  const COLS    = "90px 1fr 90px 130px 130px 130px";
  const RP      = "0 14px";
  const HDR     = [
    { label: "Tanggal",    align: "left"  },
    { label: "Keterangan", align: "left"  },
    { label: "Jenis",      align: "left"  },
    { label: "Debit (▼)", align: "right" },
    { label: "Kredit (▲)", align: "right" },
    { label: "Nilai",      align: "right" },
  ];

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
          <button style={BTN({ background: "#111827", color: "#fff", border: "none" })}
            onClick={() => { setTxMode("add"); setTxInitial(null); setTxOpen(true); }}>
            + Transaction
          </button>
        </div>
      </div>

      {/* ── Metrics ── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <MetricCard label="Current Value"  value={fmtIDR(currentValue)} color="#3b5bdb" bg="#eff6ff" />
        <MetricCard label="Cost Basis"     value={fmtIDR(costBasis)}    color="#111827" bg="#f9fafb" />
        <MetricCard label="Unrealized P&L" value={`${unrealizedPL >= 0 ? "+" : ""}${fmtIDR(Math.abs(unrealizedPL))}`} color={plColor} bg={plBg} />
        <MetricCard label="Return %"       value={`${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`} color={plColor} bg={plBg} />
      </div>

      {/* ── Sparkline chart ── */}
      {sparkData.length >= 2 && (
        <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", padding: "16px 16px 8px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>
            Value History
          </div>
          <ResponsiveContainer width="100%" height={120}>
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

      {/* ── Statement grid ── */}
      <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>

        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderBottom: "0.5px solid #e5e7eb", padding: RP }}>
          {HDR.map(({ label, align }) => (
            <div key={label} style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF, padding: "9px 6px", textAlign: align }}>
              {label}
            </div>
          ))}
        </div>

        {histLoading ? (
          <div style={{ textAlign: "center", padding: 32, color: "#9ca3af", fontSize: 13 }}>Loading…</div>
        ) : allEvents.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <EmptyState icon="📋" message="No history for this asset yet" />
          </div>
        ) : (
          <>
            {grouped.map(([date, events]) => (
              <div key={date}>
                {/* Date header */}
                <div style={{ background: "#f3f4f6", borderBottom: "0.5px solid #e5e7eb", padding: "5px 20px", fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: FF }}>
                  {fmtDateLabel(date)}
                </div>

                {events.map((ev, idx) => {
                  if (ev._type === "value_update") {
                    const h    = ev.data;
                    const diff = ev.newVal - ev.oldVal;
                    const up   = diff >= 0;
                    return (
                      <div key={`vh-${h.id || idx}`} style={{ display: "grid", gridTemplateColumns: COLS, borderBottom: "0.5px solid #f3f4f6", padding: RP, alignItems: "center" }}>
                        {/* Tanggal */}
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px", whiteSpace: "nowrap" }}>
                          {fmtDateShort(date)}
                        </div>
                        {/* Keterangan */}
                        <div style={{ padding: "8px 6px", minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", fontFamily: FF }}>
                            {h.notes && h.notes !== "Manual update" ? h.notes : "Update Nilai"}
                          </div>
                          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 2 }}>
                            {fmtIDR(ev.oldVal)} → {fmtIDR(ev.newVal)}
                          </div>
                          {h.id && (
                            <button onClick={() => { setDelVH(h); setDelEntry(null); setDelConfirm(true); }}
                              style={{ marginTop: 3, fontSize: 9, padding: "1px 7px", borderRadius: 5, border: "1px solid #fee2e2", background: "#fff5f5", color: "#dc2626", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                              Delete
                            </button>
                          )}
                        </div>
                        {/* Jenis */}
                        <div style={{ padding: "8px 6px" }}>
                          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: FF, background: "#f0f9ff", color: "#0369a1", borderRadius: 4, padding: "2px 6px" }}>
                            Update
                          </span>
                        </div>
                        {/* Debit */}
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                          {!up ? fmtIDR(Math.abs(diff)) : <span style={{ color: "#d1d5db" }}>—</span>}
                        </div>
                        {/* Kredit */}
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#059669", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                          {up ? fmtIDR(diff) : <span style={{ color: "#d1d5db" }}>—</span>}
                        </div>
                        {/* Nilai */}
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#3b5bdb", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                          {fmtIDR(ev.newVal)}
                        </div>
                      </div>
                    );
                  }

                  // Ledger row
                  const e     = ev.data;
                  const isBuy  = e.tx_type === "buy_asset"  && e.to_id   === asset.id;
                  const isSell = e.tx_type === "sell_asset" && e.from_id === asset.id;
                  const other  = accounts.find(a => a.id === (isBuy ? e.from_id : e.to_id));
                  const amt    = Number(e.amount_idr || 0);
                  const badge  = isBuy ? { label: "Purchase", bg: "#e0f2fe", color: "#0369a1" }
                               : isSell ? { label: "Sale", bg: "#fef9c3", color: "#92400e" }
                               : { label: e.tx_type, bg: "#f3f4f6", color: "#6b7280" };
                  return (
                    <div key={`tx-${e.id}`} style={{ display: "grid", gridTemplateColumns: COLS, borderBottom: "0.5px solid #f3f4f6", padding: RP, alignItems: "center" }}>
                      {/* Tanggal */}
                      <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, padding: "8px 6px", whiteSpace: "nowrap" }}>
                        {fmtDateShort(e.tx_date)}
                      </div>
                      {/* Keterangan */}
                      <div style={{ padding: "8px 6px", minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "#111827", fontFamily: FF, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {e.description || (isBuy ? "Asset Purchase" : isSell ? "Asset Sale" : e.tx_type)}
                        </div>
                        {other && (
                          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: FF, marginTop: 2 }}>
                            {isBuy ? `← from ${other.name}` : `→ to ${other.name}`}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 5, marginTop: 3 }}>
                          <button onClick={() => { setTxMode("edit"); setTxInitial(e); setTxOpen(true); }}
                            style={{ fontSize: 9, padding: "1px 7px", borderRadius: 5, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#374151", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                            Edit
                          </button>
                          <button onClick={() => { setDelEntry(e); setDelVH(null); setDelConfirm(true); }}
                            style={{ fontSize: 9, padding: "1px 7px", borderRadius: 5, border: "1px solid #fee2e2", background: "#fff5f5", color: "#dc2626", cursor: "pointer", fontFamily: FF, fontWeight: 600 }}>
                            Delete
                          </button>
                        </div>
                      </div>
                      {/* Jenis */}
                      <div style={{ padding: "8px 6px" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, fontFamily: FF, background: badge.bg, color: badge.color, borderRadius: 4, padding: "2px 6px", whiteSpace: "nowrap" }}>
                          {badge.label}
                        </span>
                      </div>
                      {/* Debit */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#dc2626", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                        {isBuy ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                      </div>
                      {/* Kredit */}
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#059669", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                        {isSell ? fmtIDR(amt) : <span style={{ color: "#d1d5db" }}>—</span>}
                      </div>
                      {/* Nilai */}
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", fontFamily: FF, padding: "8px 6px", textAlign: "right" }}>
                        <span style={{ color: "#d1d5db" }}>—</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Closing row */}
            <div style={{ display: "grid", gridTemplateColumns: COLS, background: "#f9fafb", borderTop: "1.5px solid #e5e7eb", padding: RP }}>
              <div style={{ padding: "9px 6px" }} />
              <div style={{ fontSize: 11, fontWeight: 800, color: "#111827", fontFamily: FF, padding: "9px 6px" }}>Current Value</div>
              <div /><div /><div />
              <div style={{ fontSize: 13, fontWeight: 800, color: "#3b5bdb", fontFamily: FF, padding: "9px 6px", textAlign: "right" }}>
                {fmtIDR(currentValue)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Footer ── */}
      {allEvents.length > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: FF }}>
            {allEvents.length} event{allEvents.length !== 1 ? "s" : ""}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: plColor, fontFamily: FF }}>
            P&L: {unrealizedPL >= 0 ? "+" : ""}{fmtIDR(Math.abs(unrealizedPL))} ({returnPct >= 0 ? "+" : ""}{returnPct.toFixed(1)}%)
          </span>
        </div>
      )}

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

      {/* ── TxVerticalBig ── */}
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
