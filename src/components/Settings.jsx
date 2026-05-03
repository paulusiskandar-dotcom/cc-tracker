import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import PILogo from "./PILogo";
import { fxApi, merchantApi, settingsApi, recurringApi, gmailApi, accountsApi } from "../api";
import { fmtIDR } from "../utils";
import { CURRENCIES, EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST, TX_TYPES, APP_VERSION, APP_BUILD } from "../constants";
import { LIGHT, DARK } from "../theme";
import {
  Modal, ConfirmModal, Button,
  Field, AmountInput, Input, FormRow,
  Select,
  SectionHeader, EmptyState, showToast,
} from "./shared/index";

const SUBTABS = [
  { id: "profile",     label: "Profile"     },
  { id: "accounts",    label: "Accounts"    },
  { id: "backup",      label: "Backup"      },
  { id: "email",       label: "Email Sync"  },
  { id: "fx",          label: "FX Rates"    },
  { id: "recurring",   label: "Recurring"   },
  { id: "merchants",         label: "Merchants"         },
  { id: "appearance",        label: "Appearance"        },
  { id: "reconcile_history", label: "Reconcile History" },
];

// ── Reconcile History tab ─────────────────────────────────────
const RH_FF = "Figtree, sans-serif";
const rhFmtDate = iso => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const rhFmtAgo  = iso => {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30)  return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
};
const rhMonthName = m => ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];

