// ─────────────────────────────────────────────────────────────────
// gmail-estatement/index.ts
// Actions:
//   "scan"      → search Gmail for bank PDF attachments → insert estatement_pdfs
//   "process"   → download PDF → pdf-lib password unlock → Claude AI extract
//   "mark_done" → mark statement as done
//
// Deploy: supabase functions deploy gmail-estatement
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

// ── HELPER: try to unlock PDF with pdf-lib ─────────────────────
// Returns base64 of unlocked PDF, or null if password is wrong / PDF unreadable
async function tryUnlockPDF(pdfBase64: string, password: string): Promise<string | null> {
  try {
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const opts: any = password ? { password } : {};
    const pdfDoc = await PDFDocument.load(bytes, opts);
    const saved = await pdfDoc.save();
    // Chunked btoa to avoid stack overflow on large PDFs
    let binary = "";
    const chunk = 8192;
    for (let i = 0; i < saved.length; i += chunk) {
      binary += String.fromCharCode(...saved.subarray(i, i + chunk));
    }
    return btoa(binary);
  } catch {
    return null;
  }
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

// ── ACTION: process ────────────────────────────────────────────
// Download PDF → test passwords with pdf-lib → unlock → extract with Claude.
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

  // Download PDF
  console.log(`[gmail-estatement] process: downloading PDF (message=${stmt.gmail_message_id})`);
  const pdfBase64 = await downloadPDFFromGmail(accessToken, stmt.gmail_message_id);
  console.log(`[gmail-estatement] process: PDF downloaded, size=${pdfBase64.length}`);

  // Build password list
  let passwords: string[];
  if (onlyPassword !== undefined) {
    passwords = [onlyPassword];
  } else {
    const resolved = passwordPatterns
      .map((p: any) => resolvePassword(p.pattern || "", userVars))
      .filter(Boolean);
    passwords = ["", ...resolved];
  }
  console.log(`[gmail-estatement] process: trying ${passwords.length} password(s) with pdf-lib`);

  // Try each password with pdf-lib (password detection only)
  // For unencrypted PDFs: keep original bytes — pdf-lib re-serialization strips font streams
  // For encrypted PDFs: use pdf-lib unlocked bytes (necessary to remove encryption)
  let pdfForAI: string | null = null;
  let isEncrypted = false;

  for (let i = 0; i < passwords.length; i++) {
    const unlocked = await tryUnlockPDF(pdfBase64, passwords[i]);
    if (unlocked !== null) {
      // Unencrypted (empty password): send original bytes so Claude sees intact text/fonts
      // Encrypted (real password): send unlocked bytes — encryption removed by pdf-lib
      pdfForAI = passwords[i] === "" ? pdfBase64 : unlocked;
      console.log(`[gmail-estatement] process: unlocked with password index ${i} (${passwords[i] ? "password" : "no password"}) — using ${passwords[i] === "" ? "original" : "pdf-lib"} bytes`);
      break;
    }
    if (i === 0) isEncrypted = true; // no-password attempt failed → encrypted
  }

  if (pdfForAI === null) {
    await serviceSupabase.from("estatement_pdfs")
      .update({ status: isEncrypted ? "password_needed" : "pending" }).eq("id", statementId);
    return { success: false, needs_password: isEncrypted, encrypted: isEncrypted };
  }

  // Send PDF to Claude as base64 document
  console.log(`[gmail-estatement] process: sending to Claude AI, pdf size=${pdfForAI.length}`);

  const prompt = `You are an expert at extracting transactions from Indonesian bank and credit card statements.

EXTRACT only actual financial transactions. Return a JSON array.

INCLUDE these transaction types:
- Regular purchases/expenses (merchant name + amount)
- Installment payments (CICILAN/INSTALLMENT - note the X/Y pattern and total)
- Bank fees: biaya admin, biaya layanan notifikasi, bea materai, iuran tahunan, bunga, denda, provisi
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
  "merchant": "cleaned merchant name",
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
- installment_current / installment_total: e.g. 10 and 12 from "10/12", else null
- is_fee: true if bank fee/charge (admin, materai, annual fee, bunga, denda, notifikasi)
- fee_type: "materai" | "admin" | "annual_fee" | "interest" | "notification" | "penalty" | null
- is_transfer: true if description contains "Transfer ke" or "Transfer dari"
- card_last4: last 4 digits of card if shown next to the transaction, else null
- account_hint: account number from section header if applicable, else null

Return ONLY valid JSON array. No markdown, no explanation.
If no transactions found, return [].`;

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta":    "pdfs-2024-09-25",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type:       "base64",
              media_type: "application/pdf",
              data:       pdfForAI,
            },
          },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error(`[gmail-estatement] Claude API error: ${aiRes.status} ${errText}`);
    await serviceSupabase.from("estatement_pdfs")
      .update({ status: "pending" }).eq("id", statementId);
    throw new Error(`Claude API error: ${aiRes.status}`);
  }

  const aiData  = await aiRes.json();
  const rawText = aiData.content?.[0]?.text || "";
  console.log(`[gmail-estatement] process: Claude response length=${rawText.length}`);

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    await serviceSupabase.from("estatement_pdfs")
      .update({ status: "pending" }).eq("id", statementId);
    return {
      success: false,
      error: "No transactions extracted — PDF may be a scanned image or unsupported format.",
      needs_password: false, encrypted: false,
    };
  }

  let transactions: any[];
  try {
    transactions = JSON.parse(jsonMatch[0]);
  } catch {
    await serviceSupabase.from("estatement_pdfs")
      .update({ status: "pending" }).eq("id", statementId);
    return { success: false, error: "Could not parse AI response.", needs_password: false, encrypted: false };
  }

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
