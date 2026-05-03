import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ledgerApi, installmentsApi, recurringApi, getTxFromToTypes, accountsApi } from "../api";
import { supabase } from "../lib/supabase";
import { ENTITIES, BANKS_L, NETWORKS } from "../constants";
import { fmtIDR, todayStr, ym, daysUntil } from "../utils";
import Modal, { ConfirmModal } from "./shared/Modal";
import Button from "./shared/Button";
import GlobalReconcileButton from "./shared/GlobalReconcileButton";
import Input, { Field, AmountInput, FormRow } from "./shared/Input";
import Select from "./shared/Select";
import { EmptyState, showToast } from "./shared/Card";
import SortDropdown from "./shared/SortDropdown";
import ReconcileDraftBanner from "./shared/ReconcileDraftBanner";

const SUBTABS = [
  { id: "overview",     label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "installments", label: "Installments" },
  { id: "recurring",    label: "Recurring" },
];

// ─── NETWORK BADGE TEXT ──────────────────────────────────────
const NETWORK_STYLE = {
  Visa:       { text: "VISA",       style: { fontStyle: "italic", fontWeight: 800, letterSpacing: 1 } },
  Mastercard: { text: "MC",         style: { fontWeight: 900 } },
  JCB:        { text: "JCB",        style: { fontWeight: 800 } },
  Amex:       { text: "AMEX",       style: { fontWeight: 800, letterSpacing: 1 } },
  UnionPay:   { text: "UnionPay",   style: { fontWeight: 700, fontSize: 9 } },
};

const CARD_PALETTE = [
  "#3b5bdb", "#0891b2", "#059669", "#d97706", "#7c3aed",
  "#e03131", "#0f766e", "#b45309", "#1d4ed8", "#9333ea",
  "#0e7490", "#16a34a", "#ca8a04", "#c026d3", "#0284c7",
];

const CC_BTN = (bg, color, border = "transparent") => ({
  height: 30, padding: "0 10px", borderRadius: 8, border: `1px solid ${border}`,
  background: bg, color, fontSize: 11, fontWeight: 700, cursor: "pointer",
  fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
});

const CC_SECONDARY_BTN = {
  background: "transparent", border: "0.5px solid rgba(0,0,0,0.15)",
  padding: "8px 10px", borderRadius: 8, fontSize: 12, cursor: "pointer",
  color: "#5F5E5A", fontFamily: "Figtree, sans-serif",
};

