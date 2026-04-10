// ─────────────────────────────────────────────────────────────────
// gmail-estatement/index.ts
// Actions:
//   "scan"      → search Gmail for bank PDF attachments → insert estatement_pdfs
//   "process"   → download PDF → send to Claude AI (Claude reads natively)
//   "mark_done" → mark statement as done
//
// Deploy: supabase functions deploy gmail-estatement --no-verify-jwt
// ─────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BANK_DOMAINS = [
  "klikbca.com", "bca.co.id",
  "bankmandiri.co.id", "mandiri.co.id",
  "bni.co.id", "cimbniaga.co.id",
  "bri.co.id", "jenius.com",
  "gojek.com", "gopay.co.id",
  "ovo.id", "dana.id", "shopee.co.id",
  "blu.co.id", "ocbc.id",
  "danamon.co.id", "maybank.co.id",
  "uob.co.id", "citibank.co.id",
  "hsbc.co.id", "mayapada.co.id",
  "bankmega.com", "permatabank.com",
  "btn.co.id", "superbank.id",
  "neobank.id", "sea.com",
  "smbci.com", "btpn.com",
  "mybca.com", "bcadigital.co.id",
  "mandirisyariah.co.id", "livin.id",
  "brimo.bri.co.id", "ocbcnisp.com",
  "ocbcnisp.co.id", "danamonline.com",
  "cimb.com", "uobgroup.com",
  "hsbc.com", "megasyariah.co.id",
  "permatabank.co.id",
  "noreply.jenius.com", "info.jenius.com",
  "bdi.co.id", "maybank.co.id", "hsbc.co.id",
];

// Derive a bank name from sender email domain
function bankNameFromDomain(senderEmail: string): string {
  const domain = senderEmail.split("@")[1]?.toLowerCase() || "";
  if (domain.includes("bca"))       return "BCA";
  if (domain.includes("mandiri"))   return "Mandiri";
  if (domain.includes("bni"))       return "BNI";
  if (domain.includes("bri"))       return "BRI";
  if (domain.includes("cimb"))      return "CIMB Niaga";
  if (domain.includes("jenius") || domain.includes("smbci") || domain.includes("btpn")) return "Jenius";
  if (domain.includes("ocbc"))      return "OCBC";
  if (domain.includes("danamon"))   return "Danamon";
  if (domain.includes("maybank"))   return "Maybank";
  if (domain.includes("uob"))       return "UOB";
  if (domain.includes("citibank"))  return "Citibank";
  if (domain.includes("hsbc"))      return "HSBC";
  if (domain.includes("permata"))   return "Permata";
  if (domain.includes("mega"))      return "Bank Mega";
  if (domain.includes("btn"))       return "BTN";
  if (domain.includes("superbank")) return "Superbank";
  if (domain.includes("blu"))       return "Blu";
  return domain;
}

// Resolve password variables
function resolvePassword(pattern: string, vars: Record<string, string>): string {
  return pattern
    .replace(/\{DDMMYYYY\}/g, vars.DDMMYYYY || "")
    .replace(/\{account_no\}/g, vars.account_no || "")
    .replace(/\{last4\}/g, vars.last4 || "");
}

// Refresh OAuth access token
async function refreshAccessToken(token: any, clientSecret: string): Promise<string | null> {
  if (!token.refresh_token) return null;
  const clientId = token.client_id || Deno.env.get("GOOGLE_CLIENT_ID") || "";
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token,
      grant_type:    "refresh_token",
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

// Get valid Gmail access token for user
async function getAccessToken(serviceSupabase: any, userId: string, googleSecret: string): Promise<string | null> {
  const { data: tokenRow } = await serviceSupabase
    .from("gmail_tokens").select("*").eq("user_id", userId).single();
  if (!tokenRow) return null;

  let accessToken = tokenRow.access_token;
  if (tokenRow.token_expiry && new Date(tokenRow.token_expiry) < new Date(Date.now() + 60000)) {
    const newToken = await refreshAccessToken(tokenRow, googleSecret);
    if (newToken) {
      accessToken = newToken;
      const newExpiry = new Date(Date.now() + 3500 * 1000).toISOString();
      await serviceSupabase.from("gmail_tokens")
        .update({ access_token: newToken, token_expiry: newExpiry })
        .eq("user_id", userId);
    }
  }
  return accessToken;
}

// ── HELPER: download PDF from Gmail ───────────────────────────
async function downloadPDFFromGmail(accessToken: string, messageId: string): Promise<string> {
  const msgRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msgRes.ok) throw new Error("Failed to fetch Gmail message");
  const msgData = await msgRes.json();

  const allParts: any[] = [];
  const collectParts = (part: any) => {
    if (!part) return;
    allParts.push(part);
    if (part.parts) part.parts.forEach(collectParts);
  };
  collectParts(msgData.payload);

  const pdfPart = allParts.find((p: any) =>
    p.filename?.toLowerCase().endsWith(".pdf") || p.mimeType === "application/pdf"
  );
  if (!pdfPart?.body?.attachmentId) throw new Error("No PDF attachment found in message");

  const attRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${pdfPart.body.attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!attRes.ok) throw new Error("Failed to download PDF attachment");
  const attData = await attRes.json();
  // Gmail returns base64url-encoded data
  const pdfBase64 = (attData.data || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!pdfBase64) throw new Error("Empty PDF attachment");
  return pdfBase64;
}

