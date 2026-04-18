// ─────────────────────────────────────────────────────────────────
// gmail-sync/index.ts
// Fetches new bank emails → AI extraction → saves to email_sync (pending)
//
// Called by:
//   - Supabase cron every 15 min (no body → processes ALL connected users)
//   - Frontend manually (body: { user_id: "..." } → single user)
//
// Deploy: supabase functions deploy gmail-sync
// Cron:   */15 * * * *  (Supabase Dashboard → Functions → Schedules)
//
// Secrets needed:
//   ANTHROPIC_KEY (already set from ai-proxy)
//   SUPABASE_SERVICE_ROLE_KEY
// ─────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Bank/ewallet sender domains (domain-based matching, more robust than exact emails)
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
  // additional domains
  "smbci.com",
  "btpn.com",
  "mybca.com",
  "bcadigital.co.id",
  "mandirisyariah.co.id",
  "livin.id",
  "brimo.bri.co.id",
  "ocbcnisp.com",
  "ocbcnisp.co.id",
  "danamonline.com",
  "cimb.com",
  "uobgroup.com",
  "hsbc.com",
  "megasyariah.co.id",
  "permatabank.co.id",
  "noreply.jenius.com",
  "info.jenius.com",
  // Mandiri subdomains (bankmandiri.co.id covers these via Gmail search, but list explicitly)
  "livin.bankmandiri.co.id",
  "notifikasi.bankmandiri.co.id",
];

// Keywords (case-insensitive) in the subject that mark an email as likely carrying
// a bank statement PDF. Used by the statement_attachments detector.
const STATEMENT_SUBJECT_KEYWORDS = ["statement", "rekening", "mutasi", "tagihan", "e-statement"];

// Map sender domain → canonical bank name (shared with gmail-estatement).
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

const MONTH_LOOKUP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Keywords that indicate non-transactional emails to skip.
// NOTE: Bracketed subject prefixes like [RAHASIA], [INFO], [WARNING] are intentionally
// NOT in this list — Indonesian banks use these brackets on real transaction emails
// (e.g. CIMB "[RAHASIA] Konfirmasi Transaksi").
const SKIP_KEYWORDS = [
  "promo", "penawaran", "diskon", "newsletter",
  "otp", "password", "aktivasi", "selamat datang",
  "survey", "feedback", "undian", "offer", "discount",
  "kode verifikasi", "verification code", "reset password",
  "activation", "welcome", "registration",
];

// Known transaction-positive subject patterns — never skip these even if a skip keyword
// appears elsewhere in the subject.
const FORCE_INCLUDE_PATTERNS = [
  /konfirmasi\s+transaksi/i,
  /transaksi\s+kartu/i,
  /pembayaran\s+berhasil/i,
  /notifikasi\s+transaksi/i,
  /transaction\s+alert/i,
  /debit\s+alert/i,
];

