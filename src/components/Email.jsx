import { useState, useEffect } from "react";
import { gmailApi, settingsApi, ledgerApi, getTxFromToTypes, flattenEmailSync, loanPaymentsApi, installmentsApi } from "../api";
import { undoManager } from "../lib/undoManager";
import { merchantRules } from "../lib/merchantRules";
import { todayStr, resolveCategoryIds } from "../utils";
import { LIGHT, DARK } from "../theme";
import {
  Button, EmptyState, showToast,
  SectionHeader, Field, Input, FormRow,
  TxHorizontal,
} from "./shared/index";
import ProgressIndicator from "./shared/ProgressIndicator";
import { useImportDraft } from "../lib/useImportDraft";
import DraftBanner from "./shared/DraftBanner";
import { detectTransferPairs } from "../lib/transferDetection";

// Convert a pendingSync item to the local editable row format
const syncToRow = (s) => ({
  _id:           s.id,
  email_sync_id: s.email_sync_id || s.id,
  tx_index:      s.tx_index ?? 0,
  ai_raw_result: s.ai_raw_result,
  subject:       s.subject,
  received_at:   s.received_at,
  tx_date:       s.transaction_date || s.received_at?.slice(0, 10) || todayStr(),
  description:   s.merchant_name || s.subject || "",
  amount:        String(Number(s.amount || 0)),
  currency:      s.currency || "IDR",
  amount_idr:    String(Number(s.amount_idr || s.amount || 0)),
  tx_type:       s.tx_type || "expense",
  from_id:       s.matched_account_id || "",
  to_id:         s.to_account_id || "",
  entity:        s.entity || "",
  category_id:   null,
  suggested_category_label: s.suggested_category_label || "",
  notes:         "",
  status:        "new",
});

const ACT_BTN = (extra = {}) => ({
  width: 26, height: 26, borderRadius: 6, border: "1px solid #e5e7eb",
  background: "#f9fafb", cursor: "pointer", fontSize: 12, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif", padding: 0, flexShrink: 0, ...extra,
});

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
  user, accounts, setAccounts, categories, ledger, setLedger,
  pendingSyncs, setPendingSyncs,
  dark, onRefresh,
  employeeLoans = [],
  merchantMaps = [],
  initialTab = "pending",
}) {
  const T = dark ? DARK : LIGHT;
  const [tab, setTab] = useState(initialTab);

  useEffect(() => { setTab(initialTab); }, [initialTab]);

  // ── Email Sync state ────────────────────────────────────────────
  const [gmailToken,    setGmailToken]    = useState(null);
  const [gmailLoaded,   setGmailLoaded]   = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
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
      setNeedsReconnect(t?.needs_reconnect || false);
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
        if (t) { setGmailToken(t); setNeedsReconnect(t.needs_reconnect || false); showToast("Gmail connected!"); }
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
          setAccounts={setAccounts}
          categories={categories}
          user={user}
          ledger={ledger}
          setLedger={setLedger}
          onRefresh={onRefresh}
          dark={dark}
          T={T}
          employeeLoans={employeeLoans}
          merchantMaps={merchantMaps}
        />
      )}

      {/* ══ EMAIL SYNC TAB ══ */}
      {tab === "sync" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Reconnect banner — shown when refresh_token is invalid */}
          {needsReconnect && (
            <div style={{
              background: "#FCEBEB", border: "1px solid #F7C1C1", borderRadius: 10,
              padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: 12, color: "#791F1F", fontWeight: 500 }}>
                Gmail authentication expired. Auto-sync has stopped.
              </span>
              <button onClick={connectGmail}
                style={{
                  fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 6,
                  border: "none", background: "#A32D2D", color: "#fff", cursor: "pointer",
                  fontFamily: "Figtree, sans-serif", flexShrink: 0, marginLeft: 12,
                }}>
                Reconnect Gmail
              </button>
            </div>
          )}

          {/* Status card */}
          <div style={{ ...card, borderColor: gmailToken ? (needsReconnect ? "#DC2626" : "#059669") : T.border }}>
            <SectionHeader title={gmailToken ? (needsReconnect ? "⚠ Gmail Auth Expired" : "✅ Gmail Connected") : "📧 Gmail Not Connected"} />
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
                  display: "flex", gap: 8, padding: "4px 0", borderBottom: `1px solid ${T.border}`,
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
                    <div key={i} style={{ display: "flex", gap: 8, padding: "7px 0", borderBottom: `1px solid ${T.border}`, fontSize: 11, color: T.text2 }}>
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

