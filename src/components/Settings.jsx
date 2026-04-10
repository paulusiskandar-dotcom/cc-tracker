import { useState, useCallback, useEffect } from "react";
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
  { id: "estatement",  label: "E-Statement" },
  { id: "fx",          label: "FX Rates"    },
  { id: "recurring",   label: "Recurring"   },
  { id: "merchants",   label: "Merchants"   },
  { id: "appearance",  label: "Appearance"  },
];

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
  ledger = [],
}) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab] = useState("profile");
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
  const [merchantModal, setMerchantModal] = useState(false);

  // ── E-Statement ────────────────────────────────────────────
  const [eStatements,       setEStatements]       = useState([]);
  const [passwordList,      setPasswordList]       = useState([]);
  const [eStmtLoaded,       setEStmtLoaded]        = useState(false);
  const [scanning,          setScanning]           = useState(false);
  const [scanFromDate,      setScanFromDate]       = useState("2026-01-01");
  const [scanToDate,        setScanToDate]         = useState(() => new Date().toISOString().slice(0, 10));
  const [processModal,      setProcessModal]       = useState(null); // statement record
  const [addPwdOpen,        setAddPwdOpen]         = useState(false);
  const [newPwdPattern,     setNewPwdPattern]      = useState("");

  // Always fetches — no guard. Used on mount and after scan.
  const refreshStatements = useCallback(async () => {
    try {
      const [{ data: stmts }, { data: pwds }] = await Promise.all([
        supabase.from("estatement_pdfs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("estatement_password_list").select("*").eq("user_id", user.id).order("sort_order"),
      ]);
      setEStatements(stmts || []);
      setPasswordList(pwds || []);
      setEStmtLoaded(true);
    } catch (e) { showToast(e.message, "error"); }
  }, [user.id]);

  // Lazy-load once when tab is opened (guard is fine here)
  const loadEStatement = useCallback(async () => {
    if (eStmtLoaded) return;
    await refreshStatements();
  }, [eStmtLoaded, refreshStatements]);

  const scanGmail = async () => {
    setScanning(true);
    try {
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "scan", user_id: user.id, from_date: scanFromDate, to_date: scanToDate }) }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Scan failed");
      const newCount = result.new_pdfs || 0;
      showToast(newCount > 0 ? `Found ${newCount} new statement(s)` : "No new statements found");
      await refreshStatements();
    } catch (e) { showToast(e.message, "error"); }
    setScanning(false);
  };

  const addPassword = async () => {
    if (!newPwdPattern.trim()) return showToast("Password required", "error");
    const maxOrder = passwordList.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
    const { data, error } = await supabase.from("estatement_password_list").insert({
      user_id: user.id, label: "", pattern: newPwdPattern.trim(), sort_order: maxOrder + 1,
    }).select().single();
    if (error) return showToast(error.message, "error");
    setPasswordList(prev => [...prev, data]);
    setNewPwdPattern(""); setAddPwdOpen(false);
  };

  const deletePassword = async (id) => {
    await supabase.from("estatement_password_list").delete().eq("id", id);
    setPasswordList(prev => prev.filter(p => p.id !== id));
  };

  // Auto-load e-statement data when this tab is active on mount
  useEffect(() => {
    if (subTab === "estatement") loadEStatement();
  }, [subTab, loadEStatement]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const toUUID = (v) => (!v || v === "") ? null : v;
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

  // ── Actions: Merchants ─────────────────────────────────────
  const saveMerchantCat = async () => {
    if (!editMerchant || !merchantCat) return;
    try {
      const catDef = EXPENSE_CATEGORIES.find(c => c.id === merchantCat);
      await merchantApi.upsert(user.id, editMerchant.merchant_name, merchantCat, catDef?.label || merchantCat);
      setMerchantMaps(prev => prev.map(m =>
        m.merchant_name === editMerchant.merchant_name
          ? { ...m, category_id: merchantCat, category_name: catDef?.label || merchantCat }
          : m
      ));
      showToast("Merchant mapping saved");
      setMerchantModal(false);
    } catch (e) { showToast(e.message, "error"); }
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
            onClick={() => { setSubTab(t.id); if (t.id === "email") loadGmailToken(); if (t.id === "estatement") loadEStatement(); }}
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
      {/* ── E-STATEMENT ──────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "estatement" && (
        <EStatementTab
          T={T} card={card} user={user}
          statements={eStatements} setStatements={setEStatements}
          passwordList={passwordList} setPasswordList={setPasswordList}
          scanning={scanning} onScan={scanGmail}
          scanFromDate={scanFromDate} setScanFromDate={setScanFromDate}
          scanToDate={scanToDate} setScanToDate={setScanToDate}
          addPwdOpen={addPwdOpen} setAddPwdOpen={setAddPwdOpen}
          newPwdPattern={newPwdPattern} setNewPwdPattern={setNewPwdPattern}
          onAddPassword={addPassword} onDeletePassword={deletePassword}
          processModal={processModal} setProcessModal={setProcessModal}
          accounts={accounts} ledger={ledger}
        />
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
      {subTab === "recurring" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button variant="primary" size="sm" onClick={() => openRecurModal()}>+ Add Template</Button>
          </div>

          {recurTemplates.length === 0 ? (
            <EmptyState icon="🔄" message="No recurring templates yet." />
          ) : (
            recurTemplates.map(t => {
              const txDef = TX_TYPES.find(x => x.id === t.tx_type);
              return (
                <div key={t.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>
                        {t.frequency} · {txDef?.label || t.tx_type}
                        {t.day_of_month && ` · day ${t.day_of_month}`}
                        {t.from_id && (() => { const a = accounts.find(x => x.id === t.from_id); return a ? ` · from ${a.name}` : ""; })()}
                        {t.to_id && (() => { const a = accounts.find(x => x.id === t.to_id); return a ? ` · to ${a.name}` : ""; })()}
                        {t.category_id && (() => {
                          const c = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES_LIST].find(c => c.id === t.category_id);
                          return c ? ` · ${c.icon} ${c.label}` : "";
                        })()}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: txDef?.color || T.ac }}>
                        {fmtIDR(Number(t.amount || 0), true)}
                      </div>
                      <div style={{ fontSize: 10, color: T.text3 }}>{t.currency || "IDR"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <Button variant="secondary" size="sm" onClick={() => openRecurModal(t)}>✏️ Edit</Button>
                    <Button variant="danger"    size="sm" onClick={() => deleteRecur(t)}>🗑 Delete</Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── MERCHANTS ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "merchants" && (
        <div style={card}>
          <SectionHeader title="Merchant → Category Mappings" />
          <div style={{ fontSize: 11, color: T.text3, marginTop: 4, marginBottom: 12 }}>
            Learned from AI imports. Edit to override category auto-assignment.
          </div>
          {merchantMaps.length === 0 ? (
            <EmptyState icon="🏪" message="No merchant mappings yet." />
          ) : (
            merchantMaps.map(m => {
              const cat = EXPENSE_CATEGORIES.find(c => c.id === m.category_id);
              return (
                <div key={m.merchant_name} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", background: T.sur2, borderRadius: 10, marginBottom: 6,
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{m.merchant_name}</div>
                    <div style={{ fontSize: 10, color: T.text3 }}>
                      {cat ? `${cat.icon} ${cat.label}` : m.category_name || m.category_id}
                    </div>
                  </div>
                  <Button
                    variant="secondary" size="sm"
                    onClick={() => {
                      setEditMerchant(m);
                      setMerchantCat(m.category_id || "");
                      setMerchantModal(true);
                    }}
                  >
                    Edit
                  </Button>
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
          {/* Type toggle */}
          <div style={{ display: "flex", background: T.sur2, borderRadius: 10, padding: 3, gap: 2 }}>
            {["income", "expense"].map(t => (
              <button
                key={t}
                onClick={() => setRecurForm(f => ({
                  ...f, tx_type: t,
                  frequency: t === "income" ? "Monthly" : "Monthly",
                  from_id: "", to_id: "", category_id: "",
                }))}
                style={{
                  flex: 1, height: 34, border: "none", borderRadius: 8,
                  fontFamily: "Figtree, sans-serif", fontSize: 13, cursor: "pointer",
                  background: recurForm.tx_type === t ? "#fff" : "transparent",
                  color:      recurForm.tx_type === t ? "#111827" : "#9ca3af",
                  fontWeight: recurForm.tx_type === t ? 700 : 500,
                  boxShadow:  recurForm.tx_type === t ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                  transition: "all 0.15s",
                }}
              >
                {t === "income" ? "💰 Income" : "↑ Expense"}
              </button>
            ))}
          </div>

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

          {/* INCOME-specific: To Account + Category */}
          {recurForm.tx_type === "income" && (
            <>
              <Field label="To Account (bank)">
                <Select
                  value={recurForm.to_id}
                  onChange={e => setRecurForm(f => ({ ...f, to_id: e.target.value }))}
                  options={bankAccounts.map(a => ({ value: a.id, label: a.name }))}
                  placeholder="Select bank account…"
                />
              </Field>
              <Field label="Category">
                <Select
                  value={recurForm.category_id}
                  onChange={e => setRecurForm(f => ({ ...f, category_id: e.target.value }))}
                  options={INCOME_CATEGORIES_LIST.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))}
                  placeholder="None"
                />
              </Field>
            </>
          )}

          {/* EXPENSE-specific: From Account (bank/CC toggle) + Category */}
          {recurForm.tx_type === "expense" && (
            <>
              <Field label="From Account">
                {/* Bank/CC toggle */}
                <div>
                  <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                    {[
                      { key: "bank", label: "🏦 Bank" },
                      { key: "cc",   label: "💳 Credit Card" },
                    ].map(({ key, label }) => {
                      return (
                        <button
                          key={key}
                          onClick={() => setRecurForm(f => ({ ...f, from_id: "" }))}
                          style={{
                            padding: "5px 12px", borderRadius: 8, border: "none",
                            cursor: "pointer", fontSize: 12, fontWeight: 600,
                            fontFamily: "Figtree, sans-serif",
                            background: "#f3f4f6", color: "#6b7280",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <Select
                    value={recurForm.from_id}
                    onChange={e => setRecurForm(f => ({ ...f, from_id: e.target.value }))}
                    options={[...bankAccounts, ...creditCards].map(a => ({ value: a.id, label: a.name }))}
                    placeholder="Select account…"
                  />
                </div>
              </Field>
              <Field label="Category">
                <Select
                  value={recurForm.category_id}
                  onChange={e => setRecurForm(f => ({ ...f, category_id: e.target.value }))}
                  options={EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))}
                  placeholder="None"
                />
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
        isOpen={merchantModal && !!editMerchant}
        onClose={() => { setMerchantModal(false); setEditMerchant(null); }}
        title="Edit Merchant Mapping"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => { setMerchantModal(false); setEditMerchant(null); }}>Cancel</Button>
            <Button variant="primary" size="md" disabled={!merchantCat} onClick={saveMerchantCat}>Save</Button>
          </div>
        }
      >
        {editMerchant && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{editMerchant.merchant_name}</div>
            <Field label="Category">
              <Select
                value={merchantCat}
                onChange={e => setMerchantCat(e.target.value)}
                options={EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))}
                placeholder="Select category…"
              />
            </Field>
          </div>
        )}
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
                  {fmtIDR(Number(a.current_balance || 0), true)}
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
                    {fmtIDR(Number(a.current_balance || 0), true)}
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

// ─── E-STATEMENT TAB ─────────────────────────────────────────
function EStatementTab({
  T, card, user, statements, setStatements,
  passwordList, setPasswordList,
  scanning, onScan,
  scanFromDate, setScanFromDate, scanToDate, setScanToDate,
  addPwdOpen, setAddPwdOpen,
  newPwdPattern, setNewPwdPattern,
  onAddPassword, onDeletePassword,
  processModal, setProcessModal,
  accounts, ledger,
}) {
  const [showList,    setShowList]    = useState(false);
  const [revealed,    setRevealed]    = useState({}); // id → true
  const [showSkipped, setShowSkipped] = useState(false);

  const skipStatement = async (id) => {
    await supabase.from("estatement_pdfs").update({ status: "skipped" }).eq("id", id);
    setStatements(prev => prev.map(s => s.id === id ? { ...s, status: "skipped" } : s));
  };

  const restoreStatement = async (id) => {
    await supabase.from("estatement_pdfs").update({ status: "pending" }).eq("id", id);
    setStatements(prev => prev.map(s => s.id === id ? { ...s, status: "pending" } : s));
  };

  const activeStatements  = statements.filter(s => s.status !== "skipped");
  const skippedStatements = statements.filter(s => s.status === "skipped");

  const statusBadge = (status) => {
    const map = {
      pending:         { bg: "#e0f2fe", color: "#0369a1", label: "Pending" },
      processing:      { bg: "#fef9c3", color: "#92400e", label: "Processing…" },
      parsed:          { bg: "#e0f7fa", color: "#0891b2", label: "Parsed" },
      password_needed: { bg: "#fff7ed", color: "#c2410c", label: "Password Needed" },
      done:            { bg: "#dcfce7", color: "#15803d", label: "Done" },
    };
    const s = map[status] || { bg: "#f3f4f6", color: "#6b7280", label: status };
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
        background: s.bg, color: s.color, fontFamily: "Figtree, sans-serif",
      }}>
        {s.label}
      </span>
    );
  };

  const VARIABLE_LEGEND = [
    { var: "{DDMMYYYY}", desc: "Birth date e.g. 01011990" },
    { var: "{account_no}", desc: "Account number" },
    { var: "{last4}", desc: "Last 4 digits of card" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Password Priority List ── */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <SectionHeader title="PDF Passwords" />
          {passwordList.length > 0 && (
            <span style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif" }}>
              {passwordList.length} configured
            </span>
          )}
        </div>

        {/* Masked list — only when showList */}
        {showList && passwordList.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
            {passwordList.map((p, idx) => (
              <div key={p.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 10px", background: T.sur2, borderRadius: 8,
              }}>
                <span style={{ fontSize: 11, color: T.text3, fontWeight: 700, minWidth: 18, flexShrink: 0 }}>
                  {idx + 1}.
                </span>
                <span style={{
                  flex: 1, fontSize: 13, letterSpacing: revealed[p.id] ? "normal" : "0.12em",
                  color: T.text, fontFamily: revealed[p.id] ? "Figtree, monospace" : "monospace",
                }}>
                  {revealed[p.id] ? p.pattern : "••••••••"}
                </span>
                <button
                  onClick={() => setRevealed(r => ({ ...r, [p.id]: !r[p.id] }))}
                  title={revealed[p.id] ? "Hide" : "Reveal"}
                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, padding: "2px 4px", color: T.text3 }}
                >
                  {revealed[p.id] ? "🙈" : "👁"}
                </button>
                <button
                  onClick={() => onDeletePassword(p.id)}
                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: 13, color: "#dc2626", padding: "2px 4px" }}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {showList && passwordList.length === 0 && !addPwdOpen && (
          <div style={{ fontSize: 12, color: T.text3, marginBottom: 10, fontFamily: "Figtree, sans-serif" }}>
            No passwords yet.
          </div>
        )}

        {/* Add password inline form */}
        {addPwdOpen && (
          <div style={{ marginBottom: 10, padding: "10px 12px", background: T.sur2, borderRadius: 10 }}>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 6, fontFamily: "Figtree, sans-serif" }}>
              Password or pattern:
            </div>
            <input
              type="password"
              autoFocus
              value={newPwdPattern}
              onChange={e => setNewPwdPattern(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") onAddPassword(); if (e.key === "Escape") { setAddPwdOpen(false); setNewPwdPattern(""); } }}
              placeholder="e.g. {DDMMYYYY} or MyPassword123"
              style={{
                width: "100%", boxSizing: "border-box", height: 38,
                padding: "0 12px", border: "1.5px solid #3b5bdb", borderRadius: 8,
                fontFamily: "Figtree, sans-serif", fontSize: 13,
                background: "#fff", color: "#111827", outline: "none", marginBottom: 8,
              }}
            />
            <div style={{ fontSize: 10, color: T.text3, marginBottom: 8, fontFamily: "Figtree, sans-serif" }}>
              Variables: {VARIABLE_LEGEND.map(v => (
                <code key={v.var} style={{ fontSize: 10, color: "#0891b2", background: "#e0f7fa", padding: "0 4px", borderRadius: 3, marginRight: 6 }}>
                  {v.var}
                </code>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="primary" size="sm" onClick={onAddPassword}>Save</Button>
              <Button variant="secondary" size="sm" onClick={() => { setAddPwdOpen(false); setNewPwdPattern(""); }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Buttons row */}
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={() => setAddPwdOpen(o => !o)}>
            {addPwdOpen ? "Cancel" : "+ Add Password"}
          </Button>
          {passwordList.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => { setShowList(o => !o); setRevealed({}); }}>
              {showList ? "Hide" : "Show All"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Pending Statements ── */}
      <div style={card}>
        <SectionHeader title="📄 Pending Statements" />
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif" }}>From</div>
            <input
              type="date"
              value={scanFromDate}
              onChange={e => setScanFromDate(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box", height: 36,
                padding: "0 10px", border: `1.5px solid ${T.border}`, borderRadius: 8,
                fontFamily: "Figtree, sans-serif", fontSize: 13, color: T.text,
                background: T.surface, outline: "none",
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text3, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.4px", fontFamily: "Figtree, sans-serif" }}>To</div>
            <input
              type="date"
              value={scanToDate}
              onChange={e => setScanToDate(e.target.value)}
              style={{
                width: "100%", boxSizing: "border-box", height: 36,
                padding: "0 10px", border: `1.5px solid ${T.border}`, borderRadius: 8,
                fontFamily: "Figtree, sans-serif", fontSize: 13, color: T.text,
                background: T.surface, outline: "none",
              }}
            />
          </div>
          <Button variant="primary" size="sm" busy={scanning} onClick={onScan}>
            🔍 Scan Gmail
          </Button>
        </div>

        {activeStatements.length === 0 ? (
          <EmptyState icon="📄" message='No statements found. Click "Scan Gmail" to search.' />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activeStatements.map(s => (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", background: T.sur2, borderRadius: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.filename}
                  </div>
                  <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                    {s.bank_name}{s.statement_month ? ` · ${s.statement_month}` : ""}
                  </div>
                </div>
                {statusBadge(s.status)}
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  {s.status === "done" ? (
                    <span style={{ fontSize: 11, color: "#059669", fontWeight: 600, fontFamily: "Figtree, sans-serif" }}>
                      ✓ {s.transaction_count || 0} txns
                    </span>
                  ) : s.status === "processing" ? (
                    <span style={{ fontSize: 11, color: "#92400e", fontFamily: "Figtree, sans-serif" }}>…</span>
                  ) : (
                    <Button
                      variant={s.status === "password_needed" ? "secondary" : "primary"}
                      size="sm"
                      onClick={() => setProcessModal(s)}
                    >
                      {s.status === "password_needed" ? "🔑 Enter Password" : "▶ Process"}
                    </Button>
                  )}
                  {s.status !== "done" && (
                    <button
                      onClick={() => skipStatement(s.id)}
                      title="Skip this statement"
                      style={{
                        border: "none", background: "none", cursor: "pointer",
                        fontSize: 14, color: "#d1d5db", lineHeight: 1, padding: "2px 2px",
                        flexShrink: 0,
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                      onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Skipped statements ── */}
        {skippedStatements.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              onClick={() => setShowSkipped(v => !v)}
              style={{
                border: "none", background: "none", cursor: "pointer",
                fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif",
                padding: 0, display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <span style={{ display: "inline-block", transform: showSkipped ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>›</span>
              {showSkipped ? "Hide" : "Show"} {skippedStatements.length} skipped
            </button>
            {showSkipped && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                {skippedStatements.map(s => (
                  <div key={s.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 12px", background: T.sur2, borderRadius: 10, opacity: 0.5,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.filename}
                      </div>
                      <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
                        {s.bank_name}{s.statement_month ? ` · ${s.statement_month}` : ""}
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => restoreStatement(s.id)}>
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Process Modal ── */}
      {processModal && (
        <ProcessStatementModal
          statement={processModal}
          passwordList={passwordList}
          user={user}
          accounts={accounts}
          ledger={ledger}
          T={T}
          onClose={() => setProcessModal(null)}
          onDone={(id, txCount) => {
            setStatements(prev => prev.map(s => s.id === id ? { ...s, status: "done", transaction_count: txCount } : s));
            setProcessModal(null);
          }}
        />
      )}
    </div>
  );
}

// ─── PROCESS STATEMENT MODAL ─────────────────────────────────
function ProcessStatementModal({ statement, passwordList, user, accounts, ledger, T, onClose, onDone }) {
  const [phase, setPhase]         = useState("loading"); // loading | needs_password | preview | saving
  const [statusMsg, setStatusMsg] = useState("Downloading PDF...");
  const [missing, setMissing]     = useState([]);
  const [skipped, setSkipped]     = useState({});
  const [manualPwd, setManualPwd] = useState("");
  const [error, setError]         = useState("");

  // Assign tx_category + extract installment metadata (AI field with fallback patterns)
  const categorize = (t) => {
    let cat = t.tx_category;
    if (!cat) {
      const d = (t.description || "").toLowerCase();
      if (/payment|pembayaran|bayar\s+tagihan|pelunasan|pay\s+bill|tagihan\s+kartu/i.test(d)) cat = "payment";
      else if (/cicilan|angsuran|installment|cicil/i.test(d)) cat = "installment";
      else if (/biaya\s+admin|admin[\s-]fee|late[\s-]charge|bunga|interest|annual[\s-]fee|denda|iuran|service[\s-]charge|provisi/i.test(d)) cat = "fee";
      else cat = "regular";
    }
    let inst_no    = t.installment_no    ?? null;
    let inst_total = t.installment_total ?? null;
    if (cat === "installment" && !inst_no) {
      const m = (t.description || "").match(
        /(?:cicilan|angsuran|installment)\s+(?:ke[\s-]*)?(\d+)(?:[\/\s](?:dari\s+)?(\d+))?/i
      );
      if (m) { inst_no = parseInt(m[1]); inst_total = m[2] ? parseInt(m[2]) : null; }
    }
    return { ...t, tx_category: cat, installment_no: inst_no, installment_total: inst_total };
  };

  // Duplicate = amount exact + date ±1 day
  const isDuplicate = (tx) => {
    const amt = Number(tx.amount || 0);
    return ledger.some(e => {
      if (Math.abs(Number(e.amount_idr || e.amount || 0) - amt) > 1) return false;
      if (!e.tx_date || !tx.date) return false;
      return Math.abs(new Date(e.tx_date) - new Date(tx.date)) / 86400000 <= 1;
    });
  };

  // Installment series: check if any ledger entry shares the same base description
  const hasInstallmentParent = (tx) => {
    const base = (tx.description || "")
      .replace(/(?:cicilan|angsuran|installment)\s+(?:ke[\s-]*)?\d+(?:[\/\s]\d+)?/gi, "")
      .replace(/\s+/g, " ").trim().toLowerCase();
    if (base.length < 4) return false;
    return ledger.some(e =>
      (e.description || "").toLowerCase().includes(base.slice(0, Math.min(base.length, 20)))
    );
  };

  // Auto-start as soon as modal opens
  useEffect(() => { callProcess(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // onlyPassword: if set, only test this single password (manual Try — skips saved list)
  const callProcess = async ({ onlyPassword = null } = {}) => {
    setPhase("loading");
    setStatusMsg("Processing e-statement...");
    setError("");

    const fnUrl = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;
    console.log("[estatement] callProcess for statement:", statement?.id, "user:", user?.id);

    try {
      const reqBody = { action: "process", statement_id: statement.id, user_id: user.id };
      if (onlyPassword !== null) reqBody.only_password = onlyPassword;

      console.log("[estatement] fetching:", fnUrl, "body:", JSON.stringify(reqBody));

      const res = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      console.log("[estatement] response status:", res.status);
      const result = await res.json();
      console.log("[estatement] response body:", result);

      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);

      if (!result.success) {
        if (result.needs_password && result.encrypted) {
          setPhase("needs_password");
          setError(onlyPassword
            ? "Wrong password — try a different one."
            : "PDF is password-protected. Enter the password below.");
        } else {
          setPhase("needs_password");
          setError(result.error || "Could not extract transactions. PDF may be a scanned image or unsupported format.");
        }
        return;
      }

      const categorized = (result.transactions || []).map((t, i) => categorize({ ...t, _id: i }));
      setMissing(categorized.filter(tx => tx.tx_category !== "payment" && !isDuplicate(tx)));
      setSkipped({});
      setPhase("preview");
    } catch (e) {
      console.error("[estatement] callProcess error:", e);
      setPhase("needs_password");
      setError(e.message);
    }
  };

  const saveAll = async () => {
    setPhase("saving");
    const toSave = missing.filter(t => !skipped[t._id]);
    let count = 0;
    for (const tx of toSave) {
      const acct = accounts.find(a => a.type === "bank" && (a.bank_name === statement.bank_name || accounts.length === 1));
      const isDebit = (tx.type || "debit").toLowerCase() === "debit";
      try {
        await supabase.from("ledger").insert({
          user_id:        user.id,
          tx_date:        tx.date,
          description:    tx.description || "E-Statement import",
          amount:         Number(tx.amount || 0),
          amount_idr:     Number(tx.amount || 0),
          currency:       tx.currency || "IDR",
          tx_type:        isDebit ? "expense" : "income",
          from_type:      isDebit ? "account" : null,
          to_type:        isDebit ? null : "account",
          from_id:        isDebit ? (acct?.id || null) : null,
          to_id:          isDebit ? null : (acct?.id || null),
          category_id:    null,
          category_name:  null,
          entity:         "Personal",
          is_reimburse:   false,
          ai_categorized: false,
          ai_confidence:  null,
          notes: tx.tx_category === "installment" && tx.installment_no
            ? `Cicilan ${tx.installment_no}${tx.installment_total ? `/${tx.installment_total}` : ""}`
            : null,
        });
        count++;
      } catch { /* skip on error */ }
    }
    await fetch(`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_done", statement_id: statement.id, user_id: user.id, tx_count: count }),
    });
    onDone(statement.id, count);
  };

  // Group missing transactions by category
  const groups = [
    { key: "fee",         label: "FEES & CHARGES", items: missing.filter(t => t.tx_category === "fee") },
    { key: "installment", label: "INSTALLMENTS",   items: missing.filter(t => t.tx_category === "installment") },
    { key: "regular",     label: "TRANSACTIONS",   items: missing.filter(t => t.tx_category === "regular" || t.tx_category === "transfer") },
  ].filter(g => g.items.length > 0);

  const importCount = missing.filter(t => !skipped[t._id]).length;

  const OVL = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 9999, padding: 16,
  };
  const BOX = {
    background: "#fff", borderRadius: 16, width: "100%", maxWidth: 540,
    maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden",
  };

  return (
    <div style={OVL} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={BOX}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
              Process E-Statement
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
              {statement.bank_name} · {statement.filename}
            </div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 18, cursor: "pointer", color: "#9ca3af" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>

          {phase === "needs_password" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ padding: "10px 12px", background: "#fff5f5", border: "1px solid #fecaca", borderRadius: 9, fontSize: 12, color: "#dc2626", fontFamily: "Figtree, sans-serif" }}>
                {error}
              </div>
              {error.includes("password") && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
                    Enter the PDF password manually:
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      autoFocus
                      type="password"
                      value={manualPwd}
                      onChange={e => setManualPwd(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && manualPwd.trim() && callProcess({ onlyPassword: manualPwd })}
                      placeholder="PDF password…"
                      style={{ flex: 1, height: 38, padding: "0 12px", border: "1.5px solid #3b5bdb", borderRadius: 8, fontFamily: "Figtree, sans-serif", fontSize: 13, outline: "none" }}
                    />
                    <Button
                      variant="primary" size="sm"
                      onClick={() => manualPwd.trim() && callProcess({ onlyPassword: manualPwd })}
                    >
                      Try
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {phase === "loading" && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>⏳</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{statusMsg}</div>
              <div style={{ fontSize: 11, marginTop: 6, color: "#9ca3af" }}>
                This may take 20–40 seconds
              </div>
            </div>
          )}

          {phase === "preview" && (
            groups.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
                  All transactions already recorded
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4, fontFamily: "Figtree, sans-serif" }}>
                  Nothing to import.
                </div>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.key}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.6px",
                    textTransform: "uppercase", marginBottom: 6, fontFamily: "Figtree, sans-serif",
                  }}>
                    {group.label} · {group.items.filter(t => !skipped[t._id]).length} missing
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
                    {group.items.map(tx => {
                      const skip = !!skipped[tx._id];
                      const isNewInstallment = tx.tx_category === "installment" && !hasInstallmentParent(tx);
                      const isDebit = (tx.type || "debit").toLowerCase() === "debit";
                      return (
                        <div key={tx._id} style={{
                          padding: "9px 11px", borderRadius: 9,
                          background: skip ? "#f9fafb" : "#f0fdf4",
                          border: `1px solid ${skip ? "#e5e7eb" : "#bbf7d0"}`,
                          opacity: skip ? 0.5 : 1,
                        }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif",
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {isNewInstallment && (
                                  <span style={{
                                    fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                                    background: "#fef9c3", color: "#92400e", marginRight: 5,
                                  }}>NEW</span>
                                )}
                                {tx.description || "—"}
                              </div>
                              <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 1, fontFamily: "Figtree, sans-serif" }}>
                                {tx.date}
                                {tx.installment_no
                                  ? ` · Cicilan ${tx.installment_no}${tx.installment_total ? `/${tx.installment_total}` : ""}`
                                  : ""}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                                color: isDebit ? "#dc2626" : "#059669" }}>
                                {isDebit ? "−" : "+"}Rp {Number(tx.amount || 0).toLocaleString("id-ID")}
                              </div>
                            </div>
                            <button
                              onClick={() => setSkipped(p => ({ ...p, [tx._id]: !p[tx._id] }))}
                              style={{
                                border: "1px solid #e5e7eb", borderRadius: 6, padding: "3px 8px",
                                fontSize: 10, fontWeight: 600, cursor: "pointer", flexShrink: 0,
                                background: skip ? "#f3f4f6" : "#fff",
                                color: skip ? "#059669" : "#6b7280",
                                fontFamily: "Figtree, sans-serif",
                              }}
                            >
                              {skip ? "Include" : "Skip"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )
          )}

          {phase === "saving" && (
            <div style={{ textAlign: "center", padding: 32, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>💾</div>
              <div style={{ fontSize: 13 }}>Saving transactions…</div>
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === "needs_password" && (
          <div style={{ padding: "12px 20px", borderTop: "1px solid #f3f4f6" }}>
            <Button fullWidth variant="secondary" onClick={onClose}>Close</Button>
          </div>
        )}
        {phase === "preview" && (
          <div style={{ padding: "12px 20px", borderTop: "1px solid #f3f4f6", display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={onClose} style={{ flexShrink: 0 }}>Cancel</Button>
            {groups.length > 0 && (
              <Button fullWidth variant="primary" onClick={saveAll}>
                Import {importCount} Transaction{importCount !== 1 ? "s" : ""}
              </Button>
            )}
            {groups.length === 0 && (
              <Button fullWidth variant="secondary" onClick={onClose}>Close</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
