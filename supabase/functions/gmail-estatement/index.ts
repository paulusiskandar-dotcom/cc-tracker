// ─────────────────────────────────────────────────────────────────
// gmail-estatement/index.ts
// Two actions:
//   action: "scan"    → search Gmail for bank PDF attachments → insert estatement_pdfs
//   action: "process" → download PDF → try passwords → parse with Claude → return txns
//
// Deploy: supabase functions deploy gmail-estatement
// ─────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ── ACTION: scan ───────────────────────────────────────────────
async function scanGmailForStatements(
  serviceSupabase: any, userId: string, accessToken: string,
  fromDate?: string, toDate?: string
) {
  const domainQuery = BANK_DOMAINS.map(d => `from:${d}`).join(" OR ");
  // Gmail date format: YYYY/MM/DD
  const afterPart  = fromDate ? ` after:${fromDate.replace(/-/g, "/")}` : "";
  const beforePart = toDate   ? ` before:${toDate.replace(/-/g, "/")}` : "";
  const query = `has:attachment filename:pdf (${domainQuery})${afterPart}${beforePart}`;

  const listRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) {
    const err = await listRes.text();
    throw new Error(`Gmail list failed: ${err}`);
  }
  const listData = await listRes.json();
  const messages: any[] = listData.messages || [];
  console.log(`[gmail-estatement] found ${messages.length} candidate messages`);

  let newCount = 0;

  for (const msg of messages) {
    // Skip already-known
    const { data: existing } = await serviceSupabase
      .from("estatement_pdfs")
      .select("id")
      .eq("user_id", userId)
      .eq("gmail_message_id", msg.id)
      .maybeSingle();
    if (existing) continue;

    // Fetch message metadata
    const msgRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!msgRes.ok) continue;
    const msgData = await msgRes.json();

    const headers = msgData.payload?.headers || [];
    const subject  = headers.find((h: any) => h.name === "Subject")?.value || "";
    const from     = headers.find((h: any) => h.name === "From")?.value    || "";
    const dateHdr  = headers.find((h: any) => h.name === "Date")?.value    || "";

    const senderMatch = from.match(/<(.+)>/);
    const senderEmail = (senderMatch?.[1] || from).toLowerCase().trim();
    const bankName    = bankNameFromDomain(senderEmail);

    // Find PDF attachment names from parts
    const parts = msgData.payload?.parts || [];
    const pdfParts = parts.filter((p: any) =>
      p.filename?.toLowerCase().endsWith(".pdf") || p.mimeType === "application/pdf"
    );
    if (pdfParts.length === 0) continue;

    // Use first PDF attachment name
    const filename = pdfParts[0].filename || `${bankName}_statement.pdf`;

    // Try to parse statement month from subject or date
    let statementMonth: string | null = null;
    const monthMatch = (subject + " " + dateHdr).match(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-]*(\d{4})\b/i
    );
    if (monthMatch) {
      const months: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
      };
      const mo = months[monthMatch[1].toLowerCase().slice(0, 3)];
      if (mo) statementMonth = `${monthMatch[2] || "2025"}-${mo}`;
    }

    await serviceSupabase.from("estatement_pdfs").insert({
      user_id:          userId,
      gmail_message_id: msg.id,
      filename,
      bank_name:        bankName,
      statement_month:  statementMonth,
      status:           "pending",
    });
    newCount++;
  }

  return { new_pdfs: newCount, total_found: messages.length };
}

