import { useState, useCallback, useEffect } from "react";
import { supabase } from "../lib/supabase";
import PILogo from "./PILogo";
import { fxApi, merchantApi, settingsApi, recurringApi, gmailApi, accountsApi, installmentsApi, ledgerApi, getTxFromToTypes } from "../api";
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
  categories = [], incomeSrcs = [],
  ledger = [], installments = [],
  setInstallments,
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
  const [merchantModal, setMerchantModal] = useState(false);

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
      {/* ── E-STATEMENT ──────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "estatement" && (
        <EStatementTab
          T={T} card={card} user={user}
          accounts={accounts} ledger={ledger}
          installments={installments} setInstallments={setInstallments}
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
                  { label: "Monthly Income",  value: fmtIDR(totalIncome, true),  color: "#059669" },
                  { label: "Monthly Expense", value: fmtIDR(totalExpense, true), color: "#dc2626" },
                  { label: "Net Monthly",     value: fmtIDR(net, true),          color: net >= 0 ? "#059669" : "#dc2626" },
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
                    <div key={t.id} style={{ background: "#ffffff", border: "0.5px solid #e5e7eb", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                      {/* Color bar */}
                      <div style={{ height: 3, background: accentColor }} />

                      <div style={{ padding: "14px 14px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                        {/* Type badge */}
                        <span style={{ display: "inline-block", alignSelf: "flex-start", background: accentBg, color: accentColor, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, fontFamily: "Figtree, sans-serif" }}>
                          {income ? "INCOME" : "EXPENSE"}
                        </span>

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
                            {fmtIDR(Number(t.amount || 0), true)}
                          </div>
                          <div style={{ fontSize: 10, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>{t.currency || "IDR"}</div>
                        </div>
                      </div>

                      {/* Bottom action bar */}
                      <div style={{ borderTop: "0.5px solid #f3f4f6", padding: "8px 14px", display: "flex", gap: 6 }}>
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
              <Field label="Income Source">
                <Select
                  value={recurForm.category_id}
                  onChange={e => setRecurForm(f => ({ ...f, category_id: e.target.value }))}
                  options={incomeSrcs.map(s => ({ value: s.id, label: s.name }))}
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
                  options={categories.map(c => ({ value: c.id, label: c.label || c.name || c.id }))}
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

// ── Constants shared by E-Statement preview ───────────────────
const ESTMT_TX_TYPES = [
  { value: "expense",        label: "Expense",        color: "#dc2626" },
  { value: "income",         label: "Income",         color: "#059669" },
  { value: "transfer",       label: "Transfer",       color: "#3b5bdb" },
  { value: "pay_cc",         label: "Pay CC",         color: "#7c3aed" },
  { value: "buy_asset",      label: "Buy Asset",      color: "#0891b2" },
  { value: "sell_asset",     label: "Sell Asset",     color: "#059669" },
  { value: "reimburse_out",  label: "Reimburse Out",  color: "#d97706" },
  { value: "reimburse_in",   label: "Reimburse In",   color: "#059669" },
  { value: "give_loan",      label: "Give Loan",      color: "#d97706" },
  { value: "collect_loan",   label: "Collect Loan",   color: "#059669" },
  { value: "pay_liability",  label: "Pay Liability",  color: "#d97706" },
  { value: "fx_exchange",    label: "FX Exchange",    color: "#0891b2" },
  { value: "cc_installment", label: "CC Installment", color: "#3b5bdb" },
];
const ESTMT_NO_CAT = new Set([
  "transfer","pay_cc","give_loan","collect_loan","fx_exchange",
  "reimburse_out","reimburse_in","buy_asset","sell_asset","pay_liability","cc_installment",
]);
const ESTMT_INCOME_TYPES  = new Set(["income","collect_loan","sell_asset","reimburse_in"]);
const ESTMT_NEUTRAL_TYPES = new Set(["transfer","fx_exchange"]);
const ESTMT_AMT_COLOR = {
  expense: "#dc2626", income: "#059669", cc_installment: "#3b5bdb",
  transfer: "#3b5bdb", pay_cc: "#7c3aed",
  buy_asset: "#0891b2", sell_asset: "#059669",
  reimburse_out: "#d97706", reimburse_in: "#059669",
  give_loan: "#d97706", collect_loan: "#059669",
  pay_liability: "#d97706", fx_exchange: "#0891b2",
};
const ESTMT_REIMBURSE_TYPES = new Set(["reimburse_in","reimburse_out"]);
const ESTMT_CAT_FOR_TYPE = (t) =>
  ESTMT_INCOME_TYPES.has(t) ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES;

const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return d || ""; }
};
const estmtInSel = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 4px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", cursor: "pointer",
  boxSizing: "border-box", ...extra,
});
const estmtACT = (extra = {}) => ({
  width: 26, height: 26, borderRadius: 6, border: "1px solid #e5e7eb",
  background: "#f9fafb", cursor: "pointer", fontSize: 12, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif", padding: 0, flexShrink: 0, ...extra,
});