// ── ACTION: scan ───────────────────────────────────────────────
async function scanGmailForStatements(
  serviceSupabase: any, userId: string, accessToken: string,
  fromDate?: string, toDate?: string
) {
  const afterPart  = fromDate ? ` after:${fromDate.replace(/-/g, "/")}` : "";
  const beforePart = toDate   ? ` before:${toDate.replace(/-/g, "/")}` : "";

  const subjectQuery = [
    "subject:statement",
    'subject:estatement',
    'subject:"e-statement"',
    'subject:"e statement"',
    "subject:rekening",
    'subject:"laporan rekening"',
    'subject:"laporan transaksi"',
    'subject:"pernyataan transaksi"',
    "subject:tagihan",
    'subject:"kartu kredit"',
    'subject:"credit card"',
    'subject:"consolidated statement"',
  ].join(" OR ");

  const query = `has:attachment filename:pdf (${subjectQuery})${afterPart}${beforePart}`;

  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Gmail list failed: ${err}`);
  }
  const listData = await listRes.json();
  const messages: any[] = listData.messages || [];
  console.log(`[gmail-estatement] found ${messages.length} candidate messages`);

  if (messages.length === 0) return { new_pdfs: 0, total_found: 0 };

  const msgIds = messages.map((m: any) => m.id);
  // Any existing row (any status including 'skipped') counts as known — never re-pull
  const { data: existingRows } = await serviceSupabase
    .from("estatement_pdfs")
    .select("gmail_message_id")
    .eq("user_id", userId)
    .in("gmail_message_id", msgIds);
  const knownIds = new Set((existingRows || []).map((r: any) => r.gmail_message_id));
  const newMsgs  = messages.filter((m: any) => !knownIds.has(m.id));

  if (newMsgs.length === 0) return { new_pdfs: 0, total_found: messages.length };

  const metaResults = await Promise.all(
    newMsgs.map((msg: any) =>
      fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}` +
        `?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      ).then(r => r.ok ? r.json() : null)
    )
  );

  const MONTHS: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  let newCount = 0;
  for (let i = 0; i < newMsgs.length; i++) {
    const msgData = metaResults[i];
    if (!msgData) continue;

    const headers     = msgData.payload?.headers || [];
    const subject     = headers.find((h: any) => h.name === "Subject")?.value || "";
    const from        = headers.find((h: any) => h.name === "From")?.value    || "";
    const dateHdr     = headers.find((h: any) => h.name === "Date")?.value    || "";
    const senderMatch = from.match(/<(.+)>/);
    const senderEmail = (senderMatch?.[1] || from).toLowerCase().trim();
    const bankName    = bankNameFromDomain(senderEmail);

    let statementMonth: string | null = null;
    const monthMatch = (subject + " " + dateHdr).match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-]*(\d{4})\b/i
    );
    if (monthMatch) {
      const mo = MONTHS[monthMatch[1].toLowerCase().slice(0, 3)];
      if (mo) statementMonth = `${monthMatch[2]}-${mo}`;
    }

    await serviceSupabase.from("estatement_pdfs").insert({
      user_id:          userId,
      gmail_message_id: newMsgs[i].id,
      filename:         subject || `${bankName}_statement`,
      bank_name:        bankName,
      statement_month:  statementMonth,
      status:           "pending",
    });
    newCount++;
  }

  return { new_pdfs: newCount, total_found: messages.length };
}

const EXTRACTION_PROMPT = `You are an expert at extracting transactions from Indonesian bank and credit card statements.

EXTRACT only actual financial transactions. Return a JSON array.

INCLUDE these transaction types:
- Regular purchases/expenses (merchant name + amount)
- Installment payments (CICILAN/INSTALLMENT - note the X/Y pattern and total)
- Bank fees: biaya admin, biaya layanan notifikasi, bea materai (stamp duty), iuran tahunan, bunga, denda, provisi
- Foreign currency transactions (extract both IDR amount and original currency/amount if shown)
- Transfers OUT (DEBIT column / direction "out")

SKIP these completely:
- BALANCE OF LAST MONTH / Saldo awal bulan lalu / SALDO BULAN LALU
- Payment received / Pembayaran diterima / (-) Pembayaran
- Summary sections: RINGKASAN TAGIHAN, RINGKASAN TREATS, BUNGA DAN TOTAL TRANSAKSI
- TOTAL rows and END OF STATEMENT
- Promotional text, advertisements, discount offers
- Credit limit info, minimum payment info
- Header/footer info (name, address, card number)
- Barcode, QR code references
- TAX Deducted with amount < 1000 (withholding tax noise)
- Credit Interest Capitalised (bank interest earned, skip)

DEBIT/KREDIT column format (Danamon consolidated statement style):
- DEBIT column = money OUT → direction "out"
- KREDIT column = money IN (transfers received, reversals) → direction "in" — SKIP these
- SALDO column = running balance, ignore entirely
- Section headers like "DANAMON LEBIH PRO (IDR) - IDR - 903691853372"
  → extract account number (last segment) and set account_hint for all rows in that section
- Section headers like "KARTU KREDIT JCB - 3567XXXXXX459551"
  → extract card last 4 digits ("9551") and set card_last4 for all rows in that section

FOR EACH TRANSACTION return:
{
  "date": "YYYY-MM-DD",
  "description": "full description as written",
  "merchant": "cleaned merchant name (no codes, no installment suffix)",
  "amount": 150000,
  "direction": "out",
  "currency_original": "USD",
  "amount_original": 6.66,
  "rate_used": 17182.95,
  "is_installment": false,
  "installment_current": null,
  "installment_total": null,
  "is_fee": false,
  "fee_type": null,
  "is_transfer": false,
  "card_last4": null,
  "account_hint": null
}

Field notes:
- amount: always positive number in IDR
- direction: "out" for expenses/debits, "in" for credits (income/transfers in)
- currency_original / amount_original / rate_used: fill if foreign currency shown, else null
- is_installment: true if CICILAN/INSTALLMENT row
- installment_current / installment_total: CRITICAL — always extract both numbers from "X/Y" pattern.
  Example: "TOKOPEDIA_CYBS_CCL12 : 7/12" → installment_current=7, installment_total=12.
  Example: "CICILAN KE-3 DARI 24" → installment_current=3, installment_total=24.
  Never leave these null if the row is an installment — look hard for the X/Y pattern in description.
- merchant: for installments, strip the installment suffix. "TOKOPEDIA_CYBS_CCL12" → "TOKOPEDIA".
  Remove codes like _CYBS_, _CCL, trailing digits, etc.
- is_fee: true if bank fee/charge (admin, stamp duty/materai/bea materai, annual fee, bunga, denda, notifikasi)
- fee_type: "stamp_duty" | "admin" | "annual_fee" | "interest" | "notification" | "penalty" | null
- is_transfer: true if description contains "Transfer ke" or "Transfer dari"
- card_last4: last 4 digits of card if shown next to the transaction, else null
- account_hint: account number from section header if applicable, else null

Return ONLY valid JSON array. No markdown, no explanation.
If no transactions found, return [].`;

// ── HELPER: try to decrypt PDF with pdf-lib ────────────────────
// Returns { base64: string } on success, or { error: 'wrong_password'|'unsupported' }
async function tryDecryptPDF(
  pdfBase64: string, password: string
): Promise<{ base64: string } | { error: "wrong_password" | "unsupported" }> {
  try {
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const pdfDoc = await PDFDocument.load(bytes, { password });
    const saved  = await pdfDoc.save();
    // Use Array.from for reliable base64 encoding in Deno
    const base64 = btoa(
      Array.from(new Uint8Array(saved))
        .map((b: number) => String.fromCharCode(b))
        .join("")
    );
    return { base64 };
  } catch (e: any) {
    const msg = String(e?.message || e).toLowerCase();
    // pdf-lib can't handle this encryption type (AES-256, etc.)
    if (msg.includes("unsupport") || msg.includes("aes") || msg.includes("encrypt") && !msg.includes("password")) {
      return { error: "unsupported" };
    }
    return { error: "wrong_password" };
  }
}

// ── HELPER: send PDF bytes to Claude, return extracted transactions ─
type ClaudeResult =
  | { ok: true;  transactions: any[] }
  | { ok: false; is_encrypted: true }
  | { ok: false; is_encrypted: false; error: string };

async function callClaude(pdfBase64: string, prompt: string, anthropicKey: string): Promise<ClaudeResult> {
  // Log sizes to debug large PDF issues
  const base64Len = pdfBase64.length;
  const approxBytes = Math.round(base64Len * 0.75);
  console.log(`[gmail-estatement] callClaude: base64_len=${base64Len} approx_bytes=${approxBytes}`);

  // Claude document API has ~32MB base64 limit (~24MB raw); warn at 10MB
  if (approxBytes > 10 * 1024 * 1024) {
    console.error(`[gmail-estatement] PDF too large: ${approxBytes} bytes`);
    return { ok: false, is_encrypted: false, error: "PDF too large to process automatically (>10MB). Please use AI Import / Scan instead." };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta":    "pdfs-2024-09-25",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 16000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });

  // 400 from Claude usually means the PDF is encrypted/invalid
  if (res.status === 400) {
    const errText = await res.text();
    console.error(`[gmail-estatement] Claude 400 error: ${errText}`);
    return { ok: false, is_encrypted: true };
  }
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[gmail-estatement] Claude ${res.status}: ${errText.slice(0, 500)}`);
    return { ok: false, is_encrypted: false, error: `Claude API error: ${res.status}` };
  }

  const data    = await res.json();
  const rawText = data.content?.[0]?.text || "";
  console.log(`[gmail-estatement] Claude response length=${rawText.length}`);

  // Claude explicitly says it can't read the PDF (encrypted)
  if (rawText.length < 500 && /password|encrypt|cannot\s+(read|access|open)|protected/i.test(rawText)) {
    return { ok: false, is_encrypted: true };
  }

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { ok: false, is_encrypted: false, error: "No transactions found in Claude response" };
  }
  try {
    const transactions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(transactions)) throw new Error("not array");
    return { ok: true, transactions };
  } catch {
    return { ok: false, is_encrypted: false, error: "Could not parse Claude response" };
  }
}

