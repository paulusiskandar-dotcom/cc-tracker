import { useState, useRef } from "react";
import { ledgerApi, gmailApi, scanApi, merchantApi, getTxFromToTypes } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { LIGHT, DARK } from "../theme";
import { Modal, Button, Field, Input, AmountInput, FormRow, Select, EmptyState, Spinner, showToast } from "./shared/index";
import { EXPENSE_CATEGORIES, ENTITIES, TX_TYPES } from "../constants";

export default function AIImport({ user, accounts, ledger, onRefresh, setLedger, dark }) {
  const T = dark ? DARK : LIGHT;

  const [mode, setMode]           = useState("scan"); // "scan" | "gmail"
  const [scanning, setScanning]   = useState(false);
  const [results, setResults]     = useState([]);
  const [selected, setSelected]   = useState({}); // id -> bool
  const [importing, setImporting] = useState(false);
  const [editIdx, setEditIdx]     = useState(null);
  const [editModal, setEditModal] = useState(false);
  const [editForm, setEditForm]   = useState({});
  const fileRef = useRef();

  // Gmail pending
  const [gmailPending, setGmailPending] = useState([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailLoaded, setGmailLoaded]   = useState(false);

  const bankAccounts = accounts.filter(a => a.type === "bank");
  const ccAccounts   = accounts.filter(a => a.type === "credit_card");
  const spendAccounts = [...bankAccounts, ...ccAccounts];

  const loadGmailPending = async () => {
    if (gmailLoaded) return;
    setGmailLoading(true);
    try {
      const data = await gmailApi.getPending(user.id);
      setGmailPending(data || []);
      setGmailLoaded(true);
    } catch (e) {
      showToast("Could not load Gmail pending", "error");
    }
    setGmailLoading(false);
  };

  // ── File scan ───────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setScanning(true);
    setResults([]);
    try {
      const parsed = await scanApi.scan(user.id, file);
      const items = (parsed || []).map((r, i) => ({
        _id: i,
        tx_date:         r.date || todayStr(),
        description:     r.description || "",
        amount:          String(r.amount || ""),
        currency:        r.currency || "IDR",
        amount_idr:      r.amount_idr || r.amount || "",
        tx_type:         r.type || "expense",
        from_id:         r.from_account_id || spendAccounts[0]?.id || "",
        to_id:           r.to_account_id || "",
        entity:          r.entity || "Personal",
        category:        r.category || "other",
        notes:           r.notes || "",
      }));
      setResults(items);
      const sel = {};
      items.forEach(r => { sel[r._id] = true; });
      setSelected(sel);
    } catch (e) {
      showToast(e.message || "Scan failed", "error");
    }
    setScanning(false);
  };

  const openEdit = (idx) => {
    setEditIdx(idx);
    setEditForm({ ...results[idx] });
    setEditModal(true);
  };

  const saveEdit = () => {
    setResults(prev => prev.map((r, i) => i === editIdx ? { ...editForm } : r));
    setEditModal(false);
  };

  const importSelected = async () => {
    const toImport = results.filter(r => selected[r._id]);
    if (toImport.length === 0) return showToast("Select at least one entry", "warning");
    setImporting(true);
    let ok = 0;
    for (const r of toImport) {
      try {
        const { from_type, to_type } = getTxFromToTypes(r.tx_type);
        const entry = {
          tx_date:         r.tx_date,
          description:     r.description,
          amount:          Number(r.amount),
          currency:        r.currency || "IDR",
          amount_idr:      Number(r.amount_idr || r.amount),
          tx_type:         r.tx_type,
          from_type,
          to_type,
          from_id:         r.from_id || null,
          to_id:           r.to_id   || null,
          entity:          r.entity || "Personal",
          category_id:     null,
          category_name:   r.category || null,
          notes:           r.notes || "",
        };
        const created = await ledgerApi.create(user.id, entry, accounts);
        if (created) {
          setLedger(prev => [created, ...prev]);
          ok++;
          // Merchant learning: remember description→category mapping
          if (r.description && (r.category || entry.category_name)) {
            merchantApi.upsert(user.id, r.description, r.category || entry.category_name, r.category || entry.category_name).catch(() => {});
          }
        }
      } catch { /* continue */ }
    }
    await onRefresh();
    showToast(`Imported ${ok} of ${toImport.length} entries`);
    setResults([]);
    setSelected({});
    setImporting(false);
  };

  // ── Gmail import ────────────────────────────────────────────
  const importGmailItem = async (item) => {
    try {
      const entry = {
        tx_date:         item.date || todayStr(),
        description:     item.description,
        amount:          Number(item.amount),
        currency:        "IDR",
        amount_idr:      Number(item.amount),
        tx_type:         "expense",
        from_type:       "account",
        to_type:         "expense",
        from_id:         ccAccounts[0]?.id || spendAccounts[0]?.id || null,
        to_id:           null,
        entity:          "Personal",
        category_id:     null,
        category_name:   item.category || null,
        notes:           item.email_subject || "",
      };
      const created = await ledgerApi.create(user.id, entry, accounts);
      if (created) setLedger(prev => [created, ...prev]);
      setGmailPending(prev => prev.filter(p => p.id !== item.id));
      await gmailApi.markImported(user.id, item.id);
      showToast(`Imported: ${item.description}`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const skipGmailItem = async (item) => {
    try {
      await gmailApi.markSkipped(user.id, item.id);
      setGmailPending(prev => prev.filter(p => p.id !== item.id));
    } catch { setGmailPending(prev => prev.filter(p => p.id !== item.id)); }
  };

  // ── Styles ──────────────────────────────────────────────────
  const card = {
    background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 16, padding: "16px 18px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── MODE TABS ────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 4 }}>
        {[
          { id: "scan",  label: "📷 Scan Document" },
          { id: "gmail", label: "✉️ Gmail Pending" },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => { setMode(t.id); if (t.id === "gmail") loadGmailPending(); }}
            style={{
              padding: "7px 16px", borderRadius: 99, border: "none",
              cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "Figtree, sans-serif",
              background: mode === t.id ? T.text    : T.sur2,
              color:      mode === t.id ? T.darkText : T.text2,
              transition: "background .15s, color .15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* ── SCAN TAB ─────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {mode === "scan" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            style={{
              border:       `2px dashed ${T.border}`,
              borderRadius: 16,
              padding:      "32px 24px",
              textAlign:    "center",
              cursor:       "pointer",
              background:   T.sur2,
              transition:   "border-color .15s",
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>
              Drop receipt, invoice, or bank statement
            </div>
            <div style={{ fontSize: 12, color: T.text3 }}>
              Supports JPG, PNG, PDF — AI extracts transactions automatically
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.pdf"
              style={{ display: "none" }}
              onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
            {!scanning && (
              <div style={{ marginTop: 14 }}>
                <Button variant="primary" size="sm">Choose File</Button>
              </div>
            )}
            {scanning && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: T.text2 }}>
                <Spinner size={16} /> Scanning with AI…
              </div>
            )}
          </div>

          {/* Results */}
          {results.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>
                  {results.length} transactions found
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" size="sm" onClick={() => { const s = {}; results.forEach(r => { s[r._id] = !Object.values(selected).every(Boolean); }); setSelected(s); }}>
                    {Object.values(selected).every(Boolean) ? "Deselect All" : "Select All"}
                  </Button>
                  <Button
                    variant="primary" size="sm" busy={importing}
                    onClick={importSelected}
                  >
                    Import {Object.values(selected).filter(Boolean).length} Selected
                  </Button>
                </div>
              </div>

              {results.map((r, i) => (
                <div key={r._id} style={{
                  ...card,
                  opacity: selected[r._id] ? 1 : 0.5,
                  borderColor: selected[r._id] ? T.ac : T.border,
                  borderWidth: selected[r._id] ? 2 : 1,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1 }}>
                      <input
                        type="checkbox"
                        checked={!!selected[r._id]}
                        onChange={e => setSelected(s => ({ ...s, [r._id]: e.target.checked }))}
                        style={{ marginTop: 2, accentColor: T.ac, flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{r.description || "—"}</div>
                        <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                          {r.tx_date} · {r.tx_type} · {r.entity}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, marginLeft: 12 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#dc2626" }}>
                        {fmtIDR(Number(r.amount_idr || r.amount || 0), true)}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(i)}>✏️</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* ── GMAIL TAB ────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════ */}
      {mode === "gmail" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {gmailLoading ? (
            <div style={{ textAlign: "center", padding: 32 }}>
              <Spinner size={24} />
              <div style={{ fontSize: 12, color: T.text3, marginTop: 8 }}>Loading Gmail…</div>
            </div>
          ) : gmailPending.length === 0 ? (
            <EmptyState icon="✉️" message="No pending Gmail transactions. Connect Gmail in Settings → Email Sync." />
          ) : (
            gmailPending.map(item => (
              <div key={item.id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{item.description}</div>
                    <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
                      {item.date} · {item.merchant || "—"}
                    </div>
                    {item.email_subject && (
                      <div style={{ fontSize: 10, color: T.text3, marginTop: 2, fontStyle: "italic" }}>
                        {item.email_subject}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#dc2626", flexShrink: 0, marginLeft: 12 }}>
                    {fmtIDR(Number(item.amount || 0), true)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="primary"   size="sm" onClick={() => importGmailItem(item)}>✓ Import</Button>
                  <Button variant="secondary" size="sm" onClick={() => skipGmailItem(item)}>Skip</Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── EDIT ENTRY MODAL ────────────────────────────── */}
      <Modal
        isOpen={editModal}
        onClose={() => setEditModal(false)}
        title="Edit Entry"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" size="md" onClick={() => setEditModal(false)}>Cancel</Button>
            <Button variant="primary"   size="md" onClick={saveEdit}>Save</Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Field label="Description">
            <Input
              value={editForm.description || ""}
              onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <FormRow>
            <AmountInput
              label="Amount (IDR)"
              value={editForm.amount_idr || editForm.amount || ""}
              onChange={v => setEditForm(f => ({ ...f, amount_idr: v, amount: v }))}
              currency="IDR"
            />
            <Field label="Date">
              <Input type="date" value={editForm.tx_date || ""} onChange={e => setEditForm(f => ({ ...f, tx_date: e.target.value }))} />
            </Field>
          </FormRow>
          <FormRow>
            <Field label="Type">
              <Select
                value={editForm.tx_type || "expense"}
                onChange={e => setEditForm(f => ({ ...f, tx_type: e.target.value }))}
                options={TX_TYPES.map(t => ({ value: t.id, label: t.label }))}
              />
            </Field>
            <Field label="Entity">
              <Select
                value={editForm.entity || "Personal"}
                onChange={e => setEditForm(f => ({ ...f, entity: e.target.value }))}
                options={ENTITIES.map(e => ({ value: e, label: e }))}
              />
            </Field>
          </FormRow>
          <Field label="Category">
            <Select
              value={editForm.category || "other"}
              onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
              options={EXPENSE_CATEGORIES.map(c => ({ value: c.id, label: `${c.icon} ${c.label}` }))}
            />
          </Field>
          <Field label="From Account">
            <Select
              value={editForm.from_id || ""}
              onChange={e => setEditForm(f => ({ ...f, from_id: e.target.value }))}
              options={spendAccounts.map(a => ({ value: a.id, label: a.name }))}
              placeholder="Select…"
            />
          </Field>
        </div>
      </Modal>

    </div>
  );
}
