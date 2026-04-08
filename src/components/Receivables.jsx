import { useState, useMemo } from "react";
import { ledgerApi } from "../api";
import { fmtIDR, todayStr, agingLabel } from "../utils";
import { ENTITIES } from "../constants";
import { ENT_COL, ENT_BG, LIGHT, DARK } from "../theme";
import {
  Modal, Button,
  Field, AmountInput, Input, FormRow,
  Select,
  EmptyState, showToast,
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

const SUBTABS = [
  { id: "reimburse", label: "Reimburse"      },
  { id: "loans",     label: "Employee Loans" },
  { id: "history",   label: "History"        },
];

const ENTITY_CHOICES = ["Hamasa", "SDC", "Travelio"];

export default function Receivables({ user, accounts, ledger, onRefresh, setAccounts, setLedger, dark }) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab] = useState("reimburse");
  const [saving, setSaving] = useState(false);

  // Modals
  const [outModal, setOutModal]         = useState(false);
  const [inModal, setInModal]           = useState(false);
  const [loanModal, setLoanModal]       = useState(false);
  const [collectModal, setCollectModal] = useState(false);
  const [selectedRec, setSelectedRec]   = useState(null);

  // Forms
  const [outForm, setOutForm] = useState({
    date: todayStr(), description: "", amount: "",
    entity: "Hamasa", from_id: "", notes: "",
  });
  const [inForm, setInForm] = useState({
    date: todayStr(), amount: "", bank_id: "", notes: "",
  });
  const [loanForm, setLoanForm] = useState({
    amount: "", bank_id: "", date: todayStr(), notes: "",
  });

  // ── DERIVED ────────────────────────────────────────────────
  const receivables    = useMemo(() => accounts.filter(a => a.type === "receivable"), [accounts]);
  const reimburseAccs  = useMemo(() => receivables.filter(a => a.receivable_type === "reimburse"), [receivables]);
  const loanAccs       = useMemo(() => receivables.filter(a => a.receivable_type === "employee_loan"), [receivables]);
  const bankAccounts   = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const spendAccounts  = useMemo(() => accounts.filter(a => ["bank", "credit_card"].includes(a.type)), [accounts]);

  const recStats = useMemo(() => receivables.map(r => {
    const entries = ledger
      .filter(e => e.from_id === r.id || e.to_id === r.id)
      .sort((a, b) => b.tx_date.localeCompare(a.tx_date));
    const firstEntry = entries[entries.length - 1];
    const aging = firstEntry ? agingLabel(firstEntry.tx_date) : null;
    return { ...r, entries, aging };
  }), [receivables, ledger]);

  const settledEntries = useMemo(() =>
    ledger.filter(e => e.tx_type === "reimburse_in" || e.tx_type === "collect_loan")
      .sort((a, b) => b.tx_date.localeCompare(a.tx_date))
  , [ledger]);

  // ── ACTIONS ───────────────────────────────────────────────
  const handleOut = async () => {
    if (!outForm.description || !outForm.amount || !outForm.from_id)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const rec = receivables.find(r =>
        r.entity === outForm.entity && r.receivable_type === "reimburse"
      );
      if (!rec) {
        showToast(`No reimburse account for ${outForm.entity}. Add one in Accounts.`, "error");
        setSaving(false);
        return;
      }
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(outForm.amount);
      const entry = {
        tx_date:         outForm.date,
        description:     outForm.description,
        amount:          amt,
        currency:        "IDR",
        amount_idr:      amt,
        tx_type:         "reimburse_out",
        from_id:         outForm.from_id,
        to_id:           rec.id,
        entity:          outForm.entity,
        notes:           outForm.notes || "",
        is_reimburse:    true,
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);
      await onRefresh();
      showToast(`Recorded: ${fmtIDR(amt, true)} for ${outForm.entity}`);
      setOutModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleIn = async () => {
    if (!selectedRec || !inForm.amount || !inForm.bank_id)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(inForm.amount);
      const entry = {
        tx_date:         inForm.date || todayStr(),
        description:     `${selectedRec.entity} reimburse received`,
        amount:          amt,
        currency:        "IDR",
        amount_idr:      amt,
        tx_type:         "reimburse_in",
        from_id:         selectedRec.id,
        to_id:           inForm.bank_id,
        entity:          selectedRec.entity,
        notes:           inForm.notes || "",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);
      await onRefresh();
      showToast(`Received ${fmtIDR(amt, true)} from ${selectedRec.entity}`);
      setInModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleGiveLoan = async () => {
    if (!selectedRec || !loanForm.amount || !loanForm.bank_id)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(loanForm.amount);
      const entry = {
        tx_date:         loanForm.date,
        description:     `Loan to ${selectedRec.contact_name || selectedRec.name}`,
        amount:          amt,
        currency:        "IDR",
        amount_idr:      amt,
        tx_type:         "give_loan",
        from_id:         loanForm.bank_id,
        to_id:           selectedRec.id,
        entity:          "Personal",
        notes:           loanForm.notes || "",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);
      await onRefresh();
      showToast(`Loan disbursed: ${fmtIDR(amt, true)}`);
      setLoanModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleCollect = async () => {
    if (!selectedRec || !loanForm.amount || !loanForm.bank_id)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(loanForm.amount);
      const entry = {
        tx_date:         loanForm.date,
        description:     `Loan repayment — ${selectedRec.contact_name || selectedRec.name}`,
        amount:          amt,
        currency:        "IDR",
        amount_idr:      amt,
        tx_type:         "collect_loan",
        from_id:         selectedRec.id,
        to_id:           loanForm.bank_id,
        entity:          "Personal",
        notes:           loanForm.notes || "",
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);
      await onRefresh();
      showToast(`Received ${fmtIDR(amt, true)} repayment`);
      setCollectModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── STYLES ────────────────────────────────────────────────
  const card = (borderColor) => ({
    background:   T.surface,
    border:       `1px solid ${T.border}`,
    borderLeft:   `4px solid ${borderColor || T.ac}`,
    borderRadius: 16,
    padding:      "16px 18px",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ──────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: "0.06em" }}>
          {reimburseAccs.reduce((s, a) => s + Number(a.receivable_outstanding || 0), 0) > 0 &&
            `${fmtIDR(reimburseAccs.reduce((s, a) => s + Number(a.receivable_outstanding || 0), 0), true)} outstanding`}
        </div>
        <Button variant="primary" size="sm" onClick={() => {
          setOutForm({ date: todayStr(), description: "", amount: "", entity: "Hamasa", from_id: spendAccounts[0]?.id || "", notes: "" });
          setOutModal(true);
        }}>
          + Record Expense
        </Button>
      </div>

      {/* ── SUB-TABS ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4 }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              padding:    "7px 16px",
              borderRadius: 99,
              border:     "none",
              cursor:     "pointer",
              fontSize:   13,
              fontWeight: 600,
              fontFamily: "Figtree, sans-serif",
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
      {/* ── REIMBURSE TAB ────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "reimburse" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {reimburseAccs.length === 0 ? (
            <EmptyState
              icon="📋"
              message="No reimburse accounts. Add one from Accounts (type: Receivable → Reimburse)."
            />
          ) : (
            recStats.filter(r => r.receivable_type === "reimburse").map(r => {
              const outstanding = Number(r.receivable_outstanding || 0);
              const entCol      = ENT_COL[r.entity] || T.ac;
              const entBg       = ENT_BG[r.entity]  || T.sur2;
              const recentEntries = r.entries.slice(0, 3);

              return (
                <div key={r.id} style={card(entCol)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    {/* Left */}
                    <div>
                      <span style={{
                        display: "inline-block",
                        background: entBg, color: entCol,
                        borderRadius: 6, padding: "2px 8px",
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {r.entity}
                      </span>
                      <div style={{ fontSize: 24, fontWeight: 900, color: entCol, marginTop: 6 }}>
                        {fmtIDR(outstanding)}
                      </div>
                      <div style={{ fontSize: 11, color: T.text3 }}>outstanding</div>
                      {r.aging && outstanding > 0 && (
                        <div style={{
                          display: "inline-flex", marginTop: 6,
                          background: r.aging.color + "22", color: r.aging.color,
                          borderRadius: 5, padding: "2px 7px",
                          fontSize: 10, fontWeight: 700,
                        }}>
                          ⏱ {r.aging.label}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setOutForm(f => ({ ...f, entity: r.entity }));
                          setOutModal(true);
                        }}
                      >
                        + Expense
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSelectedRec(r);
                          setInForm({
                            date: todayStr(),
                            amount: String(outstanding),
                            bank_id: bankAccounts[0]?.id || "",
                            notes: "",
                          });
                          setInModal(true);
                        }}
                        style={{ color: "#059669", borderColor: "#059669" }}
                      >
                        ↙ Receive
                      </Button>
                    </div>
                  </div>

                  {/* Recent entries */}
                  {recentEntries.length > 0 && (
                    <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
                      {recentEntries.map(e => (
                        <div key={e.id} style={{
                          display: "flex", justifyContent: "space-between",
                          fontSize: 11, color: T.text3, marginBottom: 4,
                        }}>
                          <span>{e.tx_date} · {e.description}</span>
                          <span style={{ fontWeight: 700, color: e.tx_type === "reimburse_in" ? "#059669" : "#dc2626" }}>
                            {e.tx_type === "reimburse_in" ? "−" : "+"}{fmtIDR(Number(e.amount || 0), true)}
                          </span>
                        </div>
                      ))}
                      {r.entries.length > 3 && (
                        <div style={{ fontSize: 10, color: T.text3 }}>
                          +{r.entries.length - 3} more entries
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── LOANS TAB ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "loans" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {loanAccs.length === 0 ? (
            <EmptyState
              icon="👤"
              message="No employee loans. Add from Accounts (type: Receivable → Employee Loan)."
            />
          ) : (
            recStats.filter(r => r.receivable_type === "employee_loan").map(r => {
              const outstanding = Number(r.receivable_outstanding || 0);
              const total       = Number(r.receivable_total || r.receivable_outstanding || 0);
              const paid        = Math.max(0, total - outstanding);
              const pct         = total > 0 ? (paid / total) * 100 : 0;
              const monthly     = Number(r.monthly_installment || 0);
              const paidMonths  = monthly > 0 ? Math.floor(paid / monthly) : 0;
              const totalMonths = monthly > 0 ? Math.ceil(total / monthly) : 0;
              const isFullyPaid = outstanding <= 0;

              // Next due date
              const nextDue = (() => {
                if (!r.start_date || !monthly) return null;
                const day = new Date(r.start_date).getDate();
                const now = new Date();
                let d = new Date(now.getFullYear(), now.getMonth(), day);
                if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
                return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
              })();

              // Expected end date
              const endDate = (() => {
                if (!r.start_date || !totalMonths) return null;
                const d = new Date(r.start_date);
                d.setMonth(d.getMonth() + totalMonths);
                return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
              })();

              return (
                <div key={r.id} style={card(isFullyPaid ? "#059669" : "#d97706")}>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    {/* Left */}
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10,
                        background: "#fef3c7",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 18, flexShrink: 0,
                      }}>
                        👤
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
                          {r.contact_name || r.name}
                        </div>
                        <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                          {[
                            r.contact_dept,
                            r.deduction_method === "direct_payment" ? "Direct Payment" : "Salary Deduction",
                          ].filter(Boolean).join(" · ")}
                        </div>
                        {r.aging && outstanding > 0 && (
                          <div style={{
                            display: "inline-flex", marginTop: 4,
                            background: r.aging.color + "22", color: r.aging.color,
                            borderRadius: 5, padding: "2px 7px",
                            fontSize: 10, fontWeight: 700,
                          }}>
                            {r.aging.label}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right */}
                    <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                      {isFullyPaid ? (
                        <div style={{ fontSize: 13, fontWeight: 800, color: "#059669" }}>🎉 Fully Paid</div>
                      ) : (
                        <>
                          <div style={{ fontSize: 18, fontWeight: 900, color: "#d97706" }}>
                            {fmtIDR(outstanding, true)}
                          </div>
                          <div style={{ fontSize: 10, color: T.text3 }}>remaining</div>
                        </>
                      )}
                      {monthly > 0 && (
                        <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
                          {fmtIDR(monthly, true)}/mo
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {total > 0 && (
                    <>
                      <ProgressBar value={paid} max={total} color="#059669" height={6} />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.text3, marginTop: 4 }}>
                        <span>
                          {pct.toFixed(0)}% paid
                          {totalMonths > 0 ? ` · ${paidMonths}/${totalMonths} months` : ""}
                        </span>
                        <span>{fmtIDR(paid, true)} / {fmtIDR(total, true)}</span>
                      </div>
                    </>
                  )}

                  {/* Schedule */}
                  {!isFullyPaid && (nextDue || endDate) && (
                    <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: T.text3, flexWrap: "wrap" }}>
                      {nextDue && <span>📅 Next: <strong style={{ color: T.text }}>{nextDue}</strong></span>}
                      {endDate && <span>🏁 Ends: <strong style={{ color: T.text }}>{endDate}</strong></span>}
                    </div>
                  )}

                  {/* Actions */}
                  {!isFullyPaid && (
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => {
                          setSelectedRec(r);
                          setLoanForm({
                            amount:  String(monthly || ""),
                            bank_id: r.default_bank_id || bankAccounts[0]?.id || "",
                            date:    todayStr(),
                            notes:   "",
                          });
                          setCollectModal(true);
                        }}
                      >
                        + Record Payment
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSelectedRec(r);
                          setLoanForm({ amount: "", bank_id: bankAccounts[0]?.id || "", date: todayStr(), notes: "" });
                          setLoanModal(true);
                        }}
                      >
                        ↗ Disburse More
                      </Button>
                    </div>
                  )}

                  {/* Recent entries */}
                  {r.entries.length > 0 && (
                    <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 8 }}>
                      {r.entries.slice(0, 3).map(e => (
                        <div key={e.id} style={{
                          display: "flex", justifyContent: "space-between",
                          fontSize: 11, color: T.text3, marginBottom: 3,
                        }}>
                          <span>{e.tx_date} · {e.description}</span>
                          <span style={{ fontWeight: 700, color: e.tx_type === "collect_loan" ? "#059669" : "#d97706" }}>
                            {e.tx_type === "collect_loan" ? "−" : "+"}{fmtIDR(Number(e.amount || 0), true)}
                          </span>
                        </div>
                      ))}
                      {r.entries.length > 3 && (
                        <div style={{ fontSize: 10, color: T.text3 }}>+{r.entries.length - 3} more</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── HISTORY TAB ──────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "history" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {settledEntries.length === 0 ? (
            <EmptyState icon="📜" message="No settled receivables yet." />
          ) : (
            settledEntries.map(e => {
              const rec = accounts.find(a => a.id === e.from_id);
              return (
                <div key={e.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 14px", background: T.sur2, borderRadius: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{e.description}</div>
                    <div style={{ fontSize: 10, color: T.text3 }}>
                      {e.tx_date} · {rec?.entity || rec?.contact_name || "—"}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#059669" }}>
                    +{fmtIDR(Number(e.amount || 0), true)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── RECORD EXPENSE MODAL (reimburse_out) ──────── */}
      {/* ══════════════════════════════════════════════════ */}
      <Modal
        isOpen={outModal}
        onClose={() => setOutModal(false)}
        title="Record Expense for Entity"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setOutModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!outForm.description || !outForm.amount || !outForm.from_id}
              onClick={handleOut}
            >
              Record Expense
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Entity *">
            <Select
              value={outForm.entity}
              onChange={e => setOutForm(f => ({ ...f, entity: e.target.value }))}
              options={ENTITY_CHOICES.map(e => ({ value: e, label: e }))}
            />
          </Field>

          <Field label="Description *">
            <Input
              value={outForm.description}
              onChange={e => setOutForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What was the expense?"
            />
          </Field>

          <FormRow>
            <AmountInput
              label="Amount (IDR) *"
              value={outForm.amount}
              onChange={v => setOutForm(f => ({ ...f, amount: v }))}
              currency="IDR"
            />
            <Field label="Date">
              <Input
                type="date"
                value={outForm.date}
                onChange={e => setOutForm(f => ({ ...f, date: e.target.value }))}
              />
            </Field>
          </FormRow>

          <Field label="Paid From *">
            <Select
              value={outForm.from_id}
              onChange={e => setOutForm(f => ({ ...f, from_id: e.target.value }))}
              options={spendAccounts.map(a => ({ value: a.id, label: a.name }))}
              placeholder="Select account…"
            />
          </Field>

          <Field label="Notes">
            <Input
              value={outForm.notes}
              onChange={e => setOutForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
            />
          </Field>
        </div>
      </Modal>

      {/* ── RECEIVE REIMBURSEMENT MODAL ─────────────────── */}
      <Modal
        isOpen={inModal && !!selectedRec}
        onClose={() => setInModal(false)}
        title="Receive Reimbursement"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setInModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!inForm.amount || !inForm.bank_id}
              onClick={handleIn}
            >
              Record →
            </Button>
          </div>
        }
      >
        {selectedRec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Outstanding banner */}
            <div style={{
              background: ENT_BG[selectedRec.entity] || T.sur2,
              borderRadius: 10, padding: "10px 14px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ fontSize: 12, color: T.text2 }}>Outstanding — {selectedRec.entity}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: ENT_COL[selectedRec.entity] || T.ac }}>
                {fmtIDR(Number(selectedRec.receivable_outstanding || 0))}
              </div>
            </div>

            <FormRow>
              <AmountInput
                label="Amount Received *"
                value={inForm.amount}
                onChange={v => setInForm(f => ({ ...f, amount: v }))}
                currency="IDR"
              />
              <Field label="Date">
                <Input
                  type="date"
                  value={inForm.date}
                  onChange={e => setInForm(f => ({ ...f, date: e.target.value }))}
                />
              </Field>
            </FormRow>

            <Field label="To Bank Account *">
              <Select
                value={inForm.bank_id}
                onChange={e => setInForm(f => ({ ...f, bank_id: e.target.value }))}
                options={bankAccounts.map(b => ({ value: b.id, label: b.name }))}
                placeholder="Select bank…"
              />
            </Field>

            <Field label="Notes">
              <Input
                value={inForm.notes}
                onChange={e => setInForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── DISBURSE LOAN MODAL ─────────────────────────── */}
      <Modal
        isOpen={loanModal && !!selectedRec}
        onClose={() => setLoanModal(false)}
        title={`Disburse Loan — ${selectedRec?.contact_name || selectedRec?.name || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setLoanModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!loanForm.amount || !loanForm.bank_id}
              onClick={handleGiveLoan}
            >
              Disburse →
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <FormRow>
            <AmountInput
              label="Loan Amount *"
              value={loanForm.amount}
              onChange={v => setLoanForm(f => ({ ...f, amount: v }))}
              currency="IDR"
            />
            <Field label="Date">
              <Input
                type="date"
                value={loanForm.date}
                onChange={e => setLoanForm(f => ({ ...f, date: e.target.value }))}
              />
            </Field>
          </FormRow>

          <Field label="From Bank Account *">
            <Select
              value={loanForm.bank_id}
              onChange={e => setLoanForm(f => ({ ...f, bank_id: e.target.value }))}
              options={bankAccounts.map(b => ({
                value: b.id,
                label: `${b.name} — ${fmtIDR(b.current_balance || 0, true)}`,
              }))}
              placeholder="Select bank…"
            />
          </Field>

          <Field label="Notes">
            <Input
              value={loanForm.notes}
              onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
            />
          </Field>
        </div>
      </Modal>

      {/* ── COLLECT LOAN PAYMENT MODAL ──────────────────── */}
      <Modal
        isOpen={collectModal && !!selectedRec}
        onClose={() => setCollectModal(false)}
        title={`Collect Payment — ${selectedRec?.contact_name || selectedRec?.name || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setCollectModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!loanForm.amount || !loanForm.bank_id}
              onClick={handleCollect}
            >
              Record Payment
            </Button>
          </div>
        }
      >
        {selectedRec && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Outstanding banner */}
            <div style={{
              background: T.sur2, borderRadius: 10, padding: "10px 14px",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <div style={{ fontSize: 12, color: T.text2 }}>Outstanding</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#d97706" }}>
                {fmtIDR(Number(selectedRec.receivable_outstanding || 0))}
              </div>
            </div>

            <FormRow>
              <AmountInput
                label="Payment Amount *"
                value={loanForm.amount}
                onChange={v => setLoanForm(f => ({ ...f, amount: v }))}
                currency="IDR"
              />
              <Field label="Date">
                <Input
                  type="date"
                  value={loanForm.date}
                  onChange={e => setLoanForm(f => ({ ...f, date: e.target.value }))}
                />
              </Field>
            </FormRow>

            <Field label="To Bank Account *">
              <Select
                value={loanForm.bank_id}
                onChange={e => setLoanForm(f => ({ ...f, bank_id: e.target.value }))}
                options={bankAccounts.map(b => ({ value: b.id, label: b.name }))}
                placeholder="Select bank…"
              />
            </Field>

            <Field label="Notes">
              <Input
                value={loanForm.notes}
                onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </Field>
          </div>
        )}
      </Modal>

    </div>
  );
}
