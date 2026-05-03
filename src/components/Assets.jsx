import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { accountsApi, ledgerApi, getTxFromToTypes } from "../api";
import { supabase } from "../lib/supabase";
import { fmtIDR, todayStr } from "../utils";
import { ASSET_SUBTYPES, ASSET_ICON, ASSET_COL } from "../constants";
import { LIGHT, DARK } from "../theme";
import {
  Modal, Button,
  Field, AmountInput, Input, FormRow,
  Select,
  SectionHeader, EmptyState, showToast,
  SortDropdown,
} from "./shared/index";

// ─── CONSTANTS ────────────────────────────────────────────────
const ACCT_BTN = {
  height: 30, padding: "0 12px", borderRadius: 8, border: "1px solid #e5e7eb",
  background: "#f9fafb", color: "#374151", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
};

// ─── PURE DIV DONUT CHART ─────────────────────────────────────
function DonutChart({ data, colors, size = 120, thickness = 24 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  let angle = 0;
  const stops = [];
  data.forEach((d, i) => {
    const deg = (d.value / total) * 360;
    stops.push(`${colors[i % colors.length]} ${angle.toFixed(1)}deg ${(angle + deg).toFixed(1)}deg`);
    angle += deg;
  });
  const inner = size - thickness * 2;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <div style={{ width: size, height: size, borderRadius: "50%", background: `conic-gradient(${stops.join(", ")})` }} />
      <div style={{ position: "absolute", top: thickness, left: thickness, width: inner, height: inner, borderRadius: "50%", backgroundColor: "white" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, lineHeight: 1 }}>ASSETS</div>
        <div style={{ fontSize: 11, color: "#111827", fontWeight: 800, lineHeight: 1.2 }}>{data.length}</div>
      </div>
    </div>
  );
}