// ── ACTION: process ────────────────────────────────────────────
// Fallback chain:
//   1. Send raw PDF to Claude (handles owner-password / unencrypted PDFs)
//   2. If Claude says encrypted → try pdf-lib decrypt with each password
//   3. If pdf-lib succeeds → send decrypted PDF to Claude
//   4. If all passwords fail → needs_password (ask user)
//   5. If pdf-lib throws unsupported encryption → encryption_unsupported flag
async function processStatement(
  serviceSupabase: any, userId: string, accessToken: string,
  statementId: string, passwordPatterns: any[], userVars: Record<string, string>,
  anthropicKey: string, onlyPassword?: string
) {
  console.log(`[gmail-estatement] process: statement=${statementId}`);

  const { data: stmt, error: stmtErr } = await serviceSupabase
    .from("estatement_pdfs").select("*").eq("id", statementId).eq("user_id", userId).single();
  if (stmtErr || !stmt) throw new Error("Statement not found");

  await serviceSupabase.from("estatement_pdfs")
    .update({ status: "processing" }).eq("id", statementId);

  console.log(`[gmail-estatement] process: downloading PDF (message=${stmt.gmail_message_id})`);
  const pdfBase64 = await downloadPDFFromGmail(accessToken, stmt.gmail_message_id);
  const pdfBytes  = Math.round(pdfBase64.length * 0.75);
  console.log(`[gmail-estatement] process: PDF downloaded base64_len=${pdfBase64.length} approx_bytes=${pdfBytes}`);

  // ── Step 1: try Claude with raw PDF ───────────────────────────
  // Handles unencrypted PDFs and owner-password PDFs (read-only protection)
  console.log(`[gmail-estatement] process: step 1 — sending raw PDF to Claude`);
  let claudeResult = await callClaude(pdfBase64, EXTRACTION_PROMPT, anthropicKey);

  if (claudeResult.ok) {
    return await finalizeTransactions(serviceSupabase, statementId, claudeResult.transactions);
  }
  if (!claudeResult.is_encrypted) {
    // Non-encryption failure (bad PDF format, etc.)
    await serviceSupabase.from("estatement_pdfs")
      .update({ status: "pending" }).eq("id", statementId);
    return { success: false, error: claudeResult.error, needs_password: false, encrypted: false };
  }

  // ── Step 2: PDF is encrypted — try pdf-lib with passwords ─────
  const passwords: string[] = onlyPassword !== undefined
    ? (onlyPassword ? [onlyPassword] : [])
    : passwordPatterns.map((p: any) => resolvePassword(p.pattern || "", userVars)).filter(Boolean);

  console.log(`[gmail-estatement] process: step 2 — trying ${passwords.length} password(s) with pdf-lib`);

  let lastDecryptError: "wrong_password" | "unsupported" = "wrong_password";

  for (let i = 0; i < passwords.length; i++) {
    const pwd = passwords[i];
    const decResult = await tryDecryptPDF(pdfBase64, pwd);

    if ("base64" in decResult) {
      console.log(`[gmail-estatement] process: pdf-lib unlocked with password index ${i} — sending to Claude`);
      claudeResult = await callClaude(decResult.base64, EXTRACTION_PROMPT, anthropicKey);
      if (claudeResult.ok) {
        return await finalizeTransactions(serviceSupabase, statementId, claudeResult.transactions);
      }
      // Decrypted OK but Claude still couldn't extract — bad format
      await serviceSupabase.from("estatement_pdfs")
        .update({ status: "pending" }).eq("id", statementId);
      return {
        success: false,
        error: "PDF was decrypted but no transactions could be extracted. It may be a scanned image.",
        needs_password: false, encrypted: false,
      };
    }

    lastDecryptError = decResult.error;
    console.log(`[gmail-estatement] process: pdf-lib failed password ${i}: ${decResult.error}`);
  }

  // ── Step 3: all passwords exhausted ───────────────────────────
  await serviceSupabase.from("estatement_pdfs")
    .update({ status: "password_needed" }).eq("id", statementId);

  if (lastDecryptError === "unsupported") {
    return {
      success: false,
      needs_password: true,
      encrypted: true,
      encryption_unsupported: true,
      error: "This PDF uses advanced encryption (AES-256) that cannot be decrypted automatically. Please download and decrypt it manually, then upload via AI Import / Scan instead.",
    };
  }

  // Wrong passwords or no passwords provided — ask user
  return {
    success: false,
    needs_password: true,
    encrypted: true,
    encryption_unsupported: false,
    error: passwords.length > 0
      ? "None of the saved passwords worked. Enter the PDF password below."
      : "This PDF is password-protected. Enter the password below.",
  };
}

