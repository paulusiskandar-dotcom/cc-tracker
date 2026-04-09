import { useState, useRef } from "react";
import { ledgerApi, gmailApi, scanApi, merchantApi, getTxFromToTypes } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { LIGHT, DARK } from "../theme";
import { Button, EmptyState, Spinner, showToast } from "./shared/index";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../constants";

// ── TX types available in dropdown ────────────────────────────
const IMPORT_TX_TYPES = [
  { value: "expense",       label: "Expense" },
  { value: "income",        label: "Income" },
  { value: "transfer",      label: "Transfer" },
  { value: "pay_cc",        label: "Pay CC" },
  { value: "reimburse_out", label: "Reimburse Out" },
  { value: "reimburse_in",  label: "Reimburse In" },
  { value: "bank_charges",  label: "Bank Charges" },
  { value: "materai",       label: "Materai" },
  { value: "tax",           label: "Tax" },
  { value: "bank_interest", label: "Bank Interest" },
  { value: "cashback",      label: "Cashback" },
  { value: "give_loan",     label: "Give Loan" },
  { value: "collect_loan",  label: "Collect Loan" },
];

// ── Category visibility rules ─────────────────────────────────
const SHOW_EXPENSE_CAT  = new Set(["expense","bank_charges","materai","tax"]);
const SHOW_INCOME_CAT   = new Set(["income","bank_interest","cashback"]);
const NO_CAT            = new Set(["transfer","pay_cc","reimburse_out","reimburse_in","give_loan","collect_loan"]);
const REIMBURSE_TYPES   = new Set(["reimburse_out","reimburse_in"]);

// ── Amount color ──────────────────────────────────────────────
const amtColor = (type) => {
  if (["income","cashback","bank_interest","collect_loan","reimburse_in"].includes(type)) return "#059669";
  if (["transfer","pay_cc","give_loan"].includes(type))                                    return "#3b5bdb";
  return "#dc2626";
};

// ── Format date for display ───────────────────────────────────
const fmtDate = (d) => {
  try {
    const dt = new Date(d + "T00:00:00");
    return dt.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
  } catch { return d; }
};

// ── Inline select / input styles ──────────────────────────────
const inSel = (T) => ({
  fontSize: 12, padding: "4px 6px", border: `1px solid ${T.border}`,
  borderRadius: 6, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", width: "100%",
});
const inInp = (T) => ({
  fontSize: 12, padding: "4px 6px", border: `1px solid ${T.border}`,
  borderRadius: 6, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", width: "100%",
});

// ── Entity toggle ─────────────────────────────────────────────
const REIMBURSE_ENTITIES = ["Hamasa", "SDC", "Travelio"];