const AI_EXTRACTION_PROMPT = (emailContent: string, accounts: any[], merchantContext: string) => `
You are a financial transaction extractor for an Indonesian personal finance app.
Analyze this bank email and extract ALL transactions.

User accounts for matching:
${JSON.stringify(accounts.map(a => ({
  id: a.id, name: a.name, type: a.type,
  last4: a.last4, account_no: a.account_no, bank_name: a.bank_name,
})))}

${merchantContext}

Email content:
${emailContent.slice(0, 6000)}

SUBJECT LINE NOTE: Indonesian bank emails often prefix subjects with brackets like [RAHASIA], [INFO], [WARNING], [PENTING]. Strip this prefix mentally before pattern matching — e.g. "[RAHASIA] Konfirmasi Transaksi" matches the CIMB pattern below.

SPECIAL EMAIL PATTERNS — apply these before generic extraction:

1. CIMB NIAGA CC TRANSACTION (subject contains "Konfirmasi Transaksi", sender cimbniaga.co.id):
   - Extract "No. Kartu Kredit" → card_last4 (take the last 4 visible digits, e.g. "XX87" → "XX87"; use whatever digits are shown)
   - Extract "Jumlah Transaksi" → amount (remove "Rp", dots, commas → integer IDR)
   - Extract "Tanggal/Waktu Transaksi" → date (take YYYY-MM-DD portion, ignore time)
   - Extract "Nama Merchant" → merchant_name and description
   - suggested_tx_type = "expense"
   - from_account_masked = raw card number string from email
   - from_bank_name = "CIMB Niaga"
   - confidence = 0.95

3. MANDIRI "PEMBAYARAN BERHASIL" (subject contains "Pembayaran Berhasil", sender bankmandiri.co.id or livin.bankmandiri.co.id):
   - Extract "Nominal Transaksi" → amount (remove "Rp", dots → integer IDR)
   - Extract "Tanggal" → date (DD/MM/YYYY or DD Bulan YYYY → YYYY-MM-DD)
   - Extract "Penerima" → merchant_name and description
   - Extract "Sumber Dana" → from_account_masked (copy raw value exactly)
   - If "Sumber Dana" contains "Kartu Kredit" or "Credit Card":
     → suggested_tx_type = "expense", from_bank_name = "Mandiri"
   - If "Sumber Dana" contains "Tabungan" or "TabPlus" or "Giro":
     → suggested_tx_type = "expense" (or "transfer" if Penerima matches own account)
     → from_bank_name = "Mandiri"
   - confidence = 0.95

4. BCA DEBIT / CREDIT CARD NOTIFICATION (subject contains "Transaksi Kartu Debit", "Transaksi Kartu Kredit", "Notifikasi Transaksi", or "BCA Krisflyer"):
   - Extract amount, date, merchant, card number (last4)
   - suggested_tx_type = "expense" — ALWAYS expense for BCA card transactions at merchants
   - If card is a credit card product (Krisflyer, Visa, Mastercard mentioned) → card_last4 from "No. Kartu" or masked card number

5. TRANSFER NOTIFICATION (subject contains "Transfer", body has "Transfer ke" or "Berhasil ditransfer"):
   - Extract amount, date, destination account
   - suggested_tx_type = "transfer" if to_account matches own account, else "expense"

For each transaction return a JSON array:
[{
  "date": "YYYY-MM-DD",
  "description": "merchant or transaction description",
  "merchant_name": "normalized merchant name",
  "amount": 150000,
  "amount_idr": 150000,
  "currency": "IDR",
  "card_last4": "1234 or null",
  "from_account_no": "account number or null",
  "to_account_no": "account number or null",
  "from_account_masked": "raw masked string from email e.g. TAHAPAN - 0831****88 or ****5130 or null",
  "from_bank_name": "BCA or null",
  "to_bank_name": "null",
  "type": "out or in",
  "is_qris": false,
  "is_debit": false,
  "is_transfer": false,
  "is_cc_payment": false,
  "from_account_id": "null - leave null, will be matched by post-processing",
  "to_account_id": "null - leave null, will be matched by post-processing",
  "suggested_category": "Food & Drinks",
  "category_id": "food",
  "suggested_entity": "Personal",
  "suggested_tx_type": "expense",
  "confidence": 0.95,
  "reasoning": "Grab Food is food delivery"
}]

Rules:
- Extract from_account_masked: look in "Source of Fund", "Card number", "Sumber Dana", "Account" fields. Copy the raw masked string exactly as it appears (e.g. "TAHAPAN - 0831****88", "437896******5130", "Kartu Kredit - ****1234").
- Leave from_account_id and to_account_id as null — account matching is done by post-processing code.
- If merchant_name matches a known merchant above, use that mapping's category_id exactly.
- QRIS/QR payment → is_qris=true, suggested_tx_type=qris_debit
- Transfer to own account → is_transfer=true, suggested_tx_type=transfer
- CC payment → is_cc_payment=true, suggested_tx_type=pay_cc
- CRITICAL — CC debit rule: if card_last4 is present (i.e. the transaction comes from a credit card account like BCA Krisflyer, CIMB, Mandiri CC, etc.) AND the description/merchant is a business/store name → suggested_tx_type MUST be "expense", NOT "transfer". Transfer only applies when money moves between two of the user's own bank accounts with no merchant name.
- For Mandiri "Pembayaran Berhasil": ALWAYS extract even if layout is unusual — Penerima = recipient/merchant, Nominal Transaksi = amount (remove "Rp" and dots).
- Return ONLY valid JSON array, no markdown.

IMPORTANT - Year detection rules:
- If the email clearly shows a year, use that year
- If no year is visible or it is ambiguous, use the current year (2026)
- Never use years before 2026 unless explicitly stated in the email
- For transaction notifications without a year, assume 2026
- Double-check: if a transaction date would result in a year before 2024, it is likely wrong — default to 2026
`;

