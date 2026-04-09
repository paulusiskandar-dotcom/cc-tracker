import { useState, useRef, useEffect } from "react";
import { ledgerApi, gmailApi, scanApi, merchantApi, getTxFromToTypes } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { LIGHT, DARK } from "../theme";
import { Button, EmptyState, Spinner, showToast } from "./shared/index";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST } from "../constants";

// ── TX types ────────────────────────────────────────────────────
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

// ── Category visibility ─────────────────────────────────────────
const SHOW_EXPENSE_CAT  = new Set(["expense","bank_charges","materai","tax"]);
const SHOW_INCOME_CAT   = new Set(["income","bank_interest","cashback"]);
const NO_CAT            = new Set(["transfer","pay_cc","reimburse_out","reimburse_in","give_loan","collect_loan"]);
const REIMBURSE_TYPES   = new Set(["reimburse_out","reimburse_in"]);
const REIMBURSE_ENTITIES = ["Hamasa", "SDC", "Travelio"];

const getCatOptions = (txType) =>
  SHOW_INCOME_CAT.has(txType) ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES;

// ── Helpers ─────────────────────────────────────────────────────
const amtColor = (type) => {
  if (["income","cashback","bank_interest","collect_loan","reimburse_in"].includes(type)) return "#059669";
  if (["transfer","pay_cc","give_loan"].includes(type)) return "#3b5bdb";
  return "#dc2626";
};
const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return d || ""; }
};
const fmtDate = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d || ""; }
};

// ── Inline control styles ────────────────────────────────────────
const inSel = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 4px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", width: "100%", cursor: "pointer",
  boxSizing: "border-box", ...extra,
});
const inInp = (T, extra = {}) => ({
  fontSize: 11, padding: "3px 5px", border: `1px solid ${T.border}`,
  borderRadius: 5, background: T.surface, color: T.text,
  fontFamily: "Figtree, sans-serif", width: "100%", boxSizing: "border-box", ...extra,
});

// ── Row bg based on status ────────────────────────────────────
const rowBg = (r, isSkipped, T) => {
  if (isSkipped) return T.sur2;
  if (r.flagged) return "#fff7ed";
  if (r.status === "possible_duplicate") return "#fefce8";
  return T.surface;
};

// ── Shared action button style ────────────────────────────────
const ACT_BTN = (extra = {}) => ({
  width: 26, height: 26, borderRadius: 6, border: "1px solid #e5e7eb",
  background: "#f9fafb", cursor: "pointer", fontSize: 12, fontWeight: 700,
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "Figtree, sans-serif", padding: 0, flexShrink: 0, ...extra,
});

