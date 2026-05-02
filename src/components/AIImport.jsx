import { useState, useRef, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { undoManager } from "../lib/undoManager";
import { merchantRules } from "../lib/merchantRules";
import { ledgerApi, scanApi, getTxFromToTypes, loanPaymentsApi, installmentsApi } from "../api";
import { fmtIDR, todayStr, checkDuplicateTransaction, resolveCategoryIds } from "../utils";
import { LIGHT, DARK } from "../theme";
import { Button, EmptyState, Spinner, showToast, TxHorizontal } from "./shared/index";
import ProgressIndicator from "./shared/ProgressIndicator";
import { useImportDraft } from "../lib/useImportDraft";
import DraftBanner from "./shared/DraftBanner";
import Modal from "./shared/Modal";
import { detectTransferPairs } from "../lib/transferDetection";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES_LIST, REIMBURSE_ENTITIES } from "../constants";

// ── Normalise AI pseudo-types to real tx_type + category ─────────
const PSEUDO_TYPE_MAP = {
  bank_charges:  { tx_type: "expense", category_id: "bank_charges", category_name: "Bank Charges"  },
  materai:       { tx_type: "expense", category_id: "materai",      category_name: "Stamp Duty"    },
  tax:           { tx_type: "expense", category_id: "tax",          category_name: "Tax"           },
  bank_interest: { tx_type: "income",  category_id: "bank_interest",category_name: "Bank Interest" },
  cashback:      { tx_type: "income",  category_id: "cashback",     category_name: "Cashback"      },
};
const normaliseTxType = (raw, catId) => {
  const mapped = PSEUDO_TYPE_MAP[raw];
  if (mapped) return { tx_type: mapped.tx_type, category_id: mapped.category_id };
  return { tx_type: raw || "expense", category_id: catId };
};

// ── Keyword-based auto-classification ───────────────────────────
const KEYWORD_RULES = [
  // Bank admin / fees (debit)
  { match: /biaya\s*adm(?:inistrasi)?|admin\s*fee|bi-?fast\s*fee|transfer\s*fee|provisi|biaya\s*transfer|administration\s*fee|service\s*charge/i, tx_type: "expense", category_id: "bank_charges" },
  { match: /bi-?fast|bifast/i, maxAmount: 5000, tx_type: "expense", category_id: "bank_charges" },
  { match: /materai|stamp\s*duty|bea\s*materai/i, tx_type: "expense", category_id: "materai" },
  { match: /\bpph\b|pajak|withholding\s*tax|interest\s*tax|pph\s*bunga/i, tx_type: "expense", category_id: "tax" },
  { match: /\btax\b/i, notMatch: /cashback|interest|bunga/i, tx_type: "expense", category_id: "tax" },
  // Bank interest / cashback (credit)
  { match: /bunga\s*tabungan|bunga\s*deposito|jasa\s*giro|bank\s*interest|bunga\b/i, notMatch: /pph|pajak|tax/i, tx_type: "income", category_id: "bank_interest" },
  { match: /cashback|cash\s*back|reward\s*points|poin\s*reward/i, tx_type: "income", category_id: "cashback" },
  // Mandiri: incoming transfers (credit column) → income
  { match: /transfer\s+dari\s+bank|tf\s+dari|setoran\s+tunai|setor\s+tunai/i, notMatch: /ke\s+bank|to\s+bank/i, tx_type: "income", category_id: "other_income" },
  { match: /bi\s*fast\s+dari|bifast\s+dari|transfer\s+bi\s*fast\s+dari/i, tx_type: "income", category_id: "other_income" },
  { match: /penerimaan\s+transfer|incoming\s+transfer|kredit\s+transfer/i, tx_type: "income", category_id: "other_income" },
  // Mandiri: CC payment (debit) → pay_cc
  { match: /pembayaran\s+kartu\s+kredit|bayar\s+kartu\s+kredit|cc\s+payment|credit\s+card\s+pay/i, tx_type: "pay_cc" },
  // Mandiri: cash withdrawal (debit) → expense
  { match: /penarikan\s+tunai|tarik\s+tunai|atm\s+withdrawal|withdrawal\s+atm/i, tx_type: "expense", category_id: "other" },
];