// ── HELPER: save transactions + update status ──────────────────
async function finalizeTransactions(serviceSupabase: any, statementId: string, transactions: any[]) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    await serviceSupabase.from("estatement_pdfs")
      .update({ status: "pending" }).eq("id", statementId);
    return { success: false, error: "No transactions found in this statement.", needs_password: false, encrypted: false };
  }
  console.log(`[gmail-estatement] process: extracted ${transactions.length} transactions`);
  await serviceSupabase.from("estatement_pdfs").update({
    status:            "parsed",
    transaction_count: transactions.length,
    processed_at:      new Date().toISOString(),
  }).eq("id", statementId);
  return { success: true, transactions, count: transactions.length };
}

// ── ACTION: mark_done ──────────────────────────────────────────
async function markDone(serviceSupabase: any, userId: string, statementId: string, txCount: number) {
  await serviceSupabase.from("estatement_pdfs").update({
    status:            "done",
    transaction_count: txCount,
    processed_at:      new Date().toISOString(),
  }).eq("id", statementId).eq("user_id", userId);
  return { success: true };
}

// ── SHARED: load password list + user vars from DB ─────────────
async function loadPasswordsAndVars(
  serviceSupabase: any, userId: string, body: any
): Promise<{ pwdList: any[]; vars: Record<string, string> }> {
  let pwdList = body.passwords;
  if (!pwdList) {
    const { data } = await serviceSupabase
      .from("estatement_password_list")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order");
    pwdList = data || [];
  }

  let vars: Record<string, string> = body.user_vars || {};
  if (!vars.DDMMYYYY) {
    const { data: setting } = await serviceSupabase
      .from("app_settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", "birth_date")
      .maybeSingle();
    if (setting?.value) {
      const parts = String(setting.value).split("-");
      if (parts.length === 3) vars.DDMMYYYY = `${parts[2]}${parts[1]}${parts[0]}`;
    }
  }

  return { pwdList, vars };
}

