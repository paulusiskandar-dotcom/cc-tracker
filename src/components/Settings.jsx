import { useState } from "react";
import { supabase } from "../lib/supabase";
import PILogo from "./PILogo";
import { fxApi, merchantApi, settingsApi, recurringApi, gmailApi } from "../api";
import { fmtIDR } from "../utils";
import { CURRENCIES, EXPENSE_CATEGORIES, ENTITIES, FREQUENCIES, TX_TYPES, APP_VERSION, APP_BUILD } from "../constants";
import { LIGHT, DARK } from "../theme";
import {
  Modal, Button,
  Field, AmountInput, Input, FormRow,
  Select,
  SectionHeader, EmptyState, showToast,
} from "./shared/index";

const SUBTABS = [
  { id: "profile",    label: "Profile"    },
  { id: "email",      label: "Email Sync" },
  { id: "fx",         label: "FX Rates"   },
  { id: "recurring",  label: "Recurring"  },
  { id: "merchants",  label: "Merchants"  },
  { id: "appearance", label: "Appearance" },
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
}) {
  const T = dark ? DARK : LIGHT;

  const [subTab, setSubTab] = useState("profile");
  const [saving, setSaving] = useState(false);

  // ── Profile ────────────────────────────────────────────────
  const [profileName, setProfileName] = useState(user?.user_metadata?.full_name || "");
  const [changingPass, setChangingPass] = useState(false);
  const [newPass, setNewPass] = useState("");

  // ── Gmail ──────────────────────────────────────────────────
  const [gmailToken, setGmailToken]   = useState(null);
  const [gmailLoaded, setGmailLoaded] = useState(false);
  const [clientId, setClientId]       = useState("");
  const [syncingNow, setSyncingNow]   = useState(false);

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
    name: "", type: "expense", amount: "", currency: "IDR",
    frequency: "Monthly", category: "", entity: "Personal", notes: "",
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
      const result = await gmailApi.triggerSync(user.id);
      showToast(`Sync complete: ${result?.new_transactions || 0} new transactions`);
      await onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
    setSyncingNow(false);
  };

  // ── Actions: FX ────────────────────────────────────────────
  const saveFxRates = async () => {
    setSaving(true);
    try {
      await fxApi.upsertAll(user.id, rates);
      setFxRates(rates);
      showToast("FX rates saved");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  // ── Actions: Recurring ─────────────────────────────────────
  const openRecurModal = (t = null) => {
    if (t) {
      setEditRecur(t);
      setRecurForm({ name: t.name, type: t.type, amount: String(t.amount), currency: t.currency || "IDR", frequency: t.frequency || "Monthly", category: t.category || "", entity: t.entity || "Personal", notes: t.notes || "" });
    } else {
      setEditRecur(null);
      setRecurForm({ name: "", type: "expense", amount: "", currency: "IDR", frequency: "Monthly", category: "", entity: "Personal", notes: "" });
    }
    setRecurModal(true);
  };

  const saveRecur = async () => {
    if (!recurForm.name || !recurForm.amount) return showToast("Fill name and amount", "error");
    setSaving(true);
    try {
      if (editRecur) {
        const updated = await recurringApi.updateTemplate(editRecur.id, { ...recurForm, amount: Number(recurForm.amount) });
        setRecurTemplates(prev => prev.map(t => t.id === editRecur.id ? { ...t, ...updated } : t));
        showToast("Template updated");
      } else {
        const created = await recurringApi.createTemplate(user.id, { ...recurForm, amount: Number(recurForm.amount) });
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
          ? { ...m, category_id: merchantCat, category_label: catDef?.label || merchantCat }
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
      {/* ── EMAIL SYNC ───────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "email" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Status */}
          <div style={{ ...card, borderColor: gmailToken ? "#059669" : T.border }}>
            <SectionHeader title={gmailToken ? "✅ Gmail Connected" : "📧 Gmail Not Connected"} />
            {gmailToken ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 }}>
                  {gmailToken.gmail_email || user?.email}
                </div>
                {gmailToken.last_sync && (
                  <div style={{ fontSize: 11, color: T.text3, marginBottom: 8 }}>
                    Last sync: {new Date(gmailToken.last_sync).toLocaleString()}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Button variant="primary"   size="sm" busy={syncingNow} onClick={syncNow}>
                    🔄 Sync Now
                  </Button>
                  <Button variant="danger"    size="sm" onClick={disconnectGmail}>Disconnect</Button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, fontSize: 12, color: T.text3, lineHeight: 1.6 }}>
                Connect Gmail to auto-import bank transaction notifications.
                Only <strong>gmail.readonly</strong> access — cannot send or delete emails.
              </div>
            )}
          </div>

          {/* Setup guide */}
          {!gmailToken && (
            <div style={card}>
              <SectionHeader title="Setup Guide" />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {SETUP_STEPS.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%",
                      background: "#dbeafe", border: "1px solid #93c5fd44",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 800, color: "#3b5bdb", flexShrink: 0,
                    }}>
                      {i + 1}
                    </div>
                    <div style={{ fontSize: 12, color: T.text2, lineHeight: 1.6 }}>{step}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 14 }}>
                <Field label="Google Client ID">
                  <Input
                    value={clientId}
                    onChange={e => setClientId(e.target.value)}
                    placeholder="xxx.apps.googleusercontent.com"
                  />
                </Field>
                <div style={{ marginTop: 10 }}>
                  <Button variant="accent" size="md" onClick={connectGmail}>
                    Connect Gmail →
                  </Button>
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
            Used to convert foreign currency transactions to IDR.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {CURRENCIES.filter(c => c.code !== "IDR").map(c => (
              <div key={c.code} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 12px", background: T.sur2, borderRadius: 10,
              }}>
                <span style={{ fontSize: 18 }}>{c.flag}</span>
                <span style={{ fontWeight: 700, fontSize: 13, color: T.text, minWidth: 36 }}>{c.code}</span>
                <span style={{ fontSize: 11, color: T.text3, flex: 1 }}>1 {c.code} =</span>
                <input
                  type="number"
                  value={rates[c.code] || ""}
                  onChange={e => setRates(r => ({ ...r, [c.code]: Number(e.target.value) }))}
                  style={{
                    width: 100, padding: "6px 8px", borderRadius: 8,
                    border: `1px solid ${T.border}`, background: T.surface,
                    color: T.text, fontSize: 12, fontFamily: "Figtree, sans-serif",
                    textAlign: "right",
                  }}
                />
                <span style={{ fontSize: 11, color: T.text3 }}>IDR</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <Button variant="primary" size="md" busy={saving} onClick={saveFxRates}>
              💾 Save Rates
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
              const txDef = TX_TYPES.find(x => x.id === t.type);
              return (
                <div key={t.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: T.text3, marginTop: 3 }}>
                        {t.frequency} · {txDef?.label || t.type}
                        {t.category && ` · ${t.category}`}
                        {t.entity && t.entity !== "Personal" && ` · ${t.entity}`}
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
                      {cat ? `${cat.icon} ${cat.label}` : m.category_label || m.category_id}
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
          <Field label="Name *">
            <Input
              value={recurForm.name}
              onChange={e => setRecurForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Netflix subscription"
            />
          </Field>
          <FormRow>
            <Field label="Type">
              <Select
                value={recurForm.type}
                onChange={e => setRecurForm(f => ({ ...f, type: e.target.value }))}
                options={TX_TYPES.filter(t => ["expense", "income"].includes(t.id)).map(t => ({ value: t.id, label: t.label }))}
              />
            </Field>
            <Field label="Frequency">
              <Select
                value={recurForm.frequency}
                onChange={e => setRecurForm(f => ({ ...f, frequency: e.target.value }))}
                options={FREQUENCIES.map(fr => ({ value: fr, label: fr }))}
              />
            </Field>
          </FormRow>
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
          <FormRow>
            <Field label="Category">
              <Select
                value={recurForm.category}
                onChange={e => setRecurForm(f => ({ ...f, category: e.target.value }))}
                options={EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))}
                placeholder="None"
              />
            </Field>
            <Field label="Entity">
              <Select
                value={recurForm.entity}
                onChange={e => setRecurForm(f => ({ ...f, entity: e.target.value }))}
                options={ENTITIES.map(e => ({ value: e, label: e }))}
              />
            </Field>
          </FormRow>
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