const applyKeywordRules = (desc, amount) => {
  const d   = (desc || "").toLowerCase();
  const amt = Number(amount) || 0;
  for (const rule of KEYWORD_RULES) {
    if (!rule.match.test(d)) continue;
    if (rule.notMatch && rule.notMatch.test(d)) continue;
    if (rule.maxAmount !== undefined && amt > rule.maxAmount) continue;
    return { tx_type: rule.tx_type, category_id: rule.category_id };
  }
  return null;
};

const NO_CAT          = new Set(["transfer","pay_cc","reimburse_out","reimburse_in","give_loan","collect_loan","fx_exchange"]);
const REIMBURSE_TYPES = new Set(["reimburse_out","reimburse_in"]);
const INCOME_TYPES    = new Set(["income","collect_loan","reimburse_in"]);

const getCatOptions = (txType) => INCOME_TYPES.has(txType) ? INCOME_CATEGORIES_LIST : EXPENSE_CATEGORIES;

const fmtDateShort = (d) => {
  try { return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }
  catch { return d || ""; }
};

// ─────────────────────────────────────────────────────────────────
export default function AIImport({ user, accounts, categories = [], ledger, onRefresh, setLedger, dark, merchantMaps = [], fxRates = {}, CURRENCIES = [], setPendingSyncs, employeeLoans = [] }) {
  const T = dark ? DARK : LIGHT;
  const fileRef = useRef();

  const [defaultAccountId, setDefaultAccountId] = useState("");
  const [scanning,         setScanning]         = useState(false);
  const [retrySonnet,      setRetrySonnet]      = useState(false);
  const [results,          setResults]          = useState([]);
  const [selected,         setSelected]         = useState({});
  const [importing,        setImporting]        = useState(false);
  const [batchId,          setBatchId]          = useState(null);
  const [batchFilePath,    setBatchFilePath]    = useState(null);
  const [imageBlobUrls,    setImageBlobUrls]    = useState([]);    // blob URLs for thumbnail strip
  const [zoomUrl,          setZoomUrl]          = useState(null);  // URL to show in zoom modal
  const [processingProgress, setProcessingProgress] = useState(null); // { current, total } for multi-file
  // Fingerprints of rows permanently skipped — persist across Refresh Scan
  const [skippedFPs,  setSkippedFPs]  = useState(new Set());
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [skippedCount,   setSkippedCount]   = useState(0);

  const draft = useImportDraft({
    user,
    source: "ai_scan",
    state: results.length > 0 ? { rows: results, selected, skipped: [...skippedFPs] } : null,
    onRestore: (s) => {
      if (s.rows) setResults(s.rows);
      if (s.selected) setSelected(s.selected);
      if (s.skipped) setSkippedFPs(new Set(s.skipped));
    },
  });

  const spendAccounts = accounts.filter(a => ["bank","cash","credit_card"].includes(a.type));
  const bankAccounts  = accounts.filter(a => a.type === "bank");

  // Initialise defaultAccountId to first spend account once accounts load
  useEffect(() => {
    if (!defaultAccountId && spendAccounts.length > 0) {
      setDefaultAccountId(spendAccounts[0].id);
    }
  }, [spendAccounts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load persisted extracted batch on mount ───────────────────
  useEffect(() => {
    if (!user?.id) return;
    scanApi.loadBatches(user.id).then(batches => {
      if (!batches.length) return;
      const latest = batches[0];
      const raw    = Array.isArray(latest.ai_raw_result) ? latest.ai_raw_result : latest.ai_raw_result?.transactions || [];
      if (!raw.length) return;
      const rawItems = buildRows(raw, defaultAccountId);
      if (!rawItems.length) return;
      const items = enrichTransfers(rawItems);
      setResults(items);
      const sel = {};
      items.forEach(r => { sel[r._id] = r.status !== "duplicate"; });
      setSelected(sel);
      setBatchId(latest.id);
      setBatchFilePath(latest.file_path || null);
    }).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FX rate lookup ────────────────────────────────────────────
  const getDefaultRate = (currency) => {
    if (!currency || currency.toUpperCase() === "IDR") return 1;
    const upper = currency.toUpperCase();
    const rate = fxRates[upper] || fxRates[currency] || fxRates[upper.toLowerCase()];
    if (rate) return rate;
    const c = CURRENCIES.find(c => c.code.toUpperCase() === upper);
    return c ? c.rate : 1;
  };

  // ── Transfer detection ────────────────────────────────────────
  const isOwnAccount = (accountNo) => {
    if (!accountNo) return false;
    const no = String(accountNo).replace(/\s/g, "");
    return accounts.some(a => {
      const aNo = String(a.account_no || "").replace(/\s/g, "");
      return (aNo && (aNo.includes(no) || no.includes(aNo))) || (a.card_last4 && no.slice(-4) === a.card_last4);
    });
  };

  const fixTransferType = (tx) => {
    if (tx.tx_type !== "transfer") return tx;
    const toOwn   = tx.to_account_id ? accounts.some(a => a.id === tx.to_account_id) : isOwnAccount(tx.to_account_no);
    const fromOwn = tx.from_account_id ? accounts.some(a => a.id === tx.from_account_id) : isOwnAccount(tx.from_account_no);
    if (toOwn && fromOwn) return tx;
    if (toOwn && !fromOwn) return { ...tx, tx_type: "income" };
    return { ...tx, tx_type: "expense", to_id: null, to_account_id: null };
  };

  const enrichTransfers = (items) => {
    const pairs = detectTransferPairs(items, accounts, ledger || []);
    return items.map(r => {
      const p = pairs.find(x => x.rowId === r._id || x.partnerRowId === r._id);
      return p ? { ...r, _transferPair: p } : r;
    });
  };

  const handleMergeTransfer = (rowId) => {
    setResults(prev => {
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
    setResults(prev => prev.map(r => r._id === id ? { ...r, ...patch } : r));

  const isReimburseAccount = (acc) =>
    String(acc.account_no || "").includes("0830267743") ||
    acc.name?.toLowerCase().includes("reimburse") ||
    acc.subtype === "reimburse";

  // ── Build rows from AI response ───────────────────────────────
  const buildRows = (parsed, defaultAccId = "") => {
    const fallbackAccId = defaultAccId || spendAccounts[0]?.id || "";
    return (parsed || []).map((r, i) => {
      let txType = r.type || r.tx_type || "expense";
      const hasAccountMatch = !!r.from_account_id;
      const defaultFrom = ["expense","pay_cc","reimburse_out"].includes(txType) ? fallbackAccId : "";
      const defaultTo   = ["income","transfer","reimburse_in"].includes(txType) ? (bankAccounts[0]?.id  || "") : "";
      let fromId  = r.from_account_id || defaultFrom;
      let toId    = r.to_account_id   || defaultTo;
      let flagged = false;

      if (txType !== "reimburse_in" && toId) {
        const toAcc = accounts.find(a => a.id === toId);
        if (toAcc && isReimburseAccount(toAcc)) { txType = "reimburse_in"; flagged = true; }
      }
      if (txType === "reimburse_in") flagged = true;

      let aiCatId  = r.category || r.suggested_category || "other";
      const txDate = r.date || r.tx_date || todayStr();
      const desc   = r.description || r.merchant_name || "";
      const currency = (r.currency || "IDR").toUpperCase();
      const isFX     = currency !== "IDR";
      const fxRate   = isFX ? String(r.fx_rate_used || r.rate || getDefaultRate(currency)) : "1";
      const parseAmount = (raw) => {
        if (raw == null) return 0;
        if (typeof raw === 'number') return Math.abs(raw);
        const cleaned = String(raw).replace(/[^0-9.]/g, '');
        const parsed  = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : Math.abs(parsed);
      };
      const amount   = parseAmount(r.amount);
      const amtIDR   = isFX ? String(Math.round(amount * Number(fxRate))) : String(r.amount_idr || amount);

      const norm = normaliseTxType(txType, aiCatId);
      txType  = norm.tx_type;
      aiCatId = norm.category_id;

      const fixed = fixTransferType({ tx_type: txType, from_account_id: fromId, to_account_id: toId, to_account_no: r.to_account_no, from_account_no: r.from_account_no });
      txType = fixed.tx_type;
      if (fixed.to_account_id === null) toId = "";

      const kwMatch = applyKeywordRules(desc, isFX ? Number(amtIDR) : amount);
      if (kwMatch) { txType = kwMatch.tx_type; aiCatId = kwMatch.category_id; }

      // BI Fast outgoing to own bank → reclassify as transfer
      // e.g. "Transfer BI Fast Ke SMBC INDONESIA" where user has SMBC/Jenius account
      if (txType === "expense" && /bi[\s-]*fast\s+ke|bifast\s+ke/i.test(desc)) {
        const descLower = desc.toLowerCase();
        // Build set of own-bank tokens from accounts (words ≥ 3 chars from bank_name)
        const ownBankTokens = new Set();
        accounts.forEach(a => {
          (a.bank_name || "").split(/\s+/).forEach(w => {
            if (w.length >= 3) ownBankTokens.add(w.toLowerCase());
          });
          // Also check account name tokens
          (a.name || "").split(/\s+/).forEach(w => {
            if (w.length >= 4) ownBankTokens.add(w.toLowerCase());
          });
          // Explicit aliases: SMBC Indonesia = Jenius
          if (/(smbc|jenius)/i.test(a.bank_name || "")) {
            ownBankTokens.add("smbc"); ownBankTokens.add("jenius");
          }
        });
        if ([...ownBankTokens].some(token => descLower.includes(token))) {
          txType = "transfer";
          aiCatId = null;
          // Try to auto-set to_id to the matching account
          if (!toId) {
            const matchAcc = accounts.find(a => {
              const bnLower = (a.bank_name || "").toLowerCase();
              const nameTokenMatch = (a.bank_name || "").split(/\s+/).some(w => (w.length >= 3) && descLower.includes(w.toLowerCase()));
              const smbcMatch = (/(smbc|jenius)/i.test(a.bank_name || "")) && descLower.includes("smbc");
              return nameTokenMatch || smbcMatch;
            });
            if (matchAcc) toId = matchAcc.id;
          }
        }
      }

      const learnedSuggestion = !NO_CAT.has(txType)
        ? merchantRules.apply(desc, r.merchant_name || "", merchantMaps)
        : null;
      let catId = NO_CAT.has(txType) ? null : aiCatId;
      if (learnedSuggestion?.confidence >= 2) catId = learnedSuggestion.category_id;

      const dupResult = checkDuplicateTransaction(ledger, {
        tx_date: txDate, amount_idr: amtIDR, currency, from_id: fromId, description: desc,
      });
      const dupStatus = dupResult
        ? (dupResult.level === "red" ? "duplicate" : dupResult.level === "orange" ? "possible_duplicate" : "review")
        : "new";

      return {
        _id:          i,
        tx_date:      txDate,
        description:  desc,
        merchant_name: r.merchant_name || "",
        amount:       String(amount),
        currency,
        fx_rate:      fxRate,
        amount_idr:   amtIDR,
        tx_type:      txType,
        from_id:      fromId,
        to_id:        toId,
        entity:       REIMBURSE_ENTITIES.includes(r.entity) ? r.entity : "Hamasa",
        category_id:  catId,
        ai_category:  aiCatId,
        learned_cat:  learnedSuggestion,
        notes:        r.notes || "",
        flagged,
        _hasAccountMatch: hasAccountMatch,
        _invalidAmount: amount <= 0,
        _dupEntry:    dupResult?.matchEntry || null,
        _dupReasons:  dupResult?.reasons   || [],
        status:       dupStatus,
      };
    });
  };

  // ── File scan ────────────────────────────────────────────────
  const handleFile = async (file) => {
    if (!file) return;
    setScanning(true);
    setResults([]);
    setSelected({});
    setSkippedFPs(new Set()); // new upload → clear all skip history
    setBatchId(null);
    setBatchFilePath(null);
    // Store blob URL for thumbnail strip (images only — PDFs shown via iframe)
    setImageBlobUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setImageBlobUrls([URL.createObjectURL(file)]);
    }

    let newBatchId = null;
    let filePath   = null;

    try {
      // 1. Upload file to Storage
      try {
        filePath = `${user.id}/${crypto.randomUUID()}${file.name.endsWith(".pdf") ? ".pdf" : ".jpg"}`;
        await supabase.storage.from("ai-scan-uploads").upload(filePath, file, { upsert: true });
      } catch { filePath = null; } // don't block scan if upload fails

      // 2. Create batch record
      try {
        const batch = await scanApi.createBatch(user.id, {
          source_type: "ai_scan", file_name: file.name, file_size: file.size,
          file_path: filePath, status: "processing",
        });
        newBatchId = batch.id;
        setBatchId(batch.id);
        setBatchFilePath(filePath);
      } catch { /* non-critical */ }

      // 3. Scan with AI
      const bankAcc  = defaultAccountId ? spendAccounts.find(a => a.id === defaultAccountId) : null;
      const bankHint = bankAcc?.bank_name || bankAcc?.name || "";
      const parsed = await scanApi.scan(user.id, file, { accounts, bankHint });
      const items  = enrichTransfers(buildRows(parsed, defaultAccountId).map(r => ({ ...r, _sourceFile: file.name })));

      // 4. Save results to DB
      if (newBatchId) {
        scanApi.updateBatch(newBatchId, {
          status: "extracted", ai_raw_result: parsed,
          total_detected: items.length, processed_at: new Date().toISOString(),
        }).catch(() => {});
      }

      setResults(items);
      const sel = {};
      items.forEach(r => { sel[r._id] = r.status !== "duplicate"; });
      setSelected(sel);
    } catch (e) {
      if (newBatchId) scanApi.updateBatch(newBatchId, { status: "failed" }).catch(() => {});
      showToast(e.message || "Scan failed", "error");
    }
    setScanning(false);
  };

  // ── Multi-file scan ──────────────────────────────────────────
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList).filter(Boolean);
    if (!files.length) return;
    if (files.length === 1) { handleFile(files[0]); return; }

    setScanning(true);
    setResults([]); setSelected({}); setSkippedFPs(new Set());
    setBatchId(null); setBatchFilePath(null);
    setImageBlobUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });

    const bankAcc  = defaultAccountId ? spendAccounts.find(a => a.id === defaultAccountId) : null;
    const bankHint = bankAcc?.bank_name || bankAcc?.name || "";
    let allItems = [];

    for (let i = 0; i < files.length; i++) {
      setProcessingProgress({ current: i + 1, total: files.length });
      try {
        const parsed = await scanApi.scan(user.id, files[i], { accounts, bankHint });
        const rows = buildRows(parsed, defaultAccountId).map(r => ({ ...r, _sourceFile: files[i].name }));
        allItems = [...allItems, ...rows];
      } catch (e) { showToast(`${files[i].name}: ${e.message || "Scan failed"}`, "error"); }
    }

    const items = enrichTransfers(allItems);
    setResults(items);
    const sel = {};
    items.forEach(r => { sel[r._id] = r.status !== "duplicate"; });
    setSelected(sel);
    setProcessingProgress(null);
    setScanning(false);
  };

  // ── Refresh Scan ─────────────────────────────────────────────
  const handleRefreshScan = async () => {
    if (!batchFilePath) { showToast("File not found for re-scan", "error"); return; }
    setScanning(true);
    setResults([]);
    setSelected({});
    try {
      const { data: blob, error } = await supabase.storage.from("ai-scan-uploads").download(batchFilePath);
      if (error || !blob) throw new Error("Could not download file");
      const file = new File([blob], "rescan.jpg", { type: blob.type || "image/jpeg" });
      const bankAccR  = defaultAccountId ? spendAccounts.find(a => a.id === defaultAccountId) : null;
      const bankHintR = bankAccR?.bank_name || bankAccR?.name || "";
      const parsed = await scanApi.scan(user.id, file, { accounts, bankHint: bankHintR });
      let items = buildRows(parsed, defaultAccountId);
      // Filter out previously skipped rows (by fingerprint)
      if (skippedFPs.size > 0) {
        items = items.filter(r => !skippedFPs.has(`${r.tx_date}|${r.amount_idr}|${(r.description || "").toLowerCase().trim()}`));
      }
      items = enrichTransfers(items);
      if (batchId) scanApi.updateBatch(batchId, { ai_raw_result: parsed, total_detected: items.length, processed_at: new Date().toISOString() }).catch(() => {});
      setResults(items);
      const sel = {};
      items.forEach(r => { sel[r._id] = r.status !== "duplicate"; });
      setSelected(sel);
    } catch (e) { showToast(e.message || "Refresh failed", "error"); }
    setScanning(false);
  };

  // ── Retry with Sonnet ────────────────────────────────────────
  const handleRetrySonnet = async () => {
    if (!batchFilePath) { showToast("File not found for re-scan", "error"); return; }
    setRetrySonnet(true);
    setResults([]);
    setSelected({});
    try {
      const { data: blob, error } = await supabase.storage.from("ai-scan-uploads").download(batchFilePath);
      if (error || !blob) throw new Error("Could not download file");
      const file = new File([blob], "rescan.jpg", { type: blob.type || "image/jpeg" });
      const bankAccR  = defaultAccountId ? spendAccounts.find(a => a.id === defaultAccountId) : null;
      const bankHintR = bankAccR?.bank_name || bankAccR?.name || "";
      const parsed = await scanApi.scan(user.id, file, { accounts, bankHint: bankHintR, model: "claude-sonnet-4-20250514" });
      let items = buildRows(parsed, defaultAccountId);
      if (skippedFPs.size > 0) {
        items = items.filter(r => !skippedFPs.has(`${r.tx_date}|${r.amount_idr}|${(r.description || "").toLowerCase().trim()}`));
      }
      items = enrichTransfers(items);
      if (batchId) scanApi.updateBatch(batchId, { ai_raw_result: parsed, total_detected: items.length, processed_at: new Date().toISOString() }).catch(() => {});
      setResults(items);
      const sel = {};
      items.forEach(r => { sel[r._id] = r.status !== "duplicate"; });
      setSelected(sel);
    } catch (e) { showToast(e.message || "Re-scan failed", "error"); }
    setRetrySonnet(false);
  };

  // ── Build ledger entry ────────────────────────────────────────
  const buildEntry = (r) => {
    const isFX    = r.currency && r.currency !== "IDR";
    const fxRate  = isFX ? (Number(r.fx_rate) || 1) : 1;
    const amtOrig = Number(r.amount) || 0;
    const amtIDR  = isFX ? (Number(r.amount_idr) || Math.round(amtOrig * fxRate)) : amtOrig;
    // collect_loan: from_id holds employee_loan_id; ledger from_id is null
    if (r.tx_type === "collect_loan") {
      return {
        tx_date: r.tx_date, description: r.description,
        amount: amtOrig, currency: r.currency || "IDR",
        fx_rate_used: isFX ? fxRate : null, amount_idr: amtIDR,
        tx_type: "collect_loan", from_type: "employee_loan", to_type: "account",
        from_id: null, to_id: r.to_id || null,
        employee_loan_id: r.employee_loan_id || r.from_id || null,
        entity: "Personal", category_id: null, category_name: null,
        notes: r.notes || "", source: "ai_scan", scan_batch_id: batchId || null,
      };
    }
    const { from_type, to_type } = getTxFromToTypes(r.tx_type);
    return {
      tx_date:        r.tx_date,
      description:    r.description,
      amount:         amtOrig,
      currency:       r.currency || "IDR",
      fx_rate_used:   isFX ? fxRate : null,
      amount_idr:     amtIDR,
      tx_type:        r.tx_type,
      from_type, to_type,
      from_id:        r.from_id || null,
      to_id:          r.to_id   || null,
      entity:         REIMBURSE_TYPES.has(r.tx_type) ? (r.entity || "Hamasa") : "Personal",
      is_reimburse:   r.tx_type === "reimburse_out" || r.tx_type === "reimburse_in",
      ...(r.tx_type === "reimburse_out" ? { category_id: null, category_name: null } : resolveCategoryIds(r.category_id, categories)),
      notes:          r.notes || "",
      source:         "ai_scan",
      scan_batch_id:  batchId || null,
    };
  };

  // ── Import selected (bulk) ────────────────────────────────────
  const importSelected = async (toImport) => {
    const rows = toImport || results.filter(r => selected[r._id]);
    if (!rows.length) return showToast("Select at least one entry", "warning");
    const validRows   = rows.filter(r => !r._invalidAmount);
    const zeroSkipped = rows.length - validRows.length;
    if (!validRows.length) return showToast("All selected rows have missing amounts — edit them first", "warning");
    setImporting(true);
    let ok = 0, failed = 0;
    const newLedgerIds = [];
    for (const r of validRows) {
      try {
        const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
        if (created) {
          if (created.id) newLedgerIds.push(created.id);
          setLedger(prev => [created, ...prev]); ok++;
          if (r.tx_type === "collect_loan" && (r.employee_loan_id || r.from_id)) {
            loanPaymentsApi.recordAndIncrement(user.id, {
              loanId: r.employee_loan_id || r.from_id, payDate: r.tx_date,
              amount: Number(r.amount_idr || r.amount || 0),
              notes: r.description || "Collected via import",
            }).catch(e => console.error("[collect_loan payment]", e));
          }
          if (r._cicilan && r._cicilanMonths >= 2) {
            installmentsApi.createFromImport(user.id, {
              ledgerId: created.id, description: r.description || "", accountId: r.from_id,
              amount: Number(r.amount_idr || r.amount || 0), totalMonths: r._cicilanMonths,
              paidMonths: r._cicilanKe || 1,
              currency: r.currency || "IDR", txDate: r.tx_date, categoryId: r.category_id || null,
            }).catch(e => console.error("[cicilan import]", e));
          }
        }
      } catch (e) { failed++; console.error("[importSelected] row failed:", r.description, e); }
    }
    // Mark all as skipped (remove from view)
    const importedIds = new Set(validRows.map(r => r._id));
    setResults(prev => prev.filter(r => !importedIds.has(r._id)));
    setSelected(s => { const ns = { ...s }; importedIds.forEach(id => delete ns[id]); return ns; });
    setConfirmedCount(n => n + ok);
    const remaining = results.filter(r => !importedIds.has(r._id));
    if (batchId && remaining.length === 0) {
      scanApi.updateBatch(batchId, { status: "imported", total_imported: ok }).catch(() => {});
      draft.clearDraft();
    }
    await onRefresh();
    const skipNote = zeroSkipped > 0 ? `. ${zeroSkipped} skipped (amount = 0)` : "";
    const failNote = failed > 0 ? `. ${failed} failed` : "";
    showToast(`Imported ${ok} of ${rows.length} entries${skipNote}${failNote}`, failed > 0 ? "warning" : undefined);
    if (newLedgerIds.length) undoManager.register({ type: "save_batch", ids: newLedgerIds, label: `Saved ${newLedgerIds.length} transaction${newLedgerIds.length !== 1 ? "s" : ""}` });
    setImporting(false);
  };

  // ── Import single row ─────────────────────────────────────────
  const importOne = async (r) => {
    if (r._invalidAmount) return showToast("Amount is required — edit the row first", "error");
    try {
      const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
      if (created) {
        setLedger(prev => [created, ...prev]);
        if (r.tx_type === "collect_loan" && r.from_id) {
          loanPaymentsApi.recordAndIncrement(user.id, {
            loanId: r.from_id, payDate: r.tx_date,
            amount: Number(r.amount_idr || r.amount || 0),
            notes: r.description || "Collected via import",
          }).catch(e => console.error("[collect_loan payment]", e));
        }
        if (r._cicilan && r._cicilanMonths >= 2) {
          installmentsApi.createFromImport(user.id, {
            ledgerId: created.id, description: r.description || "", accountId: r.from_id,
            amount: Number(r.amount_idr || r.amount || 0), totalMonths: r._cicilanMonths,
            paidMonths: r._cicilanKe || 1,
            currency: r.currency || "IDR", txDate: r.tx_date, categoryId: r.category_id || null,
          }).catch(e => console.error("[cicilan import]", e));
        }
        setResults(prev => prev.filter(x => x._id !== r._id));
        setSelected(s => { const ns = { ...s }; delete ns[r._id]; return ns; });
        setConfirmedCount(n => n + 1);
        showToast(`Imported: ${r.description}`);
      }
    } catch (e) { showToast(e.message, "error"); }
  };

  const toggleAll = () => {
    const cur = results.every(r => selected[r._id]);
    const ns = {};
    results.forEach(r => { ns[r._id] = !cur; });
    setSelected(ns);
  };

  // Permanently remove a row from the list; remember its fingerprint so it stays gone after Refresh Scan
  const skipRow = (id) => {
    const row = results.find(r => r._id === id);
    if (row) {
      const fp = `${row.tx_date}|${row.amount_idr}|${(row.description || "").toLowerCase().trim()}`;
      setSkippedFPs(prev => new Set([...prev, fp]));
    }
    setResults(prev => prev.filter(r => r._id !== id));
    setSelected(s => { const ns = { ...s }; delete ns[id]; return ns; });
    setSkippedCount(n => n + 1);
  };

  // Change default account — patches all rows without a specific AI-matched account
  const handleDefaultAccountChange = (id) => {
    setDefaultAccountId(id);
    setResults(prev => prev.map(r =>
      r._hasAccountMatch ? r : { ...r, from_id: id }
    ));
  };

  // Clear All: delete batch + file from DB/Storage, reset to empty state
  const handleClearAll = async () => {
    if (!window.confirm("Remove all extracted transactions? This cannot be undone.")) return;
    setResults([]);
    setSelected({});
    setSkippedFPs(new Set());
    draft.clearDraft();
    try {
      if (batchId) {
        await supabase.from("scan_batches").delete().eq("id", batchId);
      }
      if (batchFilePath) {
        await supabase.storage.from("ai-scan-uploads").remove([batchFilePath]);
      }
    } catch { /* non-critical */ }
    setBatchId(null);
    setBatchFilePath(null);
    setImageBlobUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
  };

  // ─────────────────────────────────────────────────────────────
  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const files = e.dataTransfer.files; if (files.length) handleFiles(files); }}
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
        <input ref={fileRef} type="file" accept="image/*,.pdf" multiple style={{ display: "none" }}
          onChange={e => { const f = e.target.files; if (f?.length) handleFiles(f); e.target.value = ""; }} />
        {!scanning
          ? <div style={{ marginTop: 12 }}><Button variant="primary" size="sm">Choose File(s)</Button></div>
          : <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: T.text2 }}>
              <Spinner size={16} /> {processingProgress ? `Scanning ${processingProgress.current}/${processingProgress.total}…` : "Scanning with AI…"}
            </div>
        }
      </div>

      {/* Image thumbnail strip — shown when non-PDF files were scanned */}
      {imageBlobUrls.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "8px", background: "#f9fafb", borderRadius: 8 }}>
          {imageBlobUrls.map((url, i) => (
            <img key={i} src={url} alt={`receipt ${i + 1}`}
              onClick={() => setZoomUrl(url)}
              style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 6, cursor: "pointer", border: "1px solid #e5e7eb" }}
            />
          ))}
        </div>
      )}

      {/* Account selector — shown below drop zone once results exist */}
      {results.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`,
          background: T.sur2,
        }}>
          <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
            Account:
          </span>
          <select
            value={defaultAccountId}
            onChange={e => handleDefaultAccountChange(e.target.value)}
            style={{
              fontSize: 12, padding: "4px 6px", borderRadius: 6,
              border: "1px solid #e5e7eb", background: "#fff", color: "#111827",
              fontFamily: "Figtree, sans-serif", cursor: "pointer", height: 30,
            }}>
            <option value="">— account —</option>
            {[
              { type: "bank",        label: "Bank"         },
              { type: "cash",        label: "Cash"         },
              { type: "credit_card", label: "Credit Card"  },
            ].map(g => {
              const grp = spendAccounts.filter(a => g.type === "bank" ? (a.type === "bank" && !/cash/i.test(a.subtype || "")) : g.type === "cash" ? (a.type === "cash" || a.subtype === "cash") : a.type === g.type);
              if (!grp.length) return null;
              return (
                <optgroup key={g.type} label={g.label}>
                  {grp.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.name}{a.bank_name && a.bank_name !== a.name ? ` · ${a.bank_name}` : ""}{a.card_last4 ? ` ···${a.card_last4}` : ""}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "Figtree, sans-serif", whiteSpace: "nowrap" }}>
            (applies to all rows)
          </span>
        </div>
      )}

      {/* Draft resume banner */}
      {draft.showBanner && results.length === 0 && (
        <DraftBanner draftInfo={draft.draftInfo} onResume={draft.resume} onDiscard={draft.discard} />
      )}

      {/* Results */}
      {(results.length > 0 || confirmedCount > 0 || skippedCount > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(confirmedCount > 0 || skippedCount > 0) && (
            <ProgressIndicator
              label="Review"
              total={results.length + confirmedCount + skippedCount}
              processed={confirmedCount + skippedCount}
              pending={results.length}
            />
          )}
          {results.length > 0 && (
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: "Figtree, sans-serif" }}>
              {results.length} transactions found
            </div>
          )}
          {results.length > 0 && <TxHorizontal
            rows={results}
            selected={selected}
            onUpdateRow={updateRow}
            onConfirmRow={importOne}
            onSkipRow={skipRow}
            onConfirmAll={importSelected}
            onToggleSelect={id => setSelected(s => ({ ...s, [id]: !s[id] }))}
            onToggleAll={toggleAll}
            source="ai_scan"
            accounts={accounts}
            employeeLoans={employeeLoans}
            T={T}
            busy={importing}
            onRefreshScan={batchFilePath ? handleRefreshScan : null}
            onRetrySonnet={batchFilePath ? handleRetrySonnet : null}
            retrySonnet={retrySonnet}
            onClearAll={handleClearAll}
            onMergeTransfer={handleMergeTransfer}
          />}
        </div>
      )}
    </div>

    {/* Image zoom modal */}
    {zoomUrl && (
      <Modal isOpen={!!zoomUrl} onClose={() => setZoomUrl(null)} title="Receipt Image" width={800}>
        <img src={zoomUrl} alt="zoomed" style={{ maxWidth: "100%", maxHeight: "75vh", margin: "0 auto", display: "block" }} />
      </Modal>
    )}
    </>
  );
}
