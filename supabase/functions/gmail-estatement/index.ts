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
import { buildPaperSplits, cariPecahan } from "../_shared/paperSplit.ts";
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

STEP 1 — DETECT DOCUMENT CURRENCY:
- Look at the statement header for a currency indicator. BCA foreign currency accounts show "MATA UANG : [CODE]" (e.g. "MATA UANG : JPY" or "MATA UANG : USD").
- If found, the ENTIRE document is in that currency. Set currency="JPY" (or whatever code) on ALL transactions.
- If no currency indicator is found, assume IDR. Set currency="IDR" on ALL transactions.
- Do NOT assume IDR if another currency is detected.

STEP 2 — EXTRACT TRANSACTIONS:
IMPORTANT: This statement contains a TRANSACTION TABLE. Scan every single page for rows in the transaction table.
Each row typically has: Date | Description/Keterangan | Debit amount | Kredit amount | Balance/Saldo.
Extract ALL rows from ALL pages of the transaction table. Do not stop early.

EXTRACT only actual financial transactions. Return a JSON array.

INCLUDE these transaction types:
- Regular purchases/expenses (merchant name + amount)
- Installment payments (CICILAN/INSTALLMENT - note the X/Y pattern and total)
- Bank fees: biaya admin, biaya layanan notifikasi, bea materai (stamp duty), iuran tahunan, bunga, denda, provisi
- Foreign currency transactions (extract both IDR amount and original currency/amount if shown)
- Transfers OUT (DEBIT column / direction "out")
- CREDIT rows (direction "in") — CRITICAL, NEVER drop these:
  * Card payments as DATED rows in the transaction table: "PAYMENT-THANK YOU", "Pembayaran Kartu Kredit", "PAYMENT BIFAST ...", "PAYMENT SA ATM ..." → direction "in"
  * Refunds: "REFUND ...", GLOBALBLUE, merchant reversals → direction "in"
  * Fee reversals/corrections: "Annual Fee ... CR", "KOR ...", waived fees → direction "in"
  A statement's math only balances when these are included: closing = opening + charges − credits.

SKIP these completely (they are SUMMARY/BALANCE lines, NOT transactions):
- BALANCE OF LAST MONTH / Saldo awal bulan lalu / SALDO BULAN LALU
- TAGIHAN BULAN LALU (previous balance carried over) — NEVER emit this as a transaction; it is the opening balance
- TAGIHAN BULAN INI / TOTAL TAGIHAN BULAN INI / TOTAL TAGIHAN (this is the closing balance, not a transaction)
- PEMBELANJAAN / PENARIKAN TUNAI / PEMBAYARAN / BIAYA ADM & BUNGA when they appear as SUMMARY TOTALS (a lone labelled amount with no date), BATAS KREDIT / SISA KREDIT / PEMBAYARAN MINIMUM / TANGGAL JATUH TEMPO / KOLEKTIBILITAS / JUMLAH POIN
- "Pembayaran Sebelumnya" as a SUMMARY line (no transaction date). But a DATED payment row inside the transaction table is a real transaction → INCLUDE with direction "in" (see INCLUDE list) — do NOT skip it.
- Summary sections: RINGKASAN TAGIHAN, RINGKASAN TREATS, BUNGA DAN TOTAL TRANSAKSI
- TOTAL rows and END OF STATEMENT

CRITICAL — dormant / no-activity statements: some credit-card e-bills (e.g. BNI JCB)
have NO transaction detail table this cycle — only a summary where PEMBELANJAAN=0,
PEMBAYARAN=0. In that case return an EMPTY transactions array. A row must have an
actual transaction DATE and a merchant/description to be emitted; a bare
"LABEL amount" summary line (no date) is never a transaction.
- Promotional text, advertisements, discount offers
- Credit limit info, minimum payment info
- Header/footer info (name, address, card number)
- Barcode, QR code references
- TAX Deducted with amount < 1000 (withholding tax noise)
- Credit Interest Capitalised (bank interest earned, skip)

DEBIT/KREDIT column format (Danamon consolidated statement style):
- DEBIT column = money OUT → direction "out"
- KREDIT column = money IN (transfers received, reversals) → direction "in" — INCLUDE these
- SALDO column = running balance, ignore entirely
- A "CR" suffix after an amount ("1.787.800CR", "3,000,000.00 CR", "11.245.000 CR") = CREDIT
  → direction "in" ALWAYS, no exceptions — even if the description looks like a fee or purchase
  (e.g. "Annual Fee 3,000,000.00 CR" is a fee REVERSAL = direction "in", NOT a charge).
  No suffix = debit → direction "out".

BRI-style installment conversions (TOKOPEDIA_CYBS_CCL / any "Retail" + "X/N" pattern):
- "Retail ... NAME" (debit) + "NAME : 0/N ...CR" (credit, same amount) = a purchase
  CONVERTED to installment. These two CANCEL OUT — they are a wash, not real spend.
  Emit BOTH (so they net to zero) OR skip BOTH; never emit only one side.
- "NAME : X/N" where X>=1 (debit) = the actual monthly installment billed → emit as a normal charge.
- The real amount billed this cycle = the monthly installments (X/N, X>=1) + fees, NOT
  the full purchase principals (the 0/N and Retail rows wash out).
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
  "currency": "IDR",
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
- currency: the document currency detected in STEP 1 — always set this (e.g. "IDR", "JPY", "USD")
- amount: positive number in the document's currency (IDR for normal statements; JPY/USD/etc. for FCY accounts)
- direction: "out" for expenses/debits, "in" for credits (income/transfers in)
- currency_original / amount_original / rate_used: ONLY for IDR statements where a transaction shows an original foreign currency amount alongside the IDR amount. Leave null for FCY account statements (where the whole document is already in foreign currency).
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

IMPORTANT - Year detection rules:
- If the document clearly shows a year, use that year
- If no year is visible or it is ambiguous, use the current year (2026)
- Never use years before 2026 unless explicitly stated in the document
- For bank statements dated Jan-Dec without a year, assume 2026
- Double-check: if a transaction date would result in a year before 2024, it is likely wrong — default to 2026

Return ONLY a valid JSON object (no markdown, no explanation) with this exact schema:
{
  "transactions": [...array of transaction objects above...],
  "detected_account": { "last4": "1234", "bank_name": "BCA", "account_no": "1234567890" },
  "detected_period": { "year": 2025, "month": 3 },
  "closing_balance": 5000000,
  "opening_balance": 3000000,
  "statement_date": "2025-03-21",
  "due_date": "2025-04-06"
}
- detected_account: extracted from statement header (card last 4, bank name, account number). Set fields to null if not found. Set entire value to null if no account info present.
- detected_period: statement month/year from header (e.g. March 2025 → year:2025, month:3). null if not found.
- closing_balance: the amount BILLED this cycle — "Total Tagihan" / "TAGIHAN BULAN INI" / "Total Payment Due" / "Saldo Akhir" / "Closing Balance". This is what the cardholder must pay by the due date.
  ⚠️ NEVER use a credit-limit or remaining-limit figure. On BRI the summary row is
  "<total transaksi> <?> <TAGIHAN BULAN INI> <PEMBAYARAN MINIMUM> <SISA LIMIT>" e.g.
  "14.301.073 0 5.414.773 270.739 46.473.484" → closing_balance = 5.414.773 (the bill),
  NOT 46.473.484 (Sisa Limit Gabungan / remaining limit) and NOT 270.739 (minimum payment).
  Labels to EXCLUDE as closing: Sisa Limit / Kredit Limit / Limit Gabungan / Sisa Penarikan /
  Pembayaran Minimum / Minimum Payment / BATAS KREDIT / SISA KREDIT.