// ── MAIN HANDLER ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")              || "";
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_KEY")             || "";
  const GOOGLE_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")      || "";

  // Service role client — same pattern as gmail-sync
  const serviceSupabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }

  const userId = body.user_id;
  if (!userId) {
    return new Response(JSON.stringify({ error: "user_id required" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  console.log("[gmail-estatement] user_id:", userId, "action:", body.action);

  const action = body.action || "scan";

  try {
    const accessToken = await getAccessToken(serviceSupabase, userId, GOOGLE_SECRET);
    if (!accessToken && action !== "mark_done") {
      return new Response(JSON.stringify({ error: "Gmail not connected" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    let result: any;

    if (action === "scan") {
      result = await scanGmailForStatements(
        serviceSupabase, userId, accessToken!, body.from_date, body.to_date
      );

    } else if (action === "process") {
      const { statement_id } = body;
      if (!statement_id) throw new Error("statement_id required");

      const { pwdList, vars } = await loadPasswordsAndVars(serviceSupabase, userId, body);
      result = await processStatement(
        serviceSupabase, userId, accessToken!, statement_id,
        pwdList, vars, ANTHROPIC_KEY,
        body.only_password !== undefined ? body.only_password : undefined
      );

    } else if (action === "mark_done") {
      const { statement_id, tx_count } = body;
      if (!statement_id) throw new Error("statement_id required");
      result = await markDone(serviceSupabase, userId, statement_id, tx_count || 0);

    } else if (action === "process_upload") {
      // Direct PDF upload — no Gmail download needed
      const { pdf_base64 } = body;
      if (!pdf_base64) throw new Error("pdf_base64 required");

      const base64Len   = pdf_base64.length;
      const approxBytes = Math.round(base64Len * 0.75);
      console.log(`[gmail-estatement] process_upload: base64_len=${base64Len} approx_bytes=${approxBytes}`);

      if (approxBytes > 10 * 1024 * 1024) {
        result = {
          success: false, needs_password: false,
          error: "PDF too large to process automatically (>10MB). Please use AI Import / Scan instead.",
        };
      } else {
        const { pwdList, vars } = await loadPasswordsAndVars(serviceSupabase, userId, body);

        // Step 1: try Claude with raw PDF
        let claudeResult = await callClaude(pdf_base64, EXTRACTION_PROMPT, ANTHROPIC_KEY);

        if (claudeResult.ok) {
          result = { success: true, transactions: claudeResult.transactions };
        } else if (!claudeResult.is_encrypted) {
          result = { success: false, needs_password: false, error: claudeResult.error };
        } else {
          // Step 2: try pdf-lib with passwords
          const passwords: string[] = body.only_password !== undefined
            ? (body.only_password ? [body.only_password] : [])
            : pwdList.map((p: any) => resolvePassword(p.pattern || "", vars)).filter(Boolean);

          console.log(`[gmail-estatement] process_upload: trying ${passwords.length} password(s)`);
          let lastDecryptError: "wrong_password" | "unsupported" = "wrong_password";
          let found = false;

          for (let i = 0; i < passwords.length; i++) {
            const decResult = await tryDecryptPDF(pdf_base64, passwords[i]);
            if ("base64" in decResult) {
              claudeResult = await callClaude(decResult.base64, EXTRACTION_PROMPT, ANTHROPIC_KEY);
              if (claudeResult.ok) {
                result = { success: true, transactions: claudeResult.transactions };
              } else {
                result = { success: false, needs_password: false, error: "PDF decrypted but no transactions could be extracted. It may be a scanned image." };
              }
              found = true;
              break;
            }
            lastDecryptError = decResult.error;
          }

          if (!found) {
            if (lastDecryptError === "unsupported") {
              result = {
                success: false, needs_password: true, encrypted: true, encryption_unsupported: true,
                error: "This PDF uses advanced encryption (AES-256) that cannot be decrypted automatically. Please download and decrypt it manually, then upload via AI Import / Scan instead.",
              };
            } else {
              result = {
                success: false, needs_password: true, encrypted: true, encryption_unsupported: false,
                error: passwords.length > 0
                  ? "None of the saved passwords worked. Enter the PDF password below."
                  : "This PDF is password-protected. Enter the password below.",
              };
            }
          }
        }
      }

    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("[gmail-estatement] error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
