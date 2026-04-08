import { useState } from "react";
import { supabase } from "../lib/supabase";
import { fxApi, merchantApi, settingsApi, recurringApi, gmailApi, fmtIDR } from "../api";
import { CURRENCIES, EXPENSE_CATEGORIES, ENTITIES, FREQUENCIES, TX_TYPES, APP_VERSION, APP_BUILD } from "../constants";
import { SubTabs, SectionHeader, Overlay, F, R2, Input, Select, BtnRow, Empty, showToast, confirmDelete } from "./shared";

const SUBTABS = [
  { id:"profile",    label:"Profile" },
  { id:"email",      label:"Email Sync" },
  { id:"fx",         label:"FX Rates" },
  { id:"recurring",  label:"Recurring" },
  { id:"merchants",  label:"Merchants" },
  { id:"appearance", label:"Appearance" },
];

export default function Settings({
  th, user, isDark, setIsDark, fxRates, setFxRates,
  recurTemplates, setRecurTemplates, merchantMaps, setMerchantMaps, onRefresh,
}) {
  const [subTab, setSubTab]   = useState("profile");
  const [saving, setSaving]   = useState(false);

  // ── Gmail state ──────────────────────────────────────────────
  const [gmailToken, setGmailToken]     = useState(null);
  const [gmailLoaded, setGmailLoaded]   = useState(false);
  const [clientId, setClientId]         = useState("");
  const [autoSync, setAutoSync]         = useState(true);
  const [markRead, setMarkRead]         = useState(false);
  const [syncingNow, setSyncingNow]     = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  const loadGmailToken = async () => {
    if (gmailLoaded) return;
    try {
      const t = await gmailApi.getToken(user.id);
      setGmailToken(t);
    } catch { /* table may not exist yet */ }
    setGmailLoaded(true);
  };

  const connectGmail = () => {
    if (!clientId.trim()) return showToast("Enter your Google Client ID first","error");
    const redirectUri = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-oauth`;
    const scope = "https://www.googleapis.com/auth/gmail.readonly";
    const state = user.id;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${state}`;
    const popup = window.open(url, "Connect Gmail", "width=500,height=620,scrollbars=yes");
    const poll = setInterval(async () => {
      if (!popup || popup.closed) {
        clearInterval(poll);
        const t = await gmailApi.getToken(user.id).catch(() => null);
        if (t) { setGmailToken(t); showToast("Gmail connected!"); }
        else showToast("Connection incomplete — try again","error");
      }
    }, 1000);
  };

  const disconnectGmail = async () => {
    if (!window.confirm("Disconnect Gmail? Auto-sync will stop.")) return;
    try {
      await gmailApi.disconnect(user.id);
      setGmailToken(null);
      showToast("Gmail disconnected");
    } catch (e) { showToast(e.message,"error"); }
  };

  const syncNow = async () => {
    setSyncingNow(true);
    try {
      const result = await gmailApi.triggerSync(user.id);
      showToast(`Sync complete: ${result?.new_transactions || 0} new transactions`);
      await onRefresh?.();
    } catch (e) { showToast(e.message,"error"); }
    setSyncingNow(false);
  };

  // ── FX state ────────────────────────────────────────────────
  const [rates, setRates] = useState(() => {
    const r = {};
    CURRENCIES.filter(c => c.code !== "IDR").forEach(c => {
      r[c.code] = fxRates?.[c.code] || c.rate;
    });
    return r;
  });

  // ── Recurring state ──────────────────────────────────────────
  const [showRecurForm, setShowRecurForm] = useState(false);
  const [editRecur, setEditRecur]         = useState(null);
  const [recurForm, setRecurForm] = useState({
    name:"", type:"expense", amount:"", currency:"IDR",
    frequency:"Monthly", category:"", entity:"Personal", notes:"",
  });

  // ── Merchant edit state ──────────────────────────────────────
  const [editMerchant, setEditMerchant] = useState(null);
  const [merchantCat, setMerchantCat]  = useState("");

  // ── Profile state ────────────────────────────────────────────
  const [profileName, setProfileName] = useState(user?.user_metadata?.full_name || "");
  const [changingPass, setChangingPass] = useState(false);
  const [newPass, setNewPass] = useState("");

  const saveFxRates = async () => {
    setSaving(true);
    try {
      await fxApi.upsertAll(user.id, rates);
      setFxRates(rates);
      showToast("FX rates saved");
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const saveRecur = async () => {
    if (!recurForm.name || !recurForm.amount) return showToast("Fill name and amount", "error");
    setSaving(true);
    try {
      if (editRecur) {
        const updated = await recurringApi.updateTemplate(editRecur.id, recurForm);
        setRecurTemplates(p => p.map(t => t.id === editRecur.id ? { ...t, ...updated } : t));
        showToast("Updated recurring template");
      } else {
        const created = await recurringApi.createTemplate(user.id, { ...recurForm, amount: Number(recurForm.amount) });
        setRecurTemplates(p => [created, ...p]);
        showToast("Created recurring template");
      }
      setShowRecurForm(false);
      setEditRecur(null);
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  };

  const deleteRecur = async (t) => {
    if (!confirmDelete(t.name)) return;
    try {
      await recurringApi.deleteTemplate(t.id);
      setRecurTemplates(p => p.filter(x => x.id !== t.id));
      showToast("Deleted");
    } catch (e) { showToast(e.message, "error"); }
  };

  const saveMerchantCat = async () => {
    if (!editMerchant || !merchantCat) return;
    try {
      const catDef = EXPENSE_CATEGORIES.find(c => c.id === merchantCat);
      await merchantApi.upsertMapping(user.id, editMerchant.merchant_name, merchantCat, catDef?.label || merchantCat);
      setMerchantMaps(p => p.map(m =>
        m.merchant_name === editMerchant.merchant_name
          ? { ...m, category_id: merchantCat, category_label: catDef?.label || merchantCat }
          : m
      ));
      showToast("Merchant mapping saved");
      setEditMerchant(null);
    } catch (e) { showToast(e.message, "error"); }
  };

  const toggleDark = async () => {
    const next = !isDark;
    setIsDark(next);
    try { await settingsApi.set(user.id, "dark_mode", next); } catch { /* ignore */ }
  };

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

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const openRecurForm = (t = null) => {
    if (t) {
      setEditRecur(t);
      setRecurForm({ name:t.name, type:t.type, amount:t.amount, currency:t.currency||"IDR",
        frequency:t.frequency||"Monthly", category:t.category||"", entity:t.entity||"Personal", notes:t.notes||"" });
    } else {
      setEditRecur(null);
      setRecurForm({ name:"", type:"expense", amount:"", currency:"IDR", frequency:"Monthly", category:"", entity:"Personal", notes:"" });
    }
    setShowRecurForm(true);
  };

  const expenseTypes = TX_TYPES.filter(t => ["expense","income"].includes(t.id));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:20, fontWeight:800, color:th.tx }}>Settings</div>

      <SubTabs tabs={SUBTABS} active={subTab} onChange={t => { setSubTab(t); if (t === "email") loadGmailToken(); }} th={th}/>

      {/* ── PROFILE ── */}
      {subTab === "profile" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {/* User card */}
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="Account" th={th}/>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:10, marginBottom:16 }}>
              <div style={{ width:48, height:48, borderRadius:14, background:"linear-gradient(135deg,#3b5bdb,#7048e8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>
                💎
              </div>
              <div>
                <div style={{ fontSize:14, fontWeight:700, color:th.tx }}>{profileName || "Paulus"}</div>
                <div style={{ fontSize:11, color:th.tx3 }}>{user?.email}</div>
              </div>
            </div>
            <F label="Display Name" th={th}>
              <Input value={profileName} onChange={e => setProfileName(e.target.value)} placeholder="Your name" th={th}/>
            </F>
            <div style={{ marginTop:10 }}>
              <button className="btn btn-primary" onClick={updateProfile} disabled={saving} style={{ fontSize:12 }}>
                Save Name
              </button>
            </div>
          </div>

          {/* Password */}
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="Security" th={th}/>
            {!changingPass ? (
              <button className="btn btn-ghost" onClick={() => setChangingPass(true)}
                style={{ marginTop:10, fontSize:12, color:th.tx2, borderColor:th.bor }}>
                🔑 Change Password
              </button>
            ) : (
              <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:8 }}>
                <F label="New Password (min 8 chars)" th={th}>
                  <Input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="New password" th={th}/>
                </F>
                <div style={{ display:"flex", gap:8 }}>
                  <button className="btn btn-primary" onClick={changePassword} disabled={saving} style={{ fontSize:12 }}>Update Password</button>
                  <button className="btn btn-ghost" onClick={() => { setChangingPass(false); setNewPass(""); }}
                    style={{ fontSize:12, color:th.tx2, borderColor:th.bor }}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Sign out */}
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="Session" th={th}/>
            <button className="btn" onClick={signOut}
              style={{ marginTop:10, fontSize:12, padding:"8px 16px", color:"#e03131", border:`1px solid #ffc9c9`, borderRadius:8, background:"#fff5f5" }}>
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* ── EMAIL SYNC ── */}
      {subTab === "email" && <EmailSyncTab
        th={th} user={user}
        gmailToken={gmailToken} gmailLoaded={gmailLoaded}
        loadGmailToken={loadGmailToken}
        clientId={clientId} setClientId={setClientId}
        autoSync={autoSync} setAutoSync={setAutoSync}
        markRead={markRead} setMarkRead={setMarkRead}
        syncingNow={syncingNow}
        connectGmail={connectGmail} disconnectGmail={disconnectGmail} syncNow={syncNow}
      />}

      {/* ── FX RATES ── */}
      {subTab === "fx" && (
        <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
          <SectionHeader title="Exchange Rates to IDR" th={th}/>
          <div style={{ fontSize:11, color:th.tx3, marginBottom:12, marginTop:4 }}>
            Used to convert foreign currency transactions to IDR.
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {CURRENCIES.filter(c => c.code !== "IDR").map(c => (
              <div key={c.code} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:th.bg, borderRadius:10, border:`1px solid ${th.bor}` }}>
                <span style={{ fontSize:18 }}>{c.flag}</span>
                <span style={{ fontWeight:700, fontSize:13, color:th.tx, minWidth:36 }}>{c.code}</span>
                <span style={{ fontSize:11, color:th.tx3, flex:1 }}>1 {c.code} =</span>
                <input
                  type="number"
                  value={rates[c.code] || ""}
                  onChange={e => setRates(r => ({ ...r, [c.code]: Number(e.target.value) }))}
                  style={{
                    width:100, padding:"6px 8px", borderRadius:8,
                    border:`1px solid ${th.bor}`, background:th.sur,
                    color:th.tx, fontSize:12, fontFamily:"'JetBrains Mono',monospace",
                    textAlign:"right",
                  }}
                />
                <span style={{ fontSize:11, color:th.tx3 }}>IDR</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:14 }}>
            <button className="btn btn-primary" onClick={saveFxRates} disabled={saving} style={{ fontSize:12 }}>
              {saving ? "Saving…" : "💾 Save Rates"}
            </button>
          </div>
        </div>
      )}

      {/* ── RECURRING TEMPLATES ── */}
      {subTab === "recurring" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ textAlign:"right" }}>
            <button className="btn btn-primary" onClick={() => openRecurForm()} style={{ fontSize:12 }}>
              + Add Template
            </button>
          </div>
          {recurTemplates.length === 0
            ? <Empty icon="🔄" message="No recurring templates yet." th={th}/>
            : recurTemplates.map(t => {
                const txDef = TX_TYPES.find(x => x.id === t.type);
                return (
                  <div key={t.id} style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:13, padding:"12px 14px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:700, color:th.tx }}>{t.name}</div>
                        <div style={{ fontSize:11, color:th.tx3, marginTop:3 }}>
                          {t.frequency} · {txDef?.label || t.type}
                          {t.category && ` · ${t.category}`}
                          {t.entity && t.entity !== "Personal" && ` · ${t.entity}`}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div className="num" style={{ fontSize:14, fontWeight:800, color:txDef?.color || th.ac }}>{fmtIDR(Number(t.amount||0),true)}</div>
                        <div style={{ fontSize:10, color:th.tx3 }}>{t.currency || "IDR"}</div>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6, marginTop:10 }}>
                      <button onClick={() => openRecurForm(t)} className="btn btn-ghost"
                        style={{ fontSize:11, padding:"4px 10px", color:th.tx2, borderColor:th.bor }}>
                        ✏️ Edit
                      </button>
                      <button onClick={() => deleteRecur(t)} className="btn btn-ghost"
                        style={{ fontSize:11, padding:"4px 10px", color:"#e03131", borderColor:"#ffc9c9" }}>
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* ── MERCHANT MAPPINGS ── */}
      {subTab === "merchants" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:14 }}>
            <SectionHeader title="Merchant → Category Mappings" th={th}/>
            <div style={{ fontSize:11, color:th.tx3, marginTop:4, marginBottom:10 }}>
              These are learned from AI Smart Import. Edit to override.
            </div>
            {merchantMaps.length === 0
              ? <Empty icon="🏪" message="No merchant mappings yet. They appear after AI imports." th={th}/>
              : merchantMaps.map(m => {
                  const cat = EXPENSE_CATEGORIES.find(c => c.id === m.category_id);
                  return (
                    <div key={m.merchant_name} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 10px", background:th.bg, borderRadius:8, marginBottom:6, border:`1px solid ${th.bor}` }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:600, color:th.tx }}>{m.merchant_name}</div>
                        <div style={{ fontSize:10, color:th.tx3 }}>
                          {cat ? `${cat.icon} ${cat.label}` : m.category_label || m.category_id}
                        </div>
                      </div>
                      <button onClick={() => { setEditMerchant(m); setMerchantCat(m.category_id || ""); }}
                        className="btn btn-ghost" style={{ fontSize:10, padding:"4px 10px", color:th.tx2, borderColor:th.bor }}>
                        Edit
                      </button>
                    </div>
                  );
                })
            }
          </div>
        </div>
      )}

      {/* ── APPEARANCE ── */}
      {subTab === "appearance" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="Theme" th={th}/>
            <div style={{ display:"flex", gap:10, marginTop:12 }}>
              {[
                { label:"Light", dark:false, icon:"☀️" },
                { label:"Dark",  dark:true,  icon:"🌙" },
              ].map(opt => (
                <button key={opt.label} onClick={() => { if (isDark !== opt.dark) toggleDark(); }}
                  style={{
                    flex:1, padding:"14px", border:`2px solid ${isDark === opt.dark ? th.ac : th.bor}`,
                    borderRadius:12, background: isDark === opt.dark ? th.acBg : th.bg,
                    cursor:"pointer", textAlign:"center", transition:"all .15s",
                  }}>
                  <div style={{ fontSize:24, marginBottom:4 }}>{opt.icon}</div>
                  <div style={{ fontSize:12, fontWeight:700, color: isDark === opt.dark ? th.ac : th.tx3, fontFamily:"'Sora',sans-serif" }}>
                    {opt.label}
                  </div>
                  {isDark === opt.dark && (
                    <div style={{ fontSize:10, color:th.ac, marginTop:2 }}>Active</div>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
            <SectionHeader title="About" th={th}/>
            <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:6 }}>
              {[
                { label:"App",      value:"Paulus Finance" },
                { label:"Version",  value:`v${APP_VERSION}` },
                { label:"Build",    value:APP_BUILD },
                { label:"Database", value:"v5 (unified ledger)" },
                { label:"User ID",  value:user?.id?.slice(0,8) + "…" },
                { label:"Email",    value:user?.email },
              ].map(item => (
                <div key={item.label} style={{ display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:`1px solid ${th.bor}` }}>
                  <span style={{ fontSize:12, color:th.tx3 }}>{item.label}</span>
                  <span style={{ fontSize:12, color:th.tx, fontWeight:600 }}>{item.value}</span>
                </div>
              ))}
            </div>
            {/* What's new */}
            <div style={{ marginTop:12 }}>
              <button onClick={() => setWhatsNewOpen(o => !o)}
                style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:th.ac, fontFamily:"'Sora',sans-serif", fontWeight:600, padding:0 }}>
                {whatsNewOpen ? "▲" : "▼"} What's new in v{APP_VERSION}
              </button>
              {whatsNewOpen && (
                <div style={{ marginTop:8, padding:"10px 12px", background:th.acBg, borderRadius:9, fontSize:12, color:th.tx2, lineHeight:1.7 }}>
                  <div style={{ fontWeight:700, color:th.ac, marginBottom:4 }}>v{APP_VERSION} — {APP_BUILD}</div>
                  {[
                    "📧 Gmail auto-sync: connect once, transactions import automatically",
                    "🔍 Duplicate detection: smart matching prevents double-imports",
                    "🏪 Merchant learning: categories remembered per merchant",
                    "⏳ Pending review UI: approve, edit or skip each email transaction",
                    "📊 Version indicator in sidebar and settings",
                    "🔢 Unified ledger v5 with full double-entry accounting",
                  ].map((item, i) => <div key={i}>• {item}</div>)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── RECURRING FORM MODAL ── */}
      {showRecurForm && (
        <Overlay onClose={() => { setShowRecurForm(false); setEditRecur(null); }} th={th}
          title={editRecur ? "Edit Template" : "New Recurring Template"}>
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <F label="Name" th={th} required>
              <Input value={recurForm.name} onChange={e => setRecurForm(f => ({ ...f, name:e.target.value }))} placeholder="e.g. Netflix subscription" th={th}/>
            </F>
            <R2>
              <F label="Type" th={th}>
                <Select value={recurForm.type} onChange={e => setRecurForm(f => ({ ...f, type:e.target.value }))} th={th}>
                  {expenseTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              </F>
              <F label="Frequency" th={th}>
                <Select value={recurForm.frequency} onChange={e => setRecurForm(f => ({ ...f, frequency:e.target.value }))} th={th}>
                  {FREQUENCIES.map(fr => <option key={fr} value={fr}>{fr}</option>)}
                </Select>
              </F>
            </R2>
            <R2>
              <F label="Amount" th={th} required>
                <Input type="number" value={recurForm.amount} onChange={e => setRecurForm(f => ({ ...f, amount:e.target.value }))} placeholder="0" th={th} style={{ fontFamily:"'JetBrains Mono',monospace" }}/>
              </F>
              <F label="Currency" th={th}>
                <Select value={recurForm.currency} onChange={e => setRecurForm(f => ({ ...f, currency:e.target.value }))} th={th}>
                  {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.code}</option>)}
                </Select>
              </F>
            </R2>
            <R2>
              <F label="Category" th={th}>
                <Select value={recurForm.category} onChange={e => setRecurForm(f => ({ ...f, category:e.target.value }))} th={th}>
                  <option value="">None</option>
                  {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                </Select>
              </F>
              <F label="Entity" th={th}>
                <Select value={recurForm.entity} onChange={e => setRecurForm(f => ({ ...f, entity:e.target.value }))} th={th}>
                  {ENTITIES.map(e => <option key={e} value={e}>{e}</option>)}
                </Select>
              </F>
            </R2>
            <F label="Notes" th={th}>
              <Input value={recurForm.notes} onChange={e => setRecurForm(f => ({ ...f, notes:e.target.value }))} placeholder="Optional" th={th}/>
            </F>
            <BtnRow onCancel={() => { setShowRecurForm(false); setEditRecur(null); }} onOk={saveRecur}
              label={editRecur ? "Update" : "Create Template"} th={th} saving={saving}/>
          </div>
        </Overlay>
      )}

      {/* ── MERCHANT EDIT MODAL ── */}
      {editMerchant && (
        <Overlay onClose={() => setEditMerchant(null)} th={th} title="Edit Merchant Mapping" sub={editMerchant.merchant_name}>
          <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
            <F label="Category" th={th}>
              <Select value={merchantCat} onChange={e => setMerchantCat(e.target.value)} th={th}>
                <option value="">Select category…</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </Select>
            </F>
            <BtnRow onCancel={() => setEditMerchant(null)} onOk={saveMerchantCat} label="Save Mapping" th={th} saving={saving}/>
          </div>
        </Overlay>
      )}
    </div>
  );
}

// ─── EMAIL SYNC TAB ───────────────────────────────────────────
const SETUP_STEPS = [
  { n:1, label:'Go to console.cloud.google.com → Create project "Paulus Finance"' },
  { n:2, label:"Enable Gmail API (APIs & Services → Library)" },
  { n:3, label:"OAuth consent screen → External · Scope: gmail.readonly (read-only)" },
  { n:4, label:"Create OAuth credentials → Web application" },
  { n:5, label:"Add Authorized redirect URI: [SUPABASE_URL]/functions/v1/gmail-oauth" },
  { n:6, label:"Copy Client ID and paste below" },
  { n:7, label:"Click Connect Gmail → authorize → done" },
];

function EmailSyncTab({ th, user, gmailToken, gmailLoaded, loadGmailToken,
  clientId, setClientId, autoSync, setAutoSync, markRead, setMarkRead,
  syncingNow, connectGmail, disconnectGmail, syncNow }) {

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || "[SUPABASE_URL]";
  const redirectUri = `${supabaseUrl}/functions/v1/gmail-oauth`;
  const isConnected = !!gmailToken;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {/* Status card */}
      <div style={{ background:th.sur, border:`1px solid ${isConnected?"#b2f2e8":"#ffd43b"}`, borderRadius:14, padding:16 }}>
        <SectionHeader title={isConnected ? "✅ Gmail Connected" : "📧 Gmail Not Connected"} th={th}/>
        {isConnected ? (
          <div style={{ marginTop:10 }}>
            <div style={{ fontSize:13, color:th.tx, fontWeight:600, marginBottom:4 }}>{gmailToken.gmail_email || user?.email}</div>
            {gmailToken.last_sync && (
              <div style={{ fontSize:11, color:th.tx3, marginBottom:8 }}>
                Last sync: {new Date(gmailToken.last_sync).toLocaleString()}
              </div>
            )}
            <div style={{ display:"flex", gap:8, marginTop:10 }}>
              <button className="btn btn-primary" onClick={syncNow} disabled={syncingNow}
                style={{ fontSize:12 }}>
                {syncingNow ? "Syncing…" : "🔄 Sync Now"}
              </button>
              <button className="btn btn-ghost" onClick={disconnectGmail}
                style={{ fontSize:12, color:"#e03131", borderColor:"#ffc9c9" }}>
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop:10, fontSize:12, color:th.tx3 }}>
            Connect your Gmail to automatically import bank transaction notifications.
            Only <strong>gmail.readonly</strong> access — cannot send or delete emails.
          </div>
        )}
      </div>

      {/* Setup guide (if not connected) */}
      {!isConnected && (
        <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
          <SectionHeader title="Setup Guide" th={th}/>
          <div style={{ marginTop:10, display:"flex", flexDirection:"column", gap:8 }}>
            {SETUP_STEPS.map(step => (
              <div key={step.n} style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
                <div style={{ width:22, height:22, borderRadius:"50%", background:th.acBg, border:`1px solid ${th.ac}44`,
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:800, color:th.ac, flexShrink:0 }}>
                  {step.n}
                </div>
                <div style={{ fontSize:12, color:th.tx2, lineHeight:1.6 }}>{step.label}</div>
              </div>
            ))}
          </div>

          {/* Redirect URI copy */}
          <div style={{ marginTop:14, padding:"8px 12px", background:th.bg, borderRadius:9, border:`1px solid ${th.bor}` }}>
            <div style={{ fontSize:10, color:th.tx3, marginBottom:4 }}>Authorized redirect URI (copy this exactly):</div>
            <div style={{ fontSize:11, fontFamily:"'JetBrains Mono',monospace", color:th.ac, wordBreak:"break-all" }}>{redirectUri}</div>
          </div>

          {/* Client ID input + connect */}
          <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8 }}>
            <F label="Google Client ID" th={th} required>
              <Input value={clientId} onChange={e => setClientId(e.target.value)}
                placeholder="123456789-abc...apps.googleusercontent.com" th={th}/>
            </F>
            <button className="btn btn-primary" onClick={connectGmail} style={{ fontSize:13 }}>
              Connect Gmail →
            </button>
          </div>
        </div>
      )}

      {/* Sync preferences */}
      <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
        <SectionHeader title="Sync Preferences" th={th}/>
        <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:10 }}>
          {[
            { label:"Auto-sync every 15 minutes", value:autoSync, setter:setAutoSync },
            { label:"Mark emails as read after sync", value:markRead, setter:setMarkRead },
          ].map(pref => (
            <div key={pref.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:12, color:th.tx2 }}>{pref.label}</span>
              <button onClick={() => pref.setter(v => !v)}
                style={{ width:44, height:24, borderRadius:12, border:"none", cursor:"pointer",
                  background: pref.value ? th.ac : th.bor,
                  transition:"background .2s", position:"relative" }}>
                <div style={{ width:18, height:18, borderRadius:"50%", background:"#fff",
                  position:"absolute", top:3, left: pref.value ? 23 : 3, transition:"left .2s",
                  boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop:10, padding:"8px 12px", background:th.bg, borderRadius:9, fontSize:11, color:th.tx3 }}>
          Auto-sync requires Supabase cron schedule set to <code>*/15 * * * *</code> on the <strong>gmail-sync</strong> edge function.
        </div>
      </div>

      {/* Bank senders info */}
      <div style={{ background:th.sur, border:`1px solid ${th.bor}`, borderRadius:14, padding:16 }}>
        <SectionHeader title="Monitored Bank Senders" th={th}/>
        <div style={{ marginTop:8, fontSize:11, color:th.tx3, lineHeight:1.8 }}>
          {[
            "BCA: info@klikbca.com, notification@bca.co.id",
            "Mandiri: notification@bankmandiri.co.id",
            "BNI: bni@bni.co.id",
            "CIMB: notification@cimbniaga.co.id",
            "Jenius: hello@jenius.com",
            "SeaBank: noreply@sea.com",
            "GoPay: noreply@gojek.com",
          ].map((s, i) => <div key={i} style={{ padding:"3px 0", borderBottom:`1px solid ${th.bor}` }}>✉️ {s}</div>)}
          <div style={{ marginTop:6, color:th.tx3 }}>+ OVO, DANA, ShopeePay, BRI</div>
        </div>
      </div>
    </div>
  );
}