- opening_balance: the opening/previous balance (Saldo Awal / Saldo Bulan Lalu / TAGIHAN BULAN LALU / Opening Balance / Previous Balance) as a plain number. null if not shown.
- statement_date: the date the statement was CUT/PRINTED, from the header — "Tgl. Cetak" / "Tanggal Cetak" / "Statement Date" / "Tanggal Tagihan" / "Posting Date" / "Print Date". Format "YYYY-MM-DD". This is NOT a transaction date: it is normally on or after the last transaction row. null if not shown.
- due_date: the payment due date — "Tgl. Jatuh Tempo" / "Tanggal Jatuh Tempo" / "Payment Due Date" / "Due Date". Format "YYYY-MM-DD". null if not shown.
  Both dates are often printed as DD-MM-YY (e.g. "21-07-26" = 2026-07-21, "06-08-26" = 2026-08-06) — convert to YYYY-MM-DD. Never swap day and month.
If no transactions found, return the object with an empty transactions array.`;

const FALLBACK_PROMPT = `This is a bank statement PDF. Extract every single transaction row from the transaction table.
Look for a table with columns like: Tanggal/Date, Keterangan/Description, Debet/Debit, Kredit/Credit, Saldo/Balance.
First, detect the document currency: look for "MATA UANG : [CODE]" in the header (e.g. "MATA UANG : JPY"). If found, use that currency for all transactions. Otherwise use "IDR".
Return ONLY a valid JSON object (no markdown) with this schema:
{
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "transaction description as written",
      "merchant": "merchant or payee name",
      "amount": 150000,
      "currency": "IDR",
      "direction": "out",
      "is_installment": false,
      "installment_current": null,
      "installment_total": null,
      "is_fee": false,
      "fee_type": null,
      "is_transfer": false,
      "card_last4": null,
      "account_hint": null,
      "currency_original": null,
      "amount_original": null,
      "rate_used": null
    }
  ],
  "detected_account": { "last4": null, "bank_name": null, "account_no": null },
  "detected_period": { "year": 2025, "month": 3 },
  "closing_balance": null,
  "opening_balance": null,
  "statement_date": null,
  "due_date": null
}
currency: document currency ("IDR", "JPY", "USD", etc.) — always set this.
direction: "out" for debits/expenses, "in" for credits received.
amount: positive number in document currency (no dots/commas formatting).
closing_balance: closing/ending balance from statement summary as a plain number, null if not shown.
opening_balance: opening/previous balance as a plain number, null if not shown.
statement_date: date the statement was cut/printed ("Tgl. Cetak" / "Statement Date"), "YYYY-MM-DD", null if not shown. Not a transaction date.
due_date: payment due date ("Tgl. Jatuh Tempo" / "Payment Due Date"), "YYYY-MM-DD", null if not shown.
Dates printed DD-MM-YY (e.g. "21-07-26") mean 2026-07-21 — convert, never swap day and month.
IMPORTANT - Year detection rules:
- If the document clearly shows a year, use that year
- If no year is visible or it is ambiguous, use the current year (2026)
- Never use years before 2026 unless explicitly stated in the document
- For bank statements dated Jan-Dec without a year, assume 2026
- Double-check: if a transaction date would result in a year before 2024, it is likely wrong — default to 2026
If no transactions found, return the object with an empty transactions array.`;

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

// Statement header dates (Tgl. Cetak / Jatuh Tempo) arrive as YYYY-MM-DD, but the
// model occasionally echoes the printed DD-MM-YY form. Accept both, reject anything
// else — a bad anchor date silently mis-reports what is due.
function normStmtDate(v: any): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{2}|\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return `${y.length === 2 ? "20" + y : y}-${mo}-${d}`;
  }
  return null;
}

// ── HELPER: send PDF bytes to Claude, return extracted transactions ─
type ClaudeResult =
  | { ok: true;  transactions: any[]; closing_balance?: number | null; opening_balance?: number | null; statement_date?: string | null; due_date?: string | null; detected_account?: any; detected_period?: any; }
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
  console.log(`[gmail-estatement] Claude response length=${rawText.length}, preview="${rawText.slice(0, 120).replace(/\n/g, " ")}"`);

  // Empty response
  if (rawText.length === 0) {
    return { ok: false, is_encrypted: false, error: "Claude returned an empty response (possible timeout or model error)" };
  }

  // Claude explicitly says it can't read the PDF (encrypted)
  if (rawText.length < 500 && /password|encrypt|cannot\s+(read|access|open)|protected/i.test(rawText)) {
    return { ok: false, is_encrypted: true };
  }

  // Try object format first (new schema: { transactions, detected_account, detected_period, closing_balance, opening_balance })
  const objMatch = rawText.match(/\{[\s\S]*"transactions"[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (Array.isArray(parsed.transactions)) {
        return {
          ok: true,
          transactions:     parsed.transactions,
          closing_balance:  parsed.closing_balance  ?? null,
          opening_balance:  parsed.opening_balance  ?? null,
          statement_date:   normStmtDate(parsed.statement_date),
          due_date:         normStmtDate(parsed.due_date),
          detected_account: parsed.detected_account ?? null,
          detected_period:  parsed.detected_period  ?? null,
        };
      }
    } catch { /* fall through to array format */ }
  }
  // Fall back to bare array format (older prompts / chunked responses)
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    const snippet = rawText.slice(0, 200).replace(/\n/g, " ");
    return { ok: false, is_encrypted: false, error: `Claude response contained no JSON. Response: "${snippet}"` };
  }
  try {
    const transactions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(transactions)) throw new Error("not array");
    return { ok: true, transactions };
  } catch (parseErr: any) {
    return { ok: false, is_encrypted: false, error: `JSON parse error: ${parseErr.message}. Match length: ${jsonMatch[0].length}` };
  }
}

// ── HELPER: callClaude with fallback prompt on failure ─────────
async function callClaudeWithFallback(
  pdfBase64: string, anthropicKey: string
): Promise<ClaudeResult> {
  const result = await callClaude(pdfBase64, EXTRACTION_PROMPT, anthropicKey);
  if (result.ok || result.is_encrypted) return result;

  // Non-encrypted failure → retry with simpler prompt
  console.log(`[gmail-estatement] primary prompt failed (${result.error}), retrying with fallback prompt`);
  const fallback = await callClaude(pdfBase64, FALLBACK_PROMPT, anthropicKey);
  if (fallback.ok) {
    console.log(`[gmail-estatement] fallback prompt succeeded`);
    return fallback;
  }
  // Return original error so the message is informative
  return result;
}

// ── HELPER: chunk large PDFs and process each chunk ────────────
// ── HELPER: infer account + period from already-extracted transactions ──
function inferMetadata(transactions: any[]): { detected_account: any; detected_period: any } {
  const detected_account: Record<string, string> = {};

  // Use most common card_last4 across transactions
  const last4Counts: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.card_last4) {
      const k = String(tx.card_last4);
      last4Counts[k] = (last4Counts[k] || 0) + 1;
    }
  }
  const topLast4 = Object.entries(last4Counts).sort((a, b) => b[1] - a[1])[0];
  if (topLast4) detected_account.last4 = topLast4[0];

  // Use first account_hint as account_no
  for (const tx of transactions) {
    if (tx.account_hint) { detected_account.account_no = String(tx.account_hint); break; }
  }

  // Period: majority month from transaction dates
  const monthCount: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.date && /^\d{4}-\d{2}/.test(tx.date)) {
      const ym = (tx.date as string).slice(0, 7);
      monthCount[ym] = (monthCount[ym] || 0) + 1;
    }
  }
  const topMonth = Object.entries(monthCount).sort((a, b) => b[1] - a[1])[0];
  let detected_period: any = null;
  if (topMonth) {
    const [y, m] = topMonth[0].split("-").map(Number);
    detected_period = { year: y, month: m };
  }

  return {
    detected_account: Object.keys(detected_account).length > 0 ? detected_account : null,
    detected_period,
  };
}

async function chunkAndProcessPDF(
  pdfBase64: string, anthropicKey: string
): Promise<ClaudeResult> {
  // Try to load PDF to get page count
  let srcDoc: PDFDocument | null = null;
  let pageCount = 0;
  try {
    const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
    srcDoc = await PDFDocument.load(bytes);
    pageCount = srcDoc.getPageCount();
    console.log(`[gmail-estatement] PDF has ${pageCount} pages`);
  } catch (e) {
    console.log(`[gmail-estatement] could not count pages, using single call: ${e}`);
    return callClaudeWithFallback(pdfBase64, anthropicKey);
  }

  if (pageCount <= 10) {
    return callClaudeWithFallback(pdfBase64, anthropicKey);
  }

  // Split into 5-page chunks
  const CHUNK_SIZE = 5;
  const allTransactions: any[] = [];
  const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
  const fullDoc = await PDFDocument.load(bytes);

  // Track metadata: detected_account/period from first chunk, balances from last chunk that has them
  let chunkMeta: { detected_account?: any; detected_period?: any; closing_balance?: number | null; opening_balance?: number | null; statement_date?: string | null; due_date?: string | null } = {};

  for (let start = 0; start < pageCount; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, pageCount);
    console.log(`[gmail-estatement] chunking: processing pages ${start + 1}–${end} of ${pageCount}`);

    const chunkDoc = await PDFDocument.create();
    const indices  = Array.from({ length: end - start }, (_, i) => start + i);
    const copied   = await chunkDoc.copyPages(fullDoc, indices);
    copied.forEach(p => chunkDoc.addPage(p));

    const chunkBytes  = await chunkDoc.save();
    const chunkBase64 = btoa(
      Array.from(new Uint8Array(chunkBytes)).map(b => String.fromCharCode(b)).join("")
    );

    const chunkResult = await callClaudeWithFallback(chunkBase64, anthropicKey);
    if (chunkResult.ok) {
      allTransactions.push(...chunkResult.transactions);
      // First chunk wins for account/period; last chunk wins for balances (summary is usually last)
      if (!chunkMeta.detected_account && chunkResult.detected_account) chunkMeta.detected_account = chunkResult.detected_account;
      if (!chunkMeta.detected_period  && chunkResult.detected_period)  chunkMeta.detected_period  = chunkResult.detected_period;
      if (chunkResult.closing_balance != null) chunkMeta.closing_balance = chunkResult.closing_balance;
      if (chunkResult.opening_balance != null) chunkMeta.opening_balance = chunkResult.opening_balance;
      // Header dates live on page 1 — first chunk that reports them wins.
      if (!chunkMeta.statement_date && chunkResult.statement_date) chunkMeta.statement_date = chunkResult.statement_date;
      if (!chunkMeta.due_date && chunkResult.due_date) chunkMeta.due_date = chunkResult.due_date;
    } else if (chunkResult.is_encrypted) {
      return chunkResult; // Propagate encrypted signal
    } else {
      console.log(`[gmail-estatement] chunk ${start + 1}–${end} failed: ${chunkResult.error}`);
      // Continue processing remaining chunks
    }
  }

  console.log(`[gmail-estatement] chunking complete: ${allTransactions.length} total transactions`);
  return { ok: true, transactions: allTransactions, ...chunkMeta };
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
  let claudeResult = await chunkAndProcessPDF(pdfBase64, anthropicKey);

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
      claudeResult = await chunkAndProcessPDF(decResult.base64, anthropicKey);
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

// ── HELPER: filter junk rows from extracted transactions ────────
const JUNK_KEYWORDS = [
  /balance\s+of\s+last\s+month/i,
  /opening\s+balance/i,
  /closing\s+balance/i,
  /balance\s+(brought|carried)\s+forward/i,
  /previous\s+balance/i,
  /starting\s+balance/i,
  /ending\s+balance/i,
  /sub\s*total/i,
  /grand\s+total/i,
];
function cleanTransactions(transactions: any[]): any[] {
  return transactions.filter(t => {
    const desc = ((t.description || t.merchant || "") as string).trim();
    const amt = Math.abs(Number(t.amount || 0));
    if (amt === 0) return false;
    if (JUNK_KEYWORDS.some(re => re.test(desc))) return false;
    return true;
  });
}

// ── HELPER: save transactions + update status ──────────────────
async function finalizeTransactions(serviceSupabase: any, statementId: string, transactions: any[]) {
  const cleaned = cleanTransactions(transactions);
  if (!Array.isArray(cleaned) || cleaned.length === 0) {
    await serviceSupabase.from("estatement_pdfs")
      .update({ status: "pending" }).eq("id", statementId);
    return { success: false, error: "No transactions found in this statement.", needs_password: false, encrypted: false };
  }
  console.log(`[gmail-estatement] process: extracted ${cleaned.length} transactions (${transactions.length - cleaned.length} junk filtered)`);
  await serviceSupabase.from("estatement_pdfs").update({
    status:            "parsed",
    transaction_count: cleaned.length,
    processed_at:      new Date().toISOString(),
  }).eq("id", statementId);
  return { success: true, transactions: cleaned, count: cleaned.length };
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
// ── HELPER: extract transactions from an uploaded PDF (shared by process_upload + prepare) ──
async function extractUploadedPDF(serviceSupabase: any, userId: string, body: any, ANTHROPIC_KEY: string): Promise<any> {
  const pdf_base64: string = body.pdf_base64;
  const base64Len   = pdf_base64.length;
  const approxBytes = Math.round(base64Len * 0.75);
  console.log(`[gmail-estatement] extractUploadedPDF: base64_len=${base64Len} approx_bytes=${approxBytes}`);

  if (approxBytes > 10 * 1024 * 1024) {
    return {
      success: false, needs_password: false,
      error: "PDF too large to process automatically (>10MB). Please use AI Import / Scan instead.",
    };
  }
  const { pwdList, vars } = await loadPasswordsAndVars(serviceSupabase, userId, body);

  // Step 1: try Claude with raw PDF (with chunking + fallback)
  let claudeResult: ClaudeResult;
  try {
    claudeResult = await chunkAndProcessPDF(pdf_base64, ANTHROPIC_KEY);
  } catch (e: any) {
    const errMsg = (e.message || String(e)).toLowerCase();
    if (errMsg.includes("password protected") || errMsg.includes("password-protected")) {
      claudeResult = { ok: false, is_encrypted: true };
    } else {
      throw e;
    }
  }

  if (claudeResult.ok) {
    const cleaned = cleanTransactions(claudeResult.transactions);
    const metaInferred = inferMetadata(cleaned);
    return {
      success: true,
      transactions:     cleaned,
      detected_account: claudeResult.detected_account ?? metaInferred.detected_account,
      detected_period:  claudeResult.detected_period  ?? metaInferred.detected_period,
      closing_balance:  claudeResult.closing_balance  ?? null,
      opening_balance:  claudeResult.opening_balance  ?? null,
      statement_date:   claudeResult.statement_date   ?? null,
      due_date:         claudeResult.due_date         ?? null,
    };
  }
  if (!claudeResult.is_encrypted) {
    return { success: false, needs_password: false, error: claudeResult.error };
  }

  // Step 2: try pdf-lib with passwords
  const passwords: string[] = body.only_password !== undefined
    ? (body.only_password ? [body.only_password] : [])
    : pwdList.map((p: any) => resolvePassword(p.pattern || "", vars)).filter(Boolean);

  console.log(`[gmail-estatement] extractUploadedPDF: trying ${passwords.length} password(s)`);
  let lastDecryptError: "wrong_password" | "unsupported" = "wrong_password";

  for (let i = 0; i < passwords.length; i++) {
    const decResult = await tryDecryptPDF(pdf_base64, passwords[i]);
    if ("base64" in decResult) {
      claudeResult = await chunkAndProcessPDF(decResult.base64, ANTHROPIC_KEY);
      if (claudeResult.ok) {
        const cleaned = cleanTransactions(claudeResult.transactions);
        const metaInferred = inferMetadata(cleaned);
        return {
          success: true,
          transactions:     cleaned,
          detected_account: claudeResult.detected_account ?? metaInferred.detected_account,
          detected_period:  claudeResult.detected_period  ?? metaInferred.detected_period,
          closing_balance:  claudeResult.closing_balance  ?? null,
          opening_balance:  claudeResult.opening_balance  ?? null,
          statement_date:   claudeResult.statement_date   ?? null,
          due_date:         claudeResult.due_date         ?? null,
        };
      }
      return { success: false, needs_password: false, error: "PDF decrypted but no transactions could be extracted. It may be a scanned image." };
    }
    lastDecryptError = decResult.error;
  }

  if (lastDecryptError === "unsupported") {
    return {
      success: false, needs_password: true, encrypted: true, encryption_unsupported: true,
      error: "This PDF uses advanced encryption (AES-256) that cannot be decrypted automatically. Please download and decrypt it manually, then upload via AI Import / Scan instead.",
    };
  }
  return {
    success: false, needs_password: true, encrypted: true, encryption_unsupported: false,
    error: passwords.length > 0
      ? "None of the saved passwords worked. Enter the PDF password below."
      : "This PDF is password-protected. Enter the password below.",
  };
}

// ── RECONCILE PREPARE ──────────────────────────────────────────
// Ports of the app's matching logic (src/lib/reconcilePdfUpload.js matchDetectedAccount
// + src/components/shared/ReconcileOverlay.jsx matchRows). Keep in sync — the app
// recomputes the same diff when the draft loads; these only produce the summary.
function matchDetectedAccountSrv(detected: any, accounts: any[]): any {
  if (!detected || !accounts?.length) return null;
  if (detected.last4) {
    const byLast4 = accounts.find((a) => String(a.card_last4 || "") === String(detected.last4));
    if (byLast4) return byLast4;
  }
  if (detected.account_no) {
    // Normalise to digits only — statements print "121-00-0016886-8" while the DB
    // stores "1210000168868". Require a REAL account number too: guarding length>=4
    // stops the `dno.includes("")`-always-true trap that funneled every
    // no-account_no statement onto the first blank-account_no account ("USD Cash").
    const dno = String(detected.account_no).replace(/\D/g, "");
    const byAccNo = dno.length >= 4 && accounts.find((a) => {
      const ano = String(a.account_no || "").replace(/\D/g, "");
      if (ano.length < 4) return false;
      return ano.includes(dno) || dno.includes(ano.slice(-6));
    });
    if (byAccNo) return byAccNo;
  }
  if (detected.bank_name) {
    // Only trust bank_name when it's unambiguous (one account for that bank).
    // Multiple same-bank accounts (e.g. OCBC 90N/IDR/USD/SGD) → don't guess.
    const bn = detected.bank_name.toLowerCase();
    const byBankName = accounts.filter((a) => a.bank_name?.toLowerCase() === bn);
    if (byBankName.length === 1) return byBankName[0];
  }
  return null;
}

// Resolve which tracked account a statement belongs to. Strongest signal first:
// any card_last4 PRINTED in the statement rows that maps to exactly one tracked
// card (deterministic — e.g. OCBC 90N's 3411 appears in its statement even when
// the "most common" last4 belongs to an untracked supplementary card). Falls
// back to the header-detected last4/account_no/bank_name.
function resolveStatementAccount(detected: any, txs: any[], accounts: any[]): any {
  const active = (accounts || []).filter((a: any) => a.is_active !== false);
  const digits = (v: any) => String(v ?? "").replace(/\D/g, "");

  // 1) The account NUMBER is the strongest signal, and it must outrank card_last4.
  //    A bank statement can print a credit card in its summary — Danamon's "Laporan
  //    Rekening Gabungan" lists the JCB card next to the savings account — and the
  //    parser then stamps that last4 onto the transaction rows, routing a savings
  //    statement onto the card (bill Rp7.500 vs balance Rp5.769.477).
  const accNo = digits(detected?.account_no);
  if (accNo.length >= 6) {
    const byNo = active.filter((a: any) => {
      const d = digits(a.account_no);
      return d.length >= 6 && d === accNo;
    });
    if (byNo.length === 1) return byNo[0];
    if (byNo.length > 1) {
      // One account number, several currency pockets (BCA runs IDR + 6 valas pockets
      // under 0831361688). Split them by the currency the transactions are in.
      const tally: Record<string, number> = {};
      for (const t of (txs || [])) {
        const c = String(t?.currency || "IDR").toUpperCase();
        tally[c] = (tally[c] || 0) + 1;
      }
      const cur = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || "IDR";
      const byCur = byNo.filter((a: any) => String(a.currency || "IDR").toUpperCase() === cur);
      if (byCur.length === 1) return byCur[0];
    }
  }

  // 2) Card last4 printed on the transaction rows.
  const last4s = [...new Set((txs || []).map((t: any) => t.card_last4 ? String(t.card_last4) : null).filter(Boolean))];
  const byCard = [...new Set(
    last4s.map((l4) => active.find((a: any) => a.card_last4 && String(a.card_last4) === l4)).filter(Boolean),
  )];
  if (byCard.length === 1) return byCard[0];
  return matchDetectedAccountSrv(detected, active);
}

function wordSimilaritySrv(a: string, b: string): number {
  if (!a || !b) return 0;
  const wa = a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const wb = b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  const setB = new Set(wb);
  return wa.filter((w) => setB.has(w)).length / Math.max(wa.length, wb.length);
}

function matchRowsSrv(stmtRows: any[], ledgerRows: any[]): { match: number; missing: any[]; extra: number } {
  const usedL = new Set<number>();
  let match = 0;
  const matchedStmtIds = new Set<string>();

  // Pass 0 — SPLIT GROUPS: rows sharing split_group_id are one real transaction
  // whose sum equals a statement line. Deterministic, runs before any fuzzy
  // matching. Keep in sync with matchRows in ReconcileOverlay.jsx.
  const splitGroups: Record<string, number[]> = {};
  ledgerRows.forEach((l: any, li: number) => {
    if (l.split_group_id) (splitGroups[l.split_group_id] = splitGroups[l.split_group_id] || []).push(li);
  });
  const groupList = Object.values(splitGroups).filter((g) => g.length > 1);
  if (groupList.length) {
    for (const s of stmtRows) {
      const target = Math.abs(Number(s.amount || 0));
      if (!target) continue;
      for (const g of groupList) {
        if (g.some((li) => usedL.has(li))) continue;
        const sum = g.reduce((t, li) => t + Math.abs(Number(ledgerRows[li].amount_idr || ledgerRows[li].amount || 0)), 0);
        if (Math.abs(sum - target) > 100) continue;
        const near = g.some((li) => Math.abs((new Date((s.date || "") + "T00:00:00").getTime() - new Date((ledgerRows[li].tx_date || "") + "T00:00:00").getTime()) / 86400000) <= 3);
        if (!near) continue;
        for (const li of g) usedL.add(li);
        matchedStmtIds.add(s._id);
        match++;
        break;
      }
    }
  }

  for (const s of stmtRows) {
    if (matchedStmtIds.has(s._id)) continue;
    let bestIdx = -1, bestScore = 0;
    for (let li = 0; li < ledgerRows.length; li++) {
      if (usedL.has(li)) continue;
      const l = ledgerRows[li];
      const amtDiff = Math.abs(Math.abs(Number(s.amount || 0)) - Math.abs(Number(l.amount_idr || l.amount || 0)));
      if (amtDiff > 100) continue;
      const dayDiff = Math.abs((new Date((s.date || "") + "T00:00:00").getTime() - new Date((l.tx_date || "") + "T00:00:00").getTime()) / 86400000);
      const sim = wordSimilaritySrv(s.description || s.merchant || "", l.description || "");
      let score = 0;
      if (dayDiff <= 3 && sim >= 0.6) score = 3 + sim + (amtDiff < 1 ? 1 : 0);
      else if (sim >= 0.8 && dayDiff <= 7) score = 2 + sim;
      else if (dayDiff <= 3 && amtDiff < 1) score = 2;
      if (score > bestScore) { bestScore = score; bestIdx = li; }
    }
    if (bestIdx >= 0 && bestScore >= 2) { match++; matchedStmtIds.add(s._id); usedL.add(bestIdx); }
  }
  // Second pass: one statement line can be several ledger rows (a joint payout booked
  // as own income + partner's share). Keep in sync with matchRows in ReconcileOverlay.
  for (const s of stmtRows) {
    if (matchedStmtIds.has(s._id)) continue;
    const target = Math.abs(Number(s.amount || 0));
    if (!target) continue;
    const cand: { li: number; amt: number }[] = [];
    for (let li = 0; li < ledgerRows.length; li++) {
      if (usedL.has(li)) continue;
      const l = ledgerRows[li];
      const dayDiff = Math.abs((new Date((s.date || "") + "T00:00:00").getTime() - new Date((l.tx_date || "") + "T00:00:00").getTime()) / 86400000);
      if (dayDiff <= 3) cand.push({ li, amt: Math.abs(Number(l.amount_idr || l.amount || 0)) });
    }
    if (cand.length < 2) continue;
    let combo: { li: number; amt: number }[] | null = null;
    for (let i = 0; i < cand.length && !combo; i++) {
      for (let j = i + 1; j < cand.length && !combo; j++) {
        if (Math.abs(cand[i].amt + cand[j].amt - target) <= 100) { combo = [cand[i], cand[j]]; break; }
        for (let k = j + 1; k < cand.length; k++) {
          if (Math.abs(cand[i].amt + cand[j].amt + cand[k].amt - target) <= 100) { combo = [cand[i], cand[j], cand[k]]; break; }
        }
      }
    }
    if (combo) {
      for (const c of combo) usedL.add(c.li);
      matchedStmtIds.add(s._id);
      match++;
    }
  }

  const missing = stmtRows.filter((s) => !matchedStmtIds.has(s._id));
  const extra = ledgerRows.length - usedL.size;
  return { match, missing, extra };
}

// Ledger-side balance at end of period (same conventions as recalcAccountEdge).
function ledgerClosingAt(acc: any, rows: any[], cutoff: string): number {
  const isForeign = acc.currency && acc.currency !== "IDR";
  const amtOf = (tx: any) => isForeign ? Number(tx.amount || tx.amount_idr || 0) : Number(tx.amount_idr || tx.amount || 0);
  let inn = 0, out = 0;
  for (const tx of rows) {
    if (tx.tx_date > cutoff) continue;
    const a = amtOf(tx);
    if (tx.to_id === acc.id) inn += a;
    if (tx.from_id === acc.id) out += a;
  }
  if (acc.type === "credit_card") {
    // outstanding = initial + charges(from) − payments(to)
    const net = Number(acc.initial_balance || 0) + out - inn;
    return net > 0 ? net : 0;
  }
  return Number(acc.initial_balance || 0) + inn - out;
}

async function prepareReconcile(serviceSupabase: any, userId: string, extraction: any, filename: string): Promise<any> {
  const txs: any[] = extraction.transactions || [];
  const { data: accounts } = await serviceSupabase.from("accounts")
    .select("id, name, type, bank_name, account_no, card_last4, currency, initial_balance, is_active, last_statement_date, last_statement_amount")
    .eq("user_id", userId);

  // ── SATU BERKAS, DUA KARTU ────────────────────────────────────────────────
  // Statement BCA 14871216 memuat kartu 9605 (BCA Card) DAN 3776 (Krisflyer);
  // tiap baris membawa card_last4-nya sendiri. resolveStatementAccount hanya
  // mengembalikan SATU akun, jadi seluruh baris dulu masuk ke satu sesi dan
  // baris milik kartu lain dilaporkan "hilang" — itulah 12 hilang palsu di
  // BCA Card Agustus 2026, padahal barisnya ada di Krisflyer dengan tanggal
  // yang sama persis. Pecah per kartu, satu sesi per kartu.
  //
  // Saldo pembukaan/penutupan hanya diberikan ke kartu yang TERDETEKSI di
  // kepala statement — untuk BCA itu 3776, dan penutupannya (30.638.872)
  // memang cocok dengan anchor Krisflyer. Kartu lain sesinya tanpa saldo,
  // karena statement tidak mencantumkan penutupan terpisah untuknya.
  if (!extraction._splitByCard) {
    const perCard: Record<string, any[]> = {};
    for (const t of txs) {
      const l4 = t.card_last4 ? String(t.card_last4) : null;
      if (l4) (perCard[l4] = perCard[l4] || []).push(t);
    }
    const kartu = Object.keys(perCard)
      .map((l4) => ({ l4, acc: (accounts || []).find((a: any) => a.is_active !== false && String(a.card_last4 || "") === l4) }))
      .filter((x) => x.acc);
    const idUnik = [...new Set(kartu.map((x) => x.acc.id))];
    if (idUnik.length > 1) {
      const utama = String(extraction.detected_account?.last4 || "");
      const hasil: any[] = [];
      for (const { l4, acc: ka } of kartu) {
        const sub = {
          ...extraction, _splitByCard: true, transactions: perCard[l4],
          detected_account: { ...(extraction.detected_account || {}), last4: l4 },
          opening_balance: l4 === utama ? extraction.opening_balance : null,
          closing_balance: l4 === utama ? extraction.closing_balance : null,
        };
        hasil.push({ card_last4: l4, account_name: ka.name,
          ...(await prepareReconcile(serviceSupabase, userId, sub, `${filename} · kartu ${l4}`)) });
      }
      return { prepared: true, split_by_card: true, cards: hasil };
    }
  }

  const acc = resolveStatementAccount(extraction.detected_account, txs, accounts || []);
  if (!acc) {
    return {
      prepared: false, reason: "account_not_matched",
      detected_account: extraction.detected_account, tx_count: txs.length,
      closing_balance: extraction.closing_balance ?? null,
    };
  }
  // Statement tanpa transaksi (kartu tidur: BNI 18 Agu — PEMBELANJAAN 0,
  // PEMBAYARAN 0, tagihan tetap 17.500). Dulu langsung dibuang, akibatnya
  // kartunya berdiri selamanya di "menunggu statement" padahal statement-nya
  // sudah datang dan berbunyi "tidak ada apa-apa". Catat sesinya supaya bulan
  // itu tercatat selesai; tidak ada draft karena memang tidak ada yang direview.
  if (!txs.length) {
    const tgl = normStmtDate(extraction.statement_date);
    const tutup = extraction.closing_balance ?? null;
    if (tgl && tutup != null) {
      const [y, m] = tgl.split("-").map(Number);
      await serviceSupabase.from("reconcile_sessions").delete()
        .eq("user_id", userId).eq("account_id", acc.id)
        .eq("period_year", y).eq("period_month", m).eq("status", "prepared");
      await serviceSupabase.from("reconcile_sessions").insert({
        user_id: userId, account_id: acc.id,
        period_year: y, period_month: m, period_start: tgl, period_end: tgl,
        opening_balance: extraction.opening_balance ?? null, closing_balance: tutup,
        statement_date: tgl, due_date: normStmtDate(extraction.due_date),
        calculated_balance: tutup, status: "prepared", pdf_filename: filename,
        total_statement: 0, total_match: 0, total_missing: 0, total_extra: 0,
        notes: "Statement tanpa transaksi — tagihan dibawa dari bulan sebelumnya",
      });
      return { prepared: true, empty: true, account_name: acc.name,
               statement_date: tgl, closing_balance: tutup, stats: { match: 0, missing: 0 }, gap: 0 };
    }
    return { prepared: false, reason: "empty_statement", account_name: acc.name };
  }

  // Period from statement tx dates
  const dates = txs.map((t) => String(t.date || "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const periodStart = dates[0] || null;
  const periodEnd = dates[dates.length - 1] || null;
  // Bulan sesi diambil dari TANGGAL STATEMENT, bukan dari transaksi terakhir.
  // Kartu yang sepi bisa punya satu-satunya transaksi bertanggal bulan lalu —
  // UOB (statement 18 Agu, transaksi 23 Jul) dan Maybank VP (statement 22 Agu,
  // transaksi 21 Jul) keduanya terarsip ke Juli dan hilang dari halaman
  // Agustus, tampak seperti statement-nya belum datang padahal sudah diproses.
  const bulanDari = normStmtDate(extraction.statement_date) || periodEnd || "";
  const [pY, pM] = bulanDari.split("-").map(Number);

  // stmtRows in the exact shape the app's draft loader expects
  const stmtRows = txs.map((t: any, i: number) => ({ ...t, _id: t._id || `stmt-prep-${i}`, _sourceFile: filename }));

  // Ledger rows touching this account (all-time: needed for closing calc; window slice for diff)
  const { data: ledAll } = await serviceSupabase.from("ledger")
    .select("id, tx_date, description, merchant_name, amount, amount_idr, from_id, to_id, reconciled_at, split_group_id")
    .eq("user_id", userId)
    .or(`from_id.eq.${acc.id},to_id.eq.${acc.id}`);
  // For the dup hint the whole ledger matters, not just this account: photo/email
  // imports land the same charge on the wrong card at a shifted date.
  const { data: ledgerAllAccounts } = await serviceSupabase.from("ledger")
    .select("tx_date, amount_idr, reconciled_at")
    .eq("user_id", userId);
  const pad = (d: string, days: number) => { const t = new Date(d + "T00:00:00"); t.setDate(t.getDate() + days); return t.toISOString().slice(0, 10); };
  const winStart = periodStart ? pad(periodStart, -7) : null;
  const winEnd = periodEnd ? pad(periodEnd, 7) : null;

  // Anchor date for statement-based pending-due (accounts.last_statement_date).
  // Payments printed ON the statement are ALREADY inside closing_balance, so the
  // anchor must sit strictly after the last statement row; otherwise the app
  // subtracts those payments a second time and a card with a real balance shows
  // as paid. Prefer the statement's own cut date ("Tgl. Cetak"); fall back to the
  // day after the last row when the header date is missing or looks wrong.
  const stmtDate = normStmtDate(extraction.statement_date);
  const dueDate = normStmtDate(extraction.due_date);
  const anchorDate = stmtDate && (!periodEnd || stmtDate >= periodEnd)
    ? stmtDate
    : (periodEnd ? pad(periodEnd, 1) : null);
  const ledgerWindow = (ledAll || []).filter((l: any) => (!winStart || l.tx_date >= winStart) && (!winEnd || l.tx_date <= winEnd));

  let { match, missing, extra } = matchRowsSrv(stmtRows, ledgerWindow);

  // ── AUTO-CICILAN & AUTO-BIAYA DARI STATEMENT ──────────────────────────────
  // Statement = sumber final. Dua golongan baris "hilang" yang TIDAK PERNAH
  // punya email dibuat langsung dari statement, dengan bukti pola:
  //  (a) angsuran n/m yang buku sudah punya (n−1)/m bernominal SAMA di kartu
  //      yang sama — entity/kategori/tipe disalin dari angsuran sebelumnya.
  //      n ≤ 1 TIDAK dibuat (konversi cicilan / wash — kasus Blibli-Lieche &
  //      BRI CCL 0/12; salah tangan = dobel puluhan juta).
  //  (b) biaya bulanan tetap dari daftar (materai, notifikasi, admin, e-billing,
  //      e-statement) — regex + nominal ≤ 25.000 → Bank & Card Fees.
  // Idempoten: baris yang dibuat akan match pada prepare berikutnya.
  const autoCreated: any[] = [];
  // Hanya akun IDR: insert di bawah menulis currency "IDR"; di kantong valas
  // (BCA CHF punya draft juga) itu merusak. Valas dibuat manual saat reconcile.
  try {
    if ((acc.currency || "IDR") !== "IDR") throw "akun valas — auto-create dilewati";
    // 🚨 PENJAGA PRA-ANCHOR untuk auto-create (bug 2026-08-28: prepare atas
    // statement BRI JULI membuat 9 angsuran senilai 3.370.216 padahal anchor BRI
    // sudah AGUSTUS — baris itu sudah terkandung di penutupan Agustus, jadi
    // menambahkannya = dobel, persis jebakan yang sama dengan impor email lama).
    // Statement LAMA tidak boleh melahirkan baris: masanya sudah ditutup
    // statement yang lebih baru. Hanya statement TERBARU yang boleh menulis.
    if (acc.last_statement_date && periodEnd && periodEnd < acc.last_statement_date)
      throw `statement lama (${periodEnd} < anchor ${acc.last_statement_date}) — auto-create dilewati`;
    const BIAYA_RE = /BEA METERAI|BIAYA NOTIFIKASI|ADMINISTRATION FEE|E-?BILLING|E-?STATEMENT FEE|STAMP DUTY/i;
    const CICIL_RE = /(\d{1,2})\s*\/\s*(\d{1,2})/;
    const sisaMissing: any[] = [];
    const inserts: any[] = [];
    for (const m0 of missing) {
      const desc = String(m0.description || "");
      const amt = Math.round(Number(m0.amount || 0));
      const isOut = (m0.direction || "out") !== "in";
      // (b) biaya tetap
      if (isOut && BIAYA_RE.test(desc) && amt > 0 && amt <= 25000) {
        const { data: katB } = await serviceSupabase.from("expense_categories")
          .select("id,name").eq("user_id", userId).eq("name", "Bank & Card Fees").maybeSingle();
        inserts.push({
          user_id: userId, tx_date: m0.date, description: desc.trim().slice(0, 80),
          amount: amt, amount_idr: amt, currency: "IDR", tx_type: "expense",
          from_type: "account", from_id: acc.id, to_type: "expense", to_id: null,
          category_id: katB?.id || null, category_name: katB?.name || "Bank & Card Fees",
          entity: "Personal", is_reimburse: false, source: "statement_auto",
          notes: `Biaya bulanan kartu — dibuat otomatis dari statement ${filename}`,
        });
        autoCreated.push({ jenis: "biaya", date: m0.date, amount: amt, desc });
        continue;
      }
      // (a) angsuran lanjutan
      const cm = desc.match(CICIL_RE);
      if (isOut && cm) {
        const n = Number(cm[1]), tot = Number(cm[2]);
        if (n >= 2 && tot >= n) {
          const prevRe = new RegExp(`${n - 1}\\s*\\/\\s*${tot}\\b`);
          const prev = (ledAll || [])
            .filter((l: any) => l.from_id === acc.id
              && Math.abs(Math.round(Number(l.amount_idr || l.amount || 0)) - amt) <= 1
              && prevRe.test(String(l.description || "")))
            .sort((p: any, q: any) => String(q.tx_date).localeCompare(String(p.tx_date)))[0];
          if (prev) {
            const { data: prevFull } = await serviceSupabase.from("ledger")
              .select("tx_type, to_type, to_id, category_id, category_name, entity, merchant_name")
              .eq("id", prev.id).maybeSingle();
            inserts.push({
              user_id: userId, tx_date: m0.date, description: desc.trim().slice(0, 80),
              amount: amt, amount_idr: amt, currency: "IDR",
              tx_type: prevFull?.tx_type || "expense",
              from_type: "account", from_id: acc.id,
              to_type: prevFull?.to_type || "expense", to_id: prevFull?.to_id || null,
              category_id: prevFull?.category_id || null, category_name: prevFull?.category_name || null,
              entity: prevFull?.entity || "Personal", is_reimburse: false, source: "statement_auto",
              merchant_name: prevFull?.merchant_name || null,
              notes: `Angsuran ${n}/${tot} — dibuat otomatis dari statement; entity/kategori disalin dari angsuran ${n - 1}/${tot}`,
            });
            autoCreated.push({ jenis: "cicilan", date: m0.date, amount: amt, desc: `${desc.slice(0, 40)} (${n}/${tot})` });
            continue;
          }
        }
      }
      sisaMissing.push(m0);
    }
    if (inserts.length) {
      const { data: madeRows, error: insErr } = await serviceSupabase.from("ledger").insert(inserts).select("id, tx_date, description, merchant_name, amount, amount_idr, from_id, to_id, reconciled_at, split_group_id");
      if (insErr) { console.error("[prepare auto-create]", insErr.message); }
      else if (madeRows?.length) {
        (ledAll as any[]).push(...madeRows);
        ledgerWindow.push(...madeRows);
        const ulang = matchRowsSrv(stmtRows, ledgerWindow);
        match = ulang.match; missing = ulang.missing; extra = ulang.extra;
        // Baris baru belum menyentuh accounts.outstanding_amount (insert mentah,
        // bukan lewat ledgerApi) — hitung ulang dari ledger supaya tak ada saldo
        // basi (pelajaran HSBC 2026-08-28). Rumus = recalculateBalance app.
        try {
          const { data: semua } = await serviceSupabase.from("ledger")
            .select("from_id, from_type, to_id, to_type, amount_idr, amount")
            .eq("user_id", userId).or(`from_id.eq.${acc.id},to_id.eq.${acc.id}`);
          let ch = 0, pay = 0;
          for (const r of (semua || [])) {
            const amt = Number(r.amount_idr || r.amount || 0);
            if (r.from_id === acc.id && r.from_type === "account") ch += amt;
            if (r.to_id === acc.id && r.to_type === "account") pay += amt;
          }
          const net = Number(acc.initial_balance || 0) + ch - pay;
          await serviceSupabase.from("accounts").update({
            outstanding_amount: net > 0 ? net : 0,
            current_balance: net < 0 ? -net : 0,
          }).eq("id", acc.id);
        } catch (e) { console.error("[prepare recalc]", e); }
      }
    }
  } catch (e) { console.error("[prepare auto-create]", e); }

  const stmtClosing = extraction.closing_balance != null ? Number(extraction.closing_balance) : null;
  const ledgerClosing = periodEnd ? ledgerClosingAt(acc, ledAll || [], periodEnd) : null;
  const gap = (stmtClosing != null && ledgerClosing != null) ? Math.round(stmtClosing - ledgerClosing) : null;

  // Don't clobber a draft the user is actively working on (has edits)
  const { data: existing } = await serviceSupabase.from("import_drafts")
    .select("id, state_json").eq("user_id", userId).eq("source", "reconcile").eq("account_id", acc.id).maybeSingle();
  const hasUserWork = existing && (Object.keys(existing.state_json?.pendingRows || {}).length > 0 || (existing.state_json?.ignoredIds || []).length > 0);
  let draftSaved = false;
  if (!hasUserWork) {
    const state_json = {
      stmtRows, ignoredIds: [], pendingRows: {}, pdfSource: filename,
      stmtClosingBalance: stmtClosing, stmtOpeningBalance: extraction.opening_balance != null ? Number(extraction.opening_balance) : null,
      stmtStatementDate: stmtDate, stmtDueDate: dueDate, stmtAnchorDate: anchorDate,
    };
    const { error } = await serviceSupabase.from("import_drafts").upsert(
      { user_id: userId, source: "reconcile", account_id: acc.id, state_json, updated_at: new Date().toISOString() },
      { onConflict: "user_id,source,account_id" });
    if (error) console.error("[prepare] draft upsert:", error.message);
    else draftSaved = true;
  }

  // Track as a "prepared" session (replace any earlier prepared row for the same account+period)
  if (pY && pM) {
    await serviceSupabase.from("reconcile_sessions").delete()
      .eq("user_id", userId).eq("account_id", acc.id).eq("period_year", pY).eq("period_month", pM).eq("status", "prepared");
    const { error: sesErr } = await serviceSupabase.from("reconcile_sessions").insert({
      user_id: userId, account_id: acc.id,
      period_year: pY, period_month: pM, period_start: periodStart, period_end: periodEnd,
      opening_balance: extraction.opening_balance ?? null, closing_balance: stmtClosing,
      statement_date: stmtDate, due_date: dueDate,
      calculated_balance: ledgerClosing, status: "prepared", pdf_filename: filename,
      total_statement: stmtRows.length, total_match: match, total_missing: missing.length, total_extra: extra,
    });
    if (sesErr) console.error("[prepare] session insert:", sesErr.message);
  }
  if (autoCreated.length) console.log(`[prepare] auto-created ${autoCreated.length}: ${autoCreated.map((x) => x.jenis + " " + x.amount).join(", ")}`);

  // ── Parked valas twins die HERE, at statement arrival (Paulus 2026-08-24:
  // "reconcile dan waiting for statement, langsung meniadakan aja, ga usah tanya").
  // A waiting item exists only because the IDR rate was unknown; this statement IS
  // the rate arriving. Whether its row matched the ledger or is heading to Email
  // Pending, the parked copy is obsolete — clear it against ALL statement rows,
  // not just the missing ones.
  try {
    const { data: wrows } = await serviceSupabase.from("email_sync")
      .select("id, ai_raw_result").eq("user_id", userId).eq("status", "waiting_statement");
    if (wrows?.length) {
      const normW = (x: any) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const stmtKeys = stmtRows.map((m: any) => ({
        d: new Date((m.date || "") + "T00:00:00").getTime(),
        n: normW(m.description || m.merchant),
      }));
      const dayMs2 = 86400000;
      for (const wr of wrows) {
        let arr: any = wr.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { continue; }
        if (!Array.isArray(arr)) continue;
        let changed = false;
        for (const t of arr) {
          if (!t || !t._waiting_statement || t._imported || t._skipped) continue;
          if (t.from_account_id && t.from_account_id !== acc.id) continue;
          const tok = normW(t.merchant_name || t.description);
          if (tok.length < 5) continue;
          const td = new Date((t.date || "") + "T00:00:00").getTime();
          const hit = stmtKeys.some(k => (k.n.includes(tok) || tok.includes(k.n))
            && (!isFinite(td) || !isFinite(k.d) || Math.abs(k.d - td) <= 3 * dayMs2));
          if (hit) { t._imported = true; t._clearedByStatement = true; changed = true; }
        }
        if (changed) {
          const allDone = arr.every((t: any) => t?._imported || t?._skipped || t?.confirmed || t?.skipped);
          const stillWaiting = arr.some((t: any) => t?._waiting_statement && !t?._imported && !t?._skipped);
          await serviceSupabase.from("email_sync").update({
            ai_raw_result: arr,
            status: allDone ? "imported" : (stillWaiting ? "waiting_statement" : "pending"),
          }).eq("id", wr.id);
        }
      }
    }
  } catch (e) { console.error("[prepare] waiting twin clear:", (e as any)?.message); }

  // ── Paulus's flow (2026-08-24): email masuk → download → matching → yang TIDAK
  // match muncul di EMAIL PENDING. Missing rows become one email_sync row (source
  // "statement") so they flow through the exact same TxHorizontal editor and
  // approve pipeline as email transactions — no parallel review UI. Idempotent via
  // UNIQUE(user_id, gmail_message_id) with a synthetic stable id per account+period.
  try {
    const ignoredPrev = new Set((existing?.state_json?.ignoredIds) || []);
    const dayMs = 86400000;
    const dupHint = (row: any) => {
      const amt = Math.abs(Number(row.amount || 0));
      if (!amt) return null;
      const d0 = new Date((row.date || "") + "T00:00:00").getTime();
      for (const l of (ledgerAllAccounts || [])) {
        if (l.reconciled_at) continue; // consumed by an earlier statement
        if (Math.abs(Math.abs(Number(l.amount_idr || 0)) - amt) > 1) continue;
        const dl = new Date((l.tx_date || "") + "T00:00:00").getTime();
        if (Math.abs((d0 - dl) / dayMs) > 40) continue;
        return { tx_date: l.tx_date };
      }
      return null;
    };
    // Summary lines are not transactions — "Tagihan Bulan Lalu" accepted as an
    // expense would double the carried-over balance.
    const SUMMARY_RE = /tagihan bulan lalu|balance of last month|saldo sebelumnya|last balance|ending balance|^total\b|saldo awal/i;
    const txs = missing.filter((m: any) => !ignoredPrev.has(m._id) && !SUMMARY_RE.test(m.description || "")).map((m: any) => ({
      date: m.date, description: m.description || m.merchant || "",
      merchant_name: m.merchant || m.description || "",
      amount: Math.abs(Number(m.amount || 0)), amount_idr: Math.abs(Number(m.amount || 0)),
      currency: "IDR",
      suggested_tx_type: m.direction === "in" ? "income" : "expense",
      from_account_id: acc.id, card_last4: m.card_last4 || null,
      confidence: 1,
      _source: "statement", _stmt_id: m._id, _dup_hint: dupHint(m),
    }));
    // Pecahan Paper juga dipasang di jalur STATEMENT, bukan cuma notifikasi email.
    // Tagihan Paper yang lolos dari notifikasi akan tertangkap di rekonsiliasi
    // statement — kalau di sini tidak dipecah, fee-nya masuk piutang lagi.
    if (txs.length) {
      try {
        const tglTx = txs.map((t: any) => String(t.date || "").slice(0, 10)).filter(Boolean).sort();
        const at = await getAccessToken(serviceSupabase, userId, Deno.env.get("GOOGLE_CLIENT_SECRET") || "");
        if (at && tglTx.length) {
          const geser = (d: string, n: number) => {
            const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n);
            return x.toISOString().slice(0, 10).replace(/-/g, "/");
          };
          const splits = await buildPaperSplits(at, geser(tglTx[0], -3), geser(tglTx[tglTx.length - 1], 3));
          for (const t of txs) {
            const p = cariPecahan(splits, Number(t.amount_idr || t.amount || 0));
            if (p) t.paper_split = p;
          }
        }
      } catch (e) { console.warn("[prepare] pecahan Paper gagal:", (e as any)?.message); }
    }
    if (txs.length && pY && pM) {
      await serviceSupabase.from("email_sync").upsert({
        user_id: userId,
        gmail_message_id: `stmt:${acc.id}:${pY}-${String(pM).padStart(2, "0")}`,
        sender_email: "statement@reconcile",
        subject: `Statement ${acc.name} — ${pY}-${String(pM).padStart(2, "0")}`,
        received_at: new Date().toISOString(),
        email_type: "statement", source: "statement",
        ai_raw_result: txs, extracted_count: txs.length, imported_count: 0,
        status: "pending",
      }, { onConflict: "user_id,gmail_message_id", ignoreDuplicates: true });
    }
  } catch (e) { console.error("[prepare] email_sync feed:", (e as any)?.message); }

  return {
    prepared: true,
    account_id: acc.id, account_name: acc.name, account_type: acc.type,
    period: periodEnd ? `${pY}-${String(pM).padStart(2, "0")}` : null,
    stats: { statement: stmtRows.length, match, missing: missing.length, extra },
    closing_statement: stmtClosing, closing_ledger: ledgerClosing, gap,
    draft_saved: draftSaved, draft_skipped_user_work: !!hasUserWork,
  };
}

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
    // mark_done + prepare don't touch Gmail (prepare receives the PDF directly)
    if (!accessToken && action !== "mark_done" && action !== "prepare") {
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
      result = await extractUploadedPDF(serviceSupabase, userId, body, ANTHROPIC_KEY);

    } else if (action === "prepare") {
      // Auto-prepare reconcile from a downloaded statement PDF (Mac fetch script):
      // extract → detect account → diff vs ledger → save import_draft + prepared session.
      // READ-ONLY wrt the ledger — never writes transactions.
      const { pdf_base64 } = body;
      if (!pdf_base64) throw new Error("pdf_base64 required");
      const extraction = await extractUploadedPDF(serviceSupabase, userId, body, ANTHROPIC_KEY);
      if (!extraction.success) {
        result = { prepared: false, reason: extraction.encrypted ? "encrypted" : "extract_failed", ...extraction };
      } else {
        result = await prepareReconcile(serviceSupabase, userId, extraction, String(body.filename || "statement.pdf"));
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