// ─── E-STATEMENT TAB ─────────────────────────────────────────
function EStatementTab({
  T, card, user,
  accounts, ledger, installments = [], setInstallments,
}) {
  const [queue,       setQueue]       = useState([]);
  const [history,     setHistory]     = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [dragging,    setDragging]    = useState(false);
  const [dbLoading,   setDbLoading]   = useState(true);

  // ── Load persisted queue + history from DB on mount ───────
  useEffect(() => {
    (async () => {
      setDbLoading(true);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const [{ data: pending }, { data: done }] = await Promise.all([
        supabase.from("estatement_pdfs").select("*")
          .eq("user_id", user.id).in("status", ["queued", "failed"])
          .order("created_at", { ascending: false }),
        supabase.from("estatement_pdfs").select("*")
          .eq("user_id", user.id).eq("status", "done")
          .gte("processed_at", thirtyDaysAgo)
          .order("processed_at", { ascending: false }),
      ]);
      if (pending) {
        setQueue(pending.map(r => ({
          id:         r.id,
          file:       null,
          file_path:  r.file_path || null,
          name:       r.filename,
          size:       r.file_size || 0,
          account_id: r.account_id || "",
          status:     r.status,
          rows:       null,
          selected:   {},
          notesOpen:  new Set(),
          skipped:    new Set(),
          error:      null,
          savedCount: null,
        })));
      }
      if (done) setHistory(done);
      setDbLoading(false);
    })();
  }, [user.id]);

  // ── Set account for a queue item (persisted to DB) ─────────
  const setItemAccount = (itemId, accountId) => {
    setQueue(prev => prev.map(i => i.id === itemId ? { ...i, account_id: accountId } : i));
    supabase.from("estatement_pdfs").update({ account_id: accountId || null }).eq("id", itemId).catch(() => {});
  };

  const readFileAsBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const readBlobAsBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const fmtSize = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  };

  // ── Upload PDFs → Storage + DB ─────────────────────────────
  const addFiles = async (files) => {
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) { showToast("Please select PDF files only", "error"); return; }

    for (const f of pdfs) {
      const id       = crypto.randomUUID();
      const filePath = `${user.id}/${id}.pdf`;

      // Optimistically add to queue
      setQueue(prev => [...prev, {
        id, file: f, file_path: filePath,
        name: f.name, size: f.size, status: "queued",
        account_id: "",
        rows: null, selected: {}, notesOpen: new Set(), skipped: new Set(),
        error: null, savedCount: null, _uploading: true,
      }]);

      try {
        const { error: upErr } = await supabase.storage
          .from("estatement-pdfs")
          .upload(filePath, f, { contentType: "application/pdf" });
        if (upErr) throw upErr;

        const { error: dbErr } = await supabase.from("estatement_pdfs").insert({
          id, user_id: user.id,
          filename:          f.name,
          file_size:         f.size,
          file_path:         filePath,
          status:            "queued",
          gmail_message_id:  null,
          bank_name:         "Upload",
          created_at:        new Date().toISOString(),
        });
        if (dbErr) throw dbErr;

        setQueue(prev => prev.map(i => i.id === id ? { ...i, _uploading: false } : i));
      } catch (e) {
        showToast(`Failed to upload ${f.name}: ${e.message}`, "error");
        setQueue(prev => prev.filter(i => i.id !== id));
      }
    }
  };

  // ── Categorize AI output → internal shape ─────────────────
  // statementAccountId: the user-selected account for this statement — overrides
  // any AI-guessed account. Debit txs use it as from_id; credit txs as to_id.
  const buildRows = (transactions, statementAccountId = "") => {
    return transactions.map((t, idx) => {
      // direction
      const isDebit = t.direction ? t.direction === "out"
                                  : (t.type || "debit").toLowerCase() !== "credit";
      // tx_category
      let cat = t.tx_category;
      if (!cat) {
        const d = (t.description || "").toLowerCase();
        if (t.is_installment) cat = "installment";
        else if (t.is_fee) cat = "fee";
        else if (t.is_transfer) cat = "transfer";
        else if (/payment|pembayaran|bayar\s+tagihan|pelunasan/i.test(d)) cat = "payment";
        else if (/cicilan|angsuran|installment|cicil/i.test(d)) cat = "installment";
        else if (/biaya\s*adm|admin[\s-]fee|bunga|interest|annual[\s-]fee|denda|iuran|service[\s-]charge|materai|provisi/i.test(d)) cat = "fee";
        else cat = "regular";
      }
      if (cat === "payment") return null; // skip payments
      if (cat === "transfer" && !isDebit) return null; // skip transfers-in

      // tx_type
      let txType = isDebit ? "expense" : "income";
      if (cat === "installment") txType = "cc_installment";
      if (cat === "transfer" && isDebit) txType = "transfer";

      // installment metadata — AI returns installment_current / installment_total
      let inst_no    = t.installment_current ?? t.installment_no ?? null;
      let inst_total = t.installment_total ?? null;
      // Fallback: parse from description if AI missed it
      if (cat === "installment" && (!inst_no || !inst_total)) {
        // Match "7/12", "7 / 12", "ke-7 dari 12", "KE 7 DARI 12"
        const m = (t.description || "").match(
          /(?:ke[\s-]*)?(\d+)\s*[\/\s]+(?:dari\s+)?(\d+)/i
        ) || (t.description || "").match(
          /(?:cicilan|angsuran|installment)[^\d]*(\d+)(?:[^\d]+(\d+))?/i
        );
        if (m) {
          if (!inst_no)    inst_no    = parseInt(m[1]);
          if (!inst_total) inst_total = m[2] ? parseInt(m[2]) : null;
        }
      }
      inst_no    = inst_no    ? Number(inst_no)    : null;
      inst_total = inst_total ? Number(inst_total) : null;

      // category_id
      let catId = null;
      if (!ESTMT_NO_CAT.has(txType)) {
        if (cat === "fee" || t.is_fee) {
          const ft = (t.fee_type || "").toLowerCase();
          catId = ft.includes("stamp_duty") || ft.includes("materai") ? "materai"
                : ft.includes("admin")   ? "bank_charges"
                : ft.includes("annual")  ? "bank_charges"
                : ft.includes("interest")|| ft.includes("bunga") ? "bank_charges"
                : ft.includes("penalty") || ft.includes("denda") ? "bank_charges"
                : "bank_charges";
        } else {
          catId = "other";
        }
      }

      // Account assignment — use the user-selected statement account when available,
      // otherwise fall back to AI card_last4 matching.
      const last4 = t.card_last4 || null;
      const ccAccounts   = accounts.filter(a => a.type === "credit_card");
      const bankAccounts = accounts.filter(a => a.type === "bank");
      let fromId, toId;
      if (statementAccountId) {
        // Override: debit → from selected account; credit → to selected account
        fromId = isDebit ? statementAccountId : "";
        toId   = !isDebit ? statementAccountId : "";
      } else {
        // Fallback: try card_last4 matching then first CC/bank
        const matchedAcc = last4
          ? accounts.find(a => a.last4 === last4 || a.card_last4 === last4)
          : null;
        const defaultCC   = matchedAcc || ccAccounts[0] || null;
        const defaultBank = bankAccounts[0] || null;
        fromId = isDebit ? (defaultCC?.id || defaultBank?.id || "") : "";
        toId   = !isDebit ? (defaultBank?.id || "") : "";
      }

      // duplicate check — three levels
      const amt = Number(t.amount || 0);
      const descSim = (a, b) => {
        const wordsA = new Set((a || "").toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const wordsB = new Set((b || "").toLowerCase().split(/\s+/).filter(w => w.length > 2));
        if (!wordsA.size || !wordsB.size) return 0;
        let common = 0;
        wordsA.forEach(w => { if (wordsB.has(w)) common++; });
        return common / Math.max(wordsA.size, wordsB.size);
      };

      let dupStatus = "new";
      let dupEntry  = null;
      for (const e of ledger) {
        if (Math.abs(Number(e.amount_idr || e.amount || 0) - amt) > 1) continue;
        if (!e.tx_date || !t.date) continue;
        const dayDiff = Math.abs(new Date(e.tx_date) - new Date(t.date)) / 86400000;
        const sim = descSim(e.description || e.merchant_name, t.merchant || t.description);
        if (dayDiff === 0 && sim >= 0.7) { dupStatus = "duplicate"; dupEntry = e; break; }
        if (dayDiff <= 1 && sim >= 0.7) { dupStatus = "possible_duplicate"; dupEntry = e; break; }
        if (dayDiff <= 1 && dupStatus === "new") { dupStatus = "review"; dupEntry = e; }
      }

      // installment cross-check
      const isInstallment = cat === "installment";
      let instMatch = null;
      if (isInstallment && installments.length > 0) {
        const descBase = (t.merchant || t.description || "").toLowerCase()
          .replace(/cicilan.*|installment.*/gi, "").replace(/\s+/g, " ").trim();
        instMatch = descBase.length > 3
          ? installments.find(i =>
              (i.description || "").toLowerCase().includes(descBase.slice(0, Math.min(descBase.length, 20)))
            )
          : null;
      }

      // Auto-detect reimburse: "SETORAN TUNAI" deposits to BCA 0830267743
      const isBCAReimburse = accounts.find(a => a.account_no && String(a.account_no).replace(/\s/g, "") === "0830267743");
      const autoReimburse = /SETORAN\s+TUNAI/i.test(t.merchant || t.description || "")
        && isBCAReimburse
        && (fromId === isBCAReimburse.id || toId === isBCAReimburse.id);

      return {
        _id:              idx,
        tx_date:          t.date,
        description:      t.merchant || t.description || "",
        amount:           String(amt),
        amount_idr:       String(amt),
        currency:         "IDR",
        tx_type:          autoReimburse ? "reimburse_in" : txType,
        from_id:          fromId,
        to_id:            toId,
        category_id:      catId,
        notes:            "",
        is_reimburse:     autoReimburse,
        reimburse_entity: "",
        status:           dupStatus,
        _dupEntry:        dupEntry,
        _isInstallment:   isInstallment,
        _instMatch:       instMatch,
        _instNo:          inst_no,
        _instTotal:       inst_total,
        _card_last4:      last4,
      };
    }).filter(Boolean);
  };

  // ── Process a queued file ──────────────────────────────────
  const processFile = async (itemId) => {
    const item = queue.find(i => i.id === itemId);
    if (!item) return;
    setQueue(prev => prev.map(i => i.id === itemId
      ? { ...i, status: "processing", error: null, rows: null } : i
    ));
    try {
      let base64;
      if (item.file) {
        base64 = await readFileAsBase64(item.file);
      } else if (item.file_path) {
        const { data: blob, error: dlErr } = await supabase.storage
          .from("estatement-pdfs").download(item.file_path);
        if (dlErr) throw dlErr;
        base64 = await readBlobAsBase64(blob);
      } else {
        throw new Error("No PDF source available");
      }

      const reqBody = { action: "process_upload", user_id: user.id, pdf_base64: base64, filename: item.name };
      const res = await fetch(
        `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reqBody) }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
      if (!result.success) {
        await supabase.from("estatement_pdfs").update({ status: "failed" }).eq("id", itemId);
        setQueue(prev => prev.map(i => i.id === itemId
          ? { ...i, status: "failed", error: result.error } : i
        ));
        return;
      }

      // Delete PDF from Storage — no longer needed after extraction
      if (item.file_path) {
        await supabase.storage.from("estatement-pdfs").remove([item.file_path]);
      }

      const rows = buildRows(result.transactions || [], item.account_id || "");
      const sel = {};
      rows.forEach(r => { sel[r._id] = r.status !== "duplicate" && r.status !== "possible_duplicate"; });
      setQueue(prev => prev.map(i => i.id === itemId
        ? { ...i, status: "reviewed", rows, selected: sel, skipped: new Set(), notesOpen: new Set(), file: null, file_path: null } : i
      ));
    } catch (e) {
      await supabase.from("estatement_pdfs").update({ status: "failed" }).eq("id", itemId);
      setQueue(prev => prev.map(i => i.id === itemId
        ? { ...i, status: "failed", error: e.message } : i
      ));
    }
  };

  // ── Update a row field ─────────────────────────────────────
  const updateRow = (itemId, rowId, patch) => {
    setQueue(prev => prev.map(i => i.id === itemId
      ? { ...i, rows: i.rows.map(r => r._id === rowId ? { ...r, ...patch } : r) } : i
    ));
  };

  // ── Remove a single row from preview ───────────────────────
  const removeRow = (itemId, rowId) => {
    setQueue(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const rows = i.rows.filter(r => r._id !== rowId);
      const selected = { ...i.selected }; delete selected[rowId];
      const skipped  = new Set(i.skipped);  skipped.delete(rowId);
      const notesOpen= new Set(i.notesOpen);notesOpen.delete(rowId);
      return { ...i, rows, selected, skipped, notesOpen };
    }));
  };

  // ── Build ledger payload from a row ────────────────────────
  const isUUID = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const buildPayload = (r) => {
    const txType          = r.tx_type === "cc_installment" ? "expense" : (r.tx_type || "expense");
    const isReimburseType = txType === "reimburse_in" || txType === "reimburse_out";
    const isDebit         = ["expense","transfer","pay_cc","buy_asset","pay_liability",
                             "reimburse_out","reimburse_in","give_loan","fx_exchange","cc_installment"].includes(txType);
    const { from_type, to_type } = getTxFromToTypes(txType);
    const notes           = r._isInstallment && r._instNo
      ? `Cicilan ${r._instNo}${r._instTotal ? `/${r._instTotal}` : ""}${r.notes ? ` — ${r.notes}` : ""}`
      : (r.notes || null);
    return {
      tx_date:       r.tx_date,
      description:   r.description || "E-Statement import",
      merchant_name: r.description || null,
      amount:        Number(r.amount || 0),
      amount_idr:    Number(r.amount_idr || r.amount || 0),
      currency:      r.currency || "IDR",
      tx_type:       txType,
      from_id:       isDebit && isUUID(r.from_id) ? r.from_id : null,
      from_type,
      to_id:         isUUID(r.to_id) ? r.to_id : null,
      to_type,
      // category_id is a text slug (e.g. "food"), NOT a UUID — pass directly
      category_id:   r.category_id || null,
      category_name: r.category_id || null,   // ledger reads category_name for display
      entity:        isReimburseType ? (r.reimburse_entity || "Personal") : (r.entity || "Personal"),
      is_reimburse:  isReimburseType && !!r.reimburse_entity,
      notes,
    };
  };

  // ── Save ONE row immediately, remove from preview ──────────
  const saveRow = async (itemId, row) => {
    try {
      const payload = buildPayload(row);
      const inserted = await ledgerApi.create(user.id, payload, accounts);
      if ((row.tx_type === "reimburse_in" || row.tx_type === "reimburse_out") && row.reimburse_entity && inserted?.id) {
        supabase.from("reimburse_settlements").insert({
          user_id:              user.id,
          entity:               row.reimburse_entity,
          status:               "pending",
          total_out:            Number(row.amount_idr || row.amount || 0),
          linked_ledger_id:     inserted.id,
          out_ledger_ids:       [inserted.id],
          in_ledger_ids:        [],
          total_in:             0,
          reimbursable_expense: Number(row.amount_idr || row.amount || 0),
        }).catch(() => {}); // fire-and-forget
      }
      removeRow(itemId, row._id);
      showToast(`Saved: ${row.description || "transaction"}`);
    } catch (e) {
      console.error("[saveRow]", e);
      showToast(`Error: ${e.message}`, "error");
    }
  };

  // ── Save all checked rows (bulk import) ────────────────────
  const saveFile = async (itemId) => {
    const item = queue.find(i => i.id === itemId);
    if (!item?.rows) return;
    const toSave = item.rows.filter(r => item.selected[r._id] && !item.skipped.has(r._id));
    if (toSave.length === 0) { showToast("Nothing selected", "error"); return; }
    let count = 0;
    const savedIds = [];
    for (const r of toSave) {
      try {
        const inserted = await ledgerApi.create(user.id, buildPayload(r), accounts);
        savedIds.push(r._id);
        count++;
        if ((r.tx_type === "reimburse_in" || r.tx_type === "reimburse_out") && r.reimburse_entity && inserted?.id) {
          supabase.from("reimburse_settlements").insert({
            user_id:              user.id,
            entity:               r.reimburse_entity,
            status:               "pending",
            total_out:            Number(r.amount_idr || r.amount || 0),
            linked_ledger_id:     inserted.id,
            out_ledger_ids:       [inserted.id],
            in_ledger_ids:        [],
            total_in:             0,
            reimbursable_expense: Number(r.amount_idr || r.amount || 0),
          }).catch(() => {}); // fire-and-forget
        }
      } catch (e) {
        console.error("[saveFile] row error", e);
        showToast(`Error on "${r.description}": ${e.message}`, "error");
      }
    }
    if (savedIds.length === 0) return;
    // Remove saved rows; if all gone move item to history
    setQueue(prev => prev.map(i => {
      if (i.id !== itemId) return i;
      const rows = i.rows.filter(r => !savedIds.includes(r._id));
      if (rows.length === 0) return null; // remove entirely below
      const selected = { ...i.selected };
      savedIds.forEach(id => delete selected[id]);
      return { ...i, rows, selected };
    }).filter(Boolean));
    const now = new Date().toISOString();
    await supabase.from("estatement_pdfs").update({
      status: "done", transaction_count: count, processed_at: now,
    }).eq("id", itemId);
    setHistory(prev => [{
      id: itemId, filename: item.name, file_size: item.size,
      status: "done", transaction_count: count, processed_at: now,
    }, ...prev]);
    showToast(`${count} transaction${count !== 1 ? "s" : ""} imported`);
  };

  // ── Create installment from a row ──────────────────────────
  const createInstallment = async (itemId, row) => {
    const item = queue.find(i => i.id === itemId);
    if (!item) return;
    const monthly    = Number(row.amount_idr || row.amount || 0);
    const totalMos   = row._instTotal || 12;
    const instNo     = row._instNo || 1;
    const totalAmt   = monthly * totalMos;

    // Calculate start_date: go back (instNo - 1) months from tx_date
    let startDate = row.tx_date || null;
    if (row.tx_date && instNo > 1) {
      const d = new Date(row.tx_date + "T00:00:00");
      d.setMonth(d.getMonth() - (instNo - 1));
      startDate = d.toISOString().slice(0, 10);
    }

    // next_payment_date: start + instNo months (month after the current one)
    let nextPaymentDate = null;
    if (startDate) {
      const d = new Date(startDate + "T00:00:00");
      d.setMonth(d.getMonth() + instNo);
      nextPaymentDate = d.toISOString().slice(0, 10);
    }

    try {
      const created = await installmentsApi.create(user.id, {
        account_id:         row.from_id || "",
        description:        row.description,
        total_amount:       totalAmt,
        monthly_amount:     monthly,
        total_months:       totalMos,
        paid_months:        instNo,   // current installment is on the statement = already paid
        start_date:         startDate,
        next_payment_date:  nextPaymentDate,
        entity:             "Personal",
        status:             "active",
      });
      if (created) setInstallments?.(prev => [created, ...(prev || [])]);
      setQueue(prev => prev.map(i => i.id === itemId
        ? { ...i, rows: i.rows.map(r => r._id === row._id ? { ...r, _instMatch: created } : r) } : i
      ));
      showToast("Installment plan created");
    } catch (e) { showToast(e.message, "error"); }
  };

  // ── Remove from queue (delete Storage + DB) ────────────────
  const removeFromQueue = async (itemId) => {
    const item = queue.find(i => i.id === itemId);
    // Delete from Storage if PDF still there (queued/failed)
    if (item?.file_path) {
      await supabase.storage.from("estatement-pdfs").remove([item.file_path]);
    }
    // Delete from DB
    await supabase.from("estatement_pdfs").delete().eq("id", itemId);
    setQueue(prev => prev.filter(i => i.id !== itemId));
  };

  // ── Delete history record ─────────────────────────────────
  const deleteHistoryItem = async (id) => {
    await supabase.from("estatement_pdfs").delete().eq("id", id);
    setHistory(prev => prev.filter(i => i.id !== id));
  };

  const statusBadge = (status) => {
    const map = {
      queued:     { label: "⏳ Queued",     bg: "#f3f4f6", color: "#6b7280" },
      processing: { label: "🔄 Processing", bg: "#fef9c3", color: "#92400e" },
      reviewed:   { label: "👁 Review",     bg: "#eff6ff", color: "#1d4ed8" },
      done:       { label: "✅ Done",       bg: "#dcfce7", color: "#15803d" },
      failed:     { label: "❌ Failed",     bg: "#fef2f2", color: "#dc2626" },
    };
    const s = map[status] || { label: status, bg: "#f3f4f6", color: "#6b7280" };
    return (
      <span style={{
        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap",
        background: s.bg, color: s.color, fontFamily: "Figtree, sans-serif",
      }}>
        {s.label}
      </span>
    );
  };

  const fmtDateMed = (iso) => {
    try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
    catch { return iso || ""; }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Upload Zone ── */}
      <div style={card}>
        <SectionHeader title="Upload Statements" />
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => document.getElementById("pdf-upload-input").click()}
          style={{
            marginTop: 12,
            border: `2px dashed ${dragging ? "#3b5bdb" : T.border}`,
            borderRadius: 12, padding: "28px 20px",
            textAlign: "center", cursor: "pointer",
            background: dragging ? "#eff6ff" : T.sur2,
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif" }}>
            Drop PDF statements here or click to browse
          </div>
          <div style={{ fontSize: 11, color: T.text3, marginTop: 4, fontFamily: "Figtree, sans-serif" }}>
            Upload bank or credit card statements (password-free PDFs)
          </div>
          <input id="pdf-upload-input" type="file" accept=".pdf" multiple
            style={{ display: "none" }}
            onChange={e => { addFiles(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      {/* ── Queue ── */}
      {dbLoading ? (
        <div style={{ textAlign: "center", padding: "16px 0", color: T.text3, fontSize: 12, fontFamily: "Figtree, sans-serif" }}>
          Loading queue…
        </div>
      ) : queue.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {queue.map(item => (
            <EStmtQueueItem
              key={item.id}
              item={item}
              T={T} card={card}
              accounts={accounts}
              onProcess={() => processFile(item.id)}
              onSetAccount={(accountId) => setItemAccount(item.id, accountId)}
              onUpdateRow={(rowId, patch) => updateRow(item.id, rowId, patch)}
              onToggleSel={(rowId) => setQueue(prev => prev.map(i => i.id === item.id
                ? { ...i, selected: { ...i.selected, [rowId]: !i.selected[rowId] } } : i))}
              onToggleSkip={(rowId) => removeRow(item.id, rowId)}
              onToggleNotes={(rowId) => setQueue(prev => prev.map(i => i.id === item.id ? {
                ...i,
                notesOpen: (() => { const ns = new Set(i.notesOpen); ns.has(rowId) ? ns.delete(rowId) : ns.add(rowId); return ns; })(),
              } : i))}
              onToggleAll={() => {
                const allSel = item.rows?.every(r => item.selected[r._id] && !item.skipped.has(r._id));
                const ns = {};
                item.rows?.forEach(r => { ns[r._id] = !allSel; });
                setQueue(prev => prev.map(i => i.id === item.id ? { ...i, selected: ns } : i));
              }}
              onSave={() => saveFile(item.id)}
              onSaveRow={(row) => saveRow(item.id, row)}
              onRemoveRow={(rowId) => removeRow(item.id, rowId)}
              onCreateInstallment={(row) => createInstallment(item.id, row)}
              onRemove={() => removeFromQueue(item.id)}
              statusBadge={statusBadge}
              fmtSize={fmtSize}
            />
          ))}
        </div>
      )}

      {/* ── History (last 30 days done) ── */}
      {history.length > 0 && (
        <div style={card}>
          <div
            onClick={() => setHistoryOpen(v => !v)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
          >
            <SectionHeader title={`History (${history.length})`} />
            <span style={{ fontSize: 12, color: T.text3, fontFamily: "Figtree, sans-serif" }}>
              {historyOpen ? "▲ hide" : "▼ show"}
            </span>
          </div>
          {historyOpen && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {history.map(h => (
                <div key={h.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", background: T.sur2, borderRadius: 8,
                  border: `1px solid ${T.border}`,
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>✅</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{h.filename}</div>
                    <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
                      {h.transaction_count != null ? `${h.transaction_count} tx` : "Done"}
                      {h.processed_at ? ` · ${fmtDateMed(h.processed_at)}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteHistoryItem(h.id)}
                    style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#d1d5db", padding: 2, flexShrink: 0 }}
                    onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                    onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── QUEUE FILE ITEM (card wrapper + preview) ─────────────────
function EStmtQueueItem({
  item, T, card, accounts,
  onProcess, onSetAccount,
  onUpdateRow, onToggleSel, onToggleSkip, onToggleNotes, onToggleAll,
  onSave, onSaveRow, onRemoveRow, onCreateInstallment, onRemove,
  statusBadge, fmtSize,
}) {

  const rows         = item.rows || [];
  const countSel     = rows.filter(r => item.selected[r._id] && !item.skipped.has(r._id)).length;
  const countNew     = rows.filter(r => r.status === "new" || r.status === "review").length;
  const countDup     = rows.filter(r => r.status === "duplicate" || r.status === "possible_duplicate").length;
  const allSel       = rows.length > 0 && rows.every(r => item.selected[r._id] && !item.skipped.has(r._id));

  return (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>

      {/* ── File header row ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 14px", background: T.sur2,
        borderBottom: item.status === "reviewed" ? `1px solid ${T.border}` : "none",
      }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>
          {item._uploading ? "⏫" : "📄"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {item.name}
          </div>
          <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
            {fmtSize(item.size)}
            {item._uploading                && " · uploading…"}
            {item.status === "reviewed"     && rows.length > 0 && ` · ${rows.length} tx found`}
            {item.status === "processing"   && " · scanning with AI…"}
          </div>
        </div>
        {statusBadge(item.status)}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {item.status === "queued" && !item._uploading && (
            <Button variant="primary" size="sm"
              onClick={() => {
                if (!item.account_id) { showToast("Select an account first", "error"); return; }
                onProcess();
              }}>▶ Process</Button>
          )}
          {item.status === "failed" && (
            <Button variant="secondary" size="sm" onClick={onProcess}>Retry</Button>
          )}
          {["queued","failed","reviewed"].includes(item.status) && !item._uploading && (
            <button onClick={onRemove}
              style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#d1d5db", padding: 2 }}
              onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
              onMouseLeave={e => e.currentTarget.style.color = "#d1d5db"}>
              ×
            </button>
          )}
        </div>
      </div>

      {/* ── Account selector (queued / failed) ── */}
      {["queued","failed"].includes(item.status) && !item._uploading && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 14px", borderBottom: `1px solid ${T.border}`,
          background: item.account_id ? "#f0fdf4" : "#fefce8",
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: item.account_id ? "#059669" : "#92400e", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
            {item.account_id ? "📂 Statement account" : "⚠️ Select account"}
          </span>
          <select
            value={item.account_id || ""}
            onChange={e => onSetAccount(e.target.value)}
            style={{
              flex: 1, fontSize: 12, padding: "4px 6px", borderRadius: 6,
              border: `1px solid ${item.account_id ? "#bbf7d0" : "#fcd34d"}`,
              background: "white", color: "#111827",
              fontFamily: "Figtree, sans-serif", cursor: "pointer",
            }}>
            <option value="">— pick an account —</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.name}{a.last4 || a.card_last4 ? ` ···${a.last4 || a.card_last4}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Error ── */}
      {item.error && (
        <div style={{ padding: "10px 14px", background: "#fff5f5", borderBottom: "1px solid #fecaca" }}>
          <div style={{ fontSize: 11, color: "#dc2626", fontFamily: "Figtree, sans-serif" }}>
            {item.error}
          </div>
        </div>
      )}

      {/* ── Transaction preview (AI Import/Scan style) ── */}
      {item.status === "reviewed" && (
        <div style={{ padding: "12px 14px" }}>
          {rows.length === 0 ? (
            <div style={{ fontSize: 12, color: T.text3, fontFamily: "Figtree, sans-serif", padding: "8px 0" }}>
              No transactions found in this statement.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Summary header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                    {rows.length} transaction{rows.length !== 1 ? "s" : ""} found
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: "#059669", fontFamily: "Figtree, sans-serif" }}>
                      ✅ {countNew} new
                    </span>
                    {countDup > 0 && (
                      <span style={{ fontSize: 11, color: "#d97706", fontFamily: "Figtree, sans-serif" }}>
                        ⚠️ {countDup} duplicate{countDup !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button variant="secondary" size="sm" onClick={onToggleAll}>
                    {allSel ? "Deselect All" : "Select All"}
                  </Button>
                  <Button variant="primary" size="sm" onClick={onSave}>
                    Import {countSel} Selected ▶
                  </Button>
                </div>
              </div>

              {/* Transaction cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map(r => (
                  <EStmtTxCard
                    key={r._id}
                    r={r} T={T}
                    isSelected={!!item.selected[r._id]}
                    isSkipped={item.skipped.has(r._id)}
                    isNotesOpen={item.notesOpen.has(r._id)}
                    accounts={accounts}
                    onToggleSel={() => onToggleSel(r._id)}
                    onToggleSkip={() => onToggleSkip(r._id)}
                    onToggleNotes={() => onToggleNotes(r._id)}
                    onUpdate={(patch) => onUpdateRow(r._id, patch)}
                    onSaveRow={() => onSaveRow(r)}
                    onRemoveRow={() => onRemoveRow(r._id)}
                    onCreateInstallment={() => onCreateInstallment(r)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── E-STATEMENT TX CARD ──────────────────────────────────────
// Mirrors AIImport TxCard style exactly
function EStmtTxCard({
  r, T, isSelected, isSkipped, isNotesOpen,
  accounts, onToggleSel, onToggleSkip, onToggleNotes, onUpdate,
  onSaveRow, onRemoveRow, onCreateInstallment,
}) {
  const dupLevel   = r.status === "duplicate" ? 3 : r.status === "possible_duplicate" ? 2 : r.status === "review" ? 1 : 0;
  const cardBg     = isSkipped ? T.sur2 : dupLevel === 3 ? "#fff1f2" : dupLevel === 2 ? "#fff7ed" : dupLevel === 1 ? "#fefce8" : T.surface;
  const cardBorder = dupLevel === 3 ? "1.5px solid #dc2626" : dupLevel === 2 ? "1.5px solid #ea580c" : dupLevel === 1 ? "1.5px solid #ca8a04" : `1px solid ${T.border}`;
  const color      = ESTMT_AMT_COLOR[r.tx_type] || "#dc2626";
  const showCat    = !ESTMT_NO_CAT.has(r.tx_type);
  const cats       = ESTMT_CAT_FOR_TYPE(r.tx_type);

  const sign   = ESTMT_INCOME_TYPES.has(r.tx_type) ? "+" : ESTMT_NEUTRAL_TYPES.has(r.tx_type) ? "" : "-";
  const amtStr = `${sign}Rp ${Number(r.amount_idr || r.amount || 0).toLocaleString("id-ID")}`;

  const bankAccounts  = accounts.filter(a => a.type === "bank");
  const ccAccounts    = accounts.filter(a => a.type === "credit_card");
  const spendAccounts = [...ccAccounts, ...bankAccounts];
  const allAccounts   = accounts;
  const sel = estmtInSel(T);

  return (
    <div style={{ background: cardBg, border: cardBorder, borderRadius: 10, opacity: isSkipped ? 0.55 : 1, overflow: "hidden" }}>

      {/* ── ROW 1: ☑ date description amount ✓ ✕ ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 5px" }}>
        <input type="checkbox"
          checked={isSelected && !isSkipped}
          onChange={onToggleSel}
          disabled={isSkipped}
          style={{ accentColor: "#3b5bdb", width: 15, height: 15, flexShrink: 0, cursor: "pointer" }} />

        <span style={{ width: 52, fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif", flexShrink: 0, whiteSpace: "nowrap" }}>
          {fmtDateShort(r.tx_date)}
        </span>

        <input
          style={{
            flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none",
            fontSize: 13, fontWeight: 600,
            color: isSkipped ? T.text3 : T.text,
            fontFamily: "Figtree, sans-serif",
            textDecoration: isSkipped ? "line-through" : "none",
          }}
          value={r.description}
          onChange={e => onUpdate({ description: e.target.value })}
          placeholder="Description…"
        />

        <span style={{ fontSize: 13, fontWeight: 800, color, fontFamily: "Figtree, sans-serif", flexShrink: 0, whiteSpace: "nowrap", marginLeft: 4 }}>
          {amtStr}
        </span>

        {/* ✓ import this row now */}
        <button
          onClick={onSaveRow}
          style={estmtACT({ background: "#dcfce7", color: "#059669", border: "1px solid #bbf7d0" })}
          title="Import this transaction now">
          ✓
        </button>

        {/* ✕ remove row */}
        <button
          onClick={onRemoveRow}
          style={estmtACT({ color: "#9ca3af", border: "1px solid #e5e7eb" })}
          title="Skip — remove from list">
          ✕
        </button>
      </div>

      {/* ── ROW 2: type [badges] [category] account [✏️] ── */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, padding: "2px 12px 9px 35px" }}>
        <select
          style={{ ...sel, width: 126, color: ESTMT_AMT_COLOR[r.tx_type] || "#111827", fontWeight: 600 }}
          value={r.tx_type}
          onChange={e => {
            const t = e.target.value;
            onUpdate({
              tx_type:          t,
              category_id:      ESTMT_NO_CAT.has(t) ? null : r.category_id,
              reimburse_entity: ESTMT_REIMBURSE_TYPES.has(t) ? r.reimburse_entity : "",
            });
          }}>
          {ESTMT_TX_TYPES.map(t => (
            <option key={t.value} value={t.value} style={{ color: t.color, fontWeight: 600 }}>{t.label}</option>
          ))}
        </select>

        {/* DUPLICATE badge */}
        {dupLevel === 3 && (
          <span style={{ fontSize: 9, fontWeight: 800, background: "#fee2e2", color: "#dc2626", padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>
            DUPLICATE
          </span>
        )}
        {dupLevel === 2 && (
          <span style={{ fontSize: 9, fontWeight: 800, background: "#ffedd5", color: "#ea580c", padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>
            POSSIBLE DUPLICATE
          </span>
        )}
        {dupLevel === 1 && (
          <span style={{ fontSize: 9, fontWeight: 800, background: "#fef9c3", color: "#ca8a04", padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>
            REVIEW
          </span>
        )}

        {/* CICILAN badge */}
        {r._isInstallment && (
          <span style={{ fontSize: 9, fontWeight: 800, background: "#dbeafe", color: "#1d4ed8", padding: "2px 5px", borderRadius: 4, whiteSpace: "nowrap" }}>
            CICILAN {r._instNo && r._instTotal ? `${r._instNo}/${r._instTotal}` : r._instNo || ""}
          </span>
        )}

        {/* Category */}
        {showCat && (
          <select style={{ ...sel, width: 130 }}
            value={r.category_id || ""}
            onChange={e => onUpdate({ category_id: e.target.value })}>
            {cats.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        )}

        {/* Account — varies by tx_type */}
        <div style={{ flex: 1, minWidth: 120 }}>
          {/* Income-only types: to_id */}
          {["income","collect_loan","sell_asset"].includes(r.tx_type) ? (
            <select style={{ ...sel, width: "100%" }}
              value={r.to_id || ""}
              onChange={e => onUpdate({ to_id: e.target.value })}>
              <option value="">To Account…</option>
              {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>

          /* Transfer: from bank → to bank */
          ) : r.tx_type === "transfer" ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select style={{ ...sel, flex: 1 }} value={r.from_id || ""}
                onChange={e => onUpdate({ from_id: e.target.value })}>
                <option value="">From…</option>
                {allAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>→</span>
              <select style={{ ...sel, flex: 1 }} value={r.to_id || ""}
                onChange={e => onUpdate({ to_id: e.target.value })}>
                <option value="">To…</option>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

          /* Pay CC: from bank → to CC */
          ) : r.tx_type === "pay_cc" ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select style={{ ...sel, flex: 1 }} value={r.from_id || ""}
                onChange={e => onUpdate({ from_id: e.target.value })}>
                <option value="">From…</option>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>→</span>
              <select style={{ ...sel, flex: 1 }} value={r.to_id || ""}
                onChange={e => onUpdate({ to_id: e.target.value })}>
                <option value="">To CC…</option>
                {ccAccounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.last4 ? ` ···${a.last4}` : ""}</option>)}
              </select>
            </div>

          /* Give Loan: from bank → to bank */
          ) : r.tx_type === "give_loan" ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select style={{ ...sel, flex: 1 }} value={r.from_id || ""}
                onChange={e => onUpdate({ from_id: e.target.value })}>
                <option value="">From…</option>
                {allAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <span style={{ fontSize: 10, color: T.text3, flexShrink: 0 }}>→</span>
              <select style={{ ...sel, flex: 1 }} value={r.to_id || ""}
                onChange={e => onUpdate({ to_id: e.target.value })}>
                <option value="">To…</option>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

          /* All other debit types (expense, cc_installment, buy_asset, pay_liability, fx_exchange, reimburse_in, reimburse_out): from_id */
          ) : (
            <select style={{ ...sel, width: "100%" }}
              value={r.from_id || ""}
              onChange={e => onUpdate({ from_id: e.target.value })}>
              <option value="">From Account…</option>
              {spendAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}{(a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* ✏️ notes toggle */}
        <button onClick={onToggleNotes}
          style={estmtACT({
            background: isNotesOpen ? "#dbeafe" : T.sur2,
            color: isNotesOpen ? "#3b5bdb" : T.text3,
            width: 24, height: 24, fontSize: 11,
          })}
          title="Notes">
          ✏️
        </button>
      </div>

      {/* ── Reimburse entity row (shown when tx_type is reimburse_in or reimburse_out) ── */}
      {ESTMT_REIMBURSE_TYPES.has(r.tx_type) && (
        <div style={{ borderTop: `1px solid #fde68a`, background: "#fffbeb", padding: "6px 12px 8px 35px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
            Entity
          </span>
          <select
            style={{ ...estmtInSel(T), flex: 1, border: "1px solid #fcd34d", fontWeight: 600, color: r.reimburse_entity ? "#92400e" : "#6b7280" }}
            value={r.reimburse_entity || ""}
            onChange={e => onUpdate({ reimburse_entity: e.target.value })}>
            <option value="">Select entity…</option>
            {["Hamasa", "SDC", "Travelio"].map(e => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Notes row ── */}
      {isNotesOpen && (
        <div style={{ borderTop: `1px solid ${T.border}`, background: T.sur2, padding: "6px 12px 8px 35px", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
            Notes
          </span>
          <input
            style={estmtInSel(T, { flex: 1, border: `1px solid ${T.border}`, padding: "3px 5px" })}
            value={r.notes || ""}
            onChange={e => onUpdate({ notes: e.target.value })}
            placeholder="Optional notes…"
          />
        </div>
      )}

      {/* ── Duplicate info ── */}
      {dupLevel > 0 && r._dupEntry && (
        <div style={{ borderTop: `1px solid #fde68a`, background: "#fffbeb", padding: "5px 12px 6px 35px" }}>
          <span style={{ fontSize: 10, color: "#92400e", fontFamily: "Figtree, sans-serif" }}>
            Similar: {r._dupEntry.description} · {r._dupEntry.tx_date}
          </span>
        </div>
      )}

      {/* ── Installment cross-check ── */}
      {r._isInstallment && (
        <div style={{ borderTop: `1px solid #bfdbfe`, background: "#eff6ff", padding: "6px 12px 7px 35px", display: "flex", alignItems: "center", gap: 8 }}>
          {r._instMatch ? (
            <span style={{ fontSize: 10, color: "#1d4ed8", fontFamily: "Figtree, sans-serif" }}>
              ✓ Already tracked in installments: {r._instMatch.description}
              {r._instMatch.months ? ` (${r._instMatch.paid_months}/${r._instMatch.months} paid)` : ""}
            </span>
          ) : (
            <>
              <span style={{ fontSize: 10, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
                Not tracked in installments
              </span>
              <button
                onClick={onCreateInstallment}
                style={{
                  fontSize: 10, fontWeight: 700, color: "#1d4ed8", background: "none",
                  border: "1px solid #bfdbfe", borderRadius: 4, padding: "2px 8px",
                  cursor: "pointer", fontFamily: "Figtree, sans-serif",
                }}>
                + Create Installment
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