// ─── DUE DATE HELPERS ─────────────────────────────────────────
function formatDueDate(dueDay) {
  if (!dueDay) return "";
  const today = new Date();
  const due = new Date(today.getFullYear(), today.getMonth(), dueDay);
  if (due <= today) due.setMonth(due.getMonth() + 1);
  const d = Math.ceil((due - today) / 86400000);
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  if (d <= 7)  return `Due in ${d}d`;
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `Due ${due.getDate()} ${months[due.getMonth()]}`;
}
function isDueWithin3Days(dueDay) {
  if (!dueDay) return false;
  const today = new Date();
  const due = new Date(today.getFullYear(), today.getMonth(), dueDay);
  if (due <= today) due.setMonth(due.getMonth() + 1);
  return Math.ceil((due - today) / 86400000) <= 3;
}
function lightenColor(hex, pct) {
  const n = parseInt((hex || "#3b5bdb").replace("#", ""), 16);
  const amt = Math.round(2.55 * pct);
  const r = Math.min(255, (n >> 16) + amt);
  const g = Math.min(255, ((n >> 8) & 0xff) + amt);
  const b = Math.min(255, (n & 0xff) + amt);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

// ─── PEEK HEIGHT ─────────────────────────────────────────────
const PEEK_H = 70;

// Derive a darker accent from hex color
function darkenHex(hex, amount = 40) {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, (n >> 16) - amount);
  const g = Math.max(0, ((n >> 8) & 0xff) - amount);
  const b = Math.max(0, (n & 0xff) - amount);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

export default function CreditCards({
  user, accounts, ledger, thisMonthLedger, categories,
  installments, recurTemplates, fxRates = {},
  setAccounts, setLedger, setInstallments, setRecurTemplates,
  onRefresh, bankAccounts: propBankAccounts,
  pendingReconcileNav = null, setPendingReconcileNav,
}) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const [subTab,           setSubTab]           = useState("overview");
  const [selectedCard,     setSelectedCard]     = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!pendingReconcileNav || pendingReconcileNav.accType !== "credit_card") return;
    const seeds = pendingReconcileNav.seeds || null;
    navigate(`/accounts/${pendingReconcileNav.acc.id}/statement`, { state: { reconcileSeeds: seeds } });
    setPendingReconcileNav?.(null);
  }, [pendingReconcileNav]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ccBankFilter, setCcBankFilter] = useState("all");
  const [ccSort,       setCcSort]       = useState(() => localStorage.getItem("sort_cc") || "debt_desc");
  const [filterMonth,  setFilterMonth]  = useState("");
  const [modal,        setModal]        = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [deleteInstId, setDeleteInstId] = useState(null);

  // Edit card state
  const emptyEditCardForm = () => ({ name: "", bank_name: "", last4: "", network: "", card_limit: "", statement_day: "", due_day: "", color: "", shared_limit_on: false, shared_group_mode: "create", shared_limit_group_id: null, shared_limit: "", is_limit_group_master: false, card_image_url: "" });
  const [editCardModal,    setEditCardModal]    = useState(false);
  const [editCardAcc,      setEditCardAcc]      = useState(null);
  const [editCardForm,     setEditCardForm]     = useState(emptyEditCardForm());
  const [imageUploading,   setImageUploading]   = useState(false);
  const imageInputRef = useRef();
  const setEC = (k, v) => setEditCardForm(f => ({ ...f, [k]: v }));

  const handleCardImageUpload = async (file) => {
    if (!file || !editCardAcc?.id) return;
    setImageUploading(true);
    try {
      const ext  = file.name.slice(file.name.lastIndexOf(".")) || ".jpg";
      const path = `${user.id}/${editCardAcc.id}-${Date.now()}${ext}`;
      const { error } = await supabase.storage.from("card-images").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from("card-images").getPublicUrl(path);
      setEC("card_image_url", publicUrl);
    } catch (e) { showToast(e.message || "Upload failed", "error"); }
    setImageUploading(false);
  };

  // Add CC form
  const emptyCardForm = () => ({ name: "", bank_name: "", last4: "", network: "", card_limit: "", monthly_target: "", statement_day: "", due_day: "" });
  const [addCardForm, setAddCardForm] = useState(emptyCardForm());
  const setAC = (k, v) => setAddCardForm(f => ({ ...f, [k]: v }));

  // Pay CC form
  const [payForm, setPayForm] = useState({
    cardId: "", bankId: "", amount: "", admin_fee: "", stamp_duty: "", notes: "",
  });
  const setP = (k, v) => setPayForm(f => ({ ...f, [k]: v }));

  // Installment form
  const [instForm, setInstForm] = useState({
    account_id: "", description: "", total_amount: "", months: 12,
    monthly_amount: "", start_date: todayStr(), entity: "Personal",
  });
  const setI = (k, v) => setInstForm(f => ({ ...f, [k]: v }));

  const creditCards  = useMemo(() => accounts.filter(a => a.type === "credit_card"), [accounts]);
  const bankAccounts = useMemo(() =>
    propBankAccounts || accounts.filter(a => a.type === "bank"),
  [propBankAccounts, accounts]);

  // ── Shared-limit groups ──
  const { groupMap, groupedCardIds } = useMemo(() => {
    const gm = {};
    const gids = new Set();
    creditCards.forEach(cc => {
      if (!cc.shared_limit_group_id) return;
      gids.add(cc.id);
      if (!gm[cc.shared_limit_group_id]) {
        gm[cc.shared_limit_group_id] = { id: cc.shared_limit_group_id, master: null, members: [], totalDebt: 0, totalCR: 0, sharedLimit: 0, name: "" };
      }
      const g = gm[cc.shared_limit_group_id];
      g.members.push(cc);
      g.totalDebt += Number(cc.outstanding_amount || 0);
      g.totalCR   += Number(cc.current_balance   || 0);
      if (cc.is_limit_group_master) {
        g.master = cc;
        g.sharedLimit = Number(cc.shared_limit || 0);
        g.name = cc.notes || cc.name || "Shared Limit Group";
      }
    });
    // fallback master
    Object.values(gm).forEach(g => {
      if (!g.master && g.members.length > 0) {
        g.master = g.members[0];
        g.sharedLimit = Number(g.master.shared_limit || 0);
        g.name = g.master.notes || g.master.name || "Shared Limit Group";
      }
    });
    return { groupMap: gm, groupedCardIds: gids };
  }, [creditCards]);

  // ── Card stats (group-aware, FX-converted to IDR) ──
  const cardStats = useMemo(() => creditCards.map(cc => {
    const rate = fxRates[cc.currency] || 1;
    const debt = Number(cc.outstanding_amount || 0) * rate;
    const cr   = Number(cc.current_balance   || 0) * rate;
    let limit, avail, util;
    if (cc.shared_limit_group_id && groupMap[cc.shared_limit_group_id]) {
      const g = groupMap[cc.shared_limit_group_id];
      limit = g.sharedLimit * rate;
      avail = Math.max(0, (g.sharedLimit - g.totalDebt + g.totalCR) * rate);
      util  = g.sharedLimit > 0 ? (g.totalDebt / g.sharedLimit) * 100 : 0;
    } else {
      limit = Number(cc.card_limit || 0) * rate;
      avail = Math.max(0, limit - debt + cr);
      util  = limit > 0 ? (debt / limit) * 100 : 0;
    }
    const target = Number(cc.monthly_target || 0);
    const monthSpent = ledger
      .filter(e => {
        if (e.from_id !== cc.id || e.tx_type !== "expense") return false;
        if (!filterMonth) return ym(e.tx_date) === ym(todayStr());
        if (cc.statement_day) {
          const range = getBillingRange(cc, filterMonth);
          if (range) return (e.tx_date || "") >= range.start && (e.tx_date || "") <= range.end;
        }
        return ym(e.tx_date) === filterMonth;
      })
      .reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0);
    const dueIn  = cc.due_day       ? daysUntil(cc.due_day)       : null;
    const stmtIn = cc.statement_day ? daysUntil(cc.statement_day) : null;
    return { ...cc, debt, cr, limit, avail, util, target, monthSpent, dueIn, stmtIn };
  }), [creditCards, groupMap, ledger, filterMonth, fxRates]);

  // Billing cycle date range for a CC card + month (YYYY-MM)
  const getBillingRange = useCallback((cc, monthStr) => {
    if (!monthStr || !cc?.statement_day) return null;
    const [y, m] = monthStr.split("-").map(Number);
    const stDay = Number(cc.statement_day);
    const endDate = new Date(y, m - 1, stDay);
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 1);
    startDate.setDate(startDate.getDate() + 1);
    return { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) };
  }, []);

  const ccLedger = useMemo(() =>
    ledger.filter(e => {
      const isCC   = creditCards.some(c => c.id === e.from_id || c.id === e.to_id);
      if (!isCC) return false;
      const forCard = !selectedCard || e.from_id === selectedCard || e.to_id === selectedCard;
      if (!forCard) return false;
      if (!filterMonth) return true;
      // Use billing cycle if a specific card is selected and has statement_day
      const cc = selectedCard ? creditCards.find(c => c.id === selectedCard) : null;
      if (cc?.statement_day) {
        const range = getBillingRange(cc, filterMonth);
        if (range) {
          const d = e.tx_date || "";
          return d >= range.start && d <= range.end;
        }
      }
      return ym(e.tx_date) === filterMonth;
    }),
  [ledger, creditCards, filterMonth, selectedCard, getBillingRange]);

  const ccInstallments = useMemo(() =>
    installments.filter(i => creditCards.some(c => c.id === i.account_id)),
  [installments, creditCards]);

  const ccRecurring = useMemo(() =>
    recurTemplates.filter(r => creditCards.some(c => c.id === r.from_id)),
  [recurTemplates, creditCards]);

  // ── Pay CC ──
  const payBill = async () => {
    if (!payForm.cardId || !payForm.bankId || !payForm.amount) {
      showToast("Select card, bank, and amount", "error"); return;
    }
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const amt  = sn(payForm.amount);
      const cc   = accounts.find(a => a.id === payForm.cardId);
      const total = amt + sn(payForm.admin_fee) + sn(payForm.stamp_duty);
      const entry = {
        tx_date:         todayStr(),
        description:     `Pay ${cc?.name || "CC"} bill`,
        amount:          total,
        currency:        "IDR",
        amount_idr:      total,
        tx_type:         "pay_cc",
        from_type:       "account",
        to_type:         "account",
        from_id:         payForm.bankId,
        to_id:           payForm.cardId,
        entity:          "Personal",
        notes:           payForm.notes || "",
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(p => [created, ...p]);
      await onRefresh();
      showToast(`Paid ${fmtIDR(amt)} to ${cc?.name}`);
      setModal(null);
      setPayForm({ cardId: "", bankId: "", amount: "", admin_fee: "", stamp_duty: "", notes: "" });
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Add installment ──
  const saveInst = async () => {
    if (!instForm.account_id || !instForm.description || !instForm.total_amount) {
      showToast("Fill required fields", "error"); return;
    }
    setSaving(true);
    try {
      const totalMonths = Number(instForm.months || 12);
      const monthlyAmt  = instForm.monthly_amount
        || Math.round(Number(instForm.total_amount) / totalMonths);
      // next_payment_date = start_date + 1 month
      let nextPaymentDate = null;
      if (instForm.start_date) {
        const d = new Date(instForm.start_date + "T00:00:00");
        d.setMonth(d.getMonth() + 1);
        nextPaymentDate = d.toISOString().slice(0, 10);
      }
      const d = {
        account_id:         instForm.account_id,
        description:        instForm.description,
        entity:             instForm.entity || "Personal",
        monthly_amount:     Number(monthlyAmt),
        total_amount:       Number(instForm.total_amount),
        total_months:       totalMonths,
        paid_months:        0,
        start_date:         instForm.start_date || null,
        next_payment_date:  nextPaymentDate,
        status:             "active",
      };
      const created = await installmentsApi.create(user.id, d);
      if (created) setInstallments(p => [created, ...p]);
      showToast("Installment plan added");
      setModal(null);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Mark installment month paid ──
  const markInstPaid = async (inst) => {
    try {
      const total    = Math.max(1, Number(inst.total_months ?? inst.months ?? 0) || 1);
      const newPaid  = Math.min(Number(inst.paid_months ?? 0) + 1, total);
      // Advance next_payment_date by 1 month
      let nextDate = inst.next_payment_date || null;
      if (nextDate) {
        const d = new Date(nextDate + "T00:00:00");
        d.setMonth(d.getMonth() + 1);
        nextDate = d.toISOString().slice(0, 10);
      }
      const updates = {
        paid_months: newPaid,
        next_payment_date: nextDate,
        ...(newPaid >= total ? { status: "completed" } : {}),
      };
      await installmentsApi.update(inst.id, updates);
      setInstallments(p => p.map(x => x.id === inst.id ? { ...x, ...updates } : x));
      const sn2 = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const entry = {
        tx_date:         todayStr(),
        description:     `${inst.description} — Month ${newPaid}/${total}`,
        amount:          sn2(inst.monthly_amount),
        currency:        inst.currency || "IDR",
        amount_idr:      sn2(inst.monthly_amount),
        tx_type:         "cc_installment",
        from_type:       "account",
        to_type:         "expense",
        from_id:         inst.account_id,
        to_id:           null,
        entity:          inst.entity || "Personal",
        notes:           "CC Installment",
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(p => [created, ...p]);
      showToast(`Month ${newPaid} marked paid`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const deleteInstallment = async () => {
    if (!deleteInstId) return;
    try {
      await installmentsApi.delete(deleteInstId);
      setInstallments(p => p.filter(x => x.id !== deleteInstId));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
    setDeleteInstId(null);
  };

  // ── Toggle recurring active ──
  const toggleRecurring = async (r) => {
    try {
      const updated = await recurringApi.updateTemplate(r.id, { active: !r.active });
      setRecurTemplates(p => p.map(x => x.id === r.id ? updated : x));
      showToast(updated.active ? "Activated" : "Paused");
    } catch (e) { showToast(e.message, "error"); }
  };

  // ── Apply recurring now ──
  const applyRecurringNow = async (r) => {
    try {
      const cc = accounts.find(a => a.id === r.from_id);
      const sn3 = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const txType = r.tx_type || "expense";
      const { from_type, to_type } = getTxFromToTypes(txType);
      const entry = {
        tx_date:         todayStr(),
        description:     r.name,
        amount:          sn3(r.amount),
        currency:        r.currency || "IDR",
        amount_idr:      sn3(r.amount),
        tx_type:         txType,
        from_type,
        to_type,
        from_id:         r.from_id || null,
        to_id:           r.to_id   || null,
        entity:          r.entity  || "Personal",
        notes:           `Applied from recurring template`,
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(p => [created, ...p]);
      await onRefresh();
      showToast(`Applied: ${r.name}`);
    } catch (e) { showToast(e.message, "error"); }
  };

  // ── Edit Card ──
  const openEditCard = (cc) => {
    setEditCardAcc(cc);
    setEditCardForm({
      name:                  cc.name          || "",
      bank_name:             cc.bank_name     || "",
      last4:                 cc.card_last4    || "",
      network:               cc.network       || "",
      card_limit:            cc.card_limit    != null ? String(cc.card_limit)    : "",
      statement_day:         cc.statement_day != null ? String(cc.statement_day) : "",
      due_day:               cc.due_day       != null ? String(cc.due_day)       : "",
      color:                 cc.color         || "",
      card_image_url:        cc.card_image_url || "",
      shared_limit_on:       !!(cc.shared_limit_group_id || Number(cc.shared_limit || 0) > 0),
      shared_group_mode:     cc.shared_limit_group_id
                               ? (cc.is_limit_group_master ? "create" : "join")
                               : "create",
      shared_limit_group_id: cc.shared_limit_group_id || null,
      shared_limit:          cc.shared_limit  != null ? String(cc.shared_limit)  : "",
      is_limit_group_master: cc.is_limit_group_master || false,
    });
    setEditCardModal(true);
  };

  const saveEditCard = async () => {
    if (!editCardForm.name) { showToast("Card name is required", "error"); return; }
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? null : n; };
      const data = {
        name:                  editCardForm.name.trim(),
        bank_name:             editCardForm.bank_name     || null,
        card_last4:            editCardForm.last4          || null,
        network:               editCardForm.network        || null,
        card_limit:            sn(editCardForm.card_limit),
        statement_day:         sn(editCardForm.statement_day),
        due_day:               sn(editCardForm.due_day),
        color:                 editCardForm.color          || null,
        card_image_url:        editCardForm.card_image_url || null,
        ...(editCardForm.shared_limit_on
          ? editCardForm.shared_group_mode === "join"
            ? {
                shared_limit_group_id: editCardForm.shared_limit_group_id,
                is_limit_group_master: false,
                shared_limit:          null,
              }
            : { // "create"
                shared_limit_group_id: editCardForm.shared_limit_group_id || crypto.randomUUID(),
                is_limit_group_master: true,
                shared_limit:          sn(editCardForm.shared_limit),
              }
          : {
              shared_limit_group_id: null,
              is_limit_group_master: false,
              shared_limit:          null,
            }
        ),
      };
      const updated = await accountsApi.update(editCardAcc.id, data);
      setAccounts(p => p.map(a => a.id === editCardAcc.id ? { ...a, ...updated } : a));
      showToast("Card updated");
      setEditCardModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Add Card ──
  const saveAddCard = async () => {
    if (!addCardForm.name) { showToast("Card name is required", "error"); return; }
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? null : n; };
      const data = {
        name:           addCardForm.name.trim(),
        bank_name:      addCardForm.bank_name || null,
        card_last4:     addCardForm.last4 || null,
        network:        addCardForm.network || null,
        card_limit:     sn(addCardForm.card_limit),
        monthly_target: sn(addCardForm.monthly_target),
        statement_day:  sn(addCardForm.statement_day),
        due_day:        sn(addCardForm.due_day),
        current_balance: 0,
        type:           "credit_card",
        entity:         null,
        is_active:      true,
        sort_order:     accounts.length,
      };
      const created = await accountsApi.create(user.id, data);
      if (created) setAccounts(p => [...p, created]);
      showToast("Credit card added");
      setModal(null);
      setAddCardForm(emptyCardForm());
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ─── RENDER ────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <GlobalReconcileButton
          type="cc"
          accounts={accounts}
          user={user}
          onNavigate={(acc, year, month, txs, filename, blobUrl, closingBal, openingBal) => {
            const stDay = Number(acc.statement_day);
            let from, to;
            if (stDay > 0) {
              const endDate = new Date(year, month - 1, stDay);
              const startDate = new Date(endDate);
              startDate.setMonth(startDate.getMonth() - 1);
              startDate.setDate(startDate.getDate() + 1);
              from = startDate.toISOString().slice(0, 10);
              to   = endDate.toISOString().slice(0, 10);
            } else {
              from = `${year}-${String(month).padStart(2, "0")}-01`;
              to   = new Date(year, month, 0).toISOString().slice(0, 10);
            }
            const selectedMonth = `${year}-${String(month).padStart(2, "0")}`;
            navigate(`/accounts/${acc.id}/statement`, { state: { reconcileSeeds: { from, to, selectedMonth, txs, filename, blobUrl, closingBal, openingBal } } });
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => { setAddCardForm(emptyCardForm()); setModal("add_card"); }}>
          + Add Card
        </Button>
        <Button variant="secondary" size="sm" onClick={() => { setInstForm({ account_id: "", description: "", total_amount: "", months: 12, monthly_amount: "", start_date: todayStr(), entity: "Personal" }); setModal("inst"); }}>
          + Installment
        </Button>
        <Button size="sm" onClick={() => { setPayForm({ cardId: "", bankId: "", amount: "", admin_fee: "", stamp_duty: "", notes: "" }); setModal("pay"); }}>
          💳 Pay Bill
        </Button>
      </div>

      {/* ── RECONCILE DRAFT BANNER ── */}
      <ReconcileDraftBanner
        user={user}
        accounts={accounts}
        filterType="credit_card"
        onContinue={(acc, state) => {
          navigate(`/accounts/${acc.id}/statement`, { state: { reconcileSeeds: { fullState: state || null } } });
        }}
      />

      {/* ── SUBTABS ── */}
      <div style={{ display: "flex", gap: 4 }}>
        {SUBTABS.map(t => {
          const active = subTab === t.id;
          return (
            <button key={t.id} onClick={() => setSubTab(t.id)} style={{
              height: 30, padding: "0 12px", borderRadius: 20,
              border: `1.5px solid ${active ? "#111827" : "#e5e7eb"}`,
              background: active ? "#111827" : "#fff",
              color: active ? "#fff" : "#6b7280",
              fontSize: 12, fontWeight: active ? 700 : 500,
              cursor: "pointer", fontFamily: "Figtree, sans-serif",
            }}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ══ OVERVIEW ══ */}
      {subTab === "overview" && (
        creditCards.length === 0
          ? <EmptyState icon="💳" title="No credit cards" message="Add a credit card from Accounts." />
          : (() => {
              const totalDebt  = cardStats.reduce((s, c) => s + c.debt, 0);
              const totalLimit = (() => {
                // Sum FX-converted limits, counting each shared group once
                const seenGroups = new Set();
                let total = 0;
                for (const c of cardStats) {
                  if (c.shared_limit_group_id) {
                    if (!seenGroups.has(c.shared_limit_group_id)) {
                      seenGroups.add(c.shared_limit_group_id);
                      total += c.limit;
                    }
                  } else {
                    total += c.limit;
                  }
                }
                return total;
              })();
              const overallUtil = totalLimit > 0 ? (totalDebt / totalLimit) * 100 : 0;
              const utilColor   = overallUtil > 80 ? "#dc2626" : overallUtil > 60 ? "#d97706" : "#059669";

              // Filtered + sorted cards
                const CC_SORT_PILLS = [
                  { key: "debt",  label: "Debt",  defaultDir: "desc" },
                  { key: "limit", label: "Limit", defaultDir: "desc" },
                  { key: "util",  label: "Usage", defaultDir: "desc" },
                  { key: "name",  label: "Name",  defaultDir: "asc"  },
                ];
                const allBanks   = [...new Set(cardStats.map(c => c.bank_name).filter(Boolean))].sort();
                const filtered   = cardStats.filter(cc => !ccBankFilter || ccBankFilter === "all" || cc.bank_name === ccBankFilter);
                const sortedCC   = [...filtered].sort((a, b) => {
                  switch (ccSort) {
                    case "debt_asc":   return Number(a.debt  || 0) - Number(b.debt  || 0);
                    case "limit_desc": return Number(b.limit || 0) - Number(a.limit || 0);
                    case "limit_asc":  return Number(a.limit || 0) - Number(b.limit || 0);
                    case "util_desc":  return Number(b.util  || 0) - Number(a.util  || 0);
                    case "util_asc":   return Number(a.util  || 0) - Number(b.util  || 0);
                    case "name_asc":   return (a.name || "").localeCompare(b.name || "");
                    case "name_desc":  return (b.name || "").localeCompare(a.name || "");
                    default:           return Number(b.debt  || 0) - Number(a.debt  || 0);
                  }
                });

              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* 3 Summary cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    <div style={{ background: "#fde8e8", borderRadius: 14, padding: "14px 14px" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>Total Debt</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif" }}>{fmtIDR(totalDebt, true)}</div>
                    </div>
                    <div style={{ background: "#e8f4fd", borderRadius: 14, padding: "14px 14px" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#3b5bdb", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>Total Limit</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif" }}>{fmtIDR(totalLimit, true)}</div>
                    </div>
                    <div style={{ background: overallUtil > 80 ? "#fde8e8" : "#e8fdf0", borderRadius: 14, padding: "14px 14px" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: utilColor, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>Utilization</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: utilColor, fontFamily: "Figtree, sans-serif" }}>{overallUtil.toFixed(1)}%</div>
                    </div>
                  </div>

                  {/* Filter + sort row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    {allBanks.length >= 2 ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {["all", ...allBanks].map(b => {
                          const active = (ccBankFilter || "all") === b;
                          return (
                            <button key={b} onClick={() => setCcBankFilter(b)} style={{
                              height: 30, padding: "0 12px", borderRadius: 20, cursor: "pointer",
                              border: `1.5px solid ${active ? "#111827" : "#e5e7eb"}`,
                              background: active ? "#111827" : "#fff",
                              color: active ? "#fff" : "#6b7280",
                              fontSize: 12, fontWeight: active ? 700 : 500,
                              fontFamily: "Figtree, sans-serif",
                            }}>
                              {b === "all" ? "All" : b}
                            </button>
                          );
                        })}
                      </div>
                    ) : <div />}
                    <SortDropdown
                      storageKey="sort_cc"
                      options={CC_SORT_PILLS}
                      value={ccSort}
                      onChange={v => setCcSort(v)}
                    />
                  </div>

                  {/* Mobile: Apple Wallet stack — Desktop: original grid */}
                  {isMobile ? (
                    <WalletStack
                      cards={sortedCC}
                      getColor={(i) => sortedCC[i]?.color || CARD_PALETTE[i % CARD_PALETTE.length]}
                      onPay={(cc) => { setPayForm(f => ({ ...f, cardId: cc.id, amount: cc.debt })); setModal("pay"); }}
                      onTransactions={(cc) => { setSelectedCard(cc.id); setSubTab("transactions"); }}
                      onInstallments={() => setSubTab("installments")}
                      onStatement={(cc) => navigate(`/accounts/${cc.id}/statement`)}
                      onEdit={(cc) => openEditCard(cc)}
                    />
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                      {sortedCC.map((cc, i) => (
                        <CCCard key={cc.id} cc={cc}
                          color={cc.color || CARD_PALETTE[i % CARD_PALETTE.length]}
                          onPay={() => { setPayForm(f => ({ ...f, cardId: cc.id, amount: cc.debt })); setModal("pay"); }}
                          onHistory={() => { setSelectedCard(cc.id); setSubTab("transactions"); }}
                          onInstallments={() => setSubTab("installments")}
                          onBill={() => navigate(`/accounts/${cc.id}/statement`)}
                          onEdit={() => openEditCard(cc)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })()
      )}

      {/* ══ TRANSACTIONS ══ */}
      {subTab === "transactions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Filters */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={FILTER_SEL}>
              <option value="">All months</option>
              {Array.from({ length: 24 }).map((_, i) => {
                const d = new Date(); d.setMonth(d.getMonth() - i);
                const m = d.toISOString().slice(0, 7);
                return <option key={m} value={m}>{d.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</option>;
              })}
            </select>
            <select value={selectedCard || ""} onChange={e => setSelectedCard(e.target.value || null)} style={FILTER_SEL}>
              <option value="">All Cards</option>
              {creditCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
            {ccLedger.length} transactions · {fmtIDR(ccLedger.reduce((s, e) => s + Number(e.amount_idr || e.amount || 0), 0), true)}
          </div>
          {ccLedger.length === 0
            ? <EmptyState icon="📋" message="No CC transactions found" />
            : ccLedger.map(e => {
                const cc  = creditCards.find(c => c.id === e.from_id || c.id === e.to_id);
                const cat = categories.find(c => c.id === e.category_id);
                const isPayment = e.tx_type === "pay_cc";
                return (
                  <div key={e.id} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 0", borderBottom: "1px solid #f3f4f6",
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: isPayment ? "#dcfce7" : "#fee2e2",
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
                    }}>
                      {isPayment ? "✓" : cat?.icon || "💳"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {e.description}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                        {e.tx_date}
                        {cc && <span style={{ color: cc.color || "#3b5bdb" }}> · ····{cc.card_last4}</span>}
                        {(cat || e.category_name) && ` · ${cat?.name || e.category_name}`}
                        {e.entity && e.entity !== "Personal" && ` · ${e.entity}`}
                        {e.is_reimburse && <span style={{ color: "#d97706" }}> · ↗ Reimb</span>}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 13, fontWeight: 700,
                      color: isPayment ? "#059669" : "#dc2626",
                      fontFamily: "Figtree, sans-serif", flexShrink: 0,
                    }}>
                      {isPayment ? "+" : "−"}{fmtIDR(Number(e.amount_idr || e.amount || 0))}
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ══ INSTALLMENTS ══ */}
      {subTab === "installments" && (() => {
        const INST_COLORS = ["#3b5bdb","#059669","#7c3aed","#d97706","#0891b2","#dc2626"];
        const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

        const totalMonthly   = ccInstallments.reduce((s, i) => s + Number(i.monthly_amount ?? 0), 0);
        const totalRemaining = ccInstallments.reduce((s, i) => {
          const tot = Math.max(1, Number(i.total_months ?? i.months ?? 0) || 1);
          const pd  = Number(i.paid_months ?? 0);
          return s + Math.max(0, tot - pd) * Number(i.monthly_amount ?? 0);
        }, 0);
        const activeCount = ccInstallments.filter(i => {
          const tot = Math.max(1, Number(i.total_months ?? i.months ?? 0) || 1);
          return Number(i.paid_months ?? 0) < tot;
        }).length;

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                CC installments auto-debit monthly.
              </div>
              <Button size="sm" onClick={() => setModal("inst")}>+ Add Installment</Button>
            </div>

            {/* Summary cards */}
            {ccInstallments.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {[
                  { label: "Monthly Total",  value: fmtIDR(totalMonthly),   color: "#3b5bdb" },
                  { label: "Total Remaining",value: fmtIDR(totalRemaining), color: "#dc2626" },
                  { label: "Active Plans",   value: String(activeCount),    color: "#059669" },
                ].map(s => (
                  <div key={s.label} style={{ background: "#fff", borderRadius: 12, border: "0.5px solid #e5e7eb", padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginBottom: 3 }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: s.color, fontFamily: "Figtree, sans-serif" }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Cards grid */}
            {ccInstallments.length === 0
              ? <EmptyState icon="📅" title="No installments" message="Track 0% installment plans here." />
              : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                  {ccInstallments.map((inst, idx) => {
                    const cc        = creditCards.find(c => c.id === inst.account_id);
                    const total     = Math.max(1, Number(inst.total_months ?? inst.months ?? 0) || 1);
                    const paid      = Number(inst.paid_months ?? 0);
                    const monthly   = Number(inst.monthly_amount ?? 0);
                    const remaining = Math.max(0, total - paid);
                    const pct       = Math.min(100, (paid / total) * 100);
                    const isDone    = paid >= total;
                    const accentColor = isDone ? "#059669" : INST_COLORS[idx % INST_COLORS.length];
                    const dueDateSrc  = inst.next_payment_date || inst.start_date;
                    const dueDay      = dueDateSrc ? new Date(dueDateSrc + "T00:00:00").getDate() : null;

                    return (
                      <div key={inst.id} style={{
                        background: "#ffffff", borderRadius: 16,
                        border: "0.5px solid #e5e7eb",
                        overflow: "hidden",
                        display: "flex", flexDirection: "column",
                      }}>
                        {/* Color bar */}
                        <div style={{ height: 3, background: accentColor }} />

                        <div style={{ padding: "14px 14px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                          {/* Merchant + done badge */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", lineHeight: 1.3, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {inst.description}
                            </div>
                            {isDone && (
                              <span style={{ fontSize: 9, fontWeight: 700, background: "#dcfce7", color: "#059669", padding: "2px 6px", borderRadius: 99, flexShrink: 0, marginLeft: 6 }}>DONE</span>
                            )}
                          </div>

                          {/* Subtitle: bank · X/Y months · Rp/mo */}
                          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <span>{cc?.bank_name || cc?.name || "CC"}</span>
                            <span>·</span>
                            <span>{paid}/{total} mo</span>
                            <span>·</span>
                            <span style={{ color: "#374151", fontWeight: 600 }}>{fmtIDR(monthly)}/mo</span>
                          </div>

                          {/* Due date */}
                          {dueDay && !isDone && (
                            <div style={{ fontSize: 11, color: "#0D9488", fontFamily: "Figtree, sans-serif", fontWeight: 500 }}>
                              Due: {ordinal(dueDay)} each month
                            </div>
                          )}

                          {/* Progress bar */}
                          <div style={{ marginTop: 2 }}>
                            <div style={{ height: 5, background: "#f3f4f6", borderRadius: 99, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: accentColor, borderRadius: 99, transition: "width 0.3s" }} />
                            </div>
                          </div>

                          {/* Stats row */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
                              {paid}/{total} months paid
                            </span>
                            <span style={{ fontSize: 11, fontWeight: 700, color: accentColor, fontFamily: "Figtree, sans-serif" }}>
                              {isDone ? "✓ Paid off" : `${fmtIDR(monthly * remaining)} left · ${pct.toFixed(0)}%`}
                            </span>
                          </div>
                        </div>

                        {/* Delete button */}
                        <div style={{ borderTop: "0.5px solid #f3f4f6", padding: "8px 14px", display: "flex", justifyContent: "flex-end" }}>
                          <button
                            onClick={() => setDeleteInstId(inst.id)}
                            style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, color: "#d1d5db", padding: "2px 4px", fontFamily: "Figtree, sans-serif" }}
                            onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                            onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}
                          >
                            🗑 Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            }
          </div>
        );
      })()}

      {/* ══ RECURRING ══ */}
      {subTab === "recurring" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {ccRecurring.length === 0
            ? <EmptyState icon="🔄" title="No recurring templates" message="Add recurring CC templates in Settings → Recurring." />
            : ccRecurring.map(r => {
                const cc = creditCards.find(c => c.id === r.from_id);
                return (
                  <div key={r.id} style={{
                    background: "#ffffff", borderRadius: 12,
                    border: `1.5px solid ${r.active ? "#e5e7eb" : "#f3f4f6"}`,
                    padding: "14px 16px",
                    opacity: r.active ? 1 : 0.65,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                          {r.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 3, display: "flex", gap: 8 }}>
                          <span>{cc?.name || "CC"}</span>
                          <span>{r.frequency}</span>
                          {r.day_of_month && <span>Day {r.day_of_month}</span>}
                          {r.entity && r.entity !== "Personal" && <span style={{ color: "#3b5bdb" }}>{r.entity}</span>}
                        </div>
                      </div>

                      {/* Amount */}
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif", flexShrink: 0 }}>
                        {fmtIDR(Number(r.amount || 0), true)}
                      </div>

                      {/* Active toggle */}
                      <button
                        onClick={() => toggleRecurring(r)}
                        style={{
                          height:       26,
                          padding:      "0 10px",
                          borderRadius: 20,
                          border:       "none",
                          background:   r.active ? "#dcfce7" : "#f3f4f6",
                          color:        r.active ? "#059669" : "#9ca3af",
                          fontSize:     11,
                          fontWeight:   700,
                          cursor:       "pointer",
                          fontFamily:   "Figtree, sans-serif",
                          flexShrink:   0,
                        }}
                      >
                        {r.active ? "Active" : "Paused"}
                      </button>
                    </div>

                    {/* Apply now */}
                    {r.active && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f3f4f6" }}>
                        <Button size="sm" variant="secondary" onClick={() => applyRecurringNow(r)}>
                          ▶ Apply Now
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ══ PAY CC MODAL ══ */}
      <Modal
        isOpen={modal === "pay"}
        onClose={() => setModal(null)}
        title="💳 Pay Credit Card"
        footer={
          <Button fullWidth onClick={payBill} busy={saving}>
            Pay Now →
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Select label="Credit Card"
            value={payForm.cardId} onChange={e => setP("cardId", e.target.value)}
            placeholder="Select card…"
            options={cardStats.map(c => ({ value: c.id, label: `${c.name} — Debt: ${fmtIDR(c.debt, true)}` }))}
          />
          <Select label="Pay From (Bank)"
            value={payForm.bankId} onChange={e => setP("bankId", e.target.value)}
            placeholder="Select bank…"
            options={bankAccounts.map(b => ({ value: b.id, label: `${b.name} — ${fmtIDR(Number(b.current_balance || 0), true)}` }))}
          />

          {payForm.cardId && (() => {
            const cc = cardStats.find(c => c.id === payForm.cardId);
            if (!cc) return null;
            const amt = Number(payForm.amount) || 0;
            const overpay = cc.debt > 0 && amt > cc.debt ? amt - cc.debt : 0;
            return (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px", background: "#f9fafb", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12, fontFamily: "Figtree, sans-serif" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#6b7280" }}>Outstanding</span>
                    <strong style={{ color: cc.debt > 0 ? "#dc2626" : "#9ca3af" }}>{fmtIDR(cc.debt)}</strong>
                  </div>
                  {cc.cr > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "#6b7280" }}>Current CR</span>
                      <strong style={{ color: "#059669" }}>{fmtIDR(cc.cr)}</strong>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#6b7280" }}>Available limit</span>
                    <strong style={{ color: "#374151" }}>{fmtIDR(cc.avail)}</strong>
                  </div>
                </div>
                <AmountInput label="Payment Amount" value={payForm.amount} onChange={v => setP("amount", v)} />
                {overpay > 0 && (
                  <div style={{ fontSize: 11, color: "#854F0B", background: "#FAEEDA", borderRadius: 8, padding: "8px 12px", fontFamily: "Figtree, sans-serif" }}>
                    ⓘ Sisa {fmtIDR(overpay)} akan jadi top-up (CR) yang menambah available limit.
                  </div>
                )}
              </>
            );
          })()}

          {!payForm.cardId && <AmountInput label="Payment Amount" value={payForm.amount} onChange={v => setP("amount", v)} />}

          <FormRow>
            <AmountInput label="Admin Fee (optional)" value={payForm.admin_fee} onChange={v => setP("admin_fee", v)} style={{ flex: 1 }} />
            <AmountInput label="Stamp Duty (optional)" value={payForm.stamp_duty}   onChange={v => setP("stamp_duty", v)}   style={{ flex: 1 }} />
          </FormRow>

          <Input label="Notes (optional)" value={payForm.notes} onChange={e => setP("notes", e.target.value)} placeholder="Optional" />
        </div>
      </Modal>

      {/* ══ ADD INSTALLMENT MODAL ══ */}
      <Modal
        isOpen={modal === "inst"}
        onClose={() => setModal(null)}
        title="Add Installment Plan"
        footer={<Button fullWidth onClick={saveInst} busy={saving}>Save Installment</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Select label="Credit Card" value={instForm.account_id} onChange={e => setI("account_id", e.target.value)}
            placeholder="Select card…" options={creditCards.map(c => ({ value: c.id, label: c.name }))} />
          <Input label="Description" value={instForm.description} onChange={e => setI("description", e.target.value)}
            placeholder="e.g. MacBook Pro 0%" />
          <FormRow>
            <AmountInput label="Total Amount" value={instForm.total_amount} onChange={v => setI("total_amount", v)} style={{ flex: 1 }} />
            <Field label="Months" style={{ width: 90, flexShrink: 0 }}>
              <input type="number" value={instForm.months} onChange={e => setI("months", e.target.value)}
                min={1} max={60}
                style={{ width: "100%", height: 44, padding: "0 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 700, color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box" }}
              />
            </Field>
          </FormRow>
          <AmountInput
            label={`Monthly Amount (auto: ${instForm.total_amount && instForm.months ? fmtIDR(Math.round(Number(instForm.total_amount) / Number(instForm.months)), true) : "—"})`}
            value={instForm.monthly_amount}
            onChange={v => setI("monthly_amount", v)}
          />
          <FormRow>
            <Input label="Start Date" type="date" value={instForm.start_date} onChange={e => setI("start_date", e.target.value)} style={{ flex: 1 }} />
            <Select label="Entity" value={instForm.entity} onChange={e => setI("entity", e.target.value)} options={ENTITIES} style={{ flex: 1 }} />
          </FormRow>
        </div>
      </Modal>

      {/* ══ EDIT CARD MODAL ══ */}
      <Modal
        isOpen={editCardModal}
        onClose={() => setEditCardModal(false)}
        title="Edit Card"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setEditCardModal(false)}>Cancel</Button>
            <Button variant="primary" size="md" busy={saving} disabled={!editCardForm.name} onClick={saveEditCard}>Save →</Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Card Name *">
            <Input value={editCardForm.name} onChange={e => setEC("name", e.target.value)} placeholder="e.g. BCA Everyday" />
          </Field>
          <FormRow>
            <Field label="Bank">
              <Select value={editCardForm.bank_name} onChange={e => setEC("bank_name", e.target.value)}
                options={BANKS_L.map(b => ({ value: b, label: b }))} placeholder="Select bank…" />
            </Field>
            <Field label="Network">
              <Select value={editCardForm.network} onChange={e => setEC("network", e.target.value)}
                options={NETWORKS.map(n => ({ value: n, label: n }))} placeholder="Select network…" />
            </Field>
          </FormRow>
          <FormRow>
            <Field label="Last 4 Digits">
              <Input value={editCardForm.last4} onChange={e => setEC("last4", e.target.value)} placeholder="e.g. 1234" maxLength={4} />
            </Field>
            <AmountInput label="Credit Limit" value={editCardForm.card_limit} onChange={v => setEC("card_limit", v)} currency="IDR" />
          </FormRow>
          <FormRow>
            <Field label="Statement Day">
              <input type="number" min={1} max={31} value={editCardForm.statement_day} onChange={e => setEC("statement_day", e.target.value)}
                placeholder="e.g. 25"
                style={{ width: "100%", height: 44, padding: "0 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 700, color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box" }} />
            </Field>
            <Field label="Due Day">
              <input type="number" min={1} max={31} value={editCardForm.due_day} onChange={e => setEC("due_day", e.target.value)}
                placeholder="e.g. 15"
                style={{ width: "100%", height: 44, padding: "0 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 700, color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box" }} />
            </Field>
          </FormRow>

          {/* ── Shared Limit ── */}
          <Field label="Shared Limit">
            <button type="button"
              onClick={() => setEC("shared_limit_on", !editCardForm.shared_limit_on)}
              style={{
                height: 28, padding: "0 14px", borderRadius: 20, border: "none", cursor: "pointer",
                fontFamily: "Figtree, sans-serif", fontSize: 12, fontWeight: 700,
                background: editCardForm.shared_limit_on ? "#3b5bdb" : "#e5e7eb",
                color: editCardForm.shared_limit_on ? "#fff" : "#6b7280",
              }}>
              {editCardForm.shared_limit_on ? "ON" : "OFF"}
            </button>
          </Field>
          {editCardForm.shared_limit_on && (<>
            {/* Join vs Create toggle */}
            <Field label="Group">
              <div style={{ display: "flex", gap: 6 }}>
                {[{ id: "join", label: "Join Existing Group" }, { id: "create", label: "Create New Group" }].map(opt => (
                  <button key={opt.id} type="button"
                    onClick={() => setEC("shared_group_mode", opt.id)}
                    style={{
                      flex: 1, height: 32, borderRadius: 8, cursor: "pointer",
                      fontFamily: "Figtree, sans-serif", fontSize: 12, fontWeight: 600,
                      border: editCardForm.shared_group_mode === opt.id ? "1.5px solid #3b5bdb" : "1.5px solid #e5e7eb",
                      background: editCardForm.shared_group_mode === opt.id ? "#eff3ff" : "#fff",
                      color: editCardForm.shared_group_mode === opt.id ? "#3b5bdb" : "#6b7280",
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>

            {editCardForm.shared_group_mode === "join" ? (
              <Field label="Select Group">
                <select
                  value={editCardForm.shared_limit_group_id || ""}
                  onChange={e => setEC("shared_limit_group_id", e.target.value || null)}
                  style={{ width: "100%", height: 44, padding: "0 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 600, color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box" }}>
                  <option value="">Select a group…</option>
                  {Object.values(groupMap).map(g => (
                    <option key={g.id} value={g.id}>
                      {g.master ? g.master.name : "(no master)"}{g.sharedLimit > 0 ? ` · Rp ${g.sharedLimit.toLocaleString("id-ID")}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <AmountInput label="Shared Limit Amount" value={editCardForm.shared_limit} onChange={v => setEC("shared_limit", v)} currency="IDR" />
            )}

            {/* Read-only Shared Group pills — show current siblings */}
            {(() => {
              const gid = editCardForm.shared_group_mode === "join"
                ? editCardForm.shared_limit_group_id
                : editCardAcc?.shared_limit_group_id;
              const group = gid ? groupMap[gid] : null;
              if (!group?.members?.length) return null;
              return (
                <Field label="Shared Group">
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {group.members.map(m => (
                      <span key={m.id} style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
                        background: m.is_limit_group_master ? "#dbeafe" : "#f3f4f6",
                        color: m.is_limit_group_master ? "#1d4ed8" : "#374151",
                        fontFamily: "Figtree, sans-serif",
                      }}>
                        {m.name}{m.is_limit_group_master ? " ★" : ""}
                      </span>
                    ))}
                  </div>
                </Field>
              );
            })()}
          </>)}

          <Field label="Card Color">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
              {CARD_PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setEC("color", editCardForm.color === c ? "" : c)}
                  style={{
                    width: 28, height: 28, borderRadius: "50%", background: c, border: "none",
                    cursor: "pointer", flexShrink: 0,
                    outline: editCardForm.color === c ? `3px solid ${c}` : "none",
                    outlineOffset: 2,
                    boxShadow: editCardForm.color === c ? "0 0 0 2px #fff, 0 0 0 4px " + c : "none",
                  }}
                />
              ))}
            </div>
          </Field>

          {/* Card Image Upload */}
          <Field label="Card Image (optional)">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCardImageUpload(f); e.target.value = ""; }}
            />
            {editCardForm.card_image_url ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ position: "relative", width: "100%", height: 80, borderRadius: 10, overflow: "hidden", border: "1.5px solid #e5e7eb" }}>
                  <img src={editCardForm.card_image_url} alt="card" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => imageInputRef.current?.click()} disabled={imageUploading}
                    style={{ flex: 1, height: 32, borderRadius: 8, border: "1.5px solid #e5e7eb", background: "#f9fafb", color: "#374151", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
                    {imageUploading ? "Uploading…" : "Replace"}
                  </button>
                  <button type="button" onClick={() => setEC("card_image_url", "")}
                    style={{ height: 32, padding: "0 14px", borderRadius: 8, border: "1.5px solid #fecaca", background: "#fff5f5", color: "#dc2626", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => imageInputRef.current?.click()} disabled={imageUploading}
                style={{ width: "100%", height: 44, borderRadius: 10, border: "1.5px dashed #e5e7eb", background: "#f9fafb", color: "#6b7280", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
                {imageUploading ? "Uploading…" : "Upload card photo"}
              </button>
            )}
          </Field>
        </div>
      </Modal>

      {/* ══ ADD CARD MODAL ══ */}
      <Modal
        isOpen={modal === "add_card"}
        onClose={() => setModal(null)}
        title="+ Add Credit Card"
        footer={<Button fullWidth onClick={saveAddCard} busy={saving}>Add Card →</Button>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Input label="Card Name *" value={addCardForm.name} onChange={e => setAC("name", e.target.value)} placeholder="e.g. BCA Everyday" />
          <FormRow>
            <Field label="Bank">
              <Select value={addCardForm.bank_name} onChange={e => setAC("bank_name", e.target.value)}
                options={BANKS_L.map(b => ({ value: b, label: b }))} placeholder="Select bank…" />
            </Field>
            <Field label="Network">
              <Select value={addCardForm.network} onChange={e => setAC("network", e.target.value)}
                options={NETWORKS.map(n => ({ value: n, label: n }))} placeholder="Select network…" />
            </Field>
          </FormRow>
          <FormRow>
            <Input label="Last 4 Digits" value={addCardForm.last4} onChange={e => setAC("last4", e.target.value)} placeholder="e.g. 1234" maxLength={4} />
            <AmountInput label="Credit Limit" value={addCardForm.card_limit} onChange={v => setAC("card_limit", v)} currency="IDR" />
          </FormRow>
          <FormRow>
            <Field label="Statement Day">
              <input type="number" min={1} max={31} value={addCardForm.statement_day} onChange={e => setAC("statement_day", e.target.value)}
                placeholder="e.g. 25"
                style={{ width: "100%", height: 44, padding: "0 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 700, color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box" }} />
            </Field>
            <Field label="Due Day">
              <input type="number" min={1} max={31} value={addCardForm.due_day} onChange={e => setAC("due_day", e.target.value)}
                placeholder="e.g. 15"
                style={{ width: "100%", height: 44, padding: "0 12px", border: "1.5px solid #e5e7eb", borderRadius: 10, fontFamily: "Figtree, sans-serif", fontSize: 14, fontWeight: 700, color: "#111827", background: "#fff", outline: "none", boxSizing: "border-box" }} />
            </Field>
          </FormRow>
          <AmountInput label="Monthly Spend Target (optional)" value={addCardForm.monthly_target} onChange={v => setAC("monthly_target", v)} currency="IDR" />
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        isOpen={!!deleteInstId}
        onClose={() => setDeleteInstId(null)}
        onConfirm={deleteInstallment}
        title="Delete Installment"
        message="Remove this installment plan? Transaction history is preserved."
        danger
      />
    </div>
  );
}

// ─── SHARED LIMIT GROUP CARD ─────────────────────────────────
function SharedLimitGroupCard({ group, cardStats, paletteStart = 0, onPay, onTransactions, onInstallments }) {
  const { name, sharedLimit, totalDebt, members } = group;
  const available  = Math.max(0, sharedLimit - totalDebt);
  const util       = sharedLimit > 0 ? (totalDebt / sharedLimit) * 100 : 0;
  const utilColor  = util > 80 ? "#dc2626" : util > 60 ? "#d97706" : "#059669";

  return (
    <div style={{ background: "#ffffff", borderRadius: 16, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>

      {/* ── Group header ── */}
      <div style={{ padding: "16px 18px", borderBottom: "1px solid #f3f4f6" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 18 }}>🏦</span>
          <span style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif", flex: 1 }}>
            {name}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, background: "#eff6ff", color: "#3b5bdb", padding: "2px 8px", borderRadius: 4, fontFamily: "Figtree, sans-serif" }}>
            Shared Limit
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif" }}>
            {fmtIDR(totalDebt)} / {fmtIDR(sharedLimit)} used · Available: <strong style={{ color: "#059669" }}>{fmtIDR(available)}</strong>
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: utilColor, fontFamily: "Figtree, sans-serif" }}>
            {util.toFixed(0)}%
          </span>
        </div>
        <BarSimple value={totalDebt} max={sharedLimit || 1} color={utilColor} height={6} />
      </div>

      {/* ── Member cards in 3-col grid ── */}
      <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {members.map((cc, i) => {
          const stats  = cardStats.find(s => s.id === cc.id);
          const debt   = stats?.debt ?? Number(cc.outstanding_amount || 0);
          const dueIn  = stats?.dueIn ?? null;
          const color  = CARD_PALETTE[(paletteStart + i) % CARD_PALETTE.length];
          return (
            <div key={cc.id} style={{ background: "#f9fafb", borderRadius: 12, border: "0.5px solid #e5e7eb", overflow: "hidden" }}>
              <div style={{ height: 3, background: color }} />
              <div style={{ padding: "12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                    {cc.name}
                    {cc.is_limit_group_master && (
                      <span style={{ fontSize: 9, fontWeight: 700, background: "#fef3c7", color: "#d97706", padding: "1px 5px", borderRadius: 3 }}>MASTER</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                    {(cc.bank_name && cc.bank_name !== "Other") ? cc.bank_name : ""}{cc.card_last4 ? `${(cc.bank_name && cc.bank_name !== "Other") ? " · " : ""}···· ${cc.card_last4}` : ""}
                    {dueIn !== null && (
                      <span style={{ marginLeft: 6, fontWeight: 600, color: dueIn <= 3 ? "#dc2626" : dueIn <= 7 ? "#d97706" : "#9ca3af" }}>
                        · Due {dueIn}d
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: debt > 0 ? "#dc2626" : "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                  {fmtIDR(debt, true)}
                </div>
                <button onClick={() => onPay(cc.id)} style={CC_BTN("#fde8e8", "#dc2626", "#fecaca")}>💳 Pay</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── NETWORK LOGO ─────────────────────────────────────────────
function NetworkLogo({ network }) {
  if (!network) return null;
  if (network === "Visa") return (
    <span style={{ fontSize: 15, fontWeight: 900, fontStyle: "italic", color: "#fff", fontFamily: "serif", letterSpacing: 1, textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
      VISA
    </span>
  );
  if (network === "Mastercard") return (
    <div style={{ position: "relative", width: 34, height: 22 }}>
      <div style={{ position: "absolute", left: 0, top: 1, width: 20, height: 20, borderRadius: "50%", background: "#EB001B", opacity: 0.92 }} />
      <div style={{ position: "absolute", right: 0, top: 1, width: 20, height: 20, borderRadius: "50%", background: "#F79E1B", opacity: 0.92 }} />
    </div>
  );
  if (network === "Amex") return (
    <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", fontFamily: "Figtree, sans-serif", letterSpacing: 1.5, textShadow: "0 1px 3px rgba(0,0,0,0.5)" }}>
      AMEX
    </span>
  );
  if (network === "JCB") return (
    <div style={{ display: "flex", gap: 2 }}>
      {[["J","#00539F"],["C","#E31837"],["B","#007B5E"]].map(([l, bg]) => (
        <div key={l} style={{ width: 14, height: 18, borderRadius: 2, background: bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 8, fontWeight: 900, color: "#fff", fontFamily: "Figtree, sans-serif" }}>{l}</span>
        </div>
      ))}
    </div>
  );
  return <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", fontFamily: "Figtree, sans-serif" }}>{network}</span>;
}

// ─── CC CARD (desktop grid) ───────────────────────────────────
function CCCard({ cc, color, onPay, onHistory, onInstallments, onBill, onEdit }) {
  const utilColor  = cc.util > 80 ? "#A32D2D" : cc.util > 50 ? "#BA7517" : "#97C459";
  const dueText    = formatDueDate(cc.due_day);
  const isDueSoon  = isDueWithin3Days(cc.due_day);
  const isMaster   = cc.is_limit_group_master;
  const isMember   = !!(cc.shared_limit_group_id && !isMaster);

  return (
    <div className="cc-card-v2" style={{
      background: "#fff", borderRadius: 16, overflow: "hidden",
      border: "0.5px solid rgba(0,0,0,0.08)",
      display: "flex", flexDirection: "column",
    }}>
      {/* ── 130px card image area ── */}
      <div style={{
        height: 130, position: "relative", flexShrink: 0,
        ...(cc.card_image_url
          ? { backgroundImage: `url(${cc.card_image_url})`, backgroundSize: "cover", backgroundPosition: "center top" }
          : { background: `linear-gradient(135deg, ${color || "#3b5bdb"} 0%, ${lightenColor(color || "#3b5bdb", 22)} 100%)` }
        ),
      }}>
        {/* Decorative circles for gradient fallback */}
        {!cc.card_image_url && (
          <>
            <div style={{ position: "absolute", top: -24, right: -18, width: 130, height: 130, borderRadius: "50%", background: "rgba(255,255,255,0.09)" }} />
            <div style={{ position: "absolute", bottom: -32, left: -18, width: 110, height: 110, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
          </>
        )}
        {/* Hover edit button — opacity 0, CSS handles hover */}
        <button className="cc-card-edit-btn" onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit card"
          style={{
            position: "absolute", top: 12, right: 12,
            background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)",
            width: 28, height: 28, borderRadius: 8, border: "none",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", opacity: 0, transition: "opacity 0.15s",
          }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        {/* Bottom badges */}
        <div style={{ position: "absolute", bottom: 12, left: 16, display: "flex", gap: 6, alignItems: "center" }}>
          {dueText && (
            <div style={{
              background: isDueSoon ? "#A32D2D" : "rgba(255,255,255,0.25)",
              color: "#fff", fontSize: 10, fontWeight: 500,
              padding: "3px 8px", borderRadius: 6, fontFamily: "Figtree, sans-serif",
            }}>{dueText}</div>
          )}
          {isMember && (
            <div style={{ background: "rgba(255,255,255,0.25)", color: "#fff", fontSize: 10, padding: "3px 8px", borderRadius: 6, fontFamily: "Figtree, sans-serif" }}>
              Shared
            </div>
          )}
        </div>
        {/* Network logo — bottom right */}
        <div style={{ position: "absolute", bottom: 10, right: 14, display: "flex", alignItems: "center" }}>
          <NetworkLogo network={cc.network} />
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", flex: 1 }}>
        {/* Card name */}
        <div style={{ fontSize: 14, fontWeight: 500, color: "#111827", fontFamily: "Figtree, sans-serif", marginBottom: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {cc.name}
          {isMaster && <span style={{ color: "#888780", fontWeight: 400, fontSize: 11, marginLeft: 6 }}>· Master</span>}
        </div>

        {/* DEBT */}
        <div style={{ marginBottom: cc.cr > 0 ? 4 : 12 }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#888780", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>DEBT</div>
          <div style={{ fontSize: 22, fontWeight: 500, color: cc.debt > 0 ? "#A32D2D" : "#888780", fontFamily: "Figtree, sans-serif", lineHeight: 1.1 }}>
            {fmtIDR(cc.debt, true)}
          </div>
        </div>

        {/* CR sub-info */}
        {cc.cr > 0 && (
          <div style={{ fontSize: 11, color: "#0F6E56", fontFamily: "Figtree, sans-serif", marginBottom: 12 }}>
            +{fmtIDR(cc.cr, true)} top-up
          </div>
        )}

        {/* Progress bar */}
        <div style={{ background: "#F1EFE8", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
          <div style={{ background: utilColor, width: `${Math.min(cc.util, 100)}%`, height: "100%", borderRadius: 3, transition: "width 0.3s" }} />
        </div>

        {/* Available + utilization inline */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888780", fontFamily: "Figtree, sans-serif", marginBottom: 14 }}>
          <span>
            {cc.shared_limit_group_id ? "Group avail" : "Available"}{" "}
            <span style={{ color: "#0F6E56", fontWeight: 500 }}>{fmtIDR(cc.avail, true)}</span>
          </span>
          <span style={{ color: cc.util > 80 ? "#A32D2D" : "#888780" }}>
            {cc.util.toFixed(0)}% of {fmtIDR(cc.limit, true)}{cc.shared_limit_group_id ? " shared" : ""}
          </span>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
          <button
            onClick={onPay}
            disabled={cc.debt === 0}
            style={{
              flex: 1, padding: 8, borderRadius: 8, fontSize: 12,
              fontWeight: 500, fontFamily: "Figtree, sans-serif",
              background: cc.debt > 0 ? "#2C2C2A" : "transparent",
              color: cc.debt > 0 ? "#fff" : "#888780",
              border: cc.debt > 0 ? "none" : "0.5px solid rgba(0,0,0,0.15)",
              cursor: cc.debt > 0 ? "pointer" : "not-allowed",
            }}
          >Pay</button>
          <button onClick={onHistory}      style={CC_SECONDARY_BTN}>History</button>
          <button onClick={onInstallments} style={CC_SECONDARY_BTN}>Installments</button>
          <button onClick={onBill}         style={CC_SECONDARY_BTN}>Bill</button>
        </div>
      </div>
    </div>
  );
}

// ─── WALLET CARD (Apple Wallet expanded/collapsed item) ──────
function WalletCard({ cc, color, isActive, onPay, onTransactions, onInstallments, onStatement, onEdit }) {
  const utilColor = cc.util > 80 ? "#dc2626" : cc.util > 50 ? "#d97706" : "#059669";

  return (
    <div style={{ borderRadius: 16, overflow: "hidden", background: "#fff" }}>

      {/* ── Card image area — full credit card aspect ratio (1.586:1) ── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1.586",
          overflow: "hidden",
          flexShrink: 0,
          ...(cc.card_image_url
            ? { backgroundImage: `url(${cc.card_image_url})`, backgroundSize: "cover", backgroundPosition: "center top" }
            : { background: color || "#3b5bdb" }
          ),
        }}
      >
        {/* Decorative circles for solid-color fallback */}
        {!cc.card_image_url && (
          <>
            <div style={{ position: "absolute", top: -40, right: -30, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
            <div style={{ position: "absolute", top: 50,  right: 55,  width: 130, height: 130, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />
            <div style={{ position: "absolute", bottom: -55, left: -30, width: 180, height: 180, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
          </>
        )}

        {/* Gradient overlay */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.22) 0%, transparent 38%, rgba(0,0,0,0.28) 100%)" }} />

        {/* Card name — top left, always in peek zone (first 70px) */}
        <div style={{
          position: "absolute", top: 20, left: 16, right: 58,
          fontFamily: "Figtree, sans-serif", fontWeight: 700, fontSize: 14,
          color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.6)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1,
        }}>
          {cc.name}
        </div>

        {/* Network logo — top right, always in peek zone */}
        <div style={{ position: "absolute", top: 14, right: 14, display: "flex", alignItems: "center" }}>
          <NetworkLogo network={cc.network} />
        </div>

        {/* Edit button — fades in on expand, hidden when collapsed */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="Edit card"
          style={{
            position: "absolute", top: 8, right: 10,
            border: "none", background: "rgba(0,0,0,0.30)", borderRadius: 6,
            cursor: "pointer", padding: "3px 6px", color: "#fff", lineHeight: 1, fontSize: 12,
            opacity: isActive ? 1 : 0,
            pointerEvents: isActive ? "auto" : "none",
            transition: "opacity 0.2s ease",
            zIndex: 2,
          }}
          onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.55)"}
          onMouseLeave={e => e.currentTarget.style.background = "rgba(0,0,0,0.30)"}
        >✏️</button>

        {/* Last4 — bottom left, only visible when image fully shows */}
        {cc.card_last4 && (
          <div style={{
            position: "absolute", bottom: 16, left: 16,
            fontFamily: "Figtree, sans-serif", fontSize: 12,
            color: "rgba(255,255,255,0.88)", letterSpacing: 3, fontWeight: 600,
            textShadow: "0 1px 3px rgba(0,0,0,0.45)",
          }}>
            ···· {cc.card_last4}
          </div>
        )}
      </div>

      {/* ── Info section — always rendered; outer max-height clip controls visibility ── */}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 11, background: "#fff" }}>

        {/* Debt + Available */}
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>Debt</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: cc.debt > 0 ? "#dc2626" : "#9ca3af", fontFamily: "Figtree, sans-serif", lineHeight: 1.1 }}>
              {fmtIDR(cc.debt, true)}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 2 }}>Available</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#059669", fontFamily: "Figtree, sans-serif", lineHeight: 1.1 }}>
              {fmtIDR(cc.avail, true)}
            </div>
            {cc.cr > 0 && (
              <div style={{ fontSize: 10, color: "#0F6E56", fontFamily: "Figtree, sans-serif", marginTop: 2 }}
                title="Saldo lebih bayar / CR — menambah available limit">
                +{fmtIDR(cc.cr, true)} top-up
              </div>
            )}
          </div>
        </div>

        {/* Utilization bar */}
        {cc.limit > 0 && (
          <div>
            <div style={{ height: 4, background: "#f3f4f6", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.min(cc.util, 100)}%`, background: utilColor, borderRadius: 4, transition: "width 0.3s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>Limit {fmtIDR(cc.limit, true)}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: utilColor, fontFamily: "Figtree, sans-serif" }}>{cc.util.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {/* Due + Statement badges */}
        {(cc.dueIn !== null || cc.stmtIn !== null) && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {cc.dueIn !== null && (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6,
                fontFamily: "Figtree, sans-serif",
                background: cc.dueIn <= 3 ? "#fee2e2" : cc.dueIn <= 7 ? "#fef3c7" : "#f9fafb",
                color:      cc.dueIn <= 3 ? "#dc2626" : cc.dueIn <= 7 ? "#d97706" : "#6b7280",
                border: `1px solid ${cc.dueIn <= 3 ? "#fecaca" : cc.dueIn <= 7 ? "#fde68a" : "#f3f4f6"}`,
              }}>
                Due {cc.dueIn}d
              </span>
            )}
            {cc.stmtIn !== null && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 6, fontFamily: "Figtree, sans-serif", background: "#f9fafb", color: "#6b7280", border: "1px solid #f3f4f6" }}>
                Stmt {cc.stmtIn}d
              </span>
            )}
          </div>
        )}

        {/* Action buttons — exact same styles as before */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={(e) => { e.stopPropagation(); onPay();          }} style={CC_BTN("#fde8e8", "#dc2626", "#fecaca")}>💳 Pay</button>
          <button onClick={(e) => { e.stopPropagation(); onTransactions(); }} style={CC_BTN("#f3f4f6", "#374151", "#e5e7eb")}>Txns</button>
          <button onClick={(e) => { e.stopPropagation(); onInstallments(); }} style={CC_BTN("#f3f4f6", "#374151", "#e5e7eb")}>Install.</button>
          <button onClick={(e) => { e.stopPropagation(); onStatement();    }} style={CC_BTN("#f0f9ff", "#0369a1", "#bae6fd")}>Statement</button>
        </div>
      </div>
    </div>
  );
}

// ─── APPLE WALLET STACK ───────────────────────────────────────
function WalletStack({ cards, getColor, onPay, onTransactions, onInstallments, onStatement, onEdit }) {
  const [activeId, setActiveId] = useState(null);

  return (
    <div style={{ paddingBottom: 4 }}>
      {cards.map((cc, i) => {
        const isActive = cc.id === activeId;
        return (
          <div
            key={cc.id}
            style={{
              maxHeight: isActive ? 900 : PEEK_H,
              overflow: "hidden",
              transition: "max-height 0.3s ease",
              // overlap: each card after the first tucks 14px under the card above
              marginTop: i === 0 ? 0 : -14,
              position: "relative",
              // active card always on top; otherwise first card has highest z (like a real deck)
              zIndex: isActive ? cards.length + 10 : cards.length - i,
              borderRadius: 16,
              boxShadow: "0 2px 10px rgba(0,0,0,0.14)",
              cursor: "pointer",
            }}
            onClick={() => setActiveId(isActive ? null : cc.id)}
          >
            <WalletCard
              cc={cc}
              color={getColor(i)}
              isActive={isActive}
              onPay={() => onPay(cc)}
              onTransactions={() => onTransactions(cc)}
              onInstallments={() => onInstallments()}
              onStatement={() => onStatement(cc)}
              onEdit={() => onEdit(cc)}
            />
          </div>
        );
      })}

      {/* Dot indicators */}
      {cards.length > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 18 }}>
          {cards.map(cc => (
            <div
              key={cc.id}
              onClick={(e) => { e.stopPropagation(); setActiveId(prev => prev === cc.id ? null : cc.id); }}
              style={{
                width: cc.id === activeId ? 16 : 6,
                height: 6,
                borderRadius: 3,
                background: cc.id === activeId ? "#374151" : "#d1d5db",
                transition: "all 0.3s ease",
                cursor: "pointer",
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SIMPLE PROGRESS BAR ─────────────────────────────────────
function BarSimple({ value, max, color = "#059669", height = 5 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height, background: "#f3f4f6", borderRadius: height, overflow: "hidden" }}>
      <div style={{ height, width: `${pct}%`, background: color, borderRadius: height, transition: "width 0.3s" }} />
    </div>
  );
}

// ─── BAR WITH TARGET MARKER ──────────────────────────────────
function BarWithTarget({ value, max, target, color }) {
  const pct       = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const targetPct = max > 0 ? Math.min((target / max) * 100, 100) : 0;
  return (
    <div style={{ position: "relative", height: 8, background: "#f3f4f6", borderRadius: 8, overflow: "visible" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 8, transition: "width 0.3s" }} />
      {/* Target marker */}
      <div style={{
        position:  "absolute",
        left:      `${targetPct}%`,
        top:       -3,
        width:     2,
        height:    14,
        background: "#374151",
        borderRadius: 1,
        transform: "translateX(-50%)",
      }} />
    </div>
  );
}

// ─── BAR WITH LABEL ──────────────────────────────────────────
function BarWithLabel({ value, max, color, label, labelRight }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      <div style={{ height: 5, background: "#f3f4f6", borderRadius: 5, overflow: "hidden", marginBottom: 4 }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 5, transition: "width 0.3s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>{label}</span>
        {labelRight && <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: "Figtree, sans-serif" }}>{labelRight}</span>}
      </div>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────
const FILTER_SEL = {
  height: 32, padding: "0 10px", borderRadius: 8,
  border: "1.5px solid #e5e7eb", background: "#fff",
  fontFamily: "Figtree, sans-serif", fontSize: 12, fontWeight: 500,
  color: "#374151", outline: "none", cursor: "pointer",
  appearance: "none", WebkitAppearance: "none",
};