export default function AIImport({ user, accounts, ledger, onRefresh, setLedger, dark }) {
  const T = dark ? DARK : LIGHT;
  const fileRef = useRef();

  const [mode,         setMode]         = useState("scan");
  const [scanning,     setScanning]     = useState(false);
  const [results,      setResults]      = useState([]);
  const [selected,     setSelected]     = useState({});   // _id → bool
  const [skipped,      setSkipped]      = useState(new Set());
  const [expanded,     setExpanded]     = useState(new Set());
  const [importing,    setImporting]    = useState(false);
  const [importingId,  setImportingId]  = useState(null); // single-row import

  const [gmailPending, setGmailPending] = useState([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailLoaded,  setGmailLoaded]  = useState(false);

  const bankAccounts  = accounts.filter(a => a.type === "bank");
  const ccAccounts    = accounts.filter(a => a.type === "credit_card");
  const spendAccounts = [...bankAccounts, ...ccAccounts];

  // ── Update a single field on a result row ─────────────────
  const updateRow = (id, patch) =>
    setResults(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r));

  // ── File scan ──────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setScanning(true);
    setResults([]);
    setSelected({});
    setSkipped(new Set());
    setExpanded(new Set());
    try {
      const parsed = await scanApi.scan(user.id, file, { accounts });
      const items = (parsed || []).map((r, i) => {
        const txType = r.type || r.tx_type || "expense";
        // Default from/to based on type
        const defaultFrom = SHOW_EXPENSE_CAT.has(txType) || txType === "pay_cc" || txType === "reimburse_out"
          ? (spendAccounts[0]?.id || "") : "";
        const defaultTo = SHOW_INCOME_CAT.has(txType) || txType === "transfer" || txType === "reimburse_in"
          ? (bankAccounts[0]?.id || "") : "";
        // Category: use AI suggestion directly (ids match slugs)
        const catId = r.category || r.suggested_category || "other";
        return {
          _id:         i,
          tx_date:     r.date || r.tx_date || todayStr(),
          description: r.description || "",
          amount:      String(r.amount || r.amount_idr || ""),
          currency:    r.currency || "IDR",
          amount_idr:  String(r.amount_idr || r.amount || ""),
          tx_type:     txType,
          from_id:     r.from_account_id || defaultFrom,
          to_id:       r.to_account_id   || defaultTo,
          entity:      REIMBURSE_ENTITIES.includes(r.entity) ? r.entity : "Hamasa",
          category_id: NO_CAT.has(txType) ? null : catId,
          ai_category: catId, // remember AI suggestion for badge
          notes:       r.notes || "",
        };
      });
      setResults(items);
      const sel = {};
      items.forEach(r => { sel[r._id] = true; });
      setSelected(sel);
    } catch (e) {
      showToast(e.message || "Scan failed", "error");
    }
    setScanning(false);
  };

  // ── Build ledger entry from row ────────────────────────────
  const buildEntry = (r) => {
    const { from_type, to_type } = getTxFromToTypes(r.tx_type);
    return {
      tx_date:       r.tx_date,
      description:   r.description,
      amount:        Number(r.amount_idr || r.amount) || 0,
      currency:      r.currency || "IDR",
      amount_idr:    Number(r.amount_idr || r.amount) || 0,
      tx_type:       r.tx_type,
      from_type,
      to_type,
      from_id:       r.from_id || null,
      to_id:         r.to_id   || null,
      entity:        REIMBURSE_TYPES.has(r.tx_type) ? (r.entity || "Hamasa") : "Personal",
      category_id:   r.category_id || null,
      category_name: r.category_id || null,
      notes:         r.notes || "",
    };
  };

  // ── Import selected rows ───────────────────────────────────
  const importSelected = async () => {
    const toImport = results.filter(r => selected[r._id] && !skipped.has(r._id));
    if (!toImport.length) return showToast("Select at least one entry", "warning");
    setImporting(true);
    let ok = 0;
    for (const r of toImport) {
      try {
        const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
        if (created) {
          setLedger(prev => [created, ...prev]);
          ok++;
          if (r.description && r.category_id)
            merchantApi.upsert(user.id, r.description, r.category_id, r.category_id).catch(() => {});
        }
      } catch { /* continue */ }
    }
    await onRefresh();
    showToast(`Imported ${ok} of ${toImport.length} entries`);
    setResults([]);
    setSelected({});
    setImporting(false);
  };

  // ── Import single row ──────────────────────────────────────
  const importOne = async (r) => {
    setImportingId(r._id);
    try {
      const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
      if (created) {
        setLedger(prev => [created, ...prev]);
        if (r.description && r.category_id)
          merchantApi.upsert(user.id, r.description, r.category_id, r.category_id).catch(() => {});
        setResults(prev => prev.filter(x => x._id !== r._id));
        setSelected(s => { const ns = { ...s }; delete ns[r._id]; return ns; });
        showToast(`Imported: ${r.description}`);
      }
    } catch (e) { showToast(e.message, "error"); }
    setImportingId(null);
  };

  // ── Gmail ──────────────────────────────────────────────────
  const loadGmailPending = async () => {
    if (gmailLoaded) return;
    setGmailLoading(true);
    try {
      const data = await gmailApi.getPending(user.id);
      setGmailPending(data || []);
      setGmailLoaded(true);
    } catch { showToast("Could not load Gmail pending", "error"); }
    setGmailLoading(false);
  };

  const importGmailItem = async (item) => {
    try {
      const entry = {
        tx_date: item.date || todayStr(), description: item.description,
        amount: Number(item.amount), currency: "IDR", amount_idr: Number(item.amount),
        tx_type: "expense", from_type: "account", to_type: "expense",
        from_id: ccAccounts[0]?.id || spendAccounts[0]?.id || null,
        to_id: null, entity: "Personal", category_id: item.category || null,
        category_name: item.category || null, notes: item.email_subject || "",
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(prev => [created, ...prev]);
      setGmailPending(prev => prev.filter(p => p.id !== item.id));
      await gmailApi.markImported(user.id, item.id);
      showToast(`Imported: ${item.description}`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const skipGmailItem = async (item) => {
    try { await gmailApi.markSkipped(user.id, item.id); } catch {}
    setGmailPending(prev => prev.filter(p => p.id !== item.id));
  };

  // ── Summary counts ─────────────────────────────────────────
  const countNew      = results.filter(r => selected[r._id] && !skipped.has(r._id)).length;
  const countSkipped  = skipped.size;
  const allSelected   = results.length > 0 && results.every(r => selected[r._id] && !skipped.has(r._id));

  const toggleSelectAll = () => {
    const ns = {};
    results.forEach(r => { ns[r._id] = !allSelected; });
    setSelected(ns);
  };

  // ─────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── MODE TABS ── */}
      <div style={{ display: "flex", gap: 4 }}>
        {[
          { id: "scan",  label: "📷 Scan Document" },
          { id: "gmail", label: "✉️ Gmail Pending" },
        ].map(t => (
          <button key={t.id}
            onClick={() => { setMode(t.id); if (t.id === "gmail") loadGmailPending(); }}
            style={{
              padding: "7px 16px", borderRadius: 99, border: "none",
              cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "Figtree, sans-serif",
              background: mode === t.id ? T.text : T.sur2,
              color:      mode === t.id ? T.darkText : T.text2,
              transition: "background .15s, color .15s",
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── SCAN TAB ── */}
      {mode === "scan" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            style={{
              border: `2px dashed ${T.border}`, borderRadius: 16, padding: "28px 24px",
              textAlign: "center", cursor: "pointer", background: T.sur2,
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 6 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>
              Drop receipt, invoice, or bank statement
            </div>
            <div style={{ fontSize: 12, color: T.text3 }}>
              JPG · PNG · PDF — AI extracts all transactions automatically
            </div>
            <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: "none" }}
              onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ""; }} />
            {!scanning
              ? <div style={{ marginTop: 12 }}><Button variant="primary" size="sm">Choose File</Button></div>
              : <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: T.text2 }}>
                  <Spinner size={16} /> Scanning with AI…
                </div>
            }
          </div>

          {/* ── RESULTS ── */}
          {results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

              {/* Header summary */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", gap: 8,
              }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#059669" }}>
                    ✅ {countNew} new
                  </span>
                  {countSkipped > 0 && (
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#9ca3af" }}>
                      🔄 {countSkipped} skipped
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={toggleSelectAll}>
                    {allSelected ? "Deselect All" : "☑ Select All"}
                  </Button>
                  <Button variant="primary" size="sm" busy={importing} onClick={importSelected}>
                    ✓ Import {countNew} Selected
                  </Button>
                </div>
              </div>

              {/* Row list */}
              {results.map((r) => {
                const isSkipped  = skipped.has(r._id);
                const isSelected = !!selected[r._id];
                const isExpanded = expanded.has(r._id);
                const color      = amtColor(r.tx_type);

                return (
                  <div key={r._id} style={{
                    border: `1.5px solid ${isSkipped ? T.border : isSelected ? "#3b5bdb44" : T.border}`,
                    borderRadius: 12, background: T.surface,
                    opacity: isSkipped ? 0.45 : 1,
                    transition: "opacity .15s",
                  }}>
                    {/* ── COLLAPSED ROW ── */}
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "24px 80px 1fr 90px auto 80px auto",
                      gap: 8, alignItems: "center", padding: "10px 12px",
                    }}>
                      {/* ☑ */}
                      <input type="checkbox" checked={isSelected && !isSkipped}
                        onChange={e => setSelected(s => ({ ...s, [r._id]: e.target.checked }))}
                        disabled={isSkipped}
                        style={{ accentColor: "#3b5bdb", width: 15, height: 15 }} />

                      {/* Date */}
                      <div style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
                        {fmtDate(r.tx_date)}
                      </div>

                      {/* Description */}
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.description || "—"}
                        {r.ai_category && !NO_CAT.has(r.tx_type) && (
                          <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, background: "#dbeafe", color: "#3b5bdb", padding: "1px 4px", borderRadius: 4, verticalAlign: "middle", fontFamily: "Figtree, sans-serif" }}>
                            AI
                          </span>
                        )}
                      </div>

                      {/* Type badge */}
                      <div style={{ fontSize: 10, fontWeight: 700, color, fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
                        {r.tx_type.replace("_", " ")}
                      </div>

                      {/* Category (collapsed preview) */}
                      <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
                        {!NO_CAT.has(r.tx_type) && r.category_id ? (() => {
                          const cats = SHOW_INCOME_CAT.has(r.tx_type) ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES;
                          const cat = cats.find(c => c.id === r.category_id);
                          return cat ? `${cat.icon || ""} ${cat.label}` : r.category_id;
                        })() : ""}
                      </div>

                      {/* Amount */}
                      <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "Figtree, sans-serif", textAlign: "right", whiteSpace: "nowrap" }}>
                        {fmtIDR(Number(r.amount_idr || r.amount || 0), true)}
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <button
                          onClick={() => setExpanded(s => { const ns = new Set(s); ns.has(r._id) ? ns.delete(r._id) : ns.add(r._id); return ns; })}
                          style={ACT_BTN} title="Edit">✏️</button>
                        <button
                          onClick={() => importOne(r)}
                          disabled={isSkipped || importingId === r._id}
                          style={{ ...ACT_BTN, background: "#dcfce7", color: "#059669" }} title="Import">
                          {importingId === r._id ? "…" : "✓"}
                        </button>
                        <button
                          onClick={() => {
                            setSkipped(s => { const ns = new Set(s); ns.has(r._id) ? ns.delete(r._id) : ns.add(r._id); return ns; });
                            setSelected(s => ({ ...s, [r._id]: false }));
                          }}
                          style={{ ...ACT_BTN, color: isSkipped ? "#059669" : "#9ca3af" }} title={isSkipped ? "Restore" : "Skip"}>
                          {isSkipped ? "↩" : "✕"}
                        </button>
                      </div>
                    </div>

                    {/* ── EXPANDED INLINE EDIT ── */}
                    {isExpanded && (
                      <div style={{
                        borderTop: `1px solid ${T.border}`, padding: "12px 14px",
                        display: "flex", flexDirection: "column", gap: 10,
                        background: T.sur2, borderRadius: "0 0 10px 10px",
                      }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>

                          {/* Description */}
                          <div style={{ flex: "2 1 180px" }}>
                            <label style={LBL}>Description</label>
                            <input style={inInp(T)} value={r.description}
                              onChange={e => updateRow(r._id, { description: e.target.value })} />
                          </div>

                          {/* Type */}
                          <div style={{ flex: "1 1 120px" }}>
                            <label style={LBL}>Type</label>
                            <select style={inSel(T)} value={r.tx_type}
                              onChange={e => {
                                const t = e.target.value;
                                updateRow(r._id, {
                                  tx_type:     t,
                                  category_id: NO_CAT.has(t) ? null : r.category_id,
                                });
                              }}>
                              {IMPORT_TX_TYPES.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          </div>

                          {/* Amount */}
                          <div style={{ flex: "1 1 110px" }}>
                            <label style={LBL}>Amount (IDR)</label>
                            <input style={{ ...inInp(T), color }} type="number"
                              value={r.amount_idr || r.amount || ""}
                              onChange={e => updateRow(r._id, { amount_idr: e.target.value, amount: e.target.value })} />
                          </div>
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                          {/* Category */}
                          {!NO_CAT.has(r.tx_type) && (
                            <div style={{ flex: "1 1 160px" }}>
                              <label style={LBL}>
                                Category
                                {r.ai_category && r.ai_category === r.category_id && (
                                  <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, background: "#dbeafe", color: "#3b5bdb", padding: "1px 4px", borderRadius: 4 }}>AI</span>
                                )}
                              </label>
                              <select style={inSel(T)} value={r.category_id || ""}
                                onChange={e => updateRow(r._id, { category_id: e.target.value })}>
                                {(SHOW_INCOME_CAT.has(r.tx_type) ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES).map(c => (
                                  <option key={c.id} value={c.id}>{c.icon ? `${c.icon} ` : ""}{c.label}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Account selectors — vary by type */}
                          <AccountSelectors r={r} updateRow={updateRow} T={T}
                            bankAccounts={bankAccounts} ccAccounts={ccAccounts} spendAccounts={spendAccounts} />

                          {/* Entity — reimburse only */}
                          {REIMBURSE_TYPES.has(r.tx_type) && (
                            <div style={{ flex: "1 1 160px" }}>
                              <label style={LBL}>Entity</label>
                              <div style={{ display: "flex", gap: 4 }}>
                                {REIMBURSE_ENTITIES.map(en => (
                                  <button key={en}
                                    onClick={() => updateRow(r._id, { entity: en })}
                                    style={{
                                      padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                                      border: `1.5px solid ${r.entity === en ? "#3b5bdb" : T.border}`,
                                      background: r.entity === en ? "#eff6ff" : T.surface,
                                      color: r.entity === en ? "#3b5bdb" : T.text2,
                                      cursor: "pointer", fontFamily: "Figtree, sans-serif",
                                    }}>
                                    {en}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Notes */}
                        <div>
                          <label style={LBL}>Notes (optional)</label>
                          <input style={inInp(T)} value={r.notes || ""}
                            onChange={e => updateRow(r._id, { notes: e.target.value })}
                            placeholder="Any extra details" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── GMAIL TAB ── */}
      {mode === "gmail" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {gmailLoading ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <Spinner size={24} />
              <div style={{ fontSize: 12, color: T.text3, marginTop: 8 }}>Loading Gmail…</div>
            </div>
          ) : gmailPending.length === 0 ? (
            <EmptyState icon="✉️" message="No pending Gmail transactions. Connect Gmail in Settings → Email Sync." />
          ) : gmailPending.map(item => (
            <div key={item.id} style={{
              background: T.surface, border: `1px solid ${T.border}`,
              borderRadius: 14, padding: "14px 16px",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>{item.description}</div>
                  <div style={{ fontSize: 11, color: T.text3, marginTop: 2, fontFamily: "Figtree, sans-serif" }}>
                    {item.date} · {item.merchant || "—"}
                  </div>
                  {item.email_subject && (
                    <div style={{ fontSize: 10, color: T.text3, marginTop: 2, fontStyle: "italic", fontFamily: "Figtree, sans-serif" }}>
                      {item.email_subject}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#dc2626", flexShrink: 0, marginLeft: 12, fontFamily: "Figtree, sans-serif" }}>
                  {fmtIDR(Number(item.amount || 0), true)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button variant="primary"   size="sm" onClick={() => importGmailItem(item)}>✓ Import</Button>
                <Button variant="secondary" size="sm" onClick={() => skipGmailItem(item)}>Skip</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Account selectors component ────────────────────────────────
function AccountSelectors({ r, updateRow, T, bankAccounts, ccAccounts, spendAccounts }) {
  const t = r.tx_type;
  const sel = inSel(T);

  if (t === "pay_cc") return (
    <>
      <div style={{ flex: "1 1 140px" }}>
        <label style={LBL}>From Bank</label>
        <select style={sel} value={r.from_id || ""}
          onChange={e => updateRow(r._id, { from_id: e.target.value })}>
          <option value="">— Select —</option>
          {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div style={{ flex: "1 1 140px" }}>
        <label style={LBL}>To CC</label>
        <select style={sel} value={r.to_id || ""}
          onChange={e => updateRow(r._id, { to_id: e.target.value })}>
          <option value="">— Select —</option>
          {ccAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
    </>
  );

  if (t === "transfer") return (
    <>
      <div style={{ flex: "1 1 140px" }}>
        <label style={LBL}>From</label>
        <select style={sel} value={r.from_id || ""}
          onChange={e => updateRow(r._id, { from_id: e.target.value })}>
          <option value="">— Select —</option>
          {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
      <div style={{ flex: "1 1 140px" }}>
        <label style={LBL}>To</label>
        <select style={sel} value={r.to_id || ""}
          onChange={e => updateRow(r._id, { to_id: e.target.value })}>
          <option value="">— Select —</option>
          {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>
    </>
  );

  if (["income","bank_interest","cashback","collect_loan","reimburse_in"].includes(t)) return (
    <div style={{ flex: "1 1 160px" }}>
      <label style={LBL}>To Account</label>
      <select style={sel} value={r.to_id || ""}
        onChange={e => updateRow(r._id, { to_id: e.target.value })}>
        <option value="">— Select —</option>
        {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </div>
  );

  // expense, bank_charges, materai, tax, reimburse_out, give_loan
  return (
    <div style={{ flex: "1 1 160px" }}>
      <label style={LBL}>From Account</label>
      <select style={sel} value={r.from_id || ""}
        onChange={e => updateRow(r._id, { from_id: e.target.value })}>
        <option value="">— Select —</option>
        {spendAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────
const ACT_BTN = {
  width: 26, height: 26, borderRadius: 7, border: "1px solid #e5e7eb",
  background: "#f9fafb", cursor: "pointer", fontSize: 11, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif",
};

const LBL = {
  display: "block", fontSize: 10, fontWeight: 700, color: "#9ca3af",
  marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.04em",
  fontFamily: "Figtree, sans-serif",
};