// Extract the visible (unmasked) trailing digits from a masked account/card string.
// Examples:
//   "TAHAPAN - 0831****88"  → "88"
//   "437896******5130"      → "5130"
//   "****1234"              → "1234"
//   "1234567890"            → "1234567890"  (no asterisks, return full)
function extractVisibleSuffix(masked: string): string | null {
  if (!masked) return null;
  // Find last run of digits after asterisks
  const m = masked.match(/\*+(\d+)\s*$/);
  if (m) return m[1];
  // No asterisks — strip spaces/dashes and return raw digits
  const digits = masked.replace(/[\s\-]/g, "").match(/\d+$/);
  return digits ? digits[0] : null;
}

// Match a masked account string against the user's accounts list.
// Returns the best matching account id, or null if no confident match.
function matchAccount(masked: string | null, bankName: string | null, accounts: any[]): string | null {
  if (!masked || accounts.length === 0) return null;

  const suffix = extractVisibleSuffix(masked);
  if (!suffix) return null;

  // Filter by bank if we know it
  const pool = bankName
    ? accounts.filter(a => a.bank_name && a.bank_name.toLowerCase().includes(bankName.toLowerCase()))
    : accounts;

  // Try suffix match against account_no
  const byAccountNo = pool.filter(a => a.account_no && String(a.account_no).endsWith(suffix));
  if (byAccountNo.length === 1) return byAccountNo[0].id;

  // Try suffix match against last4
  const byLast4 = pool.filter(a => a.last4 && String(a.last4) === suffix.slice(-4));
  if (byLast4.length === 1) return byLast4[0].id;

  // Ambiguous or no match — return null so user can assign manually
  return null;
}

// Resolve account IDs for all extracted transactions using deterministic suffix matching.
function resolveAccountIds(transactions: any[], accounts: any[]): any[] {
  return transactions.map(tx => {
    const fromId = matchAccount(
      tx.from_account_masked || tx.from_account_no || null,
      tx.from_bank_name || null,
      accounts,
    );
    const toId = matchAccount(
      tx.to_account_no || null,
      tx.to_bank_name || null,
      accounts,
    );
    return { ...tx, from_account_id: fromId, to_account_id: toId };
  });
}

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