// ─── ASSET HISTORY MODAL CONTENT ─────────────────────────────
function AssetHistory({ asset, ledger, accounts }) {
  const [valueHistory, setValueHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!asset?.id) return;
    setLoading(true);
    supabase
      .from("asset_value_history")
      .select("*")
      .eq("account_id", asset.id)
      .order("date", { ascending: false })
      .then(({ data, error }) => {
        setValueHistory(data || []);
        setLoading(false);
      });
  }, [asset?.id]);

  const txEntries = ledger.filter(e => e.from_id === asset.id || e.to_id === asset.id);

  // Merge: value history rows + ledger tx rows, sorted by date desc
  const allRows = [
    ...valueHistory.map(h => ({ _type: "value", _date: h.date || h.created_at || "", ...h })),
    ...txEntries.map(e  => ({ _type: "tx",    _date: e.tx_date || "",                 ...e })),
  ].sort((a, b) => (b._date > a._date ? 1 : b._date < a._date ? -1 : 0));

  if (loading) return (
    <div style={{ textAlign: "center", padding: 24, color: "#9ca3af", fontFamily: "Figtree, sans-serif", fontSize: 13 }}>
      Loading…
    </div>
  );

  if (allRows.length === 0) return (
    <EmptyState icon="📋" message="No history for this asset yet" />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {allRows.map(row => {
        if (row._type === "value") {
          const oldVal = Number(row.old_value || 0);
          const newVal = Number(row.new_value || 0);
          const diff   = newVal - oldVal;
          const up     = diff >= 0;
          return (
            <div key={`vh-${row.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#f9fafb", borderRadius: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                    Value Updated
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "#f3f4f6", color: "#6b7280", textTransform: "uppercase" }}>
                    UPDATE
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                  {row.date} · {fmtIDR(oldVal, true)} → {fmtIDR(newVal, true)}
                  {row.notes && row.notes !== "Manual update" ? ` · ${row.notes}` : ""}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: up ? "#059669" : "#dc2626", fontFamily: "Figtree, sans-serif", flexShrink: 0, marginLeft: 12 }}>
                {up ? "▲ +" : "▼ −"}{fmtIDR(Math.abs(diff), true)}
              </div>
            </div>
          );
        }

        // Ledger tx row
        const e = row;
        const isFrom = e.from_id === asset.id;
        const amt    = Number(e.amount_idr || e.amount || 0);
        const other  = accounts.find(a => a.id === (isFrom ? e.to_id : e.from_id));
        const isBuy  = e.tx_type === "buy_asset";
        const isSell = e.tx_type === "sell_asset";
        const typeLabel = isBuy ? "Buy" : isSell ? "Sell" : e.tx_type || "";
        const color = isFrom ? "#dc2626" : "#059669";
        return (
          <div key={`tx-${e.id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "#f9fafb", borderRadius: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                  {e.description || "—"}
                </span>
                {typeLabel && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: isBuy ? "#e0f2fe" : isSell ? "#fef9c3" : "#f3f4f6", color: isBuy ? "#0369a1" : isSell ? "#92400e" : "#6b7280", textTransform: "uppercase" }}>
                    {typeLabel}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                {e.tx_date}{other && ` · ${isFrom ? "→" : "←"} ${other.name}`}
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "Figtree, sans-serif", flexShrink: 0, marginLeft: 12 }}>
              {isFrom ? "−" : "+"}{fmtIDR(amt, true)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── ASSET CARD ───────────────────────────────────────────────
function AssetCard({ asset: a, ledger, valueHistoryCount = 0, color, onUpdate, onTimeline }) {
  const cur      = Number(a.current_value || 0);
  const bought   = Number(a.purchase_price || 0);
  const gain     = cur - bought;
  const gainPct  = bought > 0 ? (gain / bought) * 100 : 0;
  const icon     = ASSET_ICON[a.subtype] || "📦";

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Color bar */}
      <div style={{ height: 3, background: color }} />
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
        {/* Icon + Name */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {a.name}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
              {a.subtype || "Asset"}
            </div>
          </div>
        </div>

        {/* Value */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 3 }}>Current Value</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#3b5bdb", fontFamily: "Figtree, sans-serif", lineHeight: 1.1 }}>
            {fmtIDR(cur)}
          </div>
          {bought > 0 && (
            <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                Cost: {fmtIDR(bought, true)}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: gain >= 0 ? "#059669" : "#dc2626", fontFamily: "Figtree, sans-serif" }}>
                {gain >= 0 ? "▲" : "▼"} {fmtIDR(Math.abs(gain), true)}&nbsp;
                <span style={{ fontWeight: 500 }}>({gain >= 0 ? "+" : ""}{gainPct.toFixed(1)}%)</span>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
          <button onClick={onUpdate}   style={ACCT_BTN}>Update Value</button>
          <button onClick={onTimeline} style={{ ...ACCT_BTN, flex: 1 }}>📋 Timeline</button>
        </div>
      </div>
    </div>
  );
}

// ─── DEPOSITO CARD ────────────────────────────────────────────
function DepositoCard({ asset: a, color, onUpdate, onEdit }) {
  const principal = Number(a.current_value || 0);
  const rate      = Number(a.interest_rate || 0);

  const today    = new Date();
  const daysLeft = a.maturity_date
    ? Math.ceil((new Date(a.maturity_date + "T00:00:00") - today) / 86400000)
    : null;
  const maturityStr = a.maturity_date
    ? new Date(a.maturity_date + "T00:00:00").toLocaleDateString("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : null;
  const matColor = daysLeft !== null
    ? (daysLeft <= 0 ? "#dc2626" : daysLeft <= 30 ? "#d97706" : "#9ca3af")
    : "#9ca3af";

  return (
    <div style={{ background: "#fff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 3, background: color }} />
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        {/* Header: name + badge */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: color + "22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
            🏦
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.name}
              </div>
              <span style={{ fontSize: 9, fontWeight: 700, background: "#dbeafe", color: "#2563eb", padding: "2px 6px", borderRadius: 4, fontFamily: "Figtree, sans-serif", flexShrink: 0 }}>
                Deposito
              </span>
            </div>
            {a.bank_name && (
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                {a.bank_name}
              </div>
            )}
          </div>
        </div>

        {/* Value */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 3 }}>Current Value</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#2563eb", fontFamily: "Figtree, sans-serif", lineHeight: 1.1 }}>
            {fmtIDR(principal)}
          </div>
        </div>

        {/* Info rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rate > 0 && (
            <div style={{ fontSize: 11, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
              Bunga: <strong>{rate}% p.a.</strong>
            </div>
          )}
          {maturityStr && (
            <div style={{ fontSize: 11, fontFamily: "Figtree, sans-serif" }}>
              <span style={{ color: "#374151" }}>Jatuh tempo: </span>
              <strong style={{ color: matColor }}>{maturityStr}</strong>
              {daysLeft !== null && (
                <span style={{ marginLeft: 5, fontWeight: 700, color: matColor }}>
                  · {daysLeft > 0 ? `${daysLeft} hari lagi` : "⚠️ Jatuh tempo"}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
          <button onClick={onUpdate} style={ACCT_BTN}>Update Value</button>
          <button onClick={onEdit}   style={{ ...ACCT_BTN, flex: 1 }}>✏️ Edit</button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────
export default function Assets({ user, accounts, setAccounts, dark, ledger = [], setLedger, categories = [], fxRates = {}, CURRENCIES = [], onRefresh }) {
  const T = dark ? DARK : LIGHT;

  const [saving, setSaving] = useState(false);

  // Update value modal
  const [updateModal,   setUpdateModal]   = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [updateForm,    setUpdateForm]    = useState({ value: "", date: todayStr(), notes: "" });

  const navigate = useNavigate();

  // asset_value_history counts per account_id
  const [valueHistoryCounts, setValueHistoryCounts] = useState({});

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("asset_value_history")
      .select("account_id")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (!data) return;
        const counts = {};
        data.forEach(r => { counts[r.account_id] = (counts[r.account_id] || 0) + 1; });
        setValueHistoryCounts(counts);
      });
  }, [user?.id]);

  // Add asset modal
  const emptyAssetForm = () => ({
    name: "", subtype: "", current_value: "", purchase_price: "", notes: "",
    bank_name: "", interest_rate: "", maturity_date: "", currency: "IDR",
  });
  const [addAssetModal, setAddAssetModal] = useState(false);
  const [addAssetForm,  setAddAssetForm]  = useState(emptyAssetForm());
  const setAF = (k, v) => setAddAssetForm(f => ({ ...f, [k]: v }));

  // Edit deposito modal
  const [editDepositoModal, setEditDepositoModal] = useState(null); // deposito account
  const [editDepositoForm,  setEditDepositoForm]  = useState({});
  const setEDF = (k, v) => setEditDepositoForm(f => ({ ...f, [k]: v }));

  // ── DERIVED ─────────────────────────────────────────────────
  const assets = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);

  const totalValue    = assets.reduce((s, a) => s + Number(a.current_value  || 0), 0);
  const totalCost     = assets.reduce((s, a) => s + Number(a.purchase_price || 0), 0);
  const totalPL       = totalValue - totalCost;

  const byCategory = useMemo(() => {
    const map = {};
    assets.forEach(a => { const k = a.subtype || "Other"; map[k] = (map[k] || 0) + Number(a.current_value || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
  }, [assets]);

  const donutColors = byCategory.map(c => ASSET_COL[c.name] || "#9ca3af");

  const [assetSort, setAssetSort] = useState(() => localStorage.getItem("sort_assets") || "value_desc");

  const ASSET_SORT_PILLS = [
    { key: "value", label: "Value", defaultDir: "desc" },
    { key: "gain",  label: "Gain",  defaultDir: "desc" },
    { key: "name",  label: "Name",  defaultDir: "asc"  },
  ];

  const sorted = useMemo(() => {
    const indexed = assets.map((a, i) => ({ a, i }));
    indexed.sort((x, y) => {
      switch (assetSort) {
        case "value_asc":  return Number(x.a.current_value || 0) - Number(y.a.current_value || 0);
        case "gain_desc":  return (Number(y.a.current_value || 0) - Number(y.a.purchase_price || 0)) - (Number(x.a.current_value || 0) - Number(x.a.purchase_price || 0));
        case "gain_asc":   return (Number(x.a.current_value || 0) - Number(x.a.purchase_price || 0)) - (Number(y.a.current_value || 0) - Number(y.a.purchase_price || 0));
        case "name_asc":   return (x.a.name || "").localeCompare(y.a.name || "");
        case "name_desc":  return (y.a.name || "").localeCompare(x.a.name || "");
        default:           return Number(y.a.current_value || 0) - Number(x.a.current_value || 0);
      }
    });
    return indexed;
  }, [assets, assetSort]);

  // ── ACTIONS ─────────────────────────────────────────────────
  const openUpdateModal = (asset) => {
    setSelectedAsset(asset);
    setUpdateForm({ value: String(asset.current_value || ""), date: todayStr(), notes: "" });
    setUpdateModal(true);
  };

  const handleUpdateValue = async () => {
    if (!updateForm.value || !selectedAsset) return;
    setSaving(true);
    try {
      const accountId  = selectedAsset.id;
      const newVal     = Number(updateForm.value);
      const selectedDate = updateForm.date || todayStr();
      const notes      = updateForm.notes || null;

      // Fetch current value before updating
      const { data: current } = await supabase
        .from("accounts")
        .select("current_value")
        .eq("id", accountId)
        .single();
      const oldValue = current?.current_value || 0;

      // Update the account's current value
      await supabase
        .from("accounts")
        .update({ current_value: newVal })
        .eq("id", accountId);

      // Insert history record
      const { data: histRow, error: histErr } = await supabase
        .from("asset_value_history")
        .insert({
          account_id: accountId,
          user_id:    user.id,
          old_value:  oldValue,
          new_value:  newVal,
          date:       selectedDate,
          notes:      notes || "Manual update",
        })
        .select()
        .single();

      if (histErr) {
        console.error("[handleUpdateValue] asset_value_history insert failed:", histErr);
        throw new Error(histErr.message);
      }

      setValueHistoryCounts(prev => ({ ...prev, [accountId]: (prev[accountId] || 0) + 1 }));
      setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, current_value: newVal } : a));
      showToast(`${selectedAsset.name} updated to ${fmtIDR(newVal, true)}`);
      setUpdateModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleAddAsset = async () => {
    if (!addAssetForm.name) return showToast("Asset name is required", "error");
    setSaving(true);
    try {
      const sn  = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? null : n; };
      const isDeposito = addAssetForm.subtype === "Deposito";
      const data = {
        name:           addAssetForm.name.trim(),
        subtype:        addAssetForm.subtype || null,
        current_value:  sn(addAssetForm.current_value) ?? 0,
        purchase_price: isDeposito ? (sn(addAssetForm.current_value) ?? 0) : (sn(addAssetForm.purchase_price) ?? 0),
        notes:          addAssetForm.notes || null,
        type:           "asset",
        is_active:      true,
        sort_order:     accounts.length,
        ...(isDeposito && {
          bank_name:     addAssetForm.bank_name || null,
          interest_rate: sn(addAssetForm.interest_rate),
          maturity_date: addAssetForm.maturity_date || null,
          currency:      addAssetForm.currency || "IDR",
        }),
      };
      const created = await accountsApi.create(user.id, data);
      if (created) setAccounts(prev => [...prev, created]);
      showToast("Asset added");
      setAddAssetModal(false);
      setAddAssetForm(emptyAssetForm());
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const openEditDeposito = (asset) => {
    setEditDepositoModal(asset);
    setEditDepositoForm({
      name:          asset.name || "",
      bank_name:     asset.bank_name || "",
      current_value: String(asset.current_value || ""),
      interest_rate: String(asset.interest_rate || ""),
      maturity_date: asset.maturity_date || "",
      notes:         asset.notes || "",
    });
  };

  const handleSaveDeposito = async () => {
    if (!editDepositoModal) return;
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? null : n; };
      const updated = await accountsApi.update(editDepositoModal.id, {
        name:          editDepositoForm.name.trim(),
        bank_name:     editDepositoForm.bank_name || null,
        current_value: sn(editDepositoForm.current_value) ?? 0,
        interest_rate: sn(editDepositoForm.interest_rate),
        maturity_date: editDepositoForm.maturity_date || null,
        notes:         editDepositoForm.notes || null,
      });
      if (updated) setAccounts(prev => prev.map(a => a.id === editDepositoModal.id ? { ...a, ...updated } : a));
      showToast("Deposito updated");
      setEditDepositoModal(null);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button size="sm" onClick={() => { setAddAssetForm(emptyAssetForm()); setAddAssetModal(true); }}>
          + Add Asset
        </Button>
      </div>

      {/* ── SUMMARY CARDS ────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {[
          { label: "Total Value",  value: fmtIDR(totalValue, true), color: "#059669", bg: "#e8fdf0" },
          { label: "Total Cost",   value: fmtIDR(totalCost,  true), color: "#6b7280", bg: T.surface, border: `1px solid ${T.border}` },
          { label: "Unrealised P&L", value: (totalPL >= 0 ? "+" : "") + fmtIDR(Math.abs(totalPL), true), color: totalPL >= 0 ? "#059669" : "#dc2626", bg: T.surface, border: `1px solid ${T.border}` },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, border: s.border, borderRadius: 14, padding: "14px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.85 }}>{s.label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: totalPL < 0 && s.label === "Unrealised P&L" ? "#dc2626" : "#111827", fontFamily: "Figtree, sans-serif", lineHeight: 1.2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {assets.length === 0 ? (
        <EmptyState icon="📈" message="No assets yet. Tap '+ Add Asset' to get started." />
      ) : (
        <>
          {/* ── DONUT + BREAKDOWN ──────────────────────────── */}
          {byCategory.length > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, padding: "16px 18px" }}>
              <SectionHeader title="Breakdown by Type" />
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
                <DonutChart data={byCategory} colors={donutColors} size={112} thickness={22} />
                <div style={{ flex: 1, minWidth: 140 }}>
                  {byCategory.map((c, i) => (
                    <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: donutColors[i], flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: T.text2, fontFamily: "Figtree, sans-serif" }}>{ASSET_ICON[c.name] || "📦"} {c.name}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>{fmtIDR(c.value, true)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── SORT + ASSET GRID ──────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <SortDropdown
              storageKey="sort_assets"
              options={ASSET_SORT_PILLS}
              value={assetSort}
              onChange={v => setAssetSort(v)}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {sorted.map(({ a, i }) => {
              const color = ASSET_COL[a.subtype] || "#9ca3af";
              if (a.subtype === "Deposito") {
                return (
                  <DepositoCard
                    key={a.id}
                    asset={a}
                    color={color}
                    onUpdate={() => openUpdateModal(a)}
                    onEdit={() => openEditDeposito(a)}
                  />
                );
              }
              return (
                <AssetCard
                  key={a.id}
                  asset={a}
                  ledger={ledger}
                  valueHistoryCount={valueHistoryCounts[a.id] || 0}
                  color={color}
                  onUpdate={() => openUpdateModal(a)}
                  onTimeline={() => navigate(`/accounts/${a.id}/statement`)}
                />
              );
            })}
          </div>
        </>
      )}

      {/* ── UPDATE VALUE MODAL ───────────────────────────── */}
      <Modal
        isOpen={updateModal}
        onClose={() => setUpdateModal(false)}
        title="Update Asset Value"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setUpdateModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={saving} disabled={!updateForm.value} onClick={handleUpdateValue}>
              Update Value
            </Button>
          </div>
        }
      >
        {selectedAsset && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: T.sur2, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>{selectedAsset.name}</div>
                <div style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif" }}>{selectedAsset.subtype}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif" }}>Current</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.text, fontFamily: "Figtree, sans-serif" }}>{fmtIDR(Number(selectedAsset.current_value || 0))}</div>
              </div>
            </div>
            <FormRow>
              <AmountInput label="New Value (IDR)" value={updateForm.value} onChange={v => setUpdateForm(f => ({ ...f, value: v }))} currency="IDR" />
              <Field label="Date">
                <Input type="date" value={updateForm.date} onChange={e => setUpdateForm(f => ({ ...f, date: e.target.value }))} />
              </Field>
            </FormRow>
            <Field label="Notes">
              <Input value={updateForm.notes} onChange={e => setUpdateForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Annual appraisal" />
            </Field>
            {updateForm.value && (
              <div style={{ fontSize: 12, fontWeight: 700, color: Number(updateForm.value) >= Number(selectedAsset.current_value || 0) ? "#059669" : "#dc2626", padding: "6px 10px", borderRadius: 8, background: T.sur2, fontFamily: "Figtree, sans-serif" }}>
                Change: {Number(updateForm.value) >= Number(selectedAsset.current_value || 0) ? "+" : ""}
                {fmtIDR(Number(updateForm.value) - Number(selectedAsset.current_value || 0), true)}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── ADD ASSET MODAL ──────────────────────────────── */}
      <Modal
        isOpen={addAssetModal}
        onClose={() => setAddAssetModal(false)}
        title="+ Add Asset"
        footer={<Button fullWidth onClick={handleAddAsset} busy={saving}>Add Asset →</Button>}
      >
        {(() => {
          const isDeposito = addAssetForm.subtype === "Deposito";
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Asset Name *">
                <Input value={addAssetForm.name} onChange={e => setAF("name", e.target.value)}
                  placeholder={isDeposito ? "e.g. BCA Deposito 3 bulan" : "e.g. Rumah Jagakarsa"} />
              </Field>
              <Field label="Type">
                <Select
                  value={addAssetForm.subtype}
                  onChange={e => setAF("subtype", e.target.value)}
                  options={ASSET_SUBTYPES.map(s => ({ value: s, label: `${ASSET_ICON[s] || "📦"} ${s}` }))}
                  placeholder="Select type…"
                />
              </Field>

              {isDeposito ? (
                <>
                  <Input label="Nama Bank" value={addAssetForm.bank_name}
                    onChange={e => setAF("bank_name", e.target.value)} placeholder="e.g. BCA, Mandiri" />
                  <AmountInput label="Nominal *" value={addAssetForm.current_value}
                    onChange={v => setAF("current_value", v)} currency="IDR" />
                  <FormRow>
                    <Input label="Bunga (% p.a.)" type="number" value={addAssetForm.interest_rate}
                      onChange={e => setAF("interest_rate", e.target.value)} placeholder="5.5" style={{ flex: 1 }} />
                    <Input label="Jatuh Tempo" type="date" value={addAssetForm.maturity_date}
                      onChange={e => setAF("maturity_date", e.target.value)} style={{ flex: 1 }} />
                  </FormRow>
                </>
              ) : (
                <FormRow>
                  <AmountInput label="Current Value (IDR)" value={addAssetForm.current_value}
                    onChange={v => setAF("current_value", v)} currency="IDR" />
                  <AmountInput label="Purchase Price (IDR)" value={addAssetForm.purchase_price}
                    onChange={v => setAF("purchase_price", v)} currency="IDR" />
                </FormRow>
              )}

              <Field label="Notes">
                <Input value={addAssetForm.notes} onChange={e => setAF("notes", e.target.value)} placeholder="Optional notes…" />
              </Field>
            </div>
          );
        })()}
      </Modal>

      {/* ── EDIT DEPOSITO MODAL ──────────────────────────── */}
      <Modal
        isOpen={!!editDepositoModal}
        onClose={() => setEditDepositoModal(null)}
        title="Edit Deposito"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setEditDepositoModal(null)}>Cancel</Button>
            <Button variant="primary" size="md" busy={saving} onClick={handleSaveDeposito}>Save</Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Input label="Nama *" value={editDepositoForm.name || ""}
            onChange={e => setEDF("name", e.target.value)} />
          <Input label="Nama Bank" value={editDepositoForm.bank_name || ""}
            onChange={e => setEDF("bank_name", e.target.value)} placeholder="e.g. BCA, Mandiri" />
          <AmountInput label="Nominal (IDR)" value={editDepositoForm.current_value || ""}
            onChange={v => setEDF("current_value", v)} currency="IDR" />
          <FormRow>
            <Input label="Bunga (% p.a.)" type="number" value={editDepositoForm.interest_rate || ""}
              onChange={e => setEDF("interest_rate", e.target.value)} placeholder="5.5" style={{ flex: 1 }} />
            <Input label="Jatuh Tempo" type="date" value={editDepositoForm.maturity_date || ""}
              onChange={e => setEDF("maturity_date", e.target.value)} style={{ flex: 1 }} />
          </FormRow>
          <Field label="Notes">
            <Input value={editDepositoForm.notes || ""} onChange={e => setEDF("notes", e.target.value)} placeholder="Optional notes…" />
          </Field>
        </div>
      </Modal>

    </div>
  );
}