// ── ACTION: process ────────────────────────────────────────────
async function processStatement(
  serviceSupabase: any, userId: string, accessToken: string,
  statementId: string, passwordPatterns: any[], userVars: Record<string, string>,
  anthropicKey: string
) {
  // Load estatement record
  const { data: stmt, error: stmtErr } = await serviceSupabase
    .from("estatement_pdfs").select("*").eq("id", statementId).eq("user_id", userId).single();
  if (stmtErr || !stmt) throw new Error("Statement not found");

  // Mark as processing
  await serviceSupabase.from("estatement_pdfs")
    .update({ status: "processing" }).eq("id", statementId);

  // Fetch full message to find attachment
  const msgRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${stmt.gmail_message_id}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!msgRes.ok) throw new Error("Failed to fetch Gmail message");
  const msgData = await msgRes.json();

  // Find PDF attachment part
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

  // Download attachment
  const attRes = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${stmt.gmail_message_id}/attachments/${pdfPart.body.attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!attRes.ok) throw new Error("Failed to download PDF attachment");
  const attData = await attRes.json();
  // Gmail returns base64url-encoded data
  const pdfBase64 = (attData.data || "").replace(/-/g, "+").replace(/_/g, "/");

  if (!pdfBase64) throw new Error("Empty PDF attachment");

  // Build list of passwords to try (empty string = unprotected)
  const passwords: Array<{ label: string; value: string }> = [
    { label: "no password", value: "" },
  ];
  for (const p of passwordPatterns) {
    const resolved = resolvePassword(p.pattern || "", userVars);
    if (resolved) passwords.push({ label: p.label || p.pattern, value: resolved });
  }

  // Try each password with Claude
  let transactions: any[] = [];
  let usedPassword = "";
  let lastError = "";

  for (const pwd of passwords) {
    try {
      const promptPrefix = pwd.value
        ? `This is a password-protected bank e-statement PDF. The password is: "${pwd.value}". Extract ALL transactions from this document.`
        : `Extract ALL transactions from this bank e-statement PDF.`;

      const fullPrompt = `${promptPrefix}

Return a JSON array of transactions with this exact structure:
[{
  "date": "YYYY-MM-DD",
  "description": "transaction description",
  "amount": 150000,
  "currency": "IDR",
  "type": "debit|credit",
  "balance": 5000000,
  "tx_category": "payment|installment|fee|transfer|regular",
  "installment_no": null,
  "installment_total": null
}]

Rules for tx_category:
- "payment": Bill/CC payments (description contains: payment, pembayaran, bayar tagihan, pelunasan, pay bill, tagihan kartu)
- "installment": Installment charges (description contains: cicilan, angsuran, installment, cicil)
- "fee": Bank charges (description contains: biaya admin, admin fee, late charge, bunga, interest, annual fee, denda, iuran, service charge, provisi)
- "transfer": Inter-account transfers (description contains: transfer, pemindahan, top up, tarik tunai ke rekening lain)
- "regular": All other purchases, expenses, and income

For installment rows extract installment_no and installment_total if shown (e.g. "Cicilan 3/12" → no=3, total=12). Leave null if not shown.
If the PDF is password-protected and you cannot read it, return: {"error": "password_required"}
If the password is wrong, return: {"error": "wrong_password"}
Return ONLY the JSON array (or error object), no other text.`;

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "pdfs-2024-09-25",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 4096,
          messages: [{
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type:       "base64",
                  media_type: "application/pdf",
                  data:       pdfBase64,
                },
              },
              {
                type: "text",
                text: fullPrompt,
              },
            ],
          }],
        }),
      });

      if (!aiRes.ok) {
        lastError = `Claude API error: ${aiRes.status}`;
        continue;
      }

      const aiData = await aiRes.json();
      const rawText = aiData.content?.[0]?.text || "";
      const jsonMatch = rawText.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (!jsonMatch) { lastError = "No JSON in response"; continue; }

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed?.error === "password_required" || parsed?.error === "wrong_password") {
        lastError = parsed.error;
        continue;
      }

      const txns = Array.isArray(parsed) ? parsed : [];
      if (txns.length === 0) { lastError = "No transactions extracted"; continue; }

      transactions = txns;
      usedPassword = pwd.label;
      break;
    } catch (e) {
      lastError = String(e);
      continue;
    }
  }

  if (transactions.length === 0) {
    await serviceSupabase.from("estatement_pdfs")
      .update({ status: "password_needed" }).eq("id", statementId);
    return { success: false, error: lastError, needs_password: true };
  }

  // Update record
  await serviceSupabase.from("estatement_pdfs").update({
    status:            "parsed",
    transaction_count: transactions.length,
    processed_at:      new Date().toISOString(),
  }).eq("id", statementId);

  return { success: true, transactions, used_password: usedPassword, count: transactions.length };
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

// ── MAIN HANDLER ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")              || "";
  const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY")         || "";
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_KEY")             || "";
  const GOOGLE_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")      || "";

  // Authenticate user via Bearer token
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const userSupabase    = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceSupabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: { user }, error: authErr } = await userSupabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const userId = user.id;

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const action = body.action || "scan";

  try {
    // Get Gmail access token
    const accessToken = await getAccessToken(serviceSupabase, userId, GOOGLE_SECRET);
    if (!accessToken && action !== "mark_done") {
      return new Response(JSON.stringify({ error: "Gmail not connected" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    let result: any;

    if (action === "scan") {
      result = await scanGmailForStatements(serviceSupabase, userId, accessToken!, body.from_date, body.to_date);

    } else if (action === "process") {
      const { statement_id, passwords, user_vars } = body;
      if (!statement_id) throw new Error("statement_id required");

      // Load password list from DB if not provided
      let pwdList = passwords;
      if (!pwdList) {
        const { data } = await serviceSupabase
          .from("estatement_password_list")
          .select("*")
          .eq("user_id", userId)
          .order("sort_order");
        pwdList = data || [];
      }

      // Resolve user vars (birth date, account no)
      let vars = user_vars || {};
      if (!vars.DDMMYYYY) {
        const { data: setting } = await serviceSupabase
          .from("app_settings")
          .select("value")
          .eq("user_id", userId)
          .eq("key", "birth_date")
          .maybeSingle();
        if (setting?.value) {
          // Expect YYYY-MM-DD → convert to DDMMYYYY
          const parts = String(setting.value).split("-");
          if (parts.length === 3) vars.DDMMYYYY = `${parts[2]}${parts[1]}${parts[0]}`;
        }
      }

      result = await processStatement(
        serviceSupabase, userId, accessToken!, statement_id, pwdList, vars, ANTHROPIC_KEY
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
