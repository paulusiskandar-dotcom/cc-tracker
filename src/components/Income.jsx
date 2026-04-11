import { useState, useMemo } from "react";
import { ledgerApi, incomeSrcApi, getTxFromToTypes } from "../api";
import { fmtIDR, todayStr, ym, mlShort } from "../utils";
import { INCOME_CATEGORIES, ENTITIES, FREQUENCIES, CURRENCIES } from "../constants";
import { LIGHT, DARK } from "../theme";
import {
  Modal, Button,
  Field, AmountInput, Input, FormRow, Toggle,
  Select,
  SectionHeader, EmptyState, showToast,
  SortDropdown,
} from "./shared/index";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const SUBTABS = [
  { id: "sources",   label: "Sources"    },
  { id: "thismonth", label: "This Month" },
  { id: "cashflow",  label: "Cash Flow"  },
];

export default function Income({
  user, accounts, ledger, incomeSrcs, fxRates, curMonth,
  onRefresh, setLedger, setIncomeSrcs, dark,
}) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab]         = useState("sources");
  const [incSort, setIncSort]       = useState(() => localStorage.getItem("sort_income") || "amount_desc");
  const [saving, setSaving]         = useState(false);
  const [filterMonth, setFilterMonth] = useState(curMonth || ym(todayStr()));

  // Source modal
  const [srcModal, setSrcModal]     = useState(false);
  const [editSrcId, setEditSrcId]   = useState(null);
  const [srcForm, setSrcForm]       = useState({
    name: "", type: "Salary", expected_amount: "",
    currency: "IDR", frequency: "Monthly",
    to_account_id: "", entity: "Personal", is_active: true,
  });

  // Record income modal
  const [incModal, setIncModal]     = useState(false);
  const [incForm, setIncForm]       = useState({
    income_source_id: "", tx_date: todayStr(), description: "",
    amount: "", currency: "IDR", to_account_id: "", entity: "Personal", notes: "",
  });

  const bankAccounts = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const loanAccs     = useMemo(() =>
    accounts.filter(a => a.type === "receivable" && a.receivable_type === "employee_loan" && Number(a.receivable_outstanding || 0) > 0)
  , [accounts]);

  const totalLoanRecovery = loanAccs.reduce((s, l) => s + Number(l.monthly_installment || 0), 0);
  const incomeLedger      = useMemo(() => ledger.filter(e => e.tx_type === "income"), [ledger]);

  const thisMonthIncome   = useMemo(() =>
    incomeLedger.filter(e => ym(e.tx_date) === filterMonth)
  , [incomeLedger, filterMonth]);

  const totalThisMonth    = thisMonthIncome.reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
  const expectedThisMonth = incomeSrcs.filter(s => s.is_active).reduce((s, src) => s + Number(src.expected_amount || 0), 0)
    + totalLoanRecovery;

  // Cash flow — last 12 months
  const cashFlow = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      const m = d.toISOString().slice(0, 7);
      const income  = incomeLedger.filter(e => ym(e.tx_date) === m).reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
      const expense = ledger.filter(e => ym(e.tx_date) === m && e.tx_type === "expense").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
      return { month: mlShort(m), income, expense, surplus: income - expense };
    });
  }, [ledger, incomeLedger]);

  // ── ACTIONS ────────────────────────────────────────────────
  const openSrcModal = (src = null) => {
    if (src) {
      setEditSrcId(src.id);
      setSrcForm({ ...src, expected_amount: String(src.expected_amount || "") });
    } else {
      setEditSrcId(null);
      setSrcForm({ name: "", type: "Salary", expected_amount: "", currency: "IDR", frequency: "Monthly", to_account_id: "", entity: "Personal", is_active: true });
    }
    setSrcModal(true);
  };

  const saveSrc = async () => {
    if (!srcForm.name || !srcForm.expected_amount) return showToast("Fill name and amount", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const d = { ...srcForm, expected_amount: sn(srcForm.expected_amount) };
      if (editSrcId) {
        const r = await incomeSrcApi.update(editSrcId, d);
        setIncomeSrcs(prev => prev.map(s => s.id === editSrcId ? r : s));
        showToast("Income source updated");
      } else {
        const r = await incomeSrcApi.create(user.id, d);
        setIncomeSrcs(prev => [...prev, r]);
        showToast("Income source added");
      }
      setSrcModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const delSrc = async (id, name) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try {
      await incomeSrcApi.delete(id);
      setIncomeSrcs(prev => prev.filter(s => s.id !== id));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
  };

  const openIncModal = () => {
    setIncForm({
      income_source_id: "", tx_date: todayStr(), description: "",
      amount: "", currency: "IDR",
      to_account_id: bankAccounts[0]?.id || "",
      entity: "Personal", notes: "",
    });
    setIncModal(true);
  };

  const addIncome = async () => {
    if (!incForm.description || !incForm.amount || !incForm.to_account_id)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const sn2 = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn2(incForm.amount);
      const src = incomeSrcs.find(s => s.id === incForm.income_source_id);
      const entry = {
        tx_date:          incForm.tx_date,
        description:      incForm.description,
        amount:           amt,
        currency:         incForm.currency || "IDR",
        amount_idr:       amt,
        tx_type:          "income",
        from_type:        "income_source",
        to_type:          "account",
        from_id:          incForm.income_source_id || null,
        to_id:            incForm.to_account_id,
        entity:           incForm.entity || "Personal",
        notes:            incForm.notes || "",
        category_name:    src?.type || "Salary",
        category_id:      null,
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);
      await onRefresh();
      showToast(`Income ${fmtIDR(amt, true)} recorded`);
      setIncModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── STYLES ─────────────────────────────────────────────────
  const card = {
    background:   T.surface,
    border:       `1px solid ${T.border}`,
    borderRadius: 16,
    padding:      "16px 18px",
  };

  const tooltipStyle = {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 8, fontSize: 11,
  };

  // Month selector options — last 12 months
  const monthOptions = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = d.toISOString().slice(0, 7);
      return { value: val, label: mlShort(val) };
    });
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ─────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        {subTab === "sources" ? (
          <SortDropdown
            storageKey="sort_income"
            options={[
              { key: "amount", label: "Amount", defaultDir: "desc" },
              { key: "name",   label: "Name",   defaultDir: "asc"  },
            ]}
            value={incSort}
            onChange={v => setIncSort(v)}
          />
        ) : <div />}
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => openSrcModal()}>+ Source</Button>
          <Button variant="primary"   size="sm" onClick={openIncModal}>+ Income</Button>
        </div>
      </div>

      {/* ── SUB-TABS ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4 }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding: "7px 16px", borderRadius: 99, border: "none",
              cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "Figtree, sans-serif",
              background: subTab === t.id ? T.text    : T.sur2,
              color:      subTab === t.id ? T.darkText : T.text2,
              transition: "background .15s, color .15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── SOURCES ──────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "sources" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Loan recovery section */}
          {loanAccs.length > 0 && (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.text3, letterSpacing: "0.05em" }}>
                  💼 LOAN RECOVERY
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#059669" }}>
                  +{fmtIDR(totalLoanRecovery, true)}/mo
                </div>
              </div>
              {loanAccs.map(l => {
                const outstanding  = Number(l.receivable_outstanding || 0);
                const monthly      = Number(l.monthly_installment || 0);
                const remainMonths = monthly > 0 ? Math.ceil(outstanding / monthly) : 0;
                const nextDue = (() => {
                  if (!l.start_date || !monthly) return null;
                  const day = new Date(l.start_date).getDate();
                  const now = new Date();
                  let d = new Date(now.getFullYear(), now.getMonth(), day);
                  if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
                  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
                })();
                return (
                  <div key={l.id} style={{
                    padding: "10px 12px", background: T.sur2, borderRadius: 10,
                    marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                  }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{l.contact_name || l.name}</div>
                      <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                        {remainMonths > 0 ? `${remainMonths} months remaining` : "Fully paid"}
                        {nextDue && ` · Next: ${nextDue}`}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#059669" }}>
                        +{fmtIDR(monthly, true)}
                      </div>
                      <div style={{ fontSize: 10, color: T.text3 }}>per month</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {incomeSrcs.length === 0 && loanAccs.length === 0 ? (
            <EmptyState icon="💰" message="No income sources. Add your salary, rent, etc." />
          ) : (
            [...incomeSrcs].sort((a, b) => {
              switch (incSort) {
                case "amount_asc": return Number(a.expected_amount || 0) - Number(b.expected_amount || 0);
                case "name_asc":   return (a.name || "").localeCompare(b.name || "");
                case "name_desc":  return (b.name || "").localeCompare(a.name || "");
                default:           return Number(b.expected_amount || 0) - Number(a.expected_amount || 0);
              }
            }).map(src => (
              <div key={src.id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{src.name}</div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                      {src.type} · {src.frequency}
                      {src.entity && src.entity !== "Personal" && (
                        <span style={{ marginLeft: 6, background: T.sur2, borderRadius: 4, padding: "1px 5px", fontSize: 10, fontWeight: 600, color: T.text2 }}>
                          {src.entity}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#059669" }}>
                      {fmtIDR(Number(src.expected_amount || 0), true)}
                    </div>
                    <div style={{ fontSize: 10, color: T.text3 }}>
                      expected/{src.frequency?.toLowerCase()}
                    </div>
                    <span style={{
                      display: "inline-block", marginTop: 4,
                      background: src.is_active ? "#dcfce7" : T.sur2,
                      color: src.is_active ? "#059669" : T.text3,
                      borderRadius: 5, padding: "1px 7px",
                      fontSize: 10, fontWeight: 700,
                    }}>
                      {src.is_active ? "● Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Button variant="secondary" size="sm" onClick={() => openSrcModal(src)}>✏️ Edit</Button>
                  <Button variant="danger"    size="sm" onClick={() => delSrc(src.id, src.name)}>🗑</Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── THIS MONTH ───────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "thismonth" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Month picker */}
          <select
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
            style={{
              padding: "8px 12px", borderRadius: 10, border: `1px solid ${T.border}`,
              background: T.surface, color: T.text, fontSize: 13, fontWeight: 600,
              fontFamily: "Figtree, sans-serif", cursor: "pointer",
            }}
          >
            {monthOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ ...card, background: "#e8fdf0", border: "none" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", letterSpacing: "0.05em" }}>ACTUAL</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: T.text, marginTop: 4 }}>{fmtIDR(totalThisMonth, true)}</div>
              <div style={{ fontSize: 11, color: T.text2 }}>income received</div>
            </div>
            <div style={{ ...card, background: T.sur2, border: "none" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: "0.05em" }}>EXPECTED</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: T.text, marginTop: 4 }}>{fmtIDR(expectedThisMonth, true)}</div>
              <div style={{ fontSize: 11, color: totalThisMonth >= expectedThisMonth ? "#059669" : T.text3 }}>
                {totalThisMonth >= expectedThisMonth ? "✅ Target met" : "⏳ Pending"}
              </div>
            </div>
          </div>

          {thisMonthIncome.length === 0 ? (
            <EmptyState icon="💰" message="No income recorded this month." />
          ) : (
            thisMonthIncome.map(e => {
              const dest = accounts.find(a => a.id === e.to_id);
              return (
                <div key={e.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  ...card,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{e.description}</div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                      {e.tx_date}{dest && ` → ${dest.name}`}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#059669" }}>
                    +{fmtIDR(Number(e.amount_idr || e.amount || 0), true)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── CASH FLOW ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "cashflow" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <SectionHeader title="Income vs Expense — Last 12 Months" />
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={cashFlow} barSize={8} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <XAxis dataKey="month" tick={{ fontSize: 9, fill: T.text3 }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={v => fmtIDR(v, true)}
                />
                <Bar dataKey="income"  name="Income"  fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill="#dc2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ ...card, overflowX: "auto" }}>
            <SectionHeader title="Monthly Summary" />
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 10 }}>
              <thead>
                <tr style={{ color: T.text3 }}>
                  {["Month", "Income", "Expense", "Surplus"].map(h => (
                    <th key={h} style={{ textAlign: h === "Month" ? "left" : "right", padding: "5px 8px", fontWeight: 600, borderBottom: `1px solid ${T.border}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...cashFlow].reverse().map((m, i) => (
                  <tr key={i}>
                    <td style={{ padding: "6px 8px", color: T.text2, fontWeight: 600 }}>{m.month}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#059669", fontWeight: 700 }}>{fmtIDR(m.income, true)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: "#dc2626", fontWeight: 700 }}>{fmtIDR(m.expense, true)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", color: m.surplus >= 0 ? "#059669" : "#dc2626", fontWeight: 800 }}>
                      {m.surplus >= 0 ? "+" : ""}{fmtIDR(m.surplus, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── ADD / EDIT SOURCE MODAL ──────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      <Modal
        isOpen={srcModal}
        onClose={() => setSrcModal(false)}
        title={editSrcId ? "Edit Income Source" : "Add Income Source"}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setSrcModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!srcForm.name || !srcForm.expected_amount}
              onClick={saveSrc}
            >
              {editSrcId ? "Update" : "Add Source"}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Name *">
            <Input
              value={srcForm.name}
              onChange={e => setSrcForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Monthly Salary"
            />
          </Field>

          <FormRow>
            <Field label="Category">
              <Select
                value={srcForm.type}
                onChange={e => setSrcForm(f => ({ ...f, type: e.target.value }))}
                options={INCOME_CATEGORIES.map(c => ({ value: c, label: c }))}
              />
            </Field>
            <Field label="Frequency">
              <Select
                value={srcForm.frequency}
                onChange={e => setSrcForm(f => ({ ...f, frequency: e.target.value }))}
                options={FREQUENCIES.map(f => ({ value: f, label: f }))}
              />
            </Field>
          </FormRow>

          <FormRow>
            <AmountInput
              label="Expected Amount *"
              value={srcForm.expected_amount}
              onChange={v => setSrcForm(f => ({ ...f, expected_amount: v }))}
              currency={srcForm.currency}
            />
            <Field label="Currency">
              <Select
                value={srcForm.currency}
                onChange={e => setSrcForm(f => ({ ...f, currency: e.target.value }))}
                options={CURRENCIES.map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
              />
            </Field>
          </FormRow>

          <Field label="Destination Account">
            <Select
              value={srcForm.to_account_id}
              onChange={e => setSrcForm(f => ({ ...f, to_account_id: e.target.value }))}
              options={bankAccounts.map(b => ({ value: b.id, label: b.name }))}
              placeholder="Select…"
            />
          </Field>

          <FormRow>
            <Field label="Entity">
              <Select
                value={srcForm.entity}
                onChange={e => setSrcForm(f => ({ ...f, entity: e.target.value }))}
                options={ENTITIES.map(e => ({ value: e, label: e }))}
              />
            </Field>
            <Field label="Status">
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 10 }}>
                <Toggle
                  value={srcForm.is_active}
                  onChange={v => setSrcForm(f => ({ ...f, is_active: v }))}
                />
                <span style={{ fontSize: 13, color: T.text2 }}>Active</span>
              </div>
            </Field>
          </FormRow>
        </div>
      </Modal>

      {/* ── RECORD INCOME MODAL ─────────────────────────── */}
      <Modal
        isOpen={incModal}
        onClose={() => setIncModal(false)}
        title="Record Income"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setIncModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!incForm.description || !incForm.amount || !incForm.to_account_id}
              onClick={addIncome}
            >
              Record Income
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Income Source (optional)">
            <Select
              value={incForm.income_source_id}
              onChange={e => {
                const src = incomeSrcs.find(s => s.id === e.target.value);
                setIncForm(f => ({
                  ...f,
                  income_source_id: e.target.value,
                  description:    src?.name || f.description,
                  amount:         src?.expected_amount ? String(src.expected_amount) : f.amount,
                  entity:         src?.entity || f.entity,
                  to_account_id:  src?.to_account_id || f.to_account_id,
                }));
              }}
              options={incomeSrcs.filter(s => s.is_active).map(s => ({ value: s.id, label: s.name }))}
              placeholder="— Manual entry —"
            />
          </Field>

          <FormRow>
            <Field label="Date">
              <Input type="date" value={incForm.tx_date} onChange={e => setIncForm(f => ({ ...f, tx_date: e.target.value }))} />
            </Field>
            <Field label="Entity">
              <Select
                value={incForm.entity}
                onChange={e => setIncForm(f => ({ ...f, entity: e.target.value }))}
                options={ENTITIES.map(e => ({ value: e, label: e }))}
              />
            </Field>
          </FormRow>

          <Field label="Description *">
            <Input
              value={incForm.description}
              onChange={e => setIncForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. April Salary"
            />
          </Field>

          <FormRow>
            <AmountInput
              label="Amount *"
              value={incForm.amount}
              onChange={v => setIncForm(f => ({ ...f, amount: v }))}
              currency={incForm.currency}
            />
            <Field label="Currency">
              <Select
                value={incForm.currency}
                onChange={e => setIncForm(f => ({ ...f, currency: e.target.value }))}
                options={CURRENCIES.map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
              />
            </Field>
          </FormRow>

          <Field label="To Account *">
            <Select
              value={incForm.to_account_id}
              onChange={e => setIncForm(f => ({ ...f, to_account_id: e.target.value }))}
              options={bankAccounts.map(b => ({ value: b.id, label: b.name }))}
              placeholder="Select bank…"
            />
          </Field>

          <Field label="Notes">
            <Input
              value={incForm.notes}
              onChange={e => setIncForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
            />
          </Field>
        </div>
      </Modal>

    </div>
  );
}