function ReconcileHistoryTab({ user, accounts }) {
  const [sessions,    setSessions]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [filterAcc,   setFilterAcc]   = useState("");
  const [filterYear,  setFilterYear]  = useState("");
  const [expandedId,  setExpandedId]  = useState(null);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    supabase.from("reconcile_sessions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(200)
      .then(({ data }) => { setSessions(data || []); setLoading(false); });
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const years    = [...new Set(sessions.map(s => s.period_year))].sort((a, b) => b - a);
  const filtered = sessions.filter(s => {
    if (filterAcc  && s.account_id   !== filterAcc)           return false;
    if (filterYear && s.period_year  !== Number(filterYear))  return false;
    return true;
  });

  if (loading) return <div style={{ fontSize: 12, color: "#6b7280", fontFamily: RH_FF, padding: 20 }}>Loading…</div>;
  if (!sessions.length) return <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: RH_FF, padding: 20, textAlign: "center" }}>No reconcile history yet.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: RH_FF }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={filterAcc} onChange={e => setFilterAcc(e.target.value)}
          style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontFamily: RH_FF }}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
          style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, border: "1px solid #e5e7eb", fontFamily: RH_FF }}>
          <option value="">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          {filtered.length} session{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map(s => {
          const acc      = accounts.find(a => a.id === s.account_id);
          const expanded = expandedId === s.id;
          return (
            <div key={s.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden" }}>
              <div onClick={() => setExpandedId(expanded ? null : s.id)}
                style={{ padding: "10px 14px", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>
                    {acc?.name || "Unknown"} · {rhMonthName(s.period_month)} {s.period_year}
                  </div>
                  <div style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                    ✓ {s.total_match || 0} matched · + {s.total_missing || 0} missing · ? {s.total_extra || 0} extra
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 10, color: "#6b7280" }}>{rhFmtAgo(s.completed_at)}</div>
                  <div style={{ fontSize: 9, color: "#9ca3af" }}>{s.pdf_filename || ""}</div>
                </div>
              </div>
              {expanded && (
                <div style={{ borderTop: "1px solid #f3f4f6", background: "#f9fafb", padding: "10px 14px", fontSize: 11, color: "#374151", display: "flex", flexDirection: "column", gap: 3 }}>
                  <div>Reconciled at: {rhFmtDate(s.completed_at)}</div>
                  <div>Period: {s.period_month}/{s.period_year}</div>
                  <div>Statement PDF: {s.pdf_filename || "(none)"}</div>
                  <div>Total statement txs: {s.total_statement || 0}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SETUP_STEPS = [
  'Go to console.cloud.google.com → Create project "Paulus Finance"',
  "Enable Gmail API (APIs & Services → Library)",
  "OAuth consent screen → External · Scope: gmail.readonly",
  "Create OAuth credentials → Web application",
  `Add Authorized redirect URI: ${process.env.REACT_APP_SUPABASE_URL || "[SUPABASE_URL]"}/functions/v1/gmail-oauth`,
  "Copy Client ID and paste below",
  "Click Connect Gmail → authorize",
];

export default function Settings({
  user, dark, setDark,
  fxRates, setFxRates,
  recurTemplates, setRecurTemplates,
  merchantMaps, setMerchantMaps,
  onRefresh,
  accounts = [], setAccounts, bankAccounts = [], creditCards = [],
  categories = [], incomeSrcs = [],
  ledger = [], installments = [],
  setInstallments,
  employeeLoans = [],
  initialTab,
}) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab] = useState(initialTab || "profile");
  const [saving, setSaving] = useState(false);

  // ── Profile ────────────────────────────────────────────────
  const [profileName, setProfileName] = useState(user?.user_metadata?.full_name || "");
  const [changingPass, setChangingPass] = useState(false);
  const [newPass, setNewPass] = useState("");

  // ── Gmail ──────────────────────────────────────────────────
  const [gmailToken, setGmailToken]       = useState(null);
  const [gmailLoaded, setGmailLoaded]     = useState(false);
  const [clientId, setClientId]           = useState("");
  const [syncingNow, setSyncingNow]       = useState(false);
  const [syncLog, setSyncLog]             = useState([]);
  const [syncFromDate, setSyncFromDate]   = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [syncToDate, setSyncToDate]       = useState(() => new Date().toISOString().slice(0, 10));
  const [skippedRows, setSkippedRows]     = useState([]);
  const [skippedLoaded, setSkippedLoaded] = useState(false);
  const [skippedLoading, setSkippedLoading] = useState(false);

  // ── FX ─────────────────────────────────────────────────────
  const [rates, setRates] = useState(() => {
    const r = {};
    CURRENCIES.filter(c => c.code !== "IDR").forEach(c => {
      r[c.code] = fxRates?.[c.code] || c.rate;
    });
    return r;
  });

  // ── Recurring ──────────────────────────────────────────────
  const [recurModal, setRecurModal]   = useState(false);
  const [editRecur, setEditRecur]     = useState(null);
  const [recurForm, setRecurForm]     = useState({
    name: "", tx_type: "expense", amount: "", currency: "IDR",
    frequency: "Monthly", category_id: "", notes: "",
    from_id: "", to_id: "", day_of_month: "",
  });

  // ── Merchants ──────────────────────────────────────────────
  const [editMerchant, setEditMerchant] = useState(null);
  const [merchantCat, setMerchantCat]   = useState("");
  const [merchantTxType, setMerchantTxType] = useState("");
  const [merchantKeyword, setMerchantKeyword] = useState("");
  const [merchantModal, setMerchantModal] = useState(false);
  const [merchantSearch, setMerchantSearch] = useState("");

  // ── What's New ─────────────────────────────────────────────
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  // ── Actions: Profile ───────────────────────────────────────
  const updateProfile = async () => {
    if (!profileName.trim()) return;
    setSaving(true);
    try {
      await supabase.auth.updateUser({ data: { full_name: profileName.trim() } });
      showToast("Profile updated");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const changePassword = async () => {
    if (newPass.length < 8) return showToast("Minimum 8 characters", "error");
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPass });
      if (error) throw error;
      showToast("Password updated");
      setChangingPass(false);
      setNewPass("");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const signOut = () => supabase.auth.signOut();

  // ── Actions: Gmail ─────────────────────────────────────────
  const loadGmailToken = async () => {
    if (gmailLoaded) return;
    try {
      const t = await gmailApi.getToken(user.id);
      setGmailToken(t);
      const log = await settingsApi.get(user.id, "gmail_sync_log", []);
      setSyncLog(Array.isArray(log) ? log : []);
    } catch { /* table may not exist */ }
    setGmailLoaded(true);
  };

  const connectGmail = () => {
    if (!clientId.trim()) return showToast("Enter your Google Client ID first", "error");
    const redirectUri = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-oauth`;
    const scope = "https://www.googleapis.com/auth/gmail.readonly";
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${user.id}`;
    const popup = window.open(url, "Connect Gmail", "width=500,height=620,scrollbars=yes");
    const poll = setInterval(async () => {
      if (!popup || popup.closed) {
        clearInterval(poll);
        const t = await gmailApi.getToken(user.id).catch(() => null);
        if (t) { setGmailToken(t); showToast("Gmail connected!"); }
        else showToast("Connection incomplete — try again", "error");
      }
    }, 1000);
  };

  const disconnectGmail = async () => {
    if (!window.confirm("Disconnect Gmail? Auto-sync will stop.")) return;
    try {
      await gmailApi.disconnect(user.id);
      setGmailToken(null);
      showToast("Gmail disconnected");
    } catch (e) { showToast(e.message, "error"); }
  };

  const syncNow = async () => {
    setSyncingNow(true);
    try {
      const result = await gmailApi.triggerSync(user.id, syncFromDate, syncToDate);
      showToast(`Sync complete: ${result?.new_transactions || 0} new transactions`);
      const log = await settingsApi.get(user.id, "gmail_sync_log", []);
      setSyncLog(Array.isArray(log) ? log : []);
      await onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setSyncingNow(false);
  };

  const loadSkipped = async () => {
    if (skippedLoaded) return;
    setSkippedLoading(true);
    try {
      const data = await gmailApi.getSkipped(user.id);
      setSkippedRows(data);
      setSkippedLoaded(true);
    } catch (e) { showToast(e.message, "error"); }
    setSkippedLoading(false);
  };

  const restoreSkipped = async (id) => {
    try {
      await gmailApi.restoreSkipped(id);
      setSkippedRows(prev => prev.filter(r => r.id !== id));
      await onRefresh?.();
      showToast("Restored to pending");
    } catch (e) { showToast(e.message, "error"); }
  };

  const deleteSkipped = async (id) => {
    try {
      await gmailApi.deleteSkipped(id);
      setSkippedRows(prev => prev.filter(r => r.id !== id));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
  };

  // ── Actions: FX ────────────────────────────────────────────
  const [fxEditCode, setFxEditCode] = useState(null);
  const [fxEditVal,  setFxEditVal]  = useState("");

  const saveFxRates = async () => {
    setSaving(true);
    try {
      await fxApi.upsertAll(user.id, rates);
      await fxApi.saveHistory(user.id, rates);
      setFxRates(rates);
      showToast("FX rates saved");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const saveSingleRate = async (code) => {
    const newRate = Number(fxEditVal);
    if (!newRate || newRate <= 0) { showToast("Enter a valid rate", "error"); return; }
    const newRates = { ...rates, [code]: newRate };
    setSaving(true);
    try {
      await fxApi.upsertAll(user.id, { [code]: newRate });
      await fxApi.saveHistory(user.id, { [code]: newRate });
      setRates(newRates);
      setFxRates(newRates);
      setFxEditCode(null);
      showToast(`${code} rate updated`);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Actions: Recurring ─────────────────────────────────────
  const openRecurModal = (t = null) => {
    if (t) {
      setEditRecur(t);
      setRecurForm({
        name: t.name, tx_type: t.tx_type || "expense", amount: String(t.amount),
        currency: t.currency || "IDR",
        frequency: t.frequency || (t.tx_type === "income" ? "Monthly" : "Monthly"),
        category_id: t.category_id || "", notes: t.notes || "",
        from_id: t.from_id || "", to_id: t.to_id || "",
        day_of_month: t.day_of_month ? String(t.day_of_month) : "",
      });
    } else {
      setEditRecur(null);
      setRecurForm({
        name: "", tx_type: "expense", amount: "", currency: "IDR",
        frequency: "Monthly", category_id: "", notes: "",
        from_id: "", to_id: "", day_of_month: "",
      });
    }
    setRecurModal(true);
  };

  const saveRecur = async () => {
    if (!recurForm.name || !recurForm.amount) return showToast("Fill name and amount", "error");
    setSaving(true);
    try {
      const sn = (v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? 0 : n; };
      const isUUID = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
      const toUUID = (v) => (!v || v === "" || !isUUID(v)) ? null : v;

      const payload = {
        name:         recurForm.name,
        tx_type:      recurForm.tx_type,
        amount:       sn(recurForm.amount),
        currency:     recurForm.currency,
        frequency:    recurForm.frequency,
        category_id:  toUUID(recurForm.category_id),
        notes:        recurForm.notes || null,
        from_id:      toUUID(recurForm.from_id),
        to_id:        toUUID(recurForm.to_id),
        day_of_month: recurForm.day_of_month ? Number(recurForm.day_of_month) : null,
        entity:       "Personal",
      };
      if (editRecur) {
        const updated = await recurringApi.updateTemplate(editRecur.id, payload);
        setRecurTemplates(prev => prev.map(t => t.id === editRecur.id ? { ...t, ...updated } : t));
        showToast("Template updated");
      } else {
        const created = await recurringApi.createTemplate(user.id, payload);
        setRecurTemplates(prev => [created, ...prev]);
        showToast("Template created");
      }
      setRecurModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const deleteRecur = async (t) => {
    if (!window.confirm(`Delete "${t.name}"?`)) return;
    try {
      await recurringApi.deleteTemplate(t.id);
      setRecurTemplates(prev => prev.filter(x => x.id !== t.id));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
  };

  const toggleRecurActive = async (t) => {
    try {
      const updated = await recurringApi.updateTemplate(t.id, { is_active: !t.is_active });
      setRecurTemplates(prev => prev.map(x => x.id === t.id ? { ...x, ...updated } : x));
      showToast(updated.is_active ? "Template activated" : "Template paused");
    } catch (e) { showToast(e.message, "error"); }
  };

  // ── Actions: Merchants ─────────────────────────────────────
  const saveMerchantCat = async () => {
    const keyword = (merchantKeyword || editMerchant?.merchant_name || "").trim();
    if (!keyword) return showToast("Keyword required", "error");
    try {
      const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES_LIST];
      const catDef  = allCats.find(c => c.id === merchantCat);
      const catName = catDef?.label || merchantCat || null;
      await supabase.from("merchant_mappings").upsert(
        { user_id: user.id, merchant_name: keyword.toLowerCase(), category_id: merchantCat || null,
          category_name: catName, tx_type: merchantTxType || null, last_seen: new Date().toISOString() },
        { onConflict: "user_id,merchant_name" }
      );
      const isNew = !editMerchant?.id;
      setMerchantMaps(prev => {
        const updated = prev.map(m => m.merchant_name === keyword.toLowerCase()
          ? { ...m, category_id: merchantCat || null, category_name: catName, tx_type: merchantTxType || null }
          : m
        );
        if (isNew && !updated.some(m => m.merchant_name === keyword.toLowerCase())) {
          return [{ id: Date.now(), merchant_name: keyword.toLowerCase(), category_id: merchantCat || null,
                    category_name: catName, tx_type: merchantTxType || null, confidence: 1 }, ...prev];
        }
        return updated;
      });
      showToast(isNew ? "Rule added" : "Rule saved");
      setMerchantModal(false);
      setEditMerchant(null);
    } catch (e) { showToast(e.message, "error"); }
  };

  const deleteMerchantRule = async (m) => {
    if (!window.confirm(`Delete rule for "${m.merchant_name}"?`)) return;
    try {
      if (m.id && typeof m.id === "string") {
        await merchantApi.delete(m.id);
      } else {
        await supabase.from("merchant_mappings").delete()
          .eq("user_id", user.id).eq("merchant_name", m.merchant_name);
      }
      setMerchantMaps(prev => prev.filter(x => x.merchant_name !== m.merchant_name));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
  };

  const openAddMerchant = () => {
    setEditMerchant(null);
    setMerchantKeyword("");
    setMerchantCat("");
    setMerchantTxType("");
    setMerchantModal(true);
  };

  const openEditMerchant = (m) => {
    setEditMerchant(m);
    setMerchantKeyword(m.merchant_name || "");
    setMerchantCat(m.category_id || "");
    setMerchantTxType(m.tx_type || "");
    setMerchantModal(true);
  };

  // ── Theme ──────────────────────────────────────────────────
  const toggleDark = async () => {
    const next = !dark;
    setDark(next);
    try { await settingsApi.set(user.id, "dark_mode", next); } catch { /* ignore */ }
  };

  // ── Styles ─────────────────────────────────────────────────
  const card = {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 16, padding: "16px 18px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── SUB-TABS ─────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setSubTab(t.id); if (t.id === "email") loadGmailToken(); }}
            style={{
              padding: "7px 14px", borderRadius: 99, border: "none",
              cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "Figtree, sans-serif",
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
      {/* ── PROFILE ──────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "profile" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* User card */}
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: "linear-gradient(135deg, #1e3a5f 0%, #4338ca 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <PILogo size={28} white />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{profileName || "Paulus"}</div>
                <div style={{ fontSize: 11, color: T.text3 }}>{user?.email}</div>
              </div>
            </div>
            <Field label="Display Name">
              <Input
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="Your name"
              />
            </Field>
            <div style={{ marginTop: 10 }}>
              <Button variant="primary" size="sm" busy={saving} onClick={updateProfile}>
                Save Name
              </Button>
            </div>
          </div>

          {/* Password */}
          <div style={card}>
            <SectionHeader title="Security" />
            {!changingPass ? (
              <div style={{ marginTop: 10 }}>
                <Button variant="secondary" size="sm" onClick={() => setChangingPass(true)}>
                  🔑 Change Password
                </Button>
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <Field label="New Password (min 8 chars)">
                  <Input
                    type="password"
                    value={newPass}
                    onChange={e => setNewPass(e.target.value)}
                    placeholder="New password"
                  />
                </Field>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="primary"   size="sm" busy={saving} onClick={changePassword}>Update</Button>
                  <Button variant="secondary" size="sm" onClick={() => { setChangingPass(false); setNewPass(""); }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* Sign out */}
          <div style={card}>
            <SectionHeader title="Session" />
            <div style={{ marginTop: 10 }}>
              <Button variant="danger" size="sm" onClick={signOut}>Sign Out</Button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── ACCOUNTS ─────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "accounts" && (
        <AccountsSection
          user={user} T={T} card={card}
          accounts={accounts} setAccounts={setAccounts}
          onRefresh={onRefresh}
        />
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── BACKUP ───────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "backup" && (
        <BackupSection user={user} T={T} card={card} ledger={ledger} />
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── EMAIL SYNC ───────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "email" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* ── Status card ── */}
          <div style={{ ...card, borderColor: gmailToken ? "#059669" : T.border }}>
            <SectionHeader title={gmailToken ? "✅ Gmail Connected" : "📧 Gmail Not Connected"} />
            {gmailToken ? (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{gmailToken.gmail_email || user?.email}</div>
                <div style={{ fontSize: 11, color: T.text3 }}>Auto sync: Every 15 minutes ✅</div>
                {syncLog.length > 0 ? (() => {
                  const last = syncLog[0];
                  const d = new Date(last.synced_at);
                  const fmt = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
                  return (
                    <div style={{ fontSize: 11, color: T.text3 }}>
                      Last sync: {fmt} · {last.emails_processed ?? 0} emails · {last.new_transactions ?? 0} transactions · {last.status === "success" ? "✅" : "❌"}
                    </div>
                  );
                })() : gmailToken.last_sync ? (
                  <div style={{ fontSize: 11, color: T.text3 }}>Last sync: {new Date(gmailToken.last_sync).toLocaleString()}</div>
                ) : null}
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: T.text3, lineHeight: 1.6 }}>
                Connect Gmail to auto-import bank transaction notifications.
                Only <strong>gmail.readonly</strong> — cannot send or delete emails.
              </div>
            )}
          </div>

          {/* ── Manual sync with date range (only when connected) ── */}
          {gmailToken && (() => {
            const days = Math.round((new Date(syncToDate) - new Date(syncFromDate)) / 86400000);
            const rangeWarning = days > 30;
            return (
              <div style={card}>
                <SectionHeader title="Manual Sync" />
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                  <FormRow>
                    <Field label="From" style={{ flex: 1 }}>
                      <Input type="date" value={syncFromDate} onChange={e => setSyncFromDate(e.target.value)} />
                    </Field>
                    <Field label="To" style={{ flex: 1 }}>
                      <Input type="date" value={syncToDate} onChange={e => setSyncToDate(e.target.value)} />
                    </Field>
                  </FormRow>
                  {rangeWarning && (
                    <div style={{ fontSize: 11, color: "#d97706", background: "#fef9c3", borderRadius: 8, padding: "8px 12px" }}>
                      ⚠️ Range is {days} days. Large ranges may take longer and could hit Gmail API limits.
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button variant="primary" size="sm" busy={syncingNow} onClick={syncNow}>🔄 Sync Now</Button>
                    <Button variant="danger"  size="sm" onClick={disconnectGmail}>Disconnect Gmail</Button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Sync history (only when connected and log exists) ── */}
          {gmailToken && syncLog.length > 0 && (
            <div style={card}>
              <SectionHeader title="Sync History" />
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 0 }}>
                <div style={{
                  display: "flex", gap: 8,
                  padding: "4px 0", borderBottom: `1px solid ${T.border}`,
                  fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.05em",
                }}>
                  <span style={{ flex: 1 }}>Time</span>
                  <span style={{ width: 52, textAlign: "right", flexShrink: 0 }}>Emails</span>
                  <span style={{ width: 90, textAlign: "right", flexShrink: 0 }}>Transactions</span>
                  <span style={{ width: 44, textAlign: "center", flexShrink: 0 }}>Status</span>
                </div>
                {syncLog.slice(0, 10).map((entry, i) => {
                  const d = new Date(entry.synced_at);
                  const fmt = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
                  return (
                    <div key={i} style={{
                      display: "flex", gap: 8,
                      padding: "7px 0", borderBottom: `1px solid ${T.border}`,
                      fontSize: 11, color: T.text2,
                    }}>
                      <span style={{ flex: 1 }}>{fmt}</span>
                      <span style={{ width: 52, textAlign: "right", flexShrink: 0, color: T.text3 }}>{entry.emails_processed ?? 0}</span>
                      <span style={{ width: 90, textAlign: "right", flexShrink: 0, color: entry.new_transactions > 0 ? "#059669" : T.text3, fontWeight: entry.new_transactions > 0 ? 600 : 400 }}>{entry.new_transactions ?? 0}</span>
                      <span style={{ width: 44, textAlign: "center", flexShrink: 0 }}>{entry.status === "success" ? "✅" : "❌"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Skipped transactions (only when connected) ── */}
          {gmailToken && (
            <div style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <SectionHeader title="Skipped Transactions" />
                {!skippedLoaded && (
                  <Button variant="secondary" size="sm" onClick={loadSkipped} busy={skippedLoading}>Load</Button>
                )}
              </div>
              {skippedLoading && <div style={{ fontSize: 12, color: T.text3, marginTop: 8 }}>Loading…</div>}
              {skippedLoaded && skippedRows.length === 0 && (
                <div style={{ fontSize: 12, color: T.text3, marginTop: 8 }}>No skipped transactions.</div>
              )}
              {skippedRows.map(row => (
                <div key={row.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 0", borderBottom: `1px solid ${T.border}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.subject || "(no subject)"}</div>
                    <div style={{ fontSize: 11, color: T.text3 }}>{row.sender_email} · {row.received_at ? new Date(row.received_at).toLocaleDateString() : ""}</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => restoreSkipped(row.id)}>Restore</Button>
                  <Button variant="danger"    size="sm" onClick={() => deleteSkipped(row.id)}>Delete</Button>
                </div>
              ))}
            </div>
          )}

          {/* ── Setup guide (only when not connected) ── */}
          {!gmailToken && (
            <div style={card}>
              <SectionHeader title="Setup Guide" />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {SETUP_STEPS.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", background: "#dbeafe",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 800, color: "#3b5bdb", flexShrink: 0,
                    }}>{i + 1}</div>
                    <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.6 }}>{step}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <Field label="Google Client ID">
                  <Input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="xxx.apps.googleusercontent.com" />
                </Field>
                <div style={{ marginTop: 10 }}>
                  <Button variant="accent" size="md" onClick={connectGmail}>Connect Gmail →</Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── FX RATES ─────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "fx" && (
        <div style={card}>
          <SectionHeader title="Exchange Rates to IDR" />
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 12, marginTop: 4 }}>
            Used to convert foreign currency balances and transactions to IDR.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {CURRENCIES.filter(c => c.code !== "IDR").map(c => (
              <div key={c.code} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", background: T.sur2, borderRadius: 10,
              }}>
                <span style={{ fontSize: 18 }}>{c.flag}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: T.text, minWidth: 36 }}>{c.code}</span>
                {fxEditCode === c.code ? (
                  <>
                    <span style={{ fontSize: 11, color: T.text3 }}>1 {c.code} =</span>
                    <input
                      type="number"
                      value={fxEditVal}
                      onChange={e => setFxEditVal(e.target.value)}
                      autoFocus
                      style={{
                        width: 110, padding: "6px 8px", borderRadius: 8,
                        border: `1.5px solid #3b5bdb`, background: T.surface,
                        color: T.text, fontSize: 13, fontFamily: "Figtree, sans-serif",
                        textAlign: "right",
                      }}
                    />
                    <span style={{ fontSize: 11, color: T.text3 }}>IDR</span>
                    <Button variant="primary" size="sm" busy={saving} onClick={() => saveSingleRate(c.code)}>Save</Button>
                    <Button variant="secondary" size="sm" onClick={() => setFxEditCode(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 11, color: T.text3, flex: 1 }}>1 {c.code} =</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                      Rp {(rates[c.code] || 0).toLocaleString("id-ID")}
                    </span>
                    <button
                      onClick={() => { setFxEditCode(c.code); setFxEditVal(String(rates[c.code] || "")); }}
                      style={{
                        border: `1px solid ${T.border}`, background: T.surface, color: T.text2,
                        borderRadius: 7, padding: "4px 10px", fontSize: 11, fontWeight: 600,
                        cursor: "pointer", fontFamily: "Figtree, sans-serif",
                      }}
                    >
                      Edit
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <Button variant="primary" size="md" busy={saving} onClick={saveFxRates}>
              Save All Rates
            </Button>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── RECURRING ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "recurring" && (() => {
        const isIncome  = t => t.tx_type === "income";
        const toMonthly = t => {
          const a = Number(t.amount || 0);
          if (t.frequency === "Weekly")    return a * 52 / 12;
          if (t.frequency === "Quarterly") return a / 3;
          if (t.frequency === "Annual")    return a / 12;
          return a; // Monthly default
        };
        const totalIncome  = recurTemplates.filter(isIncome).reduce((s, t) => s + toMonthly(t), 0);
        const totalExpense = recurTemplates.filter(t => !isIncome(t)).reduce((s, t) => s + toMonthly(t), 0);
        const net          = totalIncome - totalExpense;

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* ── Summary cards + Add button row ── */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, flex: 1 }}>
                {[
                  { label: "Monthly Income",  value: fmtIDR(totalIncome),  color: "#059669" },
                  { label: "Monthly Expense", value: fmtIDR(totalExpense), color: "#dc2626" },
                  { label: "Net Monthly",     value: fmtIDR(net),          color: net >= 0 ? "#059669" : "#dc2626" },
                ].map(s => (
                  <div key={s.label} style={{ background: s.color + "14", borderRadius: 14, padding: "14px 14px" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif", marginBottom: 5, opacity: 0.8 }}>{s.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#111827", fontFamily: "Figtree, sans-serif" }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <Button variant="primary" size="sm" onClick={() => openRecurModal()} style={{ flexShrink: 0, alignSelf: "center" }}>
                + Add
              </Button>
            </div>

            {recurTemplates.length === 0 ? (
              <EmptyState icon="🔄" message="No recurring templates yet." />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                {recurTemplates.map(t => {
                  const isPaused    = t.is_active === false;
                  const income      = t.tx_type === "income";
                  const accentColor = income ? "#059669" : "#dc2626";
                  const accentBg    = income ? "#f0fdf4" : "#fff5f5";
                  const txDef       = TX_TYPES.find(x => x.id === t.tx_type);
                  const toAcc       = accounts.find(a => a.id === t.to_id);
                  const fromAcc     = accounts.find(a => a.id === t.from_id);
                  const catName     = t.category_id
                    ? (categories.find(c => c.id === t.category_id)?.label
                      || incomeSrcs.find(s => s.id === t.category_id)?.name
                      || null)
                    : null;

                  const subtitleParts = [
                    t.frequency,
                    txDef?.label || t.tx_type,
                    t.day_of_month ? `day ${t.day_of_month}` : null,
                    fromAcc ? `from ${fromAcc.name}` : null,
                    toAcc   ? `to ${toAcc.name}`     : null,
                    catName ? catName                 : null,
                  ].filter(Boolean);

                  return (
                    <div key={t.id} style={{ background: "#ffffff", border: "0.5px solid #e5e7eb", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", opacity: isPaused ? 0.55 : 1 }}>
                      {/* Color bar */}
                      <div style={{ height: 3, background: isPaused ? "#d1d5db" : accentColor }} />

                      <div style={{ padding: "14px 14px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* Type badge */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ display: "inline-block", background: accentBg, color: accentColor, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, fontFamily: "Figtree, sans-serif" }}>
                            {txDef?.label?.toUpperCase() || t.tx_type.toUpperCase()}
                          </span>
                          {isPaused && (
                            <span style={{ background: "#f3f4f6", color: "#9ca3af", borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700, fontFamily: "Figtree, sans-serif" }}>
                              PAUSED
                            </span>
                          )}
                        </div>

                        {/* Name */}
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.name}
                        </div>

                        {/* Subtitle */}
                        <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", display: "flex", flexWrap: "wrap", gap: "2px 4px" }}>
                          {subtitleParts.map((p, i) => (
                            <span key={i}>{i > 0 && <span style={{ opacity: 0.4 }}>·</span>} {p}</span>
                          ))}
                        </div>

                        {/* Amount */}
                        <div style={{ marginTop: 2 }}>
                          <div style={{ fontSize: 20, fontWeight: 900, color: accentColor, fontFamily: "Figtree, sans-serif", lineHeight: 1.2 }}>
                            {fmtIDR(Number(t.amount || 0))}
                          </div>
                          <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>{t.currency || "IDR"}</div>
                        </div>
                      </div>

                      {/* Bottom action bar */}
                      <div style={{ borderTop: "0.5px solid #f3f4f6", padding: "8px 14px", display: "flex", gap: 6 }}>
                        <button
                          onClick={() => toggleRecurActive(t)}
                          title={isPaused ? "Activate" : "Pause"}
                          style={{ width: 30, height: 30, border: "0.5px solid #e5e7eb", borderRadius: 8, cursor: "pointer", background: "#ffffff", color: isPaused ? "#059669" : "#9ca3af", fontSize: 14, fontFamily: "Figtree, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                        >
                          {isPaused ? "▶" : "⏸"}
                        </button>
                        <button
                          onClick={() => openRecurModal(t)}
                          style={{ flex: 1, height: 30, border: "0.5px solid #e5e7eb", borderRadius: 8, cursor: "pointer", background: "#ffffff", color: "#374151", fontSize: 12, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteRecur(t)}
                          style={{ height: 30, padding: "0 10px", border: "none", borderRadius: 8, cursor: "pointer", background: "none", color: "#d1d5db", fontSize: 12, fontFamily: "Figtree, sans-serif" }}
                          onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                          onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── MERCHANTS ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "merchants" && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <SectionHeader title="Merchant Rules" />
            <Button variant="primary" size="sm" onClick={openAddMerchant}>+ Add Rule</Button>
          </div>
          <div style={{ fontSize: 11, color: T.text3, marginBottom: 12 }}>
            Keyword rules for auto-categorizing transactions. More specific keywords take priority — reorder by editing.
          </div>
          <input
            value={merchantSearch}
            onChange={e => setMerchantSearch(e.target.value)}
            placeholder="Search rules…"
            style={{ width: "100%", fontSize: 12, padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.sur2, color: T.text, fontFamily: "Figtree, sans-serif", marginBottom: 10, boxSizing: "border-box" }}
          />
          {merchantMaps.length === 0 ? (
            <EmptyState icon="🏪" message="No merchant rules yet. Add one to auto-categorize transactions." />
          ) : (
            merchantMaps
              .filter(m => !merchantSearch || m.merchant_name?.toLowerCase().includes(merchantSearch.toLowerCase()))
              .map(m => {
                const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES_LIST];
                const cat = allCats.find(c => c.id === m.category_id);
                return (
                  <div key={m.merchant_name} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "8px 12px", background: T.sur2, borderRadius: 10, marginBottom: 6,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif" }}>{m.merchant_name}</div>
                      <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif" }}>
                        {cat ? `${cat.icon} ${cat.label}` : m.category_name || m.category_id || "—"}
                        {m.tx_type ? ` · ${m.tx_type}` : ""}
                        {m.confidence > 1 ? ` · used ${m.confidence}×` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <Button variant="secondary" size="sm" onClick={() => openEditMerchant(m)}>Edit</Button>
                      <Button variant="danger" size="sm" onClick={() => deleteMerchantRule(m)}>×</Button>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── APPEARANCE ───────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "appearance" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Theme toggle */}
          <div style={card}>
            <SectionHeader title="Theme" />
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              {[
                { label: "Light", isDark: false, icon: "☀️" },
                { label: "Dark",  isDark: true,  icon: "🌙" },
              ].map(opt => (
                <button
                  key={opt.label}
                  onClick={() => { if (dark !== opt.isDark) toggleDark(); }}
                  style={{
                    flex: 1, padding: 14, cursor: "pointer", textAlign: "center",
                    borderRadius: 12, transition: "all .15s",
                    border: `2px solid ${dark === opt.isDark ? T.ac : T.border}`,
                    background: dark === opt.isDark ? T.acBg : T.sur2,
                    fontFamily: "Figtree, sans-serif",
                  }}
                >
                  <div style={{ fontSize: 24, marginBottom: 4 }}>{opt.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: dark === opt.isDark ? T.ac : T.text3 }}>
                    {opt.label}
                  </div>
                  {dark === opt.isDark && <div style={{ fontSize: 10, color: T.ac, marginTop: 2 }}>Active</div>}
                </button>
              ))}
            </div>
          </div>

          {/* About */}
          <div style={card}>
            <SectionHeader title="About" />
            <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 10 }}>
              {[
                { label: "App",      value: "Paulus Finance" },
                { label: "Version",  value: `v${APP_VERSION}` },
                { label: "Build",    value: APP_BUILD },
                { label: "Database", value: "v5 (unified ledger)" },
                { label: "User ID",  value: `${user?.id?.slice(0, 8)}…` },
                { label: "Email",    value: user?.email },
              ].map(item => (
                <div key={item.label} style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "7px 0", borderBottom: `1px solid ${T.border}`,
                }}>
                  <span style={{ fontSize: 12, color: T.text3 }}>{item.label}</span>
                  <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{item.value}</span>
                </div>
              ))}
            </div>

            {/* What's new */}
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => setWhatsNewOpen(o => !o)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 12, color: T.ac, fontFamily: "Figtree, sans-serif", fontWeight: 600, padding: 0,
                }}
              >
                {whatsNewOpen ? "▲" : "▼"} What's new in v{APP_VERSION}
              </button>
              {whatsNewOpen && (
                <div style={{
                  marginTop: 8, padding: "10px 14px", background: T.acBg,
                  borderRadius: 10, fontSize: 12, color: T.text2, lineHeight: 1.8,
                }}>
                  <div style={{ fontWeight: 700, color: T.ac, marginBottom: 6 }}>v{APP_VERSION} — {APP_BUILD}</div>
                  {[
                    "📧 Gmail auto-sync: connect once, transactions import automatically",
                    "🔍 Duplicate detection: smart matching prevents double-imports",
                    "🏪 Merchant learning: categories remembered per merchant",
                    "⏳ Pending review UI: approve, edit or skip each email transaction",
                    "🎨 Complete UI overhaul: Linear/Notion design system",
                    "🔢 Unified ledger v5 with full double-entry accounting",
                  ].map((item, i) => <div key={i}>• {item}</div>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── RECONCILE HISTORY ────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "reconcile_history" && (
        <ReconcileHistoryTab user={user} accounts={accounts} />
      )}

      {/* ── RECURRING MODAL ─────────────────────────────── */}
      <Modal
        isOpen={recurModal}
        onClose={() => { setRecurModal(false); setEditRecur(null); }}
        title={editRecur ? "Edit Template" : "New Recurring Template"}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => { setRecurModal(false); setEditRecur(null); }}>Cancel</Button>
            <Button
              variant="primary" size="md" busy={saving}
              disabled={!recurForm.name || !recurForm.amount}
              onClick={saveRecur}
            >
              {editRecur ? "Update" : "Create"}
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Type select */}
          <Field label="Type">
            <Select
              value={recurForm.tx_type}
              onChange={e => setRecurForm(f => ({ ...f, tx_type: e.target.value, from_id: "", to_id: "", category_id: "" }))}
              options={[
                { value: "expense",      label: "↑ Expense"      },
                { value: "income",       label: "↓ Income"       },
                { value: "transfer",     label: "↔ Transfer"     },
                { value: "pay_cc",       label: "💳 Pay CC"       },
                { value: "pay_liability",label: "📉 Pay Liability" },
              ]}
            />
          </Field>

          {/* Name */}
          <Field label="Name *">
            <Input
              value={recurForm.name}
              onChange={e => setRecurForm(f => ({ ...f, name: e.target.value }))}
              placeholder={recurForm.tx_type === "income" ? "e.g. Monthly Salary" : "e.g. Netflix subscription"}
            />
          </Field>

          {/* Amount + Currency */}
          <FormRow>
            <AmountInput
              label="Amount *"
              value={recurForm.amount}
              onChange={v => setRecurForm(f => ({ ...f, amount: v }))}
              currency={recurForm.currency}
            />
            <Field label="Currency">
              <Select
                value={recurForm.currency}
                onChange={e => setRecurForm(f => ({ ...f, currency: e.target.value }))}
                options={CURRENCIES.map(c => ({ value: c.code, label: `${c.flag} ${c.code}` }))}
              />
            </Field>
          </FormRow>

          {/* Frequency + Day of month */}
          <FormRow>
            <Field label="Frequency">
              <Select
                value={recurForm.frequency}
                onChange={e => setRecurForm(f => ({ ...f, frequency: e.target.value }))}
                options={
                  recurForm.tx_type === "income"
                    ? ["Monthly", "Quarterly", "Annual"].map(fr => ({ value: fr, label: fr }))
                    : ["Monthly", "Weekly", "Annual"].map(fr => ({ value: fr, label: fr }))
                }
              />
            </Field>
            <Field label="Day of Month">
              <input
                type="number" min="1" max="31"
                value={recurForm.day_of_month}
                onChange={e => setRecurForm(f => ({ ...f, day_of_month: e.target.value }))}
                placeholder="e.g. 25"
                style={{
                  border: `1.5px solid ${T.border}`, borderRadius: 10,
                  padding: "0 14px", fontFamily: "Figtree, sans-serif",
                  fontSize: 14, fontWeight: 500, outline: "none",
                  color: T.text, background: T.surface, height: 44,
                  width: "100%", boxSizing: "border-box",
                }}
              />
            </Field>
          </FormRow>

          {/* INCOME: To account + source */}
          {recurForm.tx_type === "income" && (
            <>
              <Field label="To Account (bank)">
                <Select value={recurForm.to_id} onChange={e => setRecurForm(f => ({ ...f, to_id: e.target.value }))}
                  options={bankAccounts.map(a => ({ value: a.id, label: a.name }))} placeholder="Select bank account…" />
              </Field>
              <Field label="Income Source">
                <Select value={recurForm.category_id} onChange={e => setRecurForm(f => ({ ...f, category_id: e.target.value }))}
                  options={incomeSrcs.map(s => ({ value: s.id, label: s.name }))} placeholder="None" />
              </Field>
            </>
          )}

          {/* EXPENSE: From account + category */}
          {recurForm.tx_type === "expense" && (
            <>
              <Field label="From Account">
                <Select value={recurForm.from_id} onChange={e => setRecurForm(f => ({ ...f, from_id: e.target.value }))}
                  options={[...bankAccounts, ...creditCards].map(a => ({ value: a.id, label: a.name }))} placeholder="Select account…" />
              </Field>
              <Field label="Category">
                <Select value={recurForm.category_id} onChange={e => setRecurForm(f => ({ ...f, category_id: e.target.value }))}
                  options={categories.map(c => ({ value: c.id, label: c.label || c.name || c.id }))} placeholder="None" />
              </Field>
            </>
          )}

          {/* TRANSFER: From + To (bank/cash) */}
          {recurForm.tx_type === "transfer" && (
            <>
              <Field label="From Account">
                <Select value={recurForm.from_id} onChange={e => setRecurForm(f => ({ ...f, from_id: e.target.value }))}
                  options={[...bankAccounts, ...accounts.filter(a => a.type === "cash")].map(a => ({ value: a.id, label: a.name }))} placeholder="From…" />
              </Field>
              <Field label="To Account">
                <Select value={recurForm.to_id} onChange={e => setRecurForm(f => ({ ...f, to_id: e.target.value }))}
                  options={[...bankAccounts, ...accounts.filter(a => a.type === "cash")].map(a => ({ value: a.id, label: a.name }))} placeholder="To…" />
              </Field>
            </>
          )}

          {/* PAY CC: From bank + To credit card */}
          {recurForm.tx_type === "pay_cc" && (
            <>
              <Field label="From Account (bank/cash)">
                <Select value={recurForm.from_id} onChange={e => setRecurForm(f => ({ ...f, from_id: e.target.value }))}
                  options={[...bankAccounts, ...accounts.filter(a => a.type === "cash")].map(a => ({ value: a.id, label: a.name }))} placeholder="From…" />
              </Field>
              <Field label="Credit Card">
                <Select value={recurForm.to_id} onChange={e => setRecurForm(f => ({ ...f, to_id: e.target.value }))}
                  options={creditCards.map(a => ({ value: a.id, label: a.name }))} placeholder="Select card…" />
              </Field>
            </>
          )}

          {/* PAY LIABILITY: From bank + To liability */}
          {recurForm.tx_type === "pay_liability" && (
            <>
              <Field label="From Account (bank/cash)">
                <Select value={recurForm.from_id} onChange={e => setRecurForm(f => ({ ...f, from_id: e.target.value }))}
                  options={[...bankAccounts, ...accounts.filter(a => a.type === "cash")].map(a => ({ value: a.id, label: a.name }))} placeholder="From…" />
              </Field>
              <Field label="Liability Account">
                <Select value={recurForm.to_id} onChange={e => setRecurForm(f => ({ ...f, to_id: e.target.value }))}
                  options={accounts.filter(a => a.type === "liability").map(a => ({ value: a.id, label: a.name }))} placeholder="Select liability…" />
              </Field>
            </>
          )}

          {/* Notes */}
          <Field label="Notes">
            <Input
              value={recurForm.notes}
              onChange={e => setRecurForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional"
            />
          </Field>
        </div>
      </Modal>

      {/* ── MERCHANT EDIT MODAL ─────────────────────────── */}
      <Modal
        isOpen={merchantModal}
        onClose={() => { setMerchantModal(false); setEditMerchant(null); }}
        title={editMerchant ? "Edit Merchant Rule" : "Add Merchant Rule"}
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => { setMerchantModal(false); setEditMerchant(null); }}>Cancel</Button>
            <Button variant="primary" size="md" onClick={saveMerchantCat}>Save</Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Keyword (matches transaction description)">
            <Input
              value={merchantKeyword}
              onChange={e => setMerchantKeyword(e.target.value)}
              placeholder="e.g. indomaret, grab, netflix"
            />
          </Field>
          <Field label="Tx Type (optional — leave blank to match any)">
            <Select
              value={merchantTxType}
              onChange={e => setMerchantTxType(e.target.value)}
              options={[
                { value: "expense",  label: "Expense" },
                { value: "income",   label: "Income" },
                { value: "transfer", label: "Transfer" },
                { value: "pay_cc",   label: "Pay CC" },
              ]}
              placeholder="Any type…"
            />
          </Field>
          <Field label="Category (optional)">
            <Select
              value={merchantCat}
              onChange={e => setMerchantCat(e.target.value)}
              options={[
                { value: "", label: "— expense categories —", disabled: true },
                ...EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` })),
                { value: "", label: "— income categories —", disabled: true },
                ...INCOME_CATEGORIES_LIST.map(c => ({ value: c.id, label: c.label })),
              ]}
              placeholder="Select category…"
            />
          </Field>
        </div>
      </Modal>

    </div>
  );
}

// ─── ACCOUNTS SECTION (Liabilities + Receivables) ─────────────
function AccountsSection({ user, T, card, accounts, setAccounts, onRefresh }) {
  const liabilities  = accounts.filter(a => a.type === "liability");
  const receivables  = accounts.filter(a => a.type === "receivable");

  const [liabModal,  setLiabModal]  = useState(false);
  const [editLiab,   setEditLiab]   = useState(null);
  const [liabForm,   setLiabForm]   = useState({ name: "", current_balance: "" });
  const [liabSaving, setLiabSaving] = useState(false);
  const [delLiab,    setDelLiab]    = useState(null);

  const openAdd  = () => { setEditLiab(null); setLiabForm({ name: "", current_balance: "" }); setLiabModal(true); };
  const openEdit = (a) => { setEditLiab(a); setLiabForm({ name: a.name, current_balance: String(a.current_balance || 0) }); setLiabModal(true); };

  const saveLiab = async () => {
    if (!liabForm.name.trim()) return showToast("Name required", "error");
    setLiabSaving(true);
    try {
      if (editLiab) {
        await accountsApi.update(editLiab.id, { name: liabForm.name.trim(), current_balance: Number(liabForm.current_balance) || 0 });
        setAccounts(prev => prev.map(a => a.id === editLiab.id ? { ...a, name: liabForm.name.trim(), current_balance: Number(liabForm.current_balance) || 0 } : a));
      } else {
        const created = await accountsApi.create(user.id, {
          name: liabForm.name.trim(), type: "liability",
          current_balance: Number(liabForm.current_balance) || 0,
        });
        if (created) setAccounts(prev => [...prev, created]);
      }
      showToast(editLiab ? "Liability updated" : "Liability added");
      setLiabModal(false);
    } catch (e) { showToast(e.message, "error"); }
    setLiabSaving(false);
  };

  const deleteLiab = async () => {
    try {
      await accountsApi.delete(delLiab.id);
      setAccounts(prev => prev.filter(a => a.id !== delLiab.id));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
    setDelLiab(null);
  };

  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 0", borderBottom: `1px solid ${T.border}`,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Liabilities ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <SectionHeader title="Liabilities" />
          <Button size="sm" variant="primary" onClick={openAdd}>+ Add</Button>
        </div>
        {liabilities.length === 0 ? (
          <EmptyState icon="📋" message="No liabilities added yet." />
        ) : (
          liabilities.map((a, i) => (
            <div key={a.id} style={{ ...rowStyle, borderBottom: i === liabilities.length - 1 ? "none" : `1px solid ${T.border}` }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>{a.name}</div>
                <div style={{ fontSize: 11, color: "#dc2626", fontFamily: "Figtree, sans-serif" }}>
                  {fmtIDR(Number(a.current_balance || 0))}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <Button size="sm" variant="secondary" onClick={() => openEdit(a)}>Edit</Button>
                <Button size="sm" variant="danger"    onClick={() => setDelLiab(a)}>Delete</Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Receivables ── */}
      <div style={card}>
        <SectionHeader title="Receivables (Piutang)" />
        <div style={{ marginTop: 8 }}>
          {receivables.length === 0 ? (
            <EmptyState icon="📎" message="No receivable accounts." />
          ) : (
            receivables.map((a, i) => (
              <div key={a.id} style={{ ...rowStyle, borderBottom: i === receivables.length - 1 ? "none" : `1px solid ${T.border}` }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "#d97706", fontFamily: "Figtree, sans-serif" }}>
                    {fmtIDR(Number(a.current_balance || 0))}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif" }}>{a.entity || "—"}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Liability modal ── */}
      <Modal open={liabModal} onClose={() => setLiabModal(false)} title={editLiab ? "Edit Liability" : "Add Liability"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Input label="Name" value={liabForm.name} onChange={e => setLiabForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. KPR BCA" />
          <AmountInput label="Current Balance" value={liabForm.current_balance} onChange={v => setLiabForm(f => ({ ...f, current_balance: v }))} />
          <Button variant="primary" busy={liabSaving} onClick={saveLiab}>{editLiab ? "Save Changes" : "Add Liability"}</Button>
        </div>
      </Modal>

      {/* ── Delete confirm ── */}
      <ConfirmModal
        open={!!delLiab}
        title="Delete Liability"
        message={`Delete "${delLiab?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={deleteLiab}
        onCancel={() => setDelLiab(null)}
      />
    </div>
  );
}

// ─── BACKUP SECTION ───────────────────────────────────────────
const BACKUP_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/auto-backup`;

function BackupSection({ user, T, card, ledger }) {
  const [files,        setFiles]        = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [lastBackup,   setLastBackup]   = useState(null);
  const [backingUp,    setBackingUp]    = useState(false);
  const [downloading,  setDownloading]  = useState(null);

  // Load backup list + last_backup on mount
  const loadBackups = async () => {
    setLoadingFiles(true);
    try {
      const [filesRes, settingRes] = await Promise.all([
        supabase.storage.from("backups").list(user.id, {
          sortBy: { column: "created_at", order: "desc" },
        }),
        supabase.from("app_settings")
          .select("value")
          .eq("user_id", user.id)
          .eq("key", "last_backup")
          .maybeSingle(),
      ]);
      setFiles(filesRes.data || []);
      if (settingRes.data?.value) setLastBackup(settingRes.data.value);
    } catch { /* ignore */ }
    setLoadingFiles(false);
  };

  useState(() => { loadBackups(); }, []);

  // Trigger backup via edge function (uses user's JWT)
  const runBackup = async () => {
    setBackingUp(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(BACKUP_FN_URL, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
          "apikey":         process.env.REACT_APP_SUPABASE_ANON_KEY || "",
        },
        body: JSON.stringify({ user_id: user.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      showToast("Backup complete ✅");
      await loadBackups();
    } catch (e) { showToast(e.message || "Backup failed", "error"); }
    setBackingUp(false);
  };

  // Download a specific backup file
  const downloadBackup = async (filename) => {
    setDownloading(filename);
    try {
      const { data, error } = await supabase.storage
        .from("backups")
        .download(`${user.id}/${filename}`);
      if (error) throw error;
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { showToast(e.message || "Download failed", "error"); }
    setDownloading(null);
  };

  // Export ledger as CSV with UTF-8 BOM (Excel-compatible)
  const exportCSV = () => {
    const BOM = "\uFEFF";
    const headers = ["Date","Description","Amount","Currency","Amount IDR","Type","Category","Entity","Notes"];
    const rows = ledger.map(e => [
      e.tx_date, e.description, e.amount, e.currency || "IDR",
      e.amount_idr || e.amount, e.tx_type, e.category_name || e.category_id || "",
      e.entity || "", e.notes || "",
    ].map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const csv = BOM + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `paulus-finance-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmtTs = (iso) => {
    try {
      return new Date(iso).toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  };

  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 0", borderBottom: `1px solid ${T.border}`,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

      {/* ── Status card ── */}
      <div style={card}>
        <SectionHeader title="Backup & Export" />
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                Auto backup
              </div>
              <div style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif" }}>
                Daily at 08:00 WIB (01:00 UTC) ✅
              </div>
            </div>
          </div>
          {lastBackup && (
            <div style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif" }}>
              Last backup: {fmtTs(lastBackup)}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <Button variant="primary" size="sm" busy={backingUp} onClick={runBackup}>
              🔄 Backup Now
            </Button>
            <Button variant="secondary" size="sm" onClick={exportCSV}>
              📊 Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* ── File list ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <SectionHeader title={`Saved Backups (${files.length}/30)`} />
          <Button size="sm" variant="secondary" onClick={loadBackups}>↺ Refresh</Button>
        </div>
        {loadingFiles ? (
          <div style={{ textAlign: "center", padding: 20, fontSize: 12, color: T.text3 }}>Loading…</div>
        ) : files.length === 0 ? (
          <EmptyState icon="☁️" message="No backups yet. Click 'Backup Now' to create one." />
        ) : (
          files.map((f, i) => (
            <div key={f.name} style={{
              ...rowStyle,
              borderBottom: i === files.length - 1 ? "none" : `1px solid ${T.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14 }}>📁</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                    {f.name}
                  </div>
                  <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif" }}>
                    {f.metadata?.size ? `${(f.metadata.size / 1024).toFixed(0)} KB` : ""}
                  </div>
                </div>
              </div>
              <Button
                size="sm" variant="secondary"
                busy={downloading === f.name}
                onClick={() => downloadBackup(f.name)}
              >
                ⬇ Download
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

