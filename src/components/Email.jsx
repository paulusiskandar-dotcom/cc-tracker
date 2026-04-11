import { useState, useEffect } from "react";
import { gmailApi, settingsApi, ledgerApi, getTxFromToTypes } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { LIGHT, DARK } from "../theme";
import {
  Button, EmptyState, showToast,
  SectionHeader, Field, Input, FormRow,
} from "./shared/index";

const SETUP_STEPS = [
  'Go to console.cloud.google.com → Create project "Paulus Finance"',
  "Enable Gmail API (APIs & Services → Library)",
  "OAuth consent screen → External · Scope: gmail.readonly",
  "Create OAuth credentials → Web application",
  `Add Authorized redirect URI: ${process.env.REACT_APP_SUPABASE_URL || "[SUPABASE_URL]"}/functions/v1/gmail-oauth`,
  "Copy Client ID and paste below",
  "Click Connect Gmail → authorize",
];

export default function Email({
  user, accounts, categories, ledger, setLedger,
  pendingSyncs, setPendingSyncs,
  dark, onRefresh,
  initialTab = "pending",
}) {
  const T = dark ? DARK : LIGHT;
  const [tab, setTab] = useState(initialTab);

  // Sync tab when parent navigates here again
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // ── Email Sync state ────────────────────────────────────────
  const [gmailToken,    setGmailToken]    = useState(null);
  const [gmailLoaded,   setGmailLoaded]   = useState(false);
  const [clientId,      setClientId]      = useState("");
  const [syncingNow,    setSyncingNow]    = useState(false);
  const [syncLog,       setSyncLog]       = useState([]);
  const [syncFromDate,  setSyncFromDate]  = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [syncToDate,    setSyncToDate]    = useState(() => new Date().toISOString().slice(0, 10));
  const [skippedRows,   setSkippedRows]   = useState([]);
  const [skippedLoaded, setSkippedLoaded] = useState(false);
  const [skippedLoading,setSkippedLoading]= useState(false);

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

  useEffect(() => {
    if (tab === "sync") loadGmailToken();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const card = {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 16, padding: "16px 18px",
  };

  const TABS_LIST = [
    { id: "pending", label: "✉️ Email Pending" },
    { id: "sync",    label: "🔄 Email Sync"    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── Tabs ── */}
      <div style={{ display: "flex", gap: 4 }}>
        {TABS_LIST.map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "7px 16px", borderRadius: 99, border: "none",
              cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "Figtree, sans-serif",
              background: tab === t.id ? T.text : T.sur2,
              color:      tab === t.id ? T.darkText : T.text2,
              transition: "background .15s, color .15s",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ EMAIL PENDING TAB ══ */}
      {tab === "pending" && (
        <EmailPendingTab
          pendingSyncs={pendingSyncs}
          setPendingSyncs={setPendingSyncs}
          accounts={accounts}
          categories={categories}
          user={user}
          ledger={ledger}
          setLedger={setLedger}
          onRefresh={onRefresh}
        />
      )}

      {/* ══ EMAIL SYNC TAB ══ */}
      {tab === "sync" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Status card */}
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

          {/* Manual sync (only when connected) */}
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

          {/* Sync history */}
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

          {/* Skipped transactions */}
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

          {/* Setup guide (when not connected) */}
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
    </div>
  );
}

// ─── EMAIL PENDING TAB ────────────────────────────────────────
function EmailPendingTab({ pendingSyncs, setPendingSyncs, accounts, categories, user, ledger, setLedger, onRefresh }) {
  const [checked,   setChecked]   = useState(() => new Set((pendingSyncs || []).map(s => s.id)));
  const [importing, setImporting] = useState(false);
  const [progress,  setProgress]  = useState({ done: 0, total: 0 });

  // Keep checked in sync when pendingSyncs changes (e.g. after a skip)
  useEffect(() => {
    setChecked(prev => {
      const ids = new Set((pendingSyncs || []).map(s => s.id));
      const next = new Set([...prev].filter(id => ids.has(id)));
      // Add newly arrived items
      (pendingSyncs || []).forEach(s => { if (!prev.has(s.id)) next.add(s.id); });
      return next;
    });
  }, [pendingSyncs]);

  if (!pendingSyncs?.length) return (
    <EmptyState icon="📧" title="No pending emails" message="Gmail sync will surface transactions here for review." />
  );

  const selectedSyncs = pendingSyncs.filter(s => checked.has(s.id));
  const allChecked    = selectedSyncs.length === pendingSyncs.length && pendingSyncs.length > 0;

  const buildEntry = (sync) => {
    const txType = sync.tx_type || "expense";
    const { from_type, to_type } = getTxFromToTypes(txType);
    const catMatch = categories.find(c =>
      c.name?.toLowerCase() === (sync.suggested_category_label || "").toLowerCase()
    );
    return {
      tx_date:       sync.transaction_date || sync.received_at?.slice(0, 10) || todayStr(),
      description:   sync.merchant_name || sync.subject || "Gmail transaction",
      amount:        Number(sync.amount || 0),
      currency:      sync.currency || "IDR",
      amount_idr:    Number(sync.amount_idr || sync.amount || 0),
      tx_type:       txType, from_type, to_type,
      from_id:       sync.matched_account_id || null,
      to_id:         null,
      category_id:   catMatch?.id || null,
      category_name: catMatch?.name || null,
      entity:        sync.entity || "Personal",
      notes:         `Imported from Gmail: ${sync.subject || ""}`,
    };
  };

  const removeOne = (id) => {
    setPendingSyncs(p => p.filter(s => s.id !== id));
    setChecked(prev => { const n = new Set(prev); n.delete(id); return n; });
  };

  const confirm = async (sync) => {
    try {
      const created = await ledgerApi.create(user.id, buildEntry(sync), accounts);
      setLedger(p => [created, ...p]);
      await gmailApi.updateSync(sync.id, { status: "confirmed" });
      removeOne(sync.id);
      showToast("Imported");
      onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
  };

  const skip = async (sync) => {
    try {
      await gmailApi.updateSync(sync.id, { status: "skipped" });
      removeOne(sync.id);
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };

  const importAll = async () => {
    const toImport = [...selectedSyncs];
    if (!toImport.length) return;
    setImporting(true);
    setProgress({ done: 0, total: toImport.length });
    let count = 0;
    for (const sync of toImport) {
      try {
        const created = await ledgerApi.create(user.id, buildEntry(sync), accounts);
        setLedger(p => [created, ...p]);
        await gmailApi.updateSync(sync.id, { status: "confirmed" });
        setPendingSyncs(p => p.filter(s => s.id !== sync.id));
        setChecked(prev => { const n = new Set(prev); n.delete(sync.id); return n; });
        count++;
        setProgress({ done: count, total: toImport.length });
      } catch (_) { /* skip failures, continue */ }
    }
    setImporting(false);
    showToast(`${count} transaction${count !== 1 ? "s" : ""} imported`);
    onRefresh?.();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Bulk action bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 14px", background: "#ffffff",
        border: "0.5px solid #e5e7eb", borderRadius: 12,
      }}>
        <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif", flex: 1 }}>
          {importing
            ? `${progress.done} of ${progress.total}…`
            : `${selectedSyncs.length} of ${pendingSyncs.length} selected`}
        </span>
        <button
          onClick={() => setChecked(allChecked ? new Set() : new Set(pendingSyncs.map(s => s.id)))}
          disabled={importing}
          style={{ height: 28, padding: "0 10px", border: "1px solid #e5e7eb", borderRadius: 7, cursor: "pointer", background: "#fff", color: "#6b7280", fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif" }}
        >
          {allChecked ? "Deselect All" : "Select All"}
        </button>
        <button
          onClick={importAll}
          disabled={importing || !selectedSyncs.length}
          style={{
            height: 28, padding: "0 12px", border: "none", borderRadius: 7,
            cursor: importing || !selectedSyncs.length ? "not-allowed" : "pointer",
            background: !importing && selectedSyncs.length ? "#111827" : "#e5e7eb",
            color:      !importing && selectedSyncs.length ? "#fff"     : "#9ca3af",
            fontSize: 11, fontWeight: 700, fontFamily: "Figtree, sans-serif",
          }}
        >
          {importing ? "Importing…" : "Confirm All ✓"}
        </button>
      </div>

      {/* Transaction rows */}
      {pendingSyncs.map(s => (
        <div key={s.id} style={{
          background: "#fef9ec", border: "1.5px solid #fde68a",
          borderRadius: 12, padding: "12px 14px",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <input
            type="checkbox"
            checked={checked.has(s.id)}
            onChange={() => setChecked(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
            disabled={importing}
            style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#111827", flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif" }}>
              {s.merchant_name || s.subject || "Gmail transaction"}
            </div>
            <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
              {s.transaction_date || s.received_at?.slice(0, 10)}
              {s.amount && ` · ${fmtIDR(s.amount)}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => confirm(s)} disabled={importing} style={{ ...BTN_CONFIRM, opacity: importing ? 0.5 : 1 }}>✓</button>
            <button onClick={() => skip(s)}    disabled={importing} style={{ ...BTN_SKIP,    opacity: importing ? 0.5 : 1 }}>Skip</button>
          </div>
        </div>
      ))}
    </div>
  );
}

const BTN_CONFIRM = {
  height: 28, padding: "0 10px", border: "none", borderRadius: 7,
  cursor: "pointer", background: "#111827", color: "#fff",
  fontSize: 11, fontWeight: 700, fontFamily: "Figtree, sans-serif",
};
const BTN_SKIP = {
  height: 28, padding: "0 10px", border: "1px solid #e5e7eb", borderRadius: 7,
  cursor: "pointer", background: "#fff", color: "#6b7280",
  fontSize: 11, fontWeight: 600, fontFamily: "Figtree, sans-serif",
};
