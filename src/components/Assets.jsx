import { useState, useMemo } from "react";
import { accountsApi, ledgerApi, getTxFromToTypes } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { ASSET_SUBTYPES, ASSET_ICON, ASSET_COL, LIAB_SUBTYPES } from "../constants";
import { LIGHT, DARK } from "../theme";
import {
  Modal, Button,
  Field, AmountInput, Input, FormRow,
  Select,
  SectionHeader, EmptyState, Spinner, showToast,
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
  { id: "overview",    label: "Overview"     },
  { id: "assets",      label: "Assets"       },
  { id: "liabilities", label: "Liabilities"  },
];

export default function Assets({ user, accounts, ledger, onRefresh, setAccounts, setLedger, dark }) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab]     = useState("overview");
  const [saving, setSaving]     = useState(false);

  // Update value modal
  const [updateModal, setUpdateModal] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [updateForm, setUpdateForm] = useState({ value: "", date: todayStr(), notes: "" });

  // Pay liability modal
  const [payModal, setPayModal] = useState(false);
  const [payForm, setPayForm]   = useState({ liabId: "", bankId: "", amount: "", date: todayStr(), notes: "" });

  // ── DERIVED ────────────────────────────────────────────────
  const assets      = useMemo(() => accounts.filter(a => a.type === "asset"),       [accounts]);
  const liabilities = useMemo(() => accounts.filter(a => a.type === "liability"),   [accounts]);
  const bankAccounts= useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);

  const totalAssets   = assets.reduce((s, a) => s + Number(a.current_value || 0), 0);
  const totalLiab     = liabilities.reduce((s, l) => s + Number(l.outstanding_amount || 0), 0);
  const netAssets     = totalAssets - totalLiab;
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

  const openPayModal = (liabId = "") => {
    setPayForm({ liabId, bankId: "", amount: "", date: todayStr(), notes: "" });
    setPayModal(true);
  };

  const handlePayLiability = async () => {
    if (!payForm.liabId || !payForm.bankId || !payForm.amount)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt  = sn(payForm.amount);
      const liab = accounts.find(a => a.id === payForm.liabId);
      const entry = {
        tx_date:         payForm.date,
        description:     `Pay ${liab?.name || "Liability"}`,
        amount:          amt,
        currency:        "IDR",
        amount_idr:      amt,
        tx_type:         "pay_liability",
        from_type:       "account",
        to_type:         "account",
        from_id:         payForm.bankId,
        to_id:           payForm.liabId,
        entity:          liab?.entity || "Personal",
        notes:           payForm.notes || "",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);
      await onRefresh();
      showToast(`Paid ${fmtIDR(amt, true)} towards ${liab?.name}`);
      setPayModal(false);
    } catch (e) {
      showToast(e.message, "error");
    }
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

          {/* Hero */}
          <div style={{
            background:   "linear-gradient(135deg, #059669 0%, #0891b2 100%)",
            borderRadius: 20,
            padding:      "22px 22px 20px",
            color:        "#fff",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, opacity: .7, marginBottom: 4, letterSpacing: "0.06em" }}>
              NET ASSET VALUE
            </div>
            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em" }}>
              {fmtIDR(netAssets)}
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 14, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 10, opacity: .65, fontWeight: 600 }}>TOTAL ASSETS</div>
                <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{fmtIDR(totalAssets, true)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, opacity: .65, fontWeight: 600 }}>LIABILITIES</div>
                <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>−{fmtIDR(totalLiab, true)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, opacity: .65, fontWeight: 600 }}>UNREALISED</div>
                <div style={{
                  fontSize: 14, fontWeight: 800, marginTop: 2,
                  color: totalGain >= 0 ? "#a7f3d0" : "#fca5a5",
                }}>
                  {totalGain >= 0 ? "+" : ""}{fmtIDR(totalGain, true)}
                </div>
              </div>
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
            <EmptyState icon="📈" message="No assets yet. Add them from Accounts." />
          )}

          {/* Summary stats */}
          {(assets.length > 0 || liabilities.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ ...card, background: T.assetBg, border: "none" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", letterSpacing: "0.05em" }}>ASSETS</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: T.text, marginTop: 4 }}>{assets.length}</div>
                <div style={{ fontSize: 12, color: T.text2 }}>items</div>
              </div>
              <div style={{ ...card, background: T.ccBg, border: "none" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", letterSpacing: "0.05em" }}>LIABILITIES</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: T.text, marginTop: 4 }}>{liabilities.length}</div>
                <div style={{ fontSize: 12, color: T.text2 }}>items</div>
              </div>
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
            <EmptyState icon="📈" message="No assets yet. Add them from Accounts." />
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
      {/* ── LIABILITIES TAB ──────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "liabilities" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="primary" size="sm" onClick={() => openPayModal()}>
              + Make Payment
            </Button>
          </div>

          {liabilities.length === 0 ? (
            <EmptyState icon="📉" message="No liabilities. Add them from Accounts." />
          ) : (
            liabilities.map(l => {
              const outstanding = Number(l.outstanding_amount || 0);
              const original    = Number(l.total_amount || 0);
              const paid        = original > 0 ? original - outstanding : 0;
              const pct         = original > 0 ? (paid / original) * 100 : 0;

              return (
                <div key={l.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    {/* Left */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                        {[l.creditor, l.subtype, l.liability_interest_rate > 0 && `${l.liability_interest_rate}% p.a.`]
                          .filter(Boolean).join(" · ")}
                      </div>
                    </div>

                    {/* Right */}
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 10, color: T.text3, marginBottom: 2 }}>Outstanding</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "#e67700" }}>
                        {fmtIDR(outstanding, true)}
                      </div>
                      {l.monthly_payment > 0 && (
                        <div style={{ fontSize: 10, color: T.text3 }}>
                          {fmtIDR(l.monthly_payment, true)}/mo
                        </div>
                      )}
                    </div>
                  </div>

                  {original > 0 && (
                    <>
                      <ProgressBar value={paid} max={original} color="#059669" height={6} />
                      <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>
                        {pct.toFixed(1)}% paid &nbsp;·&nbsp;
                        {fmtIDR(paid, true)} of {fmtIDR(original, true)}
                      </div>
                    </>
                  )}

                  {l.end_date && (
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 4 }}>
                      Ends: {l.end_date}
                    </div>
                  )}

                  <div style={{ marginTop: 12 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => openPayModal(l.id)}
                    >
                      Make Payment →
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

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

      {/* ══════════════════════════════════════════════════ */}
      {/* ── PAY LIABILITY MODAL ──────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      <Modal
        isOpen={payModal}
        onClose={() => setPayModal(false)}
        title="Make Liability Payment"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setPayModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              busy={saving}
              disabled={!payForm.liabId || !payForm.bankId || !payForm.amount}
              onClick={handlePayLiability}
            >
              Record Payment
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Liability *">
            <Select
              value={payForm.liabId}
              onChange={e => {
                const liab = accounts.find(a => a.id === e.target.value);
                setPayForm(f => ({
                  ...f,
                  liabId: e.target.value,
                  amount: liab ? String(liab.monthly_payment || "") : f.amount,
                }));
              }}
              options={liabilities.map(l => ({
                value: l.id,
                label: `${l.name} — ${fmtIDR(l.outstanding_amount || 0, true)} remaining`,
              }))}
              placeholder="Select liability…"
            />
          </Field>

          <Field label="From Account *">
            <Select
              value={payForm.bankId}
              onChange={e => setPayForm(f => ({ ...f, bankId: e.target.value }))}
              options={bankAccounts.map(b => ({
                value: b.id,
                label: `${b.name} — ${fmtIDR(b.current_balance || 0, true)}`,
              }))}
              placeholder="Select account…"
            />
          </Field>

          <FormRow>
            <AmountInput
              label="Amount (IDR) *"
              value={payForm.amount}
              onChange={v => setPayForm(f => ({ ...f, amount: v }))}
              currency="IDR"
            />
            <Field label="Date">
              <Input
                type="date"
                value={payForm.date}
                onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))}
              />
            </Field>
          </FormRow>

          <Field label="Notes">
            <Input
              value={payForm.notes}
              onChange={e => setPayForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
            />
          </Field>
        </div>
      </Modal>

    </div>
  );
}
