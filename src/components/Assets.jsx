import { useState, useMemo } from "react";
import { accountsApi } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { ASSET_SUBTYPES, ASSET_ICON, ASSET_COL } from "../constants";
import { LIGHT, DARK } from "../theme";
import {
  Modal, Button,
  Field, AmountInput, Input, FormRow,
  Select,
  SectionHeader, EmptyState, showToast,
} from "./shared/index";

// ─── PROGRESS BAR ─────────────────────────────────────────────
function ProgressBar({ value, max, color = "#059669", height = 6 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "#e5e7eb", borderRadius: 99, height, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
    </div>
  );
}

// ─── PURE DIV DONUT CHART ─────────────────────────────────────
// Renders a conic-gradient donut — no recharts dependency
function DonutChart({ data, colors, size = 120, thickness = 24 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;

  // Build conic-gradient stops
  let angle = 0;
  const stops = [];
  data.forEach((d, i) => {
    const deg = (d.value / total) * 360;
    const col = colors[i % colors.length];
    stops.push(`${col} ${angle.toFixed(1)}deg ${(angle + deg).toFixed(1)}deg`);
    angle += deg;
  });

  const half = size / 2;
  const inner = size - thickness * 2;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {/* Outer donut via conic-gradient */}
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: `conic-gradient(${stops.join(", ")})`,
      }} />
      {/* Inner hole */}
      <div style={{
        position: "absolute",
        top: thickness, left: thickness,
        width: inner, height: inner,
        borderRadius: "50%",
        background: "inherit",
        backgroundColor: "white",
      }} />
      {/* Center label */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        pointerEvents: "none",
      }}>
        <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, lineHeight: 1 }}>ASSETS</div>
        <div style={{ fontSize: 11, color: "#111827", fontWeight: 800, lineHeight: 1.2 }}>
          {data.length}
        </div>
      </div>
    </div>
  );
}

const SUBTABS = [
  { id: "overview", label: "Overview" },
  { id: "assets",   label: "Assets"   },
];