async function processUser(supabase: any, userId: string, anthropicKey: string, googleSecret: string, fromDate?: string, toDate?: string) {
  // Load token
  const { data: tokenRow } = await supabase.from("gmail_tokens").select("*").eq("user_id", userId).single();
  if (!tokenRow) return { processed: 0, new_transactions: 0 };

  // Refresh token if expired
  let accessToken = tokenRow.access_token;
  if (tokenRow.token_expiry && new Date(tokenRow.token_expiry) < new Date(Date.now() + 60000)) {
    const newToken = await refreshAccessToken(tokenRow, googleSecret);
    if (newToken) {
      accessToken = newToken;
      const newExpiry = new Date(Date.now() + 3500 * 1000).toISOString();
      await supabase.from("gmail_tokens").update({ access_token: newToken, token_expiry: newExpiry }).eq("user_id", userId);
    }
  }

  // Load user accounts for matching
  const { data: accounts } = await supabase.from("accounts").select("id,name,type,last4,account_no,bank_name").eq("user_id", userId).eq("is_active", true);
  const userAccounts = accounts || [];

  // Load merchant mappings for AI context
  const { data: merchantMappings } = await supabase
    .from("merchant_mappings")
    .select("merchant_name,canonical_name,category_id,account_id")
    .eq("user_id", userId);
  const mappingsMap = new Map<string, any>();
  (merchantMappings || []).forEach((m: any) => {
    if (m.merchant_name) mappingsMap.set(m.merchant_name.toLowerCase(), m);
  });
  const merchantContext = mappingsMap.size > 0
    ? `Known merchants (use these to auto-assign category_id):\n` +
      [...mappingsMap.values()].map((m: any) =>
        `- "${m.merchant_name}" → canonical: "${m.canonical_name}", category_id: ${m.category_id}`
      ).join("\n")
    : "No merchant mappings yet.";

  // Build Gmail search query with date range
  let afterDate: string;
  let beforeDate: string | null = null;
  if (fromDate) {
    afterDate = fromDate.replace(/-/g, "/");
    if (toDate) beforeDate = toDate.replace(/-/g, "/");
  } else {
    const lastSync = tokenRow.last_sync ? new Date(tokenRow.last_sync) : new Date(Date.now() - 7 * 86400000);
    afterDate = lastSync.toISOString().slice(0, 10).replace(/-/g, "/");
  }
  const domainQuery = BANK_DOMAINS.map(d => `from:${d}`).join(" OR ");
  let query = `(${domainQuery}) after:${afterDate}`;
  if (beforeDate) query += ` before:${beforeDate}`;

  // Fetch messages list
  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) {
    console.error("[gmail-sync] Gmail list failed:", await listRes.text());
    return { processed: 0, new_transactions: 0 };
  }
  const listData = await listRes.json();
  const messages = listData.messages || [];

  let processed = 0;
  let newTransactions = 0;

  for (const msg of messages) {
    // Skip if already processed
    const { data: existing } = await supabase.from("email_sync")
      .select("id").eq("user_id", userId).eq("gmail_message_id", msg.id).single();
    if (existing) continue;

    // Fetch full message
    const msgRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!msgRes.ok) continue;
    const msgData = await msgRes.json();

    // Extract headers
    const headers = msgData.payload?.headers || [];
    const subject    = headers.find((h: any) => h.name === "Subject")?.value || "";
    const from       = headers.find((h: any) => h.name === "From")?.value || "";
    const receivedAt = headers.find((h: any) => h.name === "Date")?.value || "";

    // Normalize sender email
    const senderMatch = from.match(/<(.+)>/);
    const senderEmail = (senderMatch?.[1] || from).toLowerCase().trim();

    // Check skip keywords in subject.
    // Strip bracketed prefixes like [RAHASIA], [INFO] before matching — these are used
    // by Indonesian banks on real transaction emails (e.g. CIMB "[RAHASIA] Konfirmasi Transaksi").
    const subjectNoBrackets = subject.replace(/^\s*\[[^\]]*\]\s*/g, "").toLowerCase();
    const forceInclude = FORCE_INCLUDE_PATTERNS.some(p => p.test(subject));
    const shouldSkip = !forceInclude && SKIP_KEYWORDS.some(kw => subjectNoBrackets.includes(kw.toLowerCase()));
    if (shouldSkip) {
      await supabase.from("email_sync").insert({
        user_id: userId, gmail_message_id: msg.id,
        sender_email: senderEmail, subject, status: "skipped",
        received_at: receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString(),
        email_type: "skipped",
      });
      continue;
    }

    // Extract email body
    let rawBody = "";
    const extractBody = (part: any): string => {
      if (!part) return "";
      if (part.body?.data) return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
      if (part.parts) return part.parts.map(extractBody).join("\n");
      return "";
    };
    rawBody = extractBody(msgData.payload);
    // Strip HTML tags for plain text
    const plainBody = rawBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    // Walk the full MIME tree — PDF attachments can live inside multipart/mixed
    // or multipart/related wrappers, not just top-level payload.parts.
    const allParts: any[] = [];
    const collectParts = (part: any) => {
      if (!part) return;
      allParts.push(part);
      if (part.parts) part.parts.forEach(collectParts);
    };
    collectParts(msgData.payload);

    const pdfAttachments = allParts.filter((p: any) =>
      (p.filename?.toLowerCase().endsWith(".pdf") || p.mimeType === "application/pdf")
      && p.body?.attachmentId
    );
    const hasPdf    = pdfAttachments.length > 0;
    const emailType = hasPdf ? "monthly_statement" : "transaction_notification";

    // ── Flag statement PDFs (do NOT download) ──────────────────
    // If the subject looks like a bank statement AND there are PDF attachments,
    // save attachment metadata so the Reconcile UI can fetch them on demand.
    const subjectLower   = subject.toLowerCase();
    const isStatementSubj = STATEMENT_SUBJECT_KEYWORDS.some(k => subjectLower.includes(k));
    if (hasPdf && isStatementSubj) {
      const bankName = bankNameFromDomain(senderEmail);

      // Try to match a single account by bank name (best-effort — user can reassign).
      const poolAccounts = userAccounts.filter((a: any) =>
        a.bank_name && a.bank_name.toLowerCase().includes(bankName.toLowerCase())
      );
      const matchedAccountId = poolAccounts.length === 1 ? poolAccounts[0].id : null;

      // Period: "Jan 2026" / "January 2026" in subject wins, else fall back to received date.
      let periodYear:  number | null = null;
      let periodMonth: number | null = null;
      const monthMatch = (subject + " " + receivedAt).match(
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-,]*(\d{4})\b/i
      );
      if (monthMatch) {
        periodMonth = MONTH_LOOKUP[monthMatch[1].toLowerCase().slice(0, 3)] || null;
        periodYear  = parseInt(monthMatch[2], 10);
      } else if (receivedAt) {
        const d = new Date(receivedAt);
        if (!isNaN(d.getTime())) {
          periodYear  = d.getFullYear();
          periodMonth = d.getMonth() + 1;
        }
      }

      for (const pdfPart of pdfAttachments) {
        try {
          await supabase.from("statement_attachments").upsert(
            {
              user_id:          userId,
              gmail_message_id: msg.id,
              attachment_id:    pdfPart.body.attachmentId,
              filename:         pdfPart.filename || "statement.pdf",
              sender_email:     senderEmail,
              bank_name:        bankName,
              account_id:       matchedAccountId,
              period_year:      periodYear,
              period_month:     periodMonth,
              subject,
              received_at:      receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString(),
            },
            { onConflict: "user_id,gmail_message_id,attachment_id" }
          );
        } catch (e) {
          console.warn("[gmail-sync] statement_attachments upsert failed:", e);
        }
      }
    }

    // AI extraction
    let aiResult = null;
    let extractedCount = 0;
    try {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          messages: [{
            role: "user",
            content: AI_EXTRACTION_PROMPT(plainBody, userAccounts, merchantContext),
          }],
        }),
      });

      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const text = aiData.content?.[0]?.text || "[]";
        try {
          let parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          if (!Array.isArray(parsed) && parsed) parsed = [parsed];
          if (Array.isArray(parsed)) {
            const resolved = resolveAccountIds(parsed, userAccounts);
            // Apply merchant mapping overrides (category_id, account_id)
            aiResult = resolved.map((tx: any) => {
              const key = (tx.merchant_name || "").toLowerCase();
              const mapping = mappingsMap.get(key);
              if (mapping) {
                return {
                  ...tx,
                  category_id: mapping.category_id ?? tx.category_id,
                  from_account_id: tx.from_account_id ?? mapping.account_id ?? null,
                };
              }
              return tx;
            });
            extractedCount = aiResult.length;
          }
        } catch {
          aiResult = null;
        }
      }
    } catch (e) {
      console.warn("[gmail-sync] AI extraction error:", e);
    }

    // Save to email_sync
    const { error: insertErr } = await supabase.from("email_sync").insert({
      user_id:          userId,
      gmail_message_id: msg.id,
      sender_email:     senderEmail,
      subject,
      received_at:      receivedAt ? new Date(receivedAt).toISOString() : new Date().toISOString(),
      email_type:       emailType,
      raw_body:         plainBody.slice(0, 5000),
      ai_raw_result:    aiResult,
      extracted_count:  extractedCount,
      status:           aiResult && extractedCount > 0 ? "pending" : "review",
    });

    if (!insertErr) {
      processed++;
      newTransactions += extractedCount;

      // Upsert new merchants so future syncs learn from them
      if (Array.isArray(aiResult) && aiResult.length > 0) {
        for (const tx of aiResult) {
          const name = (tx.merchant_name || "").trim();
          if (!name || mappingsMap.has(name.toLowerCase())) continue;
          try {
            await supabase.from("merchant_mappings").upsert(
              {
                user_id:        userId,
                merchant_name:  name,
                canonical_name: name,
                category_id:    tx.category_id || null,
                account_id:     tx.from_account_id || null,
              },
              { onConflict: "user_id,merchant_name" }
            );
            // Add to in-memory map so duplicates within this batch are skipped
            mappingsMap.set(name.toLowerCase(), { merchant_name: name, canonical_name: name, category_id: tx.category_id, account_id: tx.from_account_id });
          } catch (e) {
            console.warn("[gmail-sync] Failed to upsert merchant mapping:", e);
          }
        }
      }
    }
  }

  // Update last_sync
  await supabase.from("gmail_tokens").update({ last_sync: new Date().toISOString() }).eq("user_id", userId);

  // Record when this sync ran (read by Dashboard banner, updated even if no new emails)
  const syncNow = new Date().toISOString();
  await supabase.from("app_settings").upsert(
    { user_id: userId, key: "gmail_last_sync_at", value: JSON.stringify(syncNow) },
    { onConflict: "user_id,key" }
  );

  // Save sync log entry to app_settings (max 50 entries, newest first)
  try {
    const syncEntry = {
      synced_at:        new Date().toISOString(),
      emails_processed: processed,
      new_transactions: newTransactions,
      status:           "success",
    };
    const { data: existing } = await supabase
      .from("app_settings")
      .select("value")
      .eq("user_id", userId)
      .eq("key", "gmail_sync_log")
      .maybeSingle();
    const history: any[] = existing ? JSON.parse(existing.value) : [];
    const updated = [syncEntry, ...history].slice(0, 50);
    await supabase.from("app_settings").upsert(
      { user_id: userId, key: "gmail_sync_log", value: JSON.stringify(updated) },
      { onConflict: "user_id,key" }
    );
  } catch (logErr) {
    console.warn("[gmail-sync] Failed to save sync log:", logErr);
  }

  return { processed, new_transactions: newTransactions };
}