// ─────────────────────────────────────────────────────────────────
export default function AIImport({ user, accounts, ledger, onRefresh, setLedger, dark }) {
  const T = dark ? DARK : LIGHT;
  const fileRef = useRef();
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth > 768);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [mode,        setMode]        = useState("scan");
  const [scanning,    setScanning]    = useState(false);
  const [results,     setResults]     = useState([]);
  const [selected,    setSelected]    = useState({});
  const [skipped,     setSkipped]     = useState(new Set());
  const [notesOpen,   setNotesOpen]   = useState(new Set());
  const [importing,   setImporting]   = useState(false);
  const [importingId, setImportingId] = useState(null);

  const [gmailPending, setGmailPending] = useState([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailLoaded,  setGmailLoaded]  = useState(false);

  const bankAccounts  = accounts.filter(a => a.type === "bank");
  const ccAccounts    = accounts.filter(a => a.type === "credit_card");
  const spendAccounts = [...bankAccounts, ...ccAccounts];

  const updateRow = (id, patch) =>
    setResults(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r));

  const isReimburseAccount = (acc) =>
    String(acc.account_no || "").includes("0830267743") ||
    acc.name?.toLowerCase().includes("reimburse") ||
    acc.subtype === "reimburse";

  const checkDuplicate = (date, amount, description) => {
    const amt = Number(amount);
    return ledger.some(l =>
      l.tx_date === date &&
      Math.abs(Number(l.amount_idr || l.amount) - amt) < 5 &&
      (l.description || "").trim().toLowerCase() === (description || "").trim().toLowerCase()
    );
  };

  // ── File scan ────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setScanning(true);
    setResults([]);
    setSelected({});
    setSkipped(new Set());
    setNotesOpen(new Set());
    try {
      const parsed = await scanApi.scan(user.id, file, { accounts });
      const items = (parsed || []).map((r, i) => {
        let txType = r.type || r.tx_type || "expense";
        const defaultFrom = SHOW_EXPENSE_CAT.has(txType) || txType === "pay_cc" || txType === "reimburse_out"
          ? (spendAccounts[0]?.id || "") : "";
        const defaultTo = SHOW_INCOME_CAT.has(txType) || txType === "transfer" || txType === "reimburse_in"
          ? (bankAccounts[0]?.id || "") : "";
        let fromId  = r.from_account_id || defaultFrom;
        let toId    = r.to_account_id   || defaultTo;
        let flagged = false;

        if (txType !== "reimburse_in" && toId) {
          const toAcc = accounts.find(a => a.id === toId);
          if (toAcc && isReimburseAccount(toAcc)) { txType = "reimburse_in"; flagged = true; }
        }
        if (txType === "reimburse_in" && fromId) {
          const fromAcc = accounts.find(a => a.id === fromId);
          if (fromAcc && isReimburseAccount(fromAcc)) flagged = true;
        }
        if (txType === "reimburse_in") flagged = true;

        const catId  = r.category || r.suggested_category || "other";
        const txDate = r.date || r.tx_date || todayStr();
        const amount = r.amount_idr || r.amount || 0;
        const desc   = r.description || "";

        return {
          _id:         i,
          tx_date:     txDate,
          description: desc,
          amount:      String(amount),
          currency:    r.currency || "IDR",
          amount_idr:  String(amount),
          tx_type:     txType,
          from_id:     fromId,
          to_id:       toId,
          entity:      REIMBURSE_ENTITIES.includes(r.entity) ? r.entity : "Hamasa",
          category_id: NO_CAT.has(txType) ? null : catId,
          ai_category: catId,
          notes:       r.notes || "",
          flagged,
          status:      checkDuplicate(txDate, amount, desc) ? "possible_duplicate" : "new",
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

  // ── Build ledger entry ────────────────────────────────────────
  const buildEntry = (r) => {
    const { from_type, to_type } = getTxFromToTypes(r.tx_type);
    return {
      tx_date:       r.tx_date,
      description:   r.description,
      amount:        Number(r.amount_idr || r.amount) || 0,
      currency:      r.currency || "IDR",
      amount_idr:    Number(r.amount_idr || r.amount) || 0,
      tx_type:       r.tx_type,
      from_type, to_type,
      from_id:       r.from_id || null,
      to_id:         r.to_id   || null,
      entity:        REIMBURSE_TYPES.has(r.tx_type) ? (r.entity || "Hamasa") : "Personal",
      category_id:   r.category_id || null,
      category_name: r.category_id || null,
      notes:         r.notes || "",
    };
  };

  // ── Import selected ───────────────────────────────────────────
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

  // ── Import single row ─────────────────────────────────────────
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

  // ── Gmail ─────────────────────────────────────────────────────
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

  // ── Summary ────────────────────────────────────────────────────
  const countSelected = results.filter(r => selected[r._id] && !skipped.has(r._id)).length;
  const countDup      = results.filter(r => r.status === "possible_duplicate").length;
  const allSelected   = results.length > 0 && results.every(r => selected[r._id] && !skipped.has(r._id));

  const toggleSelectAll = () => {
    const cur = results.every(r => selected[r._id] && !skipped.has(r._id));
    const ns = {};
    results.forEach(r => { ns[r._id] = !cur; });
    setSelected(ns);
  };

  const toggleNotes = (id) => setNotesOpen(s => {
    const ns = new Set(s); ns.has(id) ? ns.delete(id) : ns.add(id); return ns;
  });

  // ─────────────────────────────────────────────────────────────
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
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════ SCAN TAB ═════════════════ */}
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
            }}>
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
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Summary header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", gap: 8,
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                    {results.length} transactions found
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 3 }}>
                    <span style={{ fontSize: 12, color: "#059669", fontFamily: "Figtree, sans-serif" }}>
                      ✅ {countSelected} new
                    </span>
                    {countDup > 0 && (
                      <span style={{ fontSize: 12, color: "#d97706", fontFamily: "Figtree, sans-serif" }}>
                        ⚠️ {countDup} possible duplicate{countDup > 1 ? "s" : ""}
                      </span>
                    )}
                    {skipped.size > 0 && (
                      <span style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Figtree, sans-serif" }}>
                        ✕ {skipped.size} skipped
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={toggleSelectAll}>
                    {allSelected ? "Deselect All" : "Select All"}
                  </Button>
                  <Button variant="primary" size="sm" busy={importing} onClick={importSelected}>
                    Import {countSelected} Selected ▶
                  </Button>
                </div>
              </div>

              {/* Desktop table / Mobile cards */}
              {isDesktop ? (
                <DesktopTable
                  results={results} selected={selected} skipped={skipped} notesOpen={notesOpen}
                  importingId={importingId} allSelected={allSelected} T={T}
                  bankAccounts={bankAccounts} ccAccounts={ccAccounts} spendAccounts={spendAccounts}
                  updateRow={updateRow} setSelected={setSelected} setSkipped={setSkipped}
                  toggleNotes={toggleNotes} importOne={importOne} toggleSelectAll={toggleSelectAll}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {results.map(r => (
                    <MobileCard
                      key={r._id} r={r} selected={selected} skipped={skipped}
                      importingId={importingId} T={T}
                      bankAccounts={bankAccounts} ccAccounts={ccAccounts} spendAccounts={spendAccounts}
                      updateRow={updateRow} setSelected={setSelected} setSkipped={setSkipped}
                      importOne={importOne}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════ GMAIL TAB ════════════════ */}
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
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
                    {item.description}
                  </div>
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

// ══ DESKTOP TABLE ════════════════════════════════════════════════
// Grid: ☑ | Date | Description | Type | Category | Account | [Entity] | Amount | Actions
function DesktopTable({
  results, selected, skipped, notesOpen, importingId, allSelected, T,
  bankAccounts, ccAccounts, spendAccounts,
  updateRow, setSelected, setSkipped, toggleNotes, importOne, toggleSelectAll,
}) {
  const hasReimburse = results.some(r => REIMBURSE_TYPES.has(r.tx_type) || r.flagged);

  // Build column template dynamically
  const COLS = hasReimburse
    ? "40px 75px 1fr 120px 130px 150px 90px 95px 85px"
    : "40px 75px 1fr 120px 130px 150px 95px 85px";
  const HDR = hasReimburse
    ? ["Date", "Description", "Type", "Category", "Account", "Entity", "Amount", ""]
    : ["Date", "Description", "Type", "Category", "Account", "Amount", ""];
  const MIN_W = hasReimburse ? 920 : 830;

  return (
    <div style={{
      border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden",
    }}>
      <div style={{ overflowX: "auto" }}>

        {/* ── Header ── */}
        <div style={{
          display: "grid", gridTemplateColumns: COLS,
          background: T.sur2, borderBottom: `1.5px solid ${T.border}`,
          minWidth: MIN_W, position: "sticky", top: 0, zIndex: 2,
        }}>
          <div style={{ padding: "9px 8px", display: "flex", alignItems: "center" }}>
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
              style={{ accentColor: "#3b5bdb", width: 14, height: 14 }} />
          </div>
          {HDR.map((h, i) => (
            <div key={i} style={{
              padding: "9px 6px",
              fontSize: 10, fontWeight: 700, color: T.text3,
              textTransform: "uppercase", letterSpacing: "0.05em",
              fontFamily: "Figtree, sans-serif",
              textAlign: h === "Amount" ? "right" : "left",
            }}>
              {h}
            </div>
          ))}
        </div>

        {/* ── Rows ── */}
        <div style={{ minWidth: MIN_W }}>
          {results.map(r => {
            const isSkipped  = skipped.has(r._id);
            const isSelected = !!selected[r._id];
            const isNotes    = notesOpen.has(r._id);
            const color      = amtColor(r.tx_type);
            const bg         = rowBg(r, isSkipped, T);
            const showCat    = !NO_CAT.has(r.tx_type);
            const showEntity = REIMBURSE_TYPES.has(r.tx_type) || r.flagged;
            const cats       = getCatOptions(r.tx_type);
            const leftBorder = r.flagged                           ? "3px solid #f97316"
                             : r.status === "possible_duplicate"   ? "3px solid #d97706"
                             : "3px solid transparent";
            const displayDesc = r.description || r.merchant_name || r.notes || "";

            return (
              <div key={r._id}>
                {/* Main row */}
                <div style={{
                  display: "grid", gridTemplateColumns: COLS,
                  alignItems: "center", minHeight: 48,
                  background: bg, borderBottom: `1px solid ${T.border}`,
                  borderLeft: leftBorder,
                  opacity: isSkipped ? 0.5 : 1,
                }}>
                  {/* ☑ */}
                  <div style={{ padding: "4px 8px" }}>
                    <input type="checkbox" checked={isSelected && !isSkipped}
                      onChange={e => setSelected(s => ({ ...s, [r._id]: e.target.checked }))}
                      disabled={isSkipped}
                      style={{ accentColor: "#3b5bdb", width: 14, height: 14 }} />
                  </div>

                  {/* Date */}
                  <div style={{
                    padding: "4px 6px", fontSize: 11, color: T.text3,
                    fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
                  }}>
                    {fmtDateShort(r.tx_date)}
                  </div>

                  {/* Description */}
                  <div style={{ padding: "4px 6px", minWidth: 0 }}>
                    <input
                      style={inInp(T, { fontSize: 12, fontWeight: 500 })}
                      value={displayDesc}
                      onChange={e => updateRow(r._id, { description: e.target.value })}
                    />
                  </div>

                  {/* Type */}
                  <div style={{ padding: "4px 6px" }}>
                    <select style={inSel(T)}
                      value={r.tx_type}
                      onChange={e => {
                        const t = e.target.value;
                        updateRow(r._id, { tx_type: t, category_id: NO_CAT.has(t) ? null : r.category_id });
                      }}>
                      {IMPORT_TX_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Category */}
                  <div style={{ padding: "4px 6px" }}>
                    {showCat ? (
                      <div style={{ position: "relative" }}>
                        <select style={inSel(T)}
                          value={r.category_id || ""}
                          onChange={e => updateRow(r._id, { category_id: e.target.value })}>
                          {cats.map(c => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </select>
                        {r.ai_category && r.ai_category === r.category_id && (
                          <span style={{
                            position: "absolute", top: -7, right: 1,
                            fontSize: 8, fontWeight: 800, background: "#dbeafe", color: "#3b5bdb",
                            padding: "1px 3px", borderRadius: 3, fontFamily: "Figtree, sans-serif",
                            pointerEvents: "none", lineHeight: 1.4,
                          }}>AI</span>
                        )}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif" }}>—</span>
                    )}
                  </div>

                  {/* Account */}
                  <div style={{ padding: "4px 6px" }}>
                    <RowAccountCell r={r} updateRow={updateRow} T={T}
                      bankAccounts={bankAccounts} ccAccounts={ccAccounts} spendAccounts={spendAccounts} />
                  </div>

                  {/* Entity — only rendered if any row is reimburse */}
                  {hasReimburse && (
                    <div style={{ padding: "4px 6px" }}>
                      {showEntity ? (
                        <div style={{ display: "flex", gap: 2 }}>
                          {REIMBURSE_ENTITIES.map(en => (
                            <button key={en} onClick={() => updateRow(r._id, { entity: en })}
                              title={en}
                              style={{
                                width: 22, height: 22, borderRadius: 4, padding: 0,
                                border: `1.5px solid ${r.entity === en ? "#3b5bdb" : T.border}`,
                                background: r.entity === en ? "#dbeafe" : T.surface,
                                color: r.entity === en ? "#1d4ed8" : T.text3,
                                fontSize: 9, fontWeight: 800, cursor: "pointer",
                                fontFamily: "Figtree, sans-serif",
                              }}>
                              {en[0]}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif" }}>—</span>
                      )}
                    </div>
                  )}

                  {/* Amount */}
                  <div style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      style={inInp(T, { textAlign: "right", color, fontWeight: 700, fontSize: 12 })}
                      value={r.amount_idr || r.amount || ""}
                      onChange={e => updateRow(r._id, { amount_idr: e.target.value, amount: e.target.value })}
                    />
                  </div>

                  {/* Actions */}
                  <div style={{ padding: "4px 8px", display: "flex", gap: 3, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => toggleNotes(r._id)}
                      style={ACT_BTN({
                        color: isNotes ? "#3b5bdb" : "#9ca3af",
                        border: `1px solid ${isNotes ? "#bfdbfe" : "#e5e7eb"}`,
                        background: isNotes ? "#eff6ff" : "#f9fafb",
                      })}
                      title="Notes">✏️</button>
                    <button
                      onClick={() => importOne(r)}
                      disabled={isSkipped || importingId === r._id}
                      style={ACT_BTN({ background: "#dcfce7", color: "#059669", border: "1px solid #bbf7d0" })}
                      title="Import">
                      {importingId === r._id ? "…" : "✓"}
                    </button>
                    <button
                      onClick={() => {
                        setSkipped(s => { const ns = new Set(s); ns.has(r._id) ? ns.delete(r._id) : ns.add(r._id); return ns; });
                        setSelected(s => ({ ...s, [r._id]: false }));
                      }}
                      style={ACT_BTN({ color: isSkipped ? "#059669" : "#9ca3af" })}
                      title={isSkipped ? "Restore" : "Skip"}>
                      {isSkipped ? "↩" : "✕"}
                    </button>
                  </div>
                </div>

                {/* Notes row */}
                {isNotes && (
                  <div style={{
                    background: T.sur2, borderBottom: `1px solid ${T.border}`,
                    padding: "6px 44px 6px 56px",
                    display: "flex", gap: 8, alignItems: "center",
                  }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: T.text3, textTransform: "uppercase",
                      letterSpacing: "0.04em", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap",
                    }}>Notes</span>
                    <input
                      style={inInp(T, { fontSize: 11, flex: 1 })}
                      value={r.notes || ""}
                      onChange={e => updateRow(r._id, { notes: e.target.value })}
                      placeholder="Optional notes…"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Grouped account dropdown ──────────────────────────────────────
function AccSelect({ style, value, onChange, bankAccounts, ccAccounts, placeholder, showCC = false }) {
  return (
    <select style={style} value={value || ""} onChange={onChange}>
      <option value="">{placeholder || "— Account —"}</option>
      <optgroup label="BANK & CASH">
        {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </optgroup>
      {showCC && ccAccounts.length > 0 && (
        <optgroup label="CREDIT CARDS">
          {ccAccounts.map(a => (
            <option key={a.id} value={a.id}>
              {a.name}{(a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

// ── Account cell (desktop table) ─────────────────────────────────
function RowAccountCell({ r, updateRow, T, bankAccounts, ccAccounts, spendAccounts }) {
  const t   = r.tx_type;
  const sel = inSel(T, { fontSize: 10 });

  if (t === "pay_cc") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <AccSelect style={sel} value={r.from_id}
        onChange={e => updateRow(r._id, { from_id: e.target.value })}
        bankAccounts={bankAccounts} ccAccounts={[]} placeholder="— Bank —" />
      <select style={sel} value={r.to_id || ""}
        onChange={e => updateRow(r._id, { to_id: e.target.value })}>
        <option value="">— CC —</option>
        {ccAccounts.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}{(a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
          </option>
        ))}
      </select>
    </div>
  );

  if (t === "transfer") return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <AccSelect style={sel} value={r.from_id}
        onChange={e => updateRow(r._id, { from_id: e.target.value })}
        bankAccounts={bankAccounts} ccAccounts={[]} placeholder="— From —" />
      <AccSelect style={sel} value={r.to_id}
        onChange={e => updateRow(r._id, { to_id: e.target.value })}
        bankAccounts={bankAccounts} ccAccounts={[]} placeholder="— To —" />
    </div>
  );

  if (["income","bank_interest","cashback","collect_loan","reimburse_in"].includes(t)) return (
    <AccSelect style={sel} value={r.to_id}
      onChange={e => updateRow(r._id, { to_id: e.target.value })}
      bankAccounts={bankAccounts} ccAccounts={[]} placeholder="— To —" />
  );

  // expense / reimburse_out / give_loan / etc — show Bank + CC
  return (
    <AccSelect style={sel} value={r.from_id}
      onChange={e => updateRow(r._id, { from_id: e.target.value })}
      bankAccounts={bankAccounts} ccAccounts={ccAccounts} showCC placeholder="— From —" />
  );
}

// ══ MOBILE CARD ══════════════════════════════════════════════════
function MobileCard({
  r, selected, skipped, importingId, T, bankAccounts, ccAccounts, spendAccounts,
  updateRow, setSelected, setSkipped, importOne,
}) {
  const isSkipped  = skipped.has(r._id);
  const isSelected = !!selected[r._id];
  const color      = amtColor(r.tx_type);
  const bg         = rowBg(r, isSkipped, T);
  const showCat    = !NO_CAT.has(r.tx_type);
  const showEntity = REIMBURSE_TYPES.has(r.tx_type) || r.flagged;
  const cats       = getCatOptions(r.tx_type);
  const displayDesc = r.description || r.merchant_name || r.notes || "";

  return (
    <div style={{
      background: bg,
      border: `1.5px solid ${isSkipped ? T.border : r.flagged ? "#f97316" : r.status === "possible_duplicate" ? "#d97706" : T.border}`,
      borderRadius: 12, padding: "12px 14px",
      opacity: isSkipped ? 0.5 : 1,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      {/* Top: ☑ + description input + amount */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input type="checkbox" checked={isSelected && !isSkipped}
          onChange={e => setSelected(s => ({ ...s, [r._id]: e.target.checked }))}
          disabled={isSkipped}
          style={{ accentColor: "#3b5bdb", width: 15, height: 15, flexShrink: 0 }} />
        <input
          style={{
            flex: 1, border: "none", background: "transparent", padding: 0, outline: "none",
            fontSize: 13, fontWeight: 600, color: T.text, fontFamily: "Figtree, sans-serif",
            minWidth: 0,
          }}
          value={displayDesc}
          onChange={e => updateRow(r._id, { description: e.target.value })}
        />
        <div style={{
          fontSize: 14, fontWeight: 800, color, fontFamily: "Figtree, sans-serif", flexShrink: 0,
        }}>
          {fmtIDR(Number(r.amount_idr || r.amount || 0), true)}
        </div>
      </div>

      {/* Middle: Date · Type · Category */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: T.text3, fontFamily: "Figtree, sans-serif", flexShrink: 0 }}>
          {fmtDateShort(r.tx_date)}
        </span>
        <span style={{ fontSize: 11, color: T.text3 }}>·</span>
        <select style={{ ...inSel(T), fontSize: 11, width: "auto", flex: "0 1 auto" }}
          value={r.tx_type}
          onChange={e => {
            const t = e.target.value;
            updateRow(r._id, { tx_type: t, category_id: NO_CAT.has(t) ? null : r.category_id });
          }}>
          {IMPORT_TX_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        {showCat && (
          <>
            <span style={{ fontSize: 11, color: T.text3 }}>·</span>
            <select style={{ ...inSel(T), fontSize: 11, width: "auto", flex: "0 1 auto" }}
              value={r.category_id || ""}
              onChange={e => updateRow(r._id, { category_id: e.target.value })}>
              {cats.map(c => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            {r.ai_category && r.ai_category === r.category_id && (
              <span style={{
                fontSize: 9, fontWeight: 800, background: "#dbeafe", color: "#3b5bdb",
                padding: "1px 4px", borderRadius: 3, fontFamily: "Figtree, sans-serif",
              }}>AI</span>
            )}
          </>
        )}
      </div>

      {/* Account — full width */}
      <MobileAccountCell r={r} updateRow={updateRow} T={T}
        bankAccounts={bankAccounts} ccAccounts={ccAccounts} />

      {/* Entity (reimburse only) */}
      {showEntity && (
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif" }}>Entity:</span>
          {REIMBURSE_ENTITIES.map(en => (
            <button key={en} onClick={() => updateRow(r._id, { entity: en })}
              style={{
                padding: "2px 10px", borderRadius: 5,
                border: `1.5px solid ${r.entity === en ? "#3b5bdb" : T.border}`,
                background: r.entity === en ? "#dbeafe" : T.surface,
                color: r.entity === en ? "#1d4ed8" : T.text3,
                fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "Figtree, sans-serif",
              }}>
              {en}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => importOne(r)}
          disabled={isSkipped || importingId === r._id}
          style={{
            flex: 1, padding: "7px 0", borderRadius: 8,
            border: "none", background: "#dcfce7", color: "#059669",
            fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Figtree, sans-serif",
          }}>
          {importingId === r._id ? "Importing…" : "✓ Import"}
        </button>
        <button
          onClick={() => {
            setSkipped(s => { const ns = new Set(s); ns.has(r._id) ? ns.delete(r._id) : ns.add(r._id); return ns; });
            setSelected(s => ({ ...s, [r._id]: false }));
          }}
          style={{
            padding: "7px 16px", borderRadius: 8,
            border: `1px solid ${T.border}`, background: T.surface,
            color: isSkipped ? "#059669" : T.text3,
            fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "Figtree, sans-serif",
          }}>
          {isSkipped ? "↩ Restore" : "✕ Skip"}
        </button>
      </div>
    </div>
  );
}

// ── Account cell (mobile card) ────────────────────────────────────
function MobileAccountCell({ r, updateRow, T, bankAccounts, ccAccounts }) {
  const t   = r.tx_type;
  const sel = inSel(T, { fontSize: 12 });

  if (t === "pay_cc") return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <AccSelect style={{ ...sel, flex: 1 }} value={r.from_id}
        onChange={e => updateRow(r._id, { from_id: e.target.value })}
        bankAccounts={bankAccounts} ccAccounts={[]} placeholder="From…" />
      <span style={{ fontSize: 11, color: T.text3 }}>→</span>
      <select style={{ ...sel, flex: 1 }} value={r.to_id || ""}
        onChange={e => updateRow(r._id, { to_id: e.target.value })}>
        <option value="">To CC…</option>
        {ccAccounts.map(a => (
          <option key={a.id} value={a.id}>
            {a.name}{(a.last4 || a.card_last4) ? ` ···${a.last4 || a.card_last4}` : ""}
          </option>
        ))}
      </select>
    </div>
  );

  if (t === "transfer") return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <AccSelect style={{ ...sel, flex: 1 }} value={r.from_id}
        onChange={e => updateRow(r._id, { from_id: e.target.value })}
        bankAccounts={bankAccounts} ccAccounts={[]} placeholder="From…" />
      <span style={{ fontSize: 11, color: T.text3 }}>→</span>
      <AccSelect style={{ ...sel, flex: 1 }} value={r.to_id}
        onChange={e => updateRow(r._id, { to_id: e.target.value })}
        bankAccounts={bankAccounts} ccAccounts={[]} placeholder="To…" />
    </div>
  );

  if (["income","bank_interest","cashback","collect_loan","reimburse_in"].includes(t)) return (
    <AccSelect style={{ ...sel, width: "100%" }} value={r.to_id}
      onChange={e => updateRow(r._id, { to_id: e.target.value })}
      bankAccounts={bankAccounts} ccAccounts={[]} placeholder="To Account…" />
  );

  return (
    <AccSelect style={{ ...sel, width: "100%" }} value={r.from_id}
      onChange={e => updateRow(r._id, { from_id: e.target.value })}
      bankAccounts={bankAccounts} ccAccounts={ccAccounts} showCC placeholder="From Account…" />
  );
}