export default function Assets({ user, accounts, setAccounts, dark }) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab]     = useState("overview");
  const [saving, setSaving]     = useState(false);

  // Update value modal
  const [updateModal, setUpdateModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [updateForm, setUpdateForm] = useState({ value: "", date: todayStr(), notes: "" });

  // Add asset modal
  const emptyAssetForm = () => ({ name: "", subtype: "", current_value: "", purchase_price: "", notes: "" });
  const [addAssetModal, setAddAssetModal] = useState(false);
  const [addAssetForm, setAddAssetForm]   = useState(emptyAssetForm());
  const setAF = (k, v) => setAddAssetForm(f => ({ ...f, [k]: v }));

  // ── DERIVED ────────────────────────────────────────────────
  const assets = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);

  const totalAssets = assets.reduce((s, a) => s + Number(a.current_value || 0), 0);
  const netAssets   = totalAssets;
  const totalPurchase = assets.reduce((s, a) => s + Number(a.purchase_price || 0), 0);
  const totalGain     = totalAssets - totalPurchase;

  // Breakdown by category for donut
  const byCategory = useMemo(() => {
    const map = {};
    assets.forEach(a => {
      const key = a.subtype || "Other";
      map[key] = (map[key] || 0) + Number(a.current_value || 0);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .filter(x => x.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [assets]);

  const donutColors = byCategory.map(c => ASSET_COL[c.name] || "#9ca3af");

  // ── ACTIONS ───────────────────────────────────────────────
  const openUpdateModal = (asset) => {
    setSelectedAsset(asset);
    setUpdateForm({ value: String(asset.current_value || ""), date: todayStr(), notes: "" });
    setUpdateModal(true);
  };

  const handleUpdateValue = async () => {
    if (!updateForm.value || !selectedAsset) return;
    setSaving(true);
    try {
      const newVal = Number(updateForm.value);
      await accountsApi.update(selectedAsset.id, { current_value: newVal });
      setAccounts(prev => prev.map(a =>
        a.id === selectedAsset.id ? { ...a, current_value: newVal } : a
      ));
      showToast(`${selectedAsset.name} updated to ${fmtIDR(newVal, true)}`);
      setUpdateModal(false);
    } catch (e) {
      showToast(e.message, "error");
    }
    setSaving(false);
  };

  const handleAddAsset = async () => {
    if (!addAssetForm.name) return showToast("Asset name is required", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? null : n; };
      const data = {
        name:           addAssetForm.name.trim(),
        subtype:        addAssetForm.subtype || null,
        current_value:  sn(addAssetForm.current_value) ?? 0,
        purchase_price: sn(addAssetForm.purchase_price),
        notes:          addAssetForm.notes || null,
        type:           "asset",
        entity:         null,
        is_active:      true,
        sort_order:     accounts.length,
      };
      const created = await accountsApi.create(user.id, data);
      if (created) setAccounts(prev => [...prev, created]);
      showToast("Asset added");
      setAddAssetModal(false);
      setAddAssetForm(emptyAssetForm());
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── STYLES ────────────────────────────────────────────────
  const card = {
    background:   T.surface,
    border:       `1px solid ${T.border}`,
    borderRadius: 16,
    padding:      "16px 18px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button size="sm" onClick={() => { setAddAssetForm(emptyAssetForm()); setAddAssetModal(true); }}>
          + Add Asset
        </Button>
      </div>

      {/* ── SUB-TABS ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4 }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding:      "7px 16px",
              borderRadius: 99,
              border:       "none",
              cursor:       "pointer",
              fontSize:     13,
              fontWeight:   600,
              fontFamily:   "Figtree, sans-serif",
              background:   subTab === t.id ? T.text   : T.sur2,
              color:        subTab === t.id ? T.darkText : T.text2,
              transition:   "background .15s, color .15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── OVERVIEW ─────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Summary stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            <div style={{ background: T.assetBg || "#e8fdf0", borderRadius: 14, padding: "14px 14px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>Total Assets</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text, fontFamily: "Figtree, sans-serif" }}>{fmtIDR(totalAssets, true)}</div>
            </div>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: "14px 14px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>Unrealised P&amp;L</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: totalGain >= 0 ? "#059669" : "#dc2626", fontFamily: "Figtree, sans-serif" }}>{totalGain >= 0 ? "+" : ""}{fmtIDR(totalGain, true)}</div>
            </div>
            <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: "14px 14px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#3b5bdb", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>Net Value</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text, fontFamily: "Figtree, sans-serif" }}>{fmtIDR(netAssets, true)}</div>
            </div>
          </div>

          {/* Donut + category breakdown */}
          {byCategory.length > 0 ? (
            <div style={card}>
              <SectionHeader title="Asset Breakdown" />
              <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap", marginTop: 12 }}>
                <DonutChart data={byCategory} colors={donutColors} size={112} thickness={22} />
                <div style={{ flex: 1, minWidth: 140 }}>
                  {byCategory.map((c, i) => (
                    <div key={c.name} style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 8,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: 2,
                          background: donutColors[i],
                          flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 12, color: T.text2 }}>
                          {ASSET_ICON[c.name] || "📦"} {c.name}
                        </span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>
                        {fmtIDR(c.value, true)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState icon="📈" message="No assets yet. Tap '+ Add Asset' to get started." />
          )}

          {/* Cost basis row */}
          {totalPurchase > 0 && (
            <div style={{ ...card, padding: "10px 14px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Cost Basis</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{fmtIDR(totalPurchase, true)}</div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── ASSETS TAB ───────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "assets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {assets.length === 0 ? (
            <EmptyState icon="📈" message="No assets yet. Tap '+ Add Asset' to get started." />
          ) : (
            assets.map(a => {
              const cur     = Number(a.current_value || 0);
              const bought  = Number(a.purchase_price || 0);
              const gain    = cur - bought;
              const gainPct = bought > 0 ? (gain / bought) * 100 : 0;
              const col     = ASSET_COL[a.subtype] || T.ac;

              return (
                <div key={a.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    {/* Left */}
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: col + "22",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 20, flexShrink: 0,
                      }}>
                        {ASSET_ICON[a.subtype] || "📦"}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{a.name}</div>
                        <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                          {a.subtype || "Asset"}
                          {a.entity && a.entity !== "Personal" && (
                            <span style={{
                              marginLeft: 6,
                              background: T.sur2,
                              borderRadius: 4,
                              padding: "1px 5px",
                              fontSize: 10,
                              fontWeight: 600,
                              color: T.text2,
                            }}>
                              {a.entity}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right */}
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: col }}>
                        {fmtIDR(cur, true)}
                      </div>
                      {bought > 0 && (
                        <div style={{
                          fontSize: 11, fontWeight: 700, marginTop: 2,
                          color: gain >= 0 ? "#059669" : "#dc2626",
                        }}>
                          {gain >= 0 ? "▲" : "▼"} {fmtIDR(Math.abs(gain), true)}&nbsp;
                          <span style={{ fontWeight: 500 }}>
                            ({gain >= 0 ? "+" : ""}{gainPct.toFixed(1)}%)
                          </span>
                        </div>
                      )}
                      {bought > 0 && (
                        <div style={{ fontSize: 10, color: T.text3, marginTop: 1 }}>
                          Cost: {fmtIDR(bought, true)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Notes */}
                  {a.notes && (
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 8, fontStyle: "italic" }}>
                      {a.notes}
                    </div>
                  )}

                  {/* Action */}
                  <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openUpdateModal(a)}
                    >
                      ✏️ Update Value
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}


      {/* ══════════════════════════════════════════════════ */}
      {/* ── ADD ASSET MODAL ──────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      <Modal
        isOpen={addAssetModal}
        onClose={() => setAddAssetModal(false)}
        title="+ Add Asset"
        footer={<Button fullWidth onClick={handleAddAsset} busy={saving}>Add Asset →</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Asset Name *">
            <Input value={addAssetForm.name} onChange={e => setAF("name", e.target.value)} placeholder="e.g. Rumah Jagakarsa" />
          </Field>
          <Field label="Type">
            <Select
              value={addAssetForm.subtype}
              onChange={e => setAF("subtype", e.target.value)}
              options={ASSET_SUBTYPES.map(s => ({ value: s, label: `${ASSET_ICON[s] || "📦"} ${s}` }))}
              placeholder="Select type…"
            />
          </Field>
          <FormRow>
            <AmountInput label="Current Value (IDR)" value={addAssetForm.current_value} onChange={v => setAF("current_value", v)} currency="IDR" />
            <AmountInput label="Purchase Price (IDR)" value={addAssetForm.purchase_price} onChange={v => setAF("purchase_price", v)} currency="IDR" />
          </FormRow>
          <Field label="Notes">
            <Input value={addAssetForm.notes} onChange={e => setAF("notes", e.target.value)} placeholder="Optional notes…" />
          </Field>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── UPDATE VALUE MODAL ───────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      <Modal
        isOpen={updateModal}
        onClose={() => setUpdateModal(false)}
        title="Update Asset Value"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setUpdateModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              busy={saving}
              disabled={!updateForm.value}
              onClick={handleUpdateValue}
            >
              Update Value
            </Button>
          </div>
        }
      >
        {selectedAsset && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Current value banner */}
            <div style={{
              background: T.sur2, borderRadius: 10,
              padding: "10px 14px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{selectedAsset.name}</div>
                <div style={{ fontSize: 11, color: T.text3 }}>{selectedAsset.subtype}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: T.text3 }}>Current</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>
                  {fmtIDR(Number(selectedAsset.current_value || 0))}
                </div>
              </div>
            </div>

            <FormRow>
              <AmountInput
                label="New Value (IDR)"
                value={updateForm.value}
                onChange={v => setUpdateForm(f => ({ ...f, value: v }))}
                currency="IDR"
              />
              <Field label="Date">
                <Input
                  type="date"
                  value={updateForm.date}
                  onChange={e => setUpdateForm(f => ({ ...f, date: e.target.value }))}
                />
              </Field>
            </FormRow>

            <Field label="Notes">
              <Input
                value={updateForm.notes}
                onChange={e => setUpdateForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Annual appraisal"
              />
            </Field>

            {/* Change preview */}
            {updateForm.value && (
              <div style={{
                fontSize: 12, fontWeight: 700,
                color: Number(updateForm.value) >= Number(selectedAsset.current_value || 0)
                  ? "#059669" : "#dc2626",
                padding: "6px 10px", borderRadius: 8, background: T.sur2,
              }}>
                Change: {Number(updateForm.value) >= Number(selectedAsset.current_value || 0) ? "+" : ""}
                {fmtIDR(Number(updateForm.value) - Number(selectedAsset.current_value || 0), true)}
              </div>
            )}
          </div>
        )}
      </Modal>

    </div>
  );
}