// Re-run AI extraction for specific email_sync rows (by ID).
// Used by the "Re-Process" button in the Email Pending UI.
async function reprocessEmails(supabase: any, userId: string, ids: string[], anthropicKey: string) {
  // Load accounts and merchant mappings
  const { data: accounts } = await supabase.from("accounts")
    .select("id,name,type,last4,account_no,bank_name").eq("user_id", userId).eq("is_active", true);
  const userAccounts = accounts || [];

  const { data: merchantMappings } = await supabase.from("merchant_mappings")
    .select("merchant_name,canonical_name,category_id,account_id").eq("user_id", userId);
  const mappingsMap = new Map<string, any>();
  (merchantMappings || []).forEach((m: any) => {
    if (m.merchant_name) mappingsMap.set(m.merchant_name.toLowerCase(), m);
  });
  const merchantContext = mappingsMap.size > 0
    ? `Known merchants (use these to auto-assign category_id):\n` +
      [...mappingsMap.values()].map((m: any) => `- "${m.merchant_name}" → category_id: ${m.category_id}`).join("\n")
    : "No merchant mappings yet.";

  // Fetch the rows to reprocess
  const { data: rows } = await supabase.from("email_sync")
    .select("id,raw_body,subject,sender_email").eq("user_id", userId).in("id", ids);

  let reprocessed = 0;

  for (const row of rows || []) {
    const plainBody = row.raw_body || "";
    try {
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2048,
          messages: [{
            role: "user",
            content: AI_EXTRACTION_PROMPT(plainBody, userAccounts, merchantContext),
          }],
        }),
      });
      if (aiRes.ok) {
        const aiData = await aiRes.json();
        const text = aiData.content?.[0]?.text || "[]";
        let parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        if (!Array.isArray(parsed) && parsed) parsed = [parsed];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const resolved = resolveAccountIds(parsed, userAccounts);
          const aiResult = resolved.map((tx: any) => {
            const key = (tx.merchant_name || "").toLowerCase();
            const mapping = mappingsMap.get(key);
            return mapping
              ? { ...tx, category_id: mapping.category_id ?? tx.category_id, from_account_id: tx.from_account_id ?? mapping.account_id ?? null }
              : tx;
          });
          await supabase.from("email_sync").update({
            ai_raw_result:   aiResult,
            extracted_count: aiResult.length,
            status:          "pending",
            error_message:   null,
          }).eq("id", row.id).eq("user_id", userId);
          reprocessed++;
        }
      }
    } catch (e) {
      console.warn("[gmail-sync] reprocess error for", row.id, ":", e);
    }
  }

  return { reprocessed };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_KEY") || "";
  const GOOGLE_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let targetUserId: string | null = null;
  let fromDate: string | undefined;
  let toDate: string | undefined;
  let reprocessIds: string[] | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    targetUserId = body.user_id || null;
    fromDate     = body.from_date || undefined;
    toDate       = body.to_date   || undefined;
    reprocessIds = body.reprocess_ids || null;
  } catch { /* cron call with no body */ }

  // Re-process specific emails by ID
  if (reprocessIds && targetUserId) {
    try {
      const result = await reprocessEmails(supabase, targetUserId, reprocessIds, ANTHROPIC_KEY);
      return new Response(JSON.stringify({ success: true, ...result }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  }

  let userIds: string[] = [];

  if (targetUserId) {
    userIds = [targetUserId];
  } else {
    // Cron: get all users with connected Gmail
    const { data: tokens } = await supabase.from("gmail_tokens").select("user_id");
    userIds = (tokens || []).map((t: any) => t.user_id);
  }

  const results: any[] = [];
  for (const uid of userIds) {
    try {
      const result = await processUser(supabase, uid, ANTHROPIC_KEY, GOOGLE_SECRET, fromDate, toDate);
      results.push({ user_id: uid, ...result });
    } catch (e) {
      console.error(`[gmail-sync] Error for user ${uid}:`, e);
      results.push({ user_id: uid, error: String(e) });
    }
  }

  const totalNew = results.reduce((s, r) => s + (r.new_transactions || 0), 0);
  const totalProc = results.reduce((s, r) => s + (r.processed || 0), 0);

  return new Response(JSON.stringify({
    success: true,
    users_processed: userIds.length,
    emails_processed: totalProc,
    new_transactions: totalNew,
    results,
  }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