// ─── EMAIL PENDING TAB ────────────────────────────────────────────
const GMAIL_NO_CAT = new Set(["transfer","pay_cc","give_loan","collect_loan","fx_exchange","reimburse_in","reimburse_out","buy_asset","sell_asset","pay_liability"]);

function EmailPendingTab({ pendingSyncs, setPendingSyncs, accounts, setAccounts, categories, user, ledger, setLedger, onRefresh, dark, T: theme, employeeLoans = [], merchantMaps = [] }) {
  const T = theme || LIGHT;

  // Local editable rows (mirrors pendingSyncs but editable)
  const [rows,         setRows]         = useState(() => (pendingSyncs || []).map(syncToRow));
  const [selected,     setSelected]     = useState(() => Object.fromEntries((pendingSyncs || []).map(s => [s.id, true])));
  const [importing,    setImporting]    = useState(false);
  const [processedCount, setProcessedCount] = useState(0);

  const draft = useImportDraft({
    user,
    source: "gmail",
    state: rows.length > 0 ? { rows, selected } : null,
    onRestore: (s) => {
      if (s.rows) setRows(s.rows);
      if (s.selected) setSelected(s.selected);
    },
  });
  const [failedRows,   setFailedRows]   = useState(null);
  const [loadingFailed,setLoadingFailed]= useState(false);
  const [reprocessing, setReprocessing] = useState(new Set());

  const applyMerchantRule = (row) => {
    if (GMAIL_NO_CAT.has(row.tx_type) || !merchantMaps.length) return row;
    const suggestion = merchantRules.apply(row.description, row.description, merchantMaps);
    if (!suggestion) return row;
    return {
      ...row,
      learned_cat:   suggestion,
      category_id:   suggestion.category_id   || row.category_id,
      category_name: suggestion.category_name || row.category_name,
    };
  };

  // Sync rows when pendingSyncs changes from parent (new sync, refresh)
  useEffect(() => {
    setRows(prev => {
      const prevMap = new Map(prev.map(r => [r._id, r]));
      const built = (pendingSyncs || []).map(s => {
        if (prevMap.has(s.id)) return prevMap.get(s.id);
        return applyMerchantRule(syncToRow(s));
      });
      return enrichTransfers(built);
    });
    setSelected(prev => {
      const next = {};
      (pendingSyncs || []).forEach(s => { next[s.id] = s.id in prev ? prev[s.id] : true; });
      return next;
    });
  }, [pendingSyncs]);

  const enrichTransfers = (items) => {
    const pairs = detectTransferPairs(items, accounts, ledger || []);
    return items.map(r => {
      const p = pairs.find(x => x.rowId === r._id || x.partnerRowId === r._id);
      return p ? { ...r, _transferPair: p } : r;
    });
  };

  const handleMergeTransfer = (rowId) => {
    setRows(prev => {
      const row = prev.find(r => r._id === rowId);
      if (!row?._transferPair) return prev;
      const { partnerRowId, fromId, toId } = row._transferPair;
      return prev
        .filter(r => r._id !== partnerRowId)
        .map(r => r._id === rowId
          ? { ...r, tx_type: "transfer", from_id: fromId || r.from_id, to_id: toId || r.to_id, category_id: null, _transferPair: undefined }
          : r
        );
    });
  };

  const updateRow = (id, patch) =>
    setRows(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r));

  const removeRow = (id) => {
    setRows(prev => prev.filter(r => r._id !== id));
    setSelected(prev => { const n = { ...prev }; delete n[id]; return n; });
    setPendingSyncs(p => p.filter(s => s.id !== id));
  };

  const buildEntry = (r) => {
    const desc   = r.description || r.subject || "Gmail transaction";
    const amount = Number(r.amount || 0);
    const amount_idr = Number(r.amount_idr || r.amount || 0);
    const notes  = r.notes || `Imported from Gmail: ${r.subject || ""}`;
    // collect_loan: from_id holds employee_loan_id; ledger from_id is null
    if (r.tx_type === "collect_loan") {
      return {
        tx_date: r.tx_date, description: desc, amount, currency: r.currency || "IDR", amount_idr,
        tx_type: "collect_loan", from_type: "employee_loan", to_type: "account",
        from_id: null, to_id: r.to_id || null,
        employee_loan_id: r.employee_loan_id || r.from_id || null,
        entity: "Personal", category_id: null, category_name: null,
        notes, source: "gmail", email_sync_id: r.email_sync_id || r._id,
      };
    }
    const { from_type, to_type } = getTxFromToTypes(r.tx_type);
    // Resolve category slug (from user selection or AI suggestion) to DB UUID + label
    // reimburse_out never has a category
    const isReimburseOut = r.tx_type === "reimburse_out";
    const catSlug = r.category_id || r.suggested_category_label || null;
    const { category_id, category_name } = isReimburseOut
      ? { category_id: null, category_name: null }
      : resolveCategoryIds(catSlug, categories);
    return {
      tx_date:       r.tx_date,
      description:   desc,
      amount,
      currency:      r.currency || "IDR",
      amount_idr,
      tx_type:       r.tx_type, from_type, to_type,
      from_id:       r.from_id || null,
      to_id:         r.to_id   || null,
      category_id,
      category_name,
      entity:        r.entity || "Personal",
      is_reimburse:  r.tx_type === "reimburse_out" || r.tx_type === "reimburse_in",
      notes,
      source:        "gmail",
      email_sync_id: r.email_sync_id || r._id,
    };
  };

  const confirm = async (r) => {
    try {
      const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
      setLedger(p => [created, ...p]);
      if (r.tx_type === "collect_loan" && (r.employee_loan_id || r.from_id)) {
        loanPaymentsApi.recordAndIncrement(user.id, {
          loanId: r.employee_loan_id || r.from_id, payDate: r.tx_date,
          amount: Number(r.amount_idr || r.amount || 0),
          notes: r.description || "Collected via import",
        }).catch(e => console.error("[collect_loan payment]", e));
      }
      if (r._cicilan && r._cicilanMonths >= 2 && created?.id) {
        installmentsApi.createFromImport(user.id, {
          ledgerId: created.id, description: r.description || "", accountId: r.from_id,
          amount: Number(r.amount_idr || r.amount || 0), totalMonths: r._cicilanMonths,
          paidMonths: r._cicilanKe || 1,
          currency: r.currency || "IDR", txDate: r.tx_date, categoryId: r.category_id || null,
        }).catch(e => console.error("[cicilan import]", e));
      }
      await gmailApi.updateSync(r.email_sync_id, { status: "confirmed" });
      removeRow(r._id);
      setProcessedCount(n => n + 1);
      showToast("Imported");
      onRefresh?.();
    } catch (e) { showToast(e.message, "error"); }
  };

  const skipById = async (id) => {
    const r = rows.find(x => x._id === id);
    if (!r) return;
    try {
      await gmailApi.updateSync(r.email_sync_id, { status: "skipped" });
      removeRow(id);
      setProcessedCount(n => n + 1);
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };

  const importAll = async (selectedRows) => {
    if (!selectedRows.length) return;
    setImporting(true);
    let count = 0;
    const newLedgerIds = [];
    for (const r of selectedRows) {
      try {
        const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
        if (created?.id) newLedgerIds.push(created.id);
        setLedger(p => [created, ...p]);
        if (r.tx_type === "collect_loan" && r.from_id) {
          loanPaymentsApi.recordAndIncrement(user.id, {
            loanId: r.from_id, payDate: r.tx_date,
            amount: Number(r.amount_idr || r.amount || 0),
            notes: r.description || "Collected via import",
          }).catch(e => console.error("[collect_loan payment]", e));
        }
        if (r._cicilan && r._cicilanMonths >= 2 && created?.id) {
          installmentsApi.createFromImport(user.id, {
            ledgerId: created.id, description: r.description || "", accountId: r.from_id,
            amount: Number(r.amount_idr || r.amount || 0), totalMonths: r._cicilanMonths,
            paidMonths: r._cicilanKe || 1,
            currency: r.currency || "IDR", txDate: r.tx_date, categoryId: r.category_id || null,
          }).catch(e => console.error("[cicilan import]", e));
        }
        await gmailApi.updateSync(r.email_sync_id, { status: "confirmed" });
        removeRow(r._id);
        count++;
      } catch (_) { /* skip failures */ }
    }
    setImporting(false);
    setProcessedCount(n => n + count);
    showToast(`${count} transaction${count !== 1 ? "s" : ""} imported`);
    if (newLedgerIds.length) undoManager.register({ type: "save_batch", ids: newLedgerIds, label: `Saved ${newLedgerIds.length} transaction${newLedgerIds.length !== 1 ? "s" : ""}` });
    draft.clearDraft();
    onRefresh?.();
  };

  const loadFailed = async () => {
    setLoadingFailed(true);
    try {
      const data = await gmailApi.getFailedPending(user.id);
      setFailedRows(data);
    } catch (e) { showToast(e.message, "error"); }
    setLoadingFailed(false);
  };

  const reprocessOne = async (row) => {
    setReprocessing(prev => new Set([...prev, row.id]));
    try {
      await gmailApi.reprocess(user.id, [row.id]);
      showToast("Re-processed — refreshing…");
      const updated = await gmailApi.getFailedPending(user.id);
      setFailedRows(updated);
      const pending = await gmailApi.getPending(user.id);
      setPendingSyncs(flattenEmailSync(pending));
    } catch (e) { showToast(e.message, "error"); }
    setReprocessing(prev => { const n = new Set(prev); n.delete(row.id); return n; });
  };

  const skipFailed = async (row) => {
    try {
      await gmailApi.updateSync(row.id, { status: "skipped" });
      setFailedRows(prev => prev.filter(r => r.id !== row.id));
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };

  if (!rows.length && failedRows === null) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <EmptyState icon="📧" title="No pending emails" message="Gmail sync will surface transactions here for review." />
      <button onClick={loadFailed} disabled={loadingFailed}
        style={{ fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "Figtree, sans-serif", alignSelf: "flex-start" }}>
        {loadingFailed ? "Loading…" : "Show failed extractions"}
      </button>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

      {/* Draft resume banner */}
      {draft.showBanner && rows.length === 0 && (
        <DraftBanner draftInfo={draft.draftInfo} onResume={draft.resume} onDiscard={draft.discard} />
      )}

      {/* ── Pending rows via shared component ── */}
      {(rows.length > 0 || processedCount > 0) && (
        <ProgressIndicator
          label="Email Sync"
          total={rows.length + processedCount}
          processed={processedCount}
          pending={rows.length}
        />
      )}
      {rows.length > 0 && (
        <TxHorizontal
          rows={rows}
          selected={selected}
          onUpdateRow={updateRow}
          onConfirmRow={confirm}
          onSkipRow={skipById}
          onConfirmAll={importAll}
          onToggleSelect={(id) => setSelected(s => ({ ...s, [id]: !s[id] }))}
          onToggleAll={() => setSelected(
            rows.length > 0 && rows.every(r => selected[r._id])
              ? {}
              : Object.fromEntries(rows.map(r => [r._id, true]))
          )}
          source="gmail"
          accounts={accounts}
          employeeLoans={employeeLoans}
          T={T}
          busy={importing}
          onMergeTransfer={handleMergeTransfer}
          onAccountCreated={newAcct => setAccounts?.(prev => [...prev, newAcct])}
          user={user}
        />
      )}

      {/* ── Failed extractions section ── */}
      <div style={{ marginTop: 4 }}>
        {failedRows === null ? (
          <button onClick={loadFailed} disabled={loadingFailed}
            style={{ fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "Figtree, sans-serif" }}>
            {loadingFailed ? "Loading…" : "Show failed extractions"}
          </button>
        ) : failedRows.length === 0 ? (
          <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>No failed extractions.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", fontFamily: "Figtree, sans-serif", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Failed extractions ({failedRows.length})
            </div>
            {failedRows.map(row => (
              <div key={row.id} style={{
                background: "#fff7ed", border: "1.5px solid #fed7aa",
                borderRadius: 10, padding: "10px 14px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#111827", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.subject || "(no subject)"}
                  </div>
                  <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginTop: 2 }}>
                    {row.sender_email} · {row.received_at?.slice(0, 10)}
                  </div>
                </div>
                <button
                  onClick={() => reprocessOne(row)}
                  disabled={reprocessing.has(row.id)}
                  style={ACT_BTN({ background: "#fff7ed", border: "1px solid #fed7aa", fontSize: 13, opacity: reprocessing.has(row.id) ? 0.5 : 1 })}
                  title="Re-process with AI">
                  {reprocessing.has(row.id) ? "…" : "🔄"}
                </button>
                <button onClick={() => skipFailed(row)}
                  style={ACT_BTN({ color: "#9ca3af" })}
                  title="Skip">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
