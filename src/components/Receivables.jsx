import { useState, useMemo, useEffect, useRef } from "react";
import { ledgerApi, employeeLoanApi, loanPaymentsApi, recalculateBalance } from "../api";
import { supabase } from "../lib/supabase";
import { fmtIDR, todayStr, agingLabel } from "../utils";
import SortDropdown from "./shared/SortDropdown";
import { ENT_COL, ENT_BG, LIGHT, DARK } from "../theme";
import {
  Modal, Button,
  Field, AmountInput, Input, FormRow,
  Select,
  EmptyState, showToast,
} from "./shared/index";
import TransactionModal from "./shared/TransactionModal";

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

const EMPTY_LOAN = {
  employee_name: "", employee_dept: "",
  total_amount: "", monthly_installment: "", already_paid: "",
  start_date: todayStr(), notes: "",
};

// ─── LOAN FORM FIELDS (shared by Add + Edit modals) ──────────
function LoanFormFields({ form, setForm, T, showAlreadyPaid = false }) {
  const total   = Number(form.total_amount   || 0);
  const monthly = Number(form.monthly_installment || 0);
  const totalMo = total > 0 && monthly > 0 ? Math.ceil(total / monthly) : null;
  const endDate = totalMo && form.start_date
    ? (() => {
        const d = new Date(form.start_date + "T00:00:00");
        d.setMonth(d.getMonth() + totalMo);
        return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      })()
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <FormRow>
        <Field label="Employee Name *">
          <Input value={form.employee_name} onChange={e => setForm(f => ({ ...f, employee_name: e.target.value }))} placeholder="Full name" />
        </Field>
        <Field label="Department">
          <Input value={form.employee_dept} onChange={e => setForm(f => ({ ...f, employee_dept: e.target.value }))} placeholder="e.g. Finance" />
        </Field>
      </FormRow>
      <FormRow>
        <AmountInput label="Total Loan Amount *" value={form.total_amount} onChange={v => setForm(f => ({ ...f, total_amount: v }))} currency="IDR" />
        <AmountInput label="Monthly Installment" value={form.monthly_installment} onChange={v => setForm(f => ({ ...f, monthly_installment: v }))} currency="IDR" />
      </FormRow>
      <Field label="Start Date">
        <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
      </Field>
      {showAlreadyPaid && (
        <AmountInput label="Amount Already Paid (optional)" value={form.already_paid} onChange={v => setForm(f => ({ ...f, already_paid: v }))} currency="IDR" />
      )}
      <Field label="Notes">
        <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
      </Field>

      {/* Auto-calculated info box */}
      {totalMo && (
        <div style={{
          background: "#f0fdf4", border: "1px solid #bbf7d0",
          borderRadius: 10, padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#059669", marginBottom: 4 }}>Auto-calculated</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#374151" }}>Duration</span>
            <span style={{ fontWeight: 700, color: "#111827" }}>{totalMo} months</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ color: "#374151" }}>Monthly</span>
            <span style={{ fontWeight: 700, color: "#111827" }}>{fmtIDR(monthly)}</span>
          </div>
          {endDate && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: "#374151" }}>Ends</span>
              <span style={{ fontWeight: 700, color: "#111827" }}>{endDate}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Receivables({
  user, accounts, ledger, categories,
  employeeLoans, setEmployeeLoans,
  loanPayments,  setLoanPayments,
  onRefresh, setAccounts, setLedger, dark,
  fxRates = {}, CURRENCIES = [],
  bankAccounts: bankAccountsProp = [],
  creditCards = [], assets = [], liabilities = [],
  accountCurrencies = [], incomeSrcs = [],
}) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab] = useState("reimburse");
  const [saving, setSaving] = useState(false);

  // ── Sort state ───────────────────────────────────────────────
  const [reimSort, setReimSort] = useState(() => localStorage.getItem("sort_receivables") || "outstanding_desc");

  // ── Reimburse modals ─────────────────────────────────────────
  const [outModal, setOutModal]         = useState(false);
  const [selectedRec, setSelectedRec]   = useState(null);
  const [historyModal, setHistoryModal] = useState(false);
  const [historyEntity, setHistoryEntity] = useState(null);

  const [outForm, setOutForm] = useState({
    date: todayStr(), description: "", amount: "",
    entity: "Hamasa", from_id: "", notes: "", cash_advance_fee: "",
  });

  // ── Settle two-column state ───────────────────────────────────
  const [settlements,   setSettlements]  = useState([]);
  const [selectedOut,   setSelectedOut]  = useState({}); // { accId: Set<ledgerId> }
  const [selectedIn,    setSelectedIn]   = useState({}); // { accId: Set<ledgerId> }
  const [settling,      setSettling]     = useState(false);
  const [expandedSett,  setExpandedSett] = useState(new Set());
  const [showSettled,   setShowSettled]  = useState({}); // { entity: bool }
  // ── Edit / Delete settlement ──────────────────────────────────
  const [editSModal,    setEditSModal]   = useState(false);
  const [editSItem,     setEditSItem]    = useState(null);
  const [editSForm,     setEditSForm]    = useState({ settled_at: "", notes: "" });
  const [editSSaving,   setEditSSaving]  = useState(false);

  // ── Employee Loan modals ──────────────────────────────────────
  const [addLoanModal,  setAddLoanModal]  = useState(false);
  const [editLoanModal, setEditLoanModal] = useState(false);
  const [selectedLoan,  setSelectedLoan]  = useState(null);
  const [loanForm,      setLoanForm]      = useState(EMPTY_LOAN);

  // Statement modal
  const [stmtOpen, setStmtOpen] = useState(false);
  const [stmtLoan, setStmtLoan] = useState(null);
  const stmtPrintRef = useRef(null);

  // TransactionModal for + Payment
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [txModalLoan, setTxModalLoan] = useState(null);

  // TransactionModal for + New Loan (settled employees)
  const [newLoanModalOpen,     setNewLoanModalOpen]     = useState(false);
  const [newLoanEmployeeName,  setNewLoanEmployeeName]  = useState("");

  // ── DERIVED ────────────────────────────────────────────────
  const receivables    = useMemo(() => accounts.filter(a => a.type === "receivable"), [accounts]);
  const reimburseAccs  = useMemo(() => receivables, [receivables]);
  const bankAccounts   = useMemo(() => accounts.filter(a => a.type === "bank"), [accounts]);
  const spendAccounts  = useMemo(() => accounts.filter(a => ["bank", "credit_card"].includes(a.type)), [accounts]);

  const recStats = useMemo(() => receivables.map(r => {
    const entries = ledger
      .filter(e => r.entity && e.entity === r.entity && (e.tx_type === "reimburse_out" || e.tx_type === "reimburse_in"))
      .sort((a, b) => b.tx_date.localeCompare(a.tx_date));
    const firstEntry = entries[entries.length - 1];
    const aging = firstEntry ? agingLabel(firstEntry.tx_date) : null;
    return { ...r, entries, aging };
  }), [receivables, ledger]);


  const settledEntries = useMemo(() =>
    ledger.filter(e => e.tx_type === "reimburse_in")
      .sort((a, b) => b.tx_date.localeCompare(a.tx_date))
  , [ledger]);

  // Per-entity reimburse totals computed from ledger (not from account.receivable_outstanding)
  const reimburseStats = useMemo(() => {
    const map = {};
    ledger.forEach(e => {
      if (!e.entity) return;
      if (e.tx_type === "reimburse_out") {
        if (!map[e.entity]) map[e.entity] = { out: 0, in: 0 };
        map[e.entity].out += Number(e.amount_idr || e.amount || 0);
      } else if (e.tx_type === "reimburse_in") {
        if (!map[e.entity]) map[e.entity] = { out: 0, in: 0 };
        map[e.entity].in += Number(e.amount_idr || e.amount || 0);
      }
    });
    return map;
  }, [ledger]);

  // Per-loan: outstanding based on paid_months × monthly_installment
  const loansWithStats = useMemo(() => {
    return employeeLoans.map(loan => {
      const paidMonths   = Number(loan.paid_months || 0);
      const monthly      = Number(loan.monthly_installment || 0);
      const total        = Number(loan.total_amount || 0);
      const paidSoFar    = paidMonths * monthly;
      const remaining    = Math.max(0, total - paidSoFar);
      // Ledger-based payment history (employee_loan_id link)
      const ledgerPays   = ledger
        .filter(e => e.employee_loan_id === loan.id && e.tx_type === "collect_loan")
        .sort((a, b) => (a.tx_date || "").localeCompare(b.tx_date || ""));
      return { ...loan, paidSoFar, remaining, ledgerPays };
    });
  }, [employeeLoans, ledger]);

  const totalLoanOutstanding = useMemo(
    () => loansWithStats.filter(l => l.status !== "settled").reduce((s, l) => s + l.remaining, 0),
    [loansWithStats]
  );

  // Assign loan index per employee (by start_date order), and sort active first / settled last
  const loansWithIndex = useMemo(() => {
    // Group by employee_name
    const groups = {};
    loansWithStats.forEach(loan => {
      const name = loan.employee_name || "Unknown";
      if (!groups[name]) groups[name] = [];
      groups[name].push(loan);
    });

    const result = [];
    Object.values(groups).forEach(loans => {
      // Sort loans within employee by start_date ASC to assign #1, #2, …
      const byDate = [...loans].sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));
      byDate.forEach((loan, i) => {
        result.push({ ...loan, loanIndex: i + 1, totalLoansForEmployee: byDate.length });
      });
    });

    // Sort overall: active first, settled last; within each group by employee name then loanIndex
    result.sort((a, b) => {
      const aSettled = (a.status === "settled" || a.remaining <= 0) ? 1 : 0;
      const bSettled = (b.status === "settled" || b.remaining <= 0) ? 1 : 0;
      if (aSettled !== bSettled) return aSettled - bSettled;
      const nameCmp = (a.employee_name || "").localeCompare(b.employee_name || "");
      if (nameCmp !== 0) return nameCmp;
      return a.loanIndex - b.loanIndex;
    });

    return result;
  }, [loansWithStats]);

  // ── REIMBURSE ACTIONS ──────────────────────────────────────
  const handleOut = async () => {
    if (!outForm.description || !outForm.amount || !outForm.from_id)
      return showToast("Fill all required fields", "error");
    setSaving(true);
    try {
      const rec = receivables.find(r => r.entity === outForm.entity);
      if (!rec) {
        showToast(`No reimburse account for ${outForm.entity}. Add one in Accounts.`, "error");
        setSaving(false);
        return;
      }
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt = sn(outForm.amount);
      const fee = sn(outForm.cash_advance_fee);
      const entry = {
        tx_date:      outForm.date,
        description:  outForm.description,
        amount:       amt,
        currency:     "IDR",
        amount_idr:   amt,
        tx_type:      "reimburse_out",
        from_type:    "account",
        to_type:      "account",
        from_id:      outForm.from_id,
        to_id:        rec.id,
        entity:       outForm.entity,
        notes:        outForm.notes || "",
        is_reimburse: true,
      };
      const r = await ledgerApi.create(user.id, entry, accounts);
      if (r) setLedger(prev => [r, ...prev]);

      // Optional: record cash advance fee as an expense from the same account
      if (fee > 0) {
        const feeEntry = {
          tx_date:      outForm.date,
          description:  `${outForm.entity} Cash Advance Fee`,
          amount:       fee,
          currency:     "IDR",
          amount_idr:   fee,
          tx_type:      "expense",
          from_type:    "account",
          to_type:      "expense",
          from_id:      outForm.from_id,
          to_id:        null,
          entity:       outForm.entity,
          category_id:  "cash_advance_fee",
          notes:        `CA fee for: ${outForm.description}`,
          merchant_name: null, attachment_url: null,
          ai_categorized: false, ai_confidence: null,
          installment_id: null, scan_batch_id: null,
          is_reimburse: false,
        };
        const rf = await ledgerApi.create(user.id, feeEntry, accounts);
        if (rf) setLedger(prev => [rf, ...prev]);
      }

      await onRefresh();
      showToast(`Recorded: ${fmtIDR(amt, true)}${fee > 0 ? ` + ${fmtIDR(fee, true)} CA fee` : ""} for ${outForm.entity}`);
      setOutModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Fetch settlements on mount ────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    supabase.from("reimburse_settlements")
      .select("*")
      .eq("user_id", user.id)
      .order("settled_at", { ascending: false })
      .then(({ data }) => { if (data) setSettlements(data); });
  }, [user?.id]);

  // ── RE category lookup ────────────────────────────────────────
  const RE_CAT_NAMES = { Hamasa: "Hamasa RE", SDC: "SDC RE", Travelio: "Travelio RE" };
  const getRECat = (entity) =>
    (categories || []).find(c => c.label === RE_CAT_NAMES[entity] || c.name === RE_CAT_NAMES[entity]);

  // ── Toggle row selection ───────────────────────────────────────
  const toggleOutRow = (accId, entryId) => setSelectedOut(prev => {
    const s = new Set(prev[accId] || []);
    s.has(entryId) ? s.delete(entryId) : s.add(entryId);
    return { ...prev, [accId]: s };
  });
  const toggleInRow = (accId, entryId) => setSelectedIn(prev => {
    const s = new Set(prev[accId] || []);
    s.has(entryId) ? s.delete(entryId) : s.add(entryId);
    return { ...prev, [accId]: s };
  });

  // ── Settle entity (upsert — update today's settlement if it exists) ──
  const handleSettleEntity = async (entity, acc) => {
    const outIds = Array.from(selectedOut[acc.id] || []);
    const inIds  = Array.from(selectedIn[acc.id]  || []);
    if (!outIds.length || !inIds.length)
      return showToast("Select at least one expense and one received item", "error");

    const recat = getRECat(entity);

    // Check for existing settlement for this entity created today
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const existingToday = settlements.find(s =>
      s.entity === entity && new Date(s.settled_at) >= todayMidnight
    );

    setSettling(true);
    try {
      let settlement;

      if (existingToday) {
        // ── UPDATE existing settlement ──────────────────────────
        const mergedOut = Array.from(new Set([...(existingToday.out_ledger_ids || []), ...outIds]));
        const mergedIn  = Array.from(new Set([...(existingToday.in_ledger_ids  || []), ...inIds]));
        const newTotalOut   = ledger.filter(e => mergedOut.includes(e.id)).reduce((s, e) => s + Number(e.amount || 0), 0);
        const newTotalIn    = ledger.filter(e => mergedIn.includes(e.id)).reduce((s, e) => s + Number(e.amount || 0), 0);
        const newReimbursable = newTotalOut - newTotalIn;

        const { data: updated, error: uErr } = await supabase
          .from("reimburse_settlements")
          .update({
            out_ledger_ids:       mergedOut,
            in_ledger_ids:        mergedIn,
            total_out:            newTotalOut,
            total_in:             newTotalIn,
            reimbursable_expense: newReimbursable,
          })
          .eq("id", existingToday.id)
          .select().single();
        if (uErr) throw new Error(uErr.message);
        settlement = updated;

        // Delete old RE expense entry for this settlement, then recreate
        await supabase.from("ledger")
          .delete()
          .eq("reimburse_settlement_id", existingToday.id)
          .eq("tx_type", "expense");

        if (newReimbursable > 0) {
          const fromId = ledger.find(e => mergedOut.includes(e.id))?.from_id || null;
          const { error: lErr } = await supabase.from("ledger").insert([{
            user_id: user.id, tx_date: todayStr(),
            description: `${entity} Reimbursable Expense`,
            amount: newReimbursable, amount_idr: newReimbursable, currency: "IDR",
            tx_type: "expense", from_type: "account", to_type: "expense",
            from_id: fromId, to_id: null,
            category_id: recat?.id || null, category_name: recat?.label || RE_CAT_NAMES[entity],
            entity: "Personal", is_reimburse: false,
            notes: `Settlement: ${entity}`, reimburse_settlement_id: settlement.id,
          }]);
          if (lErr) throw new Error(lErr.message);
        }

        // Mark only the newly added ledger rows (avoid re-marking already-marked rows)
        const newIds = [...outIds, ...inIds];
        await supabase.from("ledger").update({ reimburse_settlement_id: settlement.id }).in("id", newIds);
        setLedger(prev => prev.map(e => newIds.includes(e.id) ? { ...e, reimburse_settlement_id: settlement.id } : e));
        setSettlements(prev => prev.map(x => x.id === existingToday.id ? settlement : x));
        showToast(`${entity} settlement updated · RE: ${fmtIDR(newReimbursable, true)}`);
      } else {
        // ── INSERT new settlement ───────────────────────────────
        const outEntries   = ledger.filter(e => outIds.includes(e.id));
        const inEntries    = ledger.filter(e => inIds.includes(e.id));
        const totalOut     = outEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
        const totalIn      = inEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
        const reimbursable = totalOut - totalIn;

        const { data: newSett, error: sErr } = await supabase
          .from("reimburse_settlements")
          .insert([{
            user_id: user.id, entity,
            settled_at: new Date().toISOString(),
            out_ledger_ids: outIds, in_ledger_ids: inIds,
            total_out: totalOut, total_in: totalIn,
            reimbursable_expense: reimbursable,
            re_category_id: recat?.id || null, notes: null,
          }])
          .select().single();
        if (sErr) throw new Error(sErr.message);
        settlement = newSett;

        if (reimbursable > 0) {
          const fromId = outEntries[0]?.from_id || null;
          const { error: lErr } = await supabase.from("ledger").insert([{
            user_id: user.id, tx_date: todayStr(),
            description: `${entity} Reimbursable Expense`,
            amount: reimbursable, amount_idr: reimbursable, currency: "IDR",
            tx_type: "expense", from_type: "account", to_type: "expense",
            from_id: fromId, to_id: null,
            category_id: recat?.id || null, category_name: recat?.label || RE_CAT_NAMES[entity],
            entity: "Personal", is_reimburse: false,
            notes: `Settlement: ${entity}`, reimburse_settlement_id: settlement.id,
          }]);
          if (lErr) throw new Error(lErr.message);
        }

        const allIds = [...outIds, ...inIds];
        await supabase.from("ledger").update({ reimburse_settlement_id: settlement.id }).in("id", allIds);
        setLedger(prev => prev.map(e => allIds.includes(e.id) ? { ...e, reimburse_settlement_id: settlement.id } : e));
        setSettlements(prev => [settlement, ...prev]);
        showToast(`${entity} settled${reimbursable > 0 ? ` · RE: ${fmtIDR(reimbursable, true)}` : ""}`);
      }

      setSelectedOut(prev => ({ ...prev, [acc.id]: new Set() }));
      setSelectedIn(prev =>  ({ ...prev, [acc.id]: new Set() }));
      await onRefresh();
    } catch (e) { showToast(e.message, "error"); }
    setSettling(false);
  };

  // ── Edit settlement ────────────────────────────────────────────
  const openEditSettle = (s) => {
    setEditSItem(s);
    setEditSForm({
      settled_at: s.settled_at ? s.settled_at.slice(0, 10) : todayStr(),
      notes:      s.notes || "",
    });
    setEditSModal(true);
  };

  const handleEditSettle = async () => {
    if (!editSItem) return;
    setEditSSaving(true);
    try {
      const { data: updated, error } = await supabase
        .from("reimburse_settlements")
        .update({ settled_at: editSForm.settled_at, notes: editSForm.notes || null })
        .eq("id", editSItem.id)
        .select().single();
      if (error) throw new Error(error.message);
      setSettlements(prev => prev.map(x => x.id === editSItem.id ? updated : x));
      showToast("Settlement updated");
      setEditSModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setEditSSaving(false);
  };

  // ── Delete settlement ──────────────────────────────────────────
  const handleDeleteSettle = async (s) => {
    if (!window.confirm(`Delete this settlement for ${s.entity}? The linked transactions will become unsettled.`)) return;
    try {
      // Unmark all linked ledger entries
      const linkedIds = [...(s.out_ledger_ids || []), ...(s.in_ledger_ids || [])];
      if (linkedIds.length) {
        await supabase.from("ledger").update({ reimburse_settlement_id: null }).in("id", linkedIds);
        setLedger(prev => prev.map(e => linkedIds.includes(e.id) ? { ...e, reimburse_settlement_id: null } : e));
      }
      // Delete the RE expense entry created for this settlement
      await supabase.from("ledger").delete().eq("reimburse_settlement_id", s.id).eq("tx_type", "expense");
      // Delete the settlement record itself
      await supabase.from("reimburse_settlements").delete().eq("id", s.id);
      setSettlements(prev => prev.filter(x => x.id !== s.id));
      showToast(`Settlement deleted — transactions are now unsettled`);
    } catch (e) { showToast(e.message, "error"); }
  };

  // ── EMPLOYEE LOAN ACTIONS ──────────────────────────────────
  const handleAddLoan = async () => {
    if (!loanForm.employee_name || !loanForm.total_amount)
      return showToast("Employee name and total amount are required", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const alreadyPaid   = sn(loanForm.already_paid);
      const monthlyAmt    = sn(loanForm.monthly_installment);
      const paidMonths    = monthlyAmt > 0 ? Math.floor(alreadyPaid / monthlyAmt) : 0;
      const d = {
        employee_name:        loanForm.employee_name.trim(),
        employee_dept:        loanForm.employee_dept.trim() || null,
        total_amount:         sn(loanForm.total_amount),
        monthly_installment:  monthlyAmt,
        start_date:           loanForm.start_date || null,
        notes:                loanForm.notes || null,
        status:               "active",
        paid_months:          paidMonths,
      };
      const created = await employeeLoanApi.create(user.id, d);
      if (created) setEmployeeLoans(prev => [created, ...prev]);

      // If already_paid > 0, record initial payments so loansWithStats is accurate
      if (alreadyPaid > 0) {
        const initPayment = await loanPaymentsApi.create(user.id, {
          loan_id:  created.id,
          pay_date: loanForm.start_date || todayStr(),
          amount:   alreadyPaid,
          notes:    "Initial paid amount (pre-existing)",
        });
        if (initPayment) setLoanPayments(prev => [initPayment, ...prev]);
      }

      showToast(`Loan added for ${d.employee_name}`);
      setAddLoanModal(false);
      setLoanForm(EMPTY_LOAN);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleEditLoan = async () => {
    if (!selectedLoan || !loanForm.employee_name || !loanForm.total_amount)
      return showToast("Employee name and total amount are required", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const d = {
        employee_name:        loanForm.employee_name.trim(),
        employee_dept:        loanForm.employee_dept.trim() || null,
        total_amount:         sn(loanForm.total_amount),
        monthly_installment:  sn(loanForm.monthly_installment),
        start_date:           loanForm.start_date || null,
        notes:                loanForm.notes || null,
      };
      const updated = await employeeLoanApi.update(selectedLoan.id, d);
      if (updated) setEmployeeLoans(prev => prev.map(l => l.id === updated.id ? updated : l));
      showToast("Loan updated");
      setEditLoanModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const handleDeleteLoan = async (loan) => {
    if (!window.confirm(`Delete loan for ${loan.employee_name}? This cannot be undone.`)) return;
    try {
      await employeeLoanApi.delete(loan.id);
      setEmployeeLoans(prev => prev.filter(l => l.id !== loan.id));
      setLoanPayments(prev => prev.filter(p => p.loan_id !== loan.id));
      showToast("Loan deleted");
    } catch (e) { showToast(e.message, "error"); }
  };

  // bankAccounts for passing to TransactionModal (prefer prop, fallback to derived)
  const allBankCashAccounts = useMemo(
    () => bankAccountsProp.length ? bankAccountsProp : accounts.filter(a => a.type === "bank"),
    [bankAccountsProp, accounts]
  );

  // ── STYLES ────────────────────────────────────────────────
  const card = (borderColor) => ({
    background:   T.surface,
    border:       `1px solid ${T.border}`,
    borderLeft:   `4px solid ${borderColor || T.ac}`,
    borderRadius: 16,
    padding:      "16px 18px",
  });

  const totalReimburse  = reimburseAccs.reduce((s, a) => {
    const st = reimburseStats[a.entity] || { out: 0, in: 0 };
    return s + Math.max(0, st.out - st.in);
  }, 0);
  const activeReimburse = reimburseAccs.filter(a => {
    const st = reimburseStats[a.entity] || { out: 0, in: 0 };
    return (st.out - st.in) > 0;
  }).length;

  const activeLoans = loansWithStats.filter(l => l.status !== "settled" && l.remaining > 0);
  const nextLoanDue = (() => {
    const dues = activeLoans.flatMap(loan => {
      if (!loan.start_date || !Number(loan.monthly_installment)) return [];
      const day = new Date(loan.start_date + "T00:00:00").getDate();
      const now = new Date();
      let d = new Date(now.getFullYear(), now.getMonth(), day);
      if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
      return [d];
    });
    if (!dues.length) return null;
    dues.sort((a, b) => a - b);
    return dues[0].toLocaleDateString("en-US", { month: "short", day: "numeric" });
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── HEADER ──────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, letterSpacing: "0.06em" }}>
          {totalReimburse > 0 &&
            `${fmtIDR(totalReimburse, true)} reimburse outstanding`}
          {totalLoanOutstanding > 0 && totalReimburse > 0 && "  ·  "}
          {totalLoanOutstanding > 0 &&
            `${fmtIDR(totalLoanOutstanding, true)} loans outstanding`}
        </div>
        <Button variant="primary" size="sm" onClick={() => {
          setOutForm({ date: todayStr(), description: "", amount: "", entity: "Hamasa", from_id: spendAccounts[0]?.id || "", notes: "", cash_advance_fee: "" });
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
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* ── Summary cards ── */}
          {reimburseAccs.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {[
                { label: "Total Outstanding", value: fmtIDR(totalReimburse, true), color: totalReimburse > 0 ? "#059669" : "#6b7280" },
                { label: "Active Entities",   value: String(activeReimburse),       color: "#3b5bdb" },
                { label: "Total Entities",    value: String(reimburseAccs.length),  color: "#d97706" },
              ].map(s => (
                <div key={s.label} style={{ background: s.color + "14", borderRadius: 14, padding: "14px 14px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {reimburseAccs.length === 0 ? (
            <EmptyState icon="📋" message="No reimburse accounts. Add one from Accounts (type: Receivable → Reimburse)." />
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <SortDropdown
                  storageKey="sort_receivables"
                  options={[
                    { key: "outstanding", label: "Outstanding", defaultDir: "desc" },
                    { key: "name",        label: "Name",        defaultDir: "asc"  },
                  ]}
                  value={reimSort}
                  onChange={v => setReimSort(v)}
                />
              </div>
              {[...recStats].sort((a, b) => {
                const aOut = (reimburseStats[a.entity] || { out: 0, in: 0 });
                const bOut = (reimburseStats[b.entity] || { out: 0, in: 0 });
                const aNet = aOut.out - aOut.in;
                const bNet = bOut.out - bOut.in;
                switch (reimSort) {
                  case "outstanding_asc": return aNet - bNet;
                  case "name_asc":        return (a.entity || a.name || "").localeCompare(b.entity || b.name || "");
                  case "name_desc":       return (b.entity || b.name || "").localeCompare(a.entity || a.name || "");
                  default:                return bNet - aNet;
                }
              }).map(r => {
              // Compute outstanding dynamically from ledger
              const entStats   = reimburseStats[r.entity] || { out: 0, in: 0 };
              const outstanding = entStats.out - entStats.in; // may be negative (overpaid)
              const entCol      = ENT_COL[r.entity] || T.ac;
              const entBg       = ENT_BG[r.entity]  || T.sur2;

              // All reimburse rows for this entity (entity-based, not account-id-based)
              const entityShowSettled = showSettled[r.entity] || false;
              const allOutRows = ledger.filter(e =>
                e.tx_type === "reimburse_out" && e.entity === r.entity
              ).sort((a, b) => b.tx_date.localeCompare(a.tx_date));
              const allInRows = ledger.filter(e =>
                e.tx_type === "reimburse_in" && e.entity === r.entity
              ).sort((a, b) => b.tx_date.localeCompare(a.tx_date));
              const outRows = entityShowSettled ? allOutRows : allOutRows.filter(e => !e.reimburse_settlement_id);
              const inRows  = entityShowSettled ? allInRows  : allInRows.filter(e => !e.reimburse_settlement_id);
              const hasSettled = allOutRows.some(e => e.reimburse_settlement_id) || allInRows.some(e => e.reimburse_settlement_id);

              const entitySettlements = settlements.filter(s => s.entity === r.entity);

              const selOut = selectedOut[r.id] || new Set();
              const selIn  = selectedIn[r.id]  || new Set();
              const selOutEntries = outRows.filter(e => selOut.has(e.id));
              const selInEntries  = inRows.filter(e => selIn.has(e.id));
              const totalOutSel  = selOutEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
              const totalInSel   = selInEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
              const reimbursable = totalOutSel - totalInSel;
              const canSettle    = selOut.size > 0 && selIn.size > 0;

              return (
                <div key={r.id} style={{ background: "#ffffff", border: "0.5px solid #e5e7eb", borderRadius: 16, overflow: "hidden" }}>
                  {/* Color bar */}
                  <div style={{ height: 3, background: entCol }} />

                  <div style={{ padding: "14px 16px" }}>
                    {/* ── Card header ── */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div>
                        <span style={{ display: "inline-block", background: entBg, color: entCol, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 700, fontFamily: "Figtree, sans-serif" }}>
                          {r.entity}
                        </span>
                        <div style={{ fontSize: 20, fontWeight: 900, color: outstanding > 0 ? entCol : outstanding < 0 ? "#059669" : "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 4, lineHeight: 1.2 }}>
                          {fmtIDR(Math.abs(outstanding))}
                        </div>
                        <div style={{ fontSize: 11, color: outstanding < 0 ? "#059669" : "#9ca3af", fontFamily: "Figtree, sans-serif", fontWeight: outstanding < 0 ? 700 : 400 }}>
                          {outstanding < 0 ? "lebih bayar" : "outstanding"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {hasSettled && (
                          <button
                            onClick={() => setShowSettled(prev => ({ ...prev, [r.entity]: !prev[r.entity] }))}
                            style={{ height: 30, padding: "0 12px", border: "1px solid #e5e7eb", borderRadius: 8, cursor: "pointer", background: "transparent", color: "#6b7280", fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
                          >
                            {entityShowSettled ? "Hide settled" : "Show settled"}
                          </button>
                        )}
                        <button
                          onClick={() => { setHistoryEntity(r.entity); setHistoryModal(true); }}
                          style={{ height: 30, padding: "0 12px", border: `1px solid ${entCol}`, borderRadius: 8, cursor: "pointer", background: "transparent", color: entCol, fontSize: 12, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
                        >
                          History
                        </button>
                        <button
                          onClick={() => { setOutForm(f => ({ ...f, entity: r.entity })); setOutModal(true); }}
                          style={{ height: 30, padding: "0 14px", border: "none", borderRadius: 8, cursor: "pointer", background: entBg, color: entCol, fontSize: 12, fontWeight: 700, fontFamily: "Figtree, sans-serif" }}
                        >
                          + Expense
                        </button>
                      </div>
                    </div>

                    {/* ── Two-column settle UI ── */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {/* Left: Expenses OUT */}
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "Figtree, sans-serif", marginBottom: 6 }}>
                          Expenses (Out)
                        </div>
                        {outRows.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#9ca3af", padding: "6px 0" }}>No expenses recorded</div>
                        ) : outRows.map(e => {
                          const settled    = !!e.reimburse_settlement_id;
                          const isSelected = !settled && selOut.has(e.id);
                          const fromAcc    = accounts.find(a => a.id === e.from_id);
                          return (
                            <div
                              key={e.id}
                              onClick={settled ? undefined : () => toggleOutRow(r.id, e.id)}
                              style={{
                                cursor: settled ? "default" : "pointer",
                                opacity: settled ? 0.45 : 1,
                                border: isSelected ? "1.5px solid #dc2626" : "1px solid #f3f4f6",
                                borderRadius: 8, padding: "8px 10px", marginBottom: 4,
                                background: isSelected ? "#fff5f5" : "#fafafa",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "Figtree, sans-serif" }}>{e.description}</div>
                                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
                                    {e.tx_date} · {fromAcc?.name || "—"}
                                    {settled && <span style={{ marginLeft: 4, color: "#d1d5db" }}>· settled</span>}
                                  </div>
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", flexShrink: 0 }}>{fmtIDR(Number(e.amount || 0), true)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Right: Received IN */}
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "Figtree, sans-serif", marginBottom: 6 }}>
                          Received (In)
                        </div>
                        {inRows.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#9ca3af", padding: "6px 0" }}>No payments received</div>
                        ) : inRows.map(e => {
                          const settled    = !!e.reimburse_settlement_id;
                          const isSelected = !settled && selIn.has(e.id);
                          const toAcc      = accounts.find(a => a.id === e.to_id);
                          return (
                            <div
                              key={e.id}
                              onClick={settled ? undefined : () => toggleInRow(r.id, e.id)}
                              style={{
                                cursor: settled ? "default" : "pointer",
                                opacity: settled ? 0.45 : 1,
                                border: isSelected ? "1.5px solid #059669" : "1px solid #f3f4f6",
                                borderRadius: 8, padding: "8px 10px", marginBottom: 4,
                                background: isSelected ? "#f0fdf4" : "#fafafa",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 4 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "Figtree, sans-serif" }}>{e.description}</div>
                                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1 }}>
                                    {e.tx_date} · {toAcc?.name || "—"}
                                    {settled && <span style={{ marginLeft: 4, color: "#d1d5db" }}>· settled</span>}
                                  </div>
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", flexShrink: 0 }}>+{fmtIDR(Number(e.amount || 0), true)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Summary + Settle ── */}
                    {(selOut.size > 0 || selIn.size > 0) && (
                      <div style={{ marginTop: 10, borderTop: "0.5px solid #f3f4f6", paddingTop: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3, fontFamily: "Figtree, sans-serif" }}>
                          <span style={{ color: "#9ca3af" }}>Total Out selected</span>
                          <span style={{ fontWeight: 700, color: "#dc2626" }}>{fmtIDR(totalOutSel)}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8, fontFamily: "Figtree, sans-serif" }}>
                          <span style={{ color: "#9ca3af" }}>Total In selected</span>
                          <span style={{ fontWeight: 700, color: "#059669" }}>+{fmtIDR(totalInSel)}</span>
                        </div>
                        <div style={{ borderTop: "0.5px solid #e5e7eb", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>Reimbursable Expense ({r.entity} RE)</div>
                            <div style={{ fontSize: 16, fontWeight: 900, fontFamily: "Figtree, sans-serif", color: reimbursable > 0 ? "#dc2626" : "#059669" }}>
                              {fmtIDR(Math.abs(reimbursable))}
                            </div>
                          </div>
                          <button
                            onClick={() => handleSettleEntity(r.entity, r)}
                            disabled={!canSettle || settling}
                            style={{
                              height: 34, padding: "0 18px", border: "none", borderRadius: 8,
                              cursor: canSettle && !settling ? "pointer" : "not-allowed",
                              background: canSettle ? entCol : "#e5e7eb",
                              color: canSettle ? "#fff" : "#9ca3af",
                              fontSize: 13, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                              opacity: settling ? 0.6 : 1,
                            }}
                          >
                            {settling ? "Settling…" : "Settle →"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── Settlement history ── */}
                    {entitySettlements.length > 0 && (
                      <div style={{ marginTop: 14, borderTop: "0.5px solid #f3f4f6", paddingTop: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "Figtree, sans-serif", marginBottom: 6 }}>
                          Settlement History
                        </div>
                        {entitySettlements.map(s => {
                          const isExpanded = expandedSett.has(s.id);
                          const date = new Date(s.settled_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                          const outLedger = ledger.filter(e => (s.out_ledger_ids || []).includes(e.id));
                          const inLedger  = ledger.filter(e => (s.in_ledger_ids  || []).includes(e.id));
                          const re = Number(s.reimbursable_expense || 0);
                          return (
                            <div key={s.id} style={{ border: "0.5px solid #f3f4f6", borderRadius: 8, marginBottom: 4, overflow: "hidden" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "#fafafa" }}>
                                <div
                                  onClick={() => setExpandedSett(prev => { const ns = new Set(prev); ns.has(s.id) ? ns.delete(s.id) : ns.add(s.id); return ns; })}
                                  style={{ flex: 1, cursor: "pointer", minWidth: 0 }}
                                >
                                  <div style={{ fontSize: 11, fontWeight: 700, color: "#374151", fontFamily: "Figtree, sans-serif" }}>{date}</div>
                                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1, fontFamily: "Figtree, sans-serif" }}>
                                    Out {fmtIDR(Number(s.total_out || 0), true)} · In {fmtIDR(Number(s.total_in || 0), true)} ·{" "}
                                    <span style={{ fontWeight: 700, color: re > 0 ? "#dc2626" : "#059669" }}>RE {fmtIDR(re, true)}</span>
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                                  <button
                                    onClick={e => { e.stopPropagation(); openEditSettle(s); }}
                                    style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 4px", fontSize: 13, color: "#9ca3af", lineHeight: 1 }}
                                    title="Edit"
                                  >✏️</button>
                                  <button
                                    onClick={e => { e.stopPropagation(); handleDeleteSettle(s); }}
                                    style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 4px", fontSize: 13, color: "#9ca3af", lineHeight: 1 }}
                                    title="Delete"
                                  >🗑</button>
                                  <span
                                    onClick={() => setExpandedSett(prev => { const ns = new Set(prev); ns.has(s.id) ? ns.delete(s.id) : ns.add(s.id); return ns; })}
                                    style={{ fontSize: 10, color: "#9ca3af", cursor: "pointer", padding: "2px 4px" }}
                                  >{isExpanded ? "▲" : "▼"}</span>
                                </div>
                              </div>
                              {isExpanded && (
                                <div style={{ padding: "8px 10px", borderTop: "0.5px solid #f3f4f6", background: "#fff" }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", marginBottom: 4, fontFamily: "Figtree, sans-serif" }}>OUT</div>
                                  {outLedger.map(e => (
                                    <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3, fontFamily: "Figtree, sans-serif" }}>
                                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>{e.description} · {e.tx_date}</span>
                                      <span style={{ fontWeight: 700, color: "#dc2626", flexShrink: 0, marginLeft: 6 }}>{fmtIDR(Number(e.amount || 0), true)}</span>
                                    </div>
                                  ))}
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", margin: "8px 0 4px", fontFamily: "Figtree, sans-serif" }}>IN</div>
                                  {inLedger.map(e => (
                                    <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3, fontFamily: "Figtree, sans-serif" }}>
                                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>{e.description} · {e.tx_date}</span>
                                      <span style={{ fontWeight: 700, color: "#059669", flexShrink: 0, marginLeft: 6 }}>+{fmtIDR(Number(e.amount || 0), true)}</span>
                                    </div>
                                  ))}
                                  <div style={{ borderTop: "0.5px solid #f3f4f6", paddingTop: 6, marginTop: 4, display: "flex", justifyContent: "space-between", fontSize: 12, fontFamily: "Figtree, sans-serif" }}>
                                    <span style={{ fontWeight: 700, color: "#374151" }}>{r.entity} RE</span>
                                    <span style={{ fontWeight: 900, color: re > 0 ? "#dc2626" : "#059669" }}>{fmtIDR(re)}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── LOANS TAB ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "loans" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* ── Summary cards + Add button row ── */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, flex: 1 }}>
              {[
                { label: "Total Outstanding",  value: fmtIDR(totalLoanOutstanding, true), color: totalLoanOutstanding > 0 ? "#d97706" : "#6b7280" },
                { label: "Active Employees",   value: String(activeLoans.length),          color: "#3b5bdb" },
                { label: "Next Payment Due",   value: nextLoanDue || "—",                  color: "#0891b2" },
              ].map(s => (
                <div key={s.label} style={{ background: s.color + "14", borderRadius: 14, padding: "14px 14px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
            <Button variant="primary" size="sm" onClick={() => { setLoanForm(EMPTY_LOAN); setAddLoanModal(true); }}
              style={{ flexShrink: 0, alignSelf: "center" }}>
              + Add Loan
            </Button>
          </div>

          {loansWithIndex.length === 0 ? (
            <EmptyState icon="👤" message="No employee loans yet. Click + Add Loan to create one." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {loansWithIndex.map(loan => {
                const total     = Number(loan.total_amount || 0);
                const paid      = loan.paidSoFar;
                const remaining = loan.remaining;
                const monthly   = Number(loan.monthly_installment || 0);
                const isSettled = loan.status === "settled" || remaining <= 0;
                const totalMo   = total > 0 && monthly > 0 ? Math.ceil(total / monthly) : 0;
                const paidMo    = monthly > 0 ? Math.floor(paid / monthly) : 0;
                const pct       = totalMo > 0 ? Math.min(100, (paidMo / totalMo) * 100) : 0;
                const accentColor = isSettled ? "#059669" : "#d97706";

                const initials = (loan.employee_name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

                const startedLabel = loan.start_date
                  ? new Date(loan.start_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })
                  : null;

                const nextDueLabel = (() => {
                  if (!loan.start_date || !monthly || isSettled) return null;
                  const day = new Date(loan.start_date + "T00:00:00").getDate();
                  const now = new Date();
                  let d = new Date(now.getFullYear(), now.getMonth(), day);
                  if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, day);
                  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
                })();

                return (
                  <div key={loan.id} style={{
                    background: "#ffffff", borderRadius: 16,
                    border: "0.5px solid #e5e7eb",
                    overflow: "hidden",
                    display: "flex", flexDirection: "column",
                  }}>
                    {/* Color bar */}
                    <div style={{ height: 3, background: accentColor }} />

                    <div style={{ padding: "14px 14px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                      {/* Avatar + name + dept */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                          background: isSettled ? "#dcfce7" : "#fef3c7",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 800, color: accentColor, fontFamily: "Figtree, sans-serif",
                        }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {loan.employee_name}
                          </div>
                          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
                            {loan.totalLoansForEmployee > 1 ? (
                              <span style={{ fontWeight: 700, color: isSettled ? "#059669" : "#d97706" }}>
                                {`Loan #${loan.loanIndex}${startedLabel ? ` · ${startedLabel}` : ""} · ${isSettled ? "SETTLED" : "ACTIVE"}`}
                              </span>
                            ) : (
                              [loan.employee_dept, startedLabel ? `Started ${startedLabel}` : null].filter(Boolean).join(" · ")
                            )}
                          </div>
                        </div>
                        {isSettled && (
                          <span style={{ fontSize: 9, fontWeight: 700, background: "#dcfce7", color: "#059669", padding: "2px 6px", borderRadius: 99, flexShrink: 0 }}>SETTLED</span>
                        )}
                      </div>

                      {/* Total amount */}
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 900, color: "#111827", fontFamily: "Figtree, sans-serif", lineHeight: 1.2 }}>
                          {fmtIDR(total)}
                        </div>
                        {monthly > 0 && totalMo > 0 && (
                          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                            {fmtIDR(monthly, true)}/mo × {totalMo} months
                          </div>
                        )}
                      </div>

                      {/* Progress bar */}
                      {totalMo > 0 && (
                        <div>
                          <div style={{ height: 5, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: accentColor, borderRadius: 99, transition: "width 0.3s" }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 4 }}>
                            <span>{paidMo}/{totalMo} months paid</span>
                            <span style={{ fontWeight: 700, color: accentColor }}>Remaining: {fmtIDR(remaining, true)}</span>
                          </div>
                        </div>
                      )}

                      {/* Paid so far */}
                      <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                        Paid: <span style={{ fontWeight: 700, color: "#059669" }}>{fmtIDR(paid, true)}</span>
                        {" "}of <span style={{ fontWeight: 600, color: "#374151" }}>{fmtIDR(total, true)}</span> total
                      </div>

                      {/* Next due */}
                      {nextDueLabel && (
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                          Next due: <span style={{ fontWeight: 700, color: "#111827" }}>{nextDueLabel}</span>
                        </div>
                      )}

                      {/* Notes */}
                      {loan.notes && (
                        <div style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic", fontFamily: "Figtree, sans-serif" }}>{loan.notes}</div>
                      )}

                      {/* Payment history from ledger */}
                      <div style={{ borderTop: "0.5px solid #f3f4f6", paddingTop: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.5px", fontFamily: "Figtree, sans-serif", marginBottom: 6 }}>
                          Payment History
                        </div>
                        {loan.ledgerPays.length === 0 ? (
                          <div style={{ fontSize: 11, color: "#d1d5db", fontFamily: "Figtree, sans-serif" }}>No payments recorded yet</div>
                        ) : (
                          [...loan.ledgerPays].sort((a, b) => (b.tx_date || "").localeCompare(a.tx_date || "")).map(p => {
                            const toAcc = accounts.find(a => a.id === p.to_id);
                            const dateStr = p.tx_date
                              ? new Date(p.tx_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                              : "—";
                            return (
                              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", fontSize: 11, marginBottom: 4, gap: 6 }}>
                                <div style={{ color: "#6b7280", fontFamily: "Figtree, sans-serif", flex: 1, minWidth: 0 }}>
                                  {dateStr}
                                  {toAcc && <span style={{ color: "#9ca3af" }}> · {toAcc.name}</span>}
                                  {p.notes && <span style={{ color: "#9ca3af" }}> · {p.notes}</span>}
                                </div>
                                <div style={{ fontWeight: 700, color: "#059669", flexShrink: 0, fontFamily: "Figtree, sans-serif" }}>
                                  +{fmtIDR(Number(p.amount || 0), true)}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    {/* Bottom action bar */}
                    <div style={{ borderTop: "0.5px solid #f3f4f6", padding: "10px 14px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
                      {/* Row 1: + Payment (active only) or + New Loan (settled only), full width */}
                      {!isSettled ? (
                        <button
                          onClick={() => { setTxModalLoan(loan); setTxModalOpen(true); }}
                          style={{ width: "100%", height: 34, border: "none", borderRadius: 8, cursor: "pointer", background: "#d97706", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "Figtree, sans-serif", letterSpacing: "0.01em" }}
                        >
                          + Payment
                        </button>
                      ) : (
                        <button
                          onClick={() => { setNewLoanEmployeeName(loan.employee_name); setNewLoanModalOpen(true); }}
                          style={{ width: "100%", height: 34, border: "none", borderRadius: 8, cursor: "pointer", background: "#d97706", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "Figtree, sans-serif", letterSpacing: "0.01em" }}
                        >
                          + New Loan
                        </button>
                      )}
                      {/* Row 2: Statement + Edit + Delete */}
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <button
                          onClick={() => { setStmtLoan(loan); setStmtOpen(true); }}
                          style={{ flex: 1, height: 28, padding: "0 10px", border: "1px solid #e5e7eb", borderRadius: 7, cursor: "pointer", background: "#fff", color: "#374151", fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
                        >
                          Statement
                        </button>
                        <button
                          onClick={() => { setSelectedLoan(loan); setLoanForm({ employee_name: loan.employee_name, employee_dept: loan.employee_dept || "", total_amount: String(loan.total_amount || ""), monthly_installment: String(loan.monthly_installment || ""), start_date: loan.start_date || todayStr(), notes: loan.notes || "" }); setEditLoanModal(true); }}
                          style={{ flex: 1, height: 28, padding: "0 10px", border: "1px solid #e5e7eb", borderRadius: 7, cursor: "pointer", background: "#fff", color: "#374151", fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteLoan(loan)}
                          style={{ height: 28, width: 28, border: "none", borderRadius: 7, cursor: "pointer", background: "none", color: "#d1d5db", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "Figtree, sans-serif" }}
                          onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                          onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
              <Input type="date" value={outForm.date} onChange={e => setOutForm(f => ({ ...f, date: e.target.value }))} />
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
          <AmountInput
            label="Cash Advance Fee (optional)"
            value={outForm.cash_advance_fee}
            onChange={v => setOutForm(f => ({ ...f, cash_advance_fee: v }))}
            currency="IDR"
          />
          <Field label="Notes">
            <Input value={outForm.notes} onChange={e => setOutForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
          </Field>
        </div>
      </Modal>


      {/* ── ADD LOAN MODAL ───────────────────────────────── */}
      <Modal
        isOpen={addLoanModal}
        onClose={() => setAddLoanModal(false)}
        title="Add Employee Loan"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setAddLoanModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!loanForm.employee_name || !loanForm.total_amount}
              onClick={handleAddLoan}
            >
              Add Loan
            </Button>
          </div>
        }
      >
        <LoanFormFields form={loanForm} setForm={setLoanForm} T={T} showAlreadyPaid />
      </Modal>

      {/* ── EDIT LOAN MODAL ──────────────────────────────── */}
      <Modal
        isOpen={editLoanModal && !!selectedLoan}
        onClose={() => setEditLoanModal(false)}
        title={`Edit Loan — ${selectedLoan?.employee_name || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setEditLoanModal(false)}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!loanForm.employee_name || !loanForm.total_amount}
              onClick={handleEditLoan}
            >
              Save
            </Button>
          </div>
        }
      >
        <LoanFormFields form={loanForm} setForm={setLoanForm} T={T} />
      </Modal>

      {/* ── STATEMENT MODAL ──────────────────────────────────── */}
      {stmtOpen && stmtLoan && (() => {
        const loan         = stmtLoan;
        const total        = Number(loan.total_amount || 0);
        const payments     = loanPayments
          .filter(p => p.loan_id === loan.id)
          .sort((a, b) => (a.pay_date || "").localeCompare(b.pay_date || ""));
        const totalCollected = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        const outstanding    = Math.max(0, total - totalCollected);
        const isSettledLoan  = loan.status === "settled" || outstanding <= 0;

        let runBal = total;
        const tableRows = payments.map(p => {
          runBal = Math.max(0, runBal - Number(p.amount || 0));
          return { ...p, sisa: runBal };
        });

        const exportPDF = () => {
          const prev = document.title;
          document.title = `${loan.employee_name}_LoanStatement`;
          window.print();
          document.title = prev;
        };

        const COL = "Figtree, sans-serif";
        const TH = { fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", padding: "6px 8px", borderBottom: "1.5px solid #e5e7eb", fontFamily: COL };
        const TD = { fontSize: 12, padding: "8px 8px", borderBottom: "0.5px solid #f3f4f6", fontFamily: COL, verticalAlign: "top" };

        return (
          <Modal
            isOpen={stmtOpen}
            onClose={() => { setStmtOpen(false); setStmtLoan(null); }}
            title="Loan Statement"
            width={600}
            footer={
              <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button variant="secondary" size="md" onClick={() => { setStmtOpen(false); setStmtLoan(null); }}>Close</Button>
                <Button variant="primary" size="md" onClick={exportPDF}>🖨 PDF</Button>
              </div>
            }
          >
            <div ref={stmtPrintRef} style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: COL }}>

              {/* ── Header ── */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>{loan.employee_name}</div>
                  {loan.employee_dept && <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{loan.employee_dept}</div>}
                </div>
                <span style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "4px 12px", borderRadius: 99, fontSize: 11, fontWeight: 700,
                  background: isSettledLoan ? "#dcfce7" : "#fef3c7",
                  color:      isSettledLoan ? "#059669" : "#d97706",
                }}>
                  {isSettledLoan ? "Settled" : "Active"}
                </span>
              </div>

              {/* ── Summary ── */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {[
                  { label: "Total Loaned",     value: fmtIDR(total),          color: "#3b5bdb" },
                  { label: "Total Collected",  value: fmtIDR(totalCollected), color: "#059669" },
                  { label: "Outstanding",      value: fmtIDR(outstanding),    color: outstanding > 0 ? "#d97706" : "#059669" },
                ].map(s => (
                  <div key={s.label} style={{ background: s.color + "12", borderRadius: 10, padding: "12px 12px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4, opacity: 0.8 }}>{s.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* ── Table ── */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, textAlign: "left", width: 88 }}>Tanggal</th>
                      <th style={{ ...TH, textAlign: "left" }}>Keterangan</th>
                      <th style={{ ...TH, textAlign: "right", width: 100 }}>Pinjam</th>
                      <th style={{ ...TH, textAlign: "right", width: 100 }}>Bayar</th>
                      <th style={{ ...TH, textAlign: "right", width: 110 }}>Sisa Hutang</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Opening row */}
                    {loan.start_date && (
                      <tr style={{ background: "#f0f9ff" }}>
                        <td style={{ ...TD, color: "#6b7280" }}>{loan.start_date}</td>
                        <td style={{ ...TD, fontWeight: 600, color: "#111827" }}>Initial Loan</td>
                        <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: "#3b5bdb" }}>{fmtIDR(total, true)}</td>
                        <td style={{ ...TD, textAlign: "right" }}>—</td>
                        <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: "#374151" }}>{fmtIDR(total, true)}</td>
                      </tr>
                    )}
                    {/* Payment rows */}
                    {tableRows.map(row => (
                      <tr key={row.id}>
                        <td style={{ ...TD, color: "#6b7280" }}>{row.pay_date}</td>
                        <td style={{ ...TD, color: "#374151" }}>{row.notes || "Payment"}</td>
                        <td style={{ ...TD, textAlign: "right" }}>—</td>
                        <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: "#059669" }}>{fmtIDR(Number(row.amount || 0), true)}</td>
                        <td style={{ ...TD, textAlign: "right", fontWeight: 700, color: row.sisa <= 0 ? "#059669" : "#374151" }}>
                          {row.sisa <= 0 ? <span style={{ color: "#059669" }}>LUNAS</span> : fmtIDR(row.sisa, true)}
                        </td>
                      </tr>
                    ))}
                    {tableRows.length === 0 && (
                      <tr><td colSpan={5} style={{ ...TD, textAlign: "center", color: "#9ca3af" }}>No payments recorded yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ── TRANSACTION MODAL (+ Payment) ─────────────────────── */}
      <TransactionModal
        open={txModalOpen}
        mode="add"
        defaultGroup="loan"
        defaultTxType="collect_loan"
        defaultAccount={{ from_id: txModalLoan?.id || null }}
        onSave={() => { setTxModalOpen(false); setTxModalLoan(null); onRefresh?.(); }}
        onClose={() => { setTxModalOpen(false); setTxModalLoan(null); }}
        user={user}
        accounts={accounts}
        setLedger={setLedger}
        categories={categories || []}
        fxRates={fxRates}
        allCurrencies={CURRENCIES}
        bankAccounts={allBankCashAccounts}
        creditCards={creditCards}
        assets={assets}
        liabilities={liabilities}
        receivables={[]}
        incomeSrcs={incomeSrcs}
        employeeLoans={employeeLoans}
        setEmployeeLoans={setEmployeeLoans}
        accountCurrencies={accountCurrencies}
        onRefresh={onRefresh}
      />

      {/* ── TRANSACTION MODAL (+ New Loan for settled employees) ─── */}
      <TransactionModal
        open={newLoanModalOpen}
        mode="add"
        defaultGroup="loan"
        defaultTxType="give_loan"
        defaultEmployeeName={newLoanEmployeeName}
        onSave={() => { setNewLoanModalOpen(false); setNewLoanEmployeeName(""); onRefresh?.(); }}
        onClose={() => { setNewLoanModalOpen(false); setNewLoanEmployeeName(""); }}
        user={user}
        accounts={accounts}
        setLedger={setLedger}
        categories={categories || []}
        fxRates={fxRates}
        allCurrencies={CURRENCIES}
        bankAccounts={allBankCashAccounts}
        creditCards={creditCards}
        assets={assets}
        liabilities={liabilities}
        receivables={[]}
        incomeSrcs={incomeSrcs}
        employeeLoans={employeeLoans}
        setEmployeeLoans={setEmployeeLoans}
        accountCurrencies={accountCurrencies}
        onRefresh={onRefresh}
      />

      {/* ── EDIT SETTLEMENT MODAL ───────────────────────── */}
      <Modal
        isOpen={editSModal && !!editSItem}
        onClose={() => setEditSModal(false)}
        title={`Edit Settlement — ${editSItem?.entity || ""}`}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setEditSModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={editSSaving} onClick={handleEditSettle}>Save</Button>
          </div>
        }
      >
        {editSItem && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Read-only summary */}
            <div style={{ background: "#f9fafb", borderRadius: 10, padding: "10px 14px", display: "flex", gap: 16, fontSize: 12, fontFamily: "Figtree, sans-serif" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 2 }}>Total Out</div>
                <div style={{ fontWeight: 700, color: "#dc2626" }}>{fmtIDR(Number(editSItem.total_out || 0))}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 2 }}>Total In</div>
                <div style={{ fontWeight: 700, color: "#059669" }}>+{fmtIDR(Number(editSItem.total_in || 0))}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", marginBottom: 2 }}>RE</div>
                <div style={{ fontWeight: 700, color: Number(editSItem.reimbursable_expense || 0) > 0 ? "#dc2626" : "#059669" }}>
                  {fmtIDR(Number(editSItem.reimbursable_expense || 0))}
                </div>
              </div>
            </div>
            <FormRow>
              <Field label="Date">
                <Input
                  type="date"
                  value={editSForm.settled_at}
                  onChange={e => setEditSForm(f => ({ ...f, settled_at: e.target.value }))}
                />
              </Field>
            </FormRow>
            <Field label="Notes">
              <Input
                value={editSForm.notes}
                onChange={e => setEditSForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* ── REIMBURSE HISTORY MODAL ──────────────────────── */}
      <Modal
        isOpen={historyModal && !!historyEntity}
        onClose={() => setHistoryModal(false)}
        title={`History — ${historyEntity || ""}`}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setHistoryModal(false)}>Close</Button>
          </div>
        }
      >
        {historyEntity && (() => {
          const rows = ledger
            .filter(e => e.entity === historyEntity && (e.tx_type === "reimburse_out" || e.tx_type === "reimburse_in"))
            .sort((a, b) => b.tx_date.localeCompare(a.tx_date));

          if (rows.length === 0) {
            return <div style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", padding: "24px 0" }}>No history yet.</div>;
          }

          const totalOut = rows.filter(e => e.tx_type === "reimburse_out").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
          const totalIn  = rows.filter(e => e.tx_type === "reimburse_in").reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
          const selisih  = totalOut - totalIn;

          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {/* Table header */}
              <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 90px", gap: 6, padding: "6px 8px", background: "#f9fafb", borderRadius: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>Date</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em" }}>Description</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Out</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>In</div>
              </div>

              {/* Rows */}
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {rows.map(e => {
                  const isOut = e.tx_type === "reimburse_out";
                  const amt   = Number(e.amount_idr || e.amount || 0);
                  return (
                    <div key={e.id} style={{ display: "grid", gridTemplateColumns: "80px 1fr 90px 90px", gap: 6, padding: "8px 8px", borderBottom: "0.5px solid #f3f4f6" }}>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{e.tx_date}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", textAlign: "right" }}>
                        {isOut ? fmtIDR(amt, true) : "—"}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#059669", textAlign: "right" }}>
                        {!isOut ? `+${fmtIDR(amt, true)}` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div style={{ borderTop: "1.5px solid #e5e7eb", marginTop: 4, padding: "10px 8px 2px", display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#6b7280" }}>Total Out</span>
                  <span style={{ fontWeight: 700, color: "#dc2626" }}>{fmtIDR(totalOut)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: "#6b7280" }}>Total In</span>
                  <span style={{ fontWeight: 700, color: "#059669" }}>+{fmtIDR(totalIn)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800, borderTop: "0.5px solid #e5e7eb", paddingTop: 6, marginTop: 2 }}>
                  <span style={{ color: "#374151" }}>Selisih (Outstanding)</span>
                  <span style={{ color: selisih > 0 ? "#d97706" : "#059669" }}>{selisih > 0 ? "" : "+"}{fmtIDR(Math.abs(selisih))}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>

    </div>
  );
}
