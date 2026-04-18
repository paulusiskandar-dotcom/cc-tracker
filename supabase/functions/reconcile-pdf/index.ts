// ─────────────────────────────────────────────────────────────────
// reconcile-pdf/index.ts
// Download a specific PDF statement attachment from Gmail on demand,
// optionally decrypt it with a user-supplied password, then send to
// Claude AI to extract transactions for the Reconcile modal.
//
// Input body:
//   { user_id, email_id, attachment_id, password? }
//
// Output:
//   { success: true, transactions: [...] }  |
//   { success: false, needs_password: true, encrypted: true, error }  |
//   { success: false, error }
//
// Deploy: supabase functions deploy reconcile-pdf --no-verify-jwt
// ─────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── OAuth helpers ─────────────────────────────────────────────
async function refreshAccessToken(token: any, clientSecret: string): Promise<string | null> {
  if (!token.refresh_token) return null;
  const clientId = token.client_id || Deno.env.get("GOOGLE_CLIENT_ID") || "";
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:  "POST",
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

async function getAccessToken(supabase: any, userId: string, googleSecret: string): Promise<string | null> {
  const { data: tokenRow } = await supabase
    .from("gmail_tokens").select("*").eq("user_id", userId).single();
  if (!tokenRow) return null;

  let accessToken = tokenRow.access_token;
  if (tokenRow.token_expiry && new Date(tokenRow.token_expiry) < new Date(Date.now() + 60000)) {
    const newToken = await refreshAccessToken(tokenRow, googleSecret);
    if (newToken) {
      accessToken = newToken;
      const newExpiry = new Date(Date.now() + 3500 * 1000).toISOString();
      await supabase.from("gmail_tokens")
        .update({ access_token: newToken, token_expiry: newExpiry })
        .eq("user_id", userId);
    }
  }
  return accessToken;
}

// ── Gmail attachment download ─────────────────────────────────
async function downloadAttachment(
  accessToken: string, messageId: string, attachmentId: string
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`Gmail attachment fetch failed: ${res.status}`);
  const data = await res.json();
  // Gmail returns base64url — convert to standard base64 for Claude / pdf-lib.
  const b64 = (data.data || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!b64) throw new Error("Empty attachment payload from Gmail");
  return b64;
}

// Walk the MIME tree to find a PDF attachment when attachment_id is not provided.
async function findPrimaryPdfAttachmentId(
  accessToken: string, messageId: string
): Promise<string | null> {
  const res = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const msg = await res.json();

  const all: any[] = [];
  const walk = (p: any) => { if (!p) return; all.push(p); if (p.parts) p.parts.forEach(walk); };
  walk(msg.payload);

  const pdf = all.find((p: any) =>
    (p.filename?.toLowerCase().endsWith(".pdf") || p.mimeType === "application/pdf") && p.body?.attachmentId
  );
  return pdf?.body?.attachmentId || null;
}

// ── PDF decryption ────────────────────────────────────────────
async function tryDecryptPDF(
  pdfBase64: string, password: string
): Promise<{ base64: string } | { error: "wrong_password" | "unsupported" }> {
  try {
    const bytes  = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
    const pdfDoc = await PDFDocument.load(bytes, { password });
    const saved  = await pdfDoc.save();
    const base64 = btoa(
      Array.from(new Uint8Array(saved))
        .map((b: number) => String.fromCharCode(b))
        .join("")
    );
    return { base64 };
  } catch (e: any) {
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes("unsupport") || msg.includes("aes") || (msg.includes("encrypt") && !msg.includes("password"))) {
      return { error: "unsupported" };
    }
    return { error: "wrong_password" };
  }
}

// ── Claude extraction ─────────────────────────────────────────
// Same prompt shape as gmail-estatement — kept here as its own copy so
// both functions can evolve independently.
const EXTRACTION_PROMPT = `You are an expert at extracting transactions from Indonesian bank and credit card statements.

STEP 1 — DETECT DOCUMENT CURRENCY:
- Look at the statement header for a currency indicator. BCA foreign currency accounts show "MATA UANG : [CODE]" (e.g. "MATA UANG : JPY" or "MATA UANG : USD").
- If found, the ENTIRE document is in that currency. Set currency="JPY" (or whatever code) on ALL transactions.
- If no currency indicator is found, assume IDR.

STEP 2 — EXTRACT TRANSACTIONS:
Scan every single page for rows in the transaction table.
Each row typically has: Date | Description/Keterangan | Debit | Kredit | Balance/Saldo.
Extract ALL rows from ALL pages of the transaction table.

INCLUDE:
- Regular purchases/expenses, installment payments (note X/Y pattern)
- Bank fees: biaya admin, bea materai, iuran tahunan, bunga, denda, provisi
- Foreign currency transactions (both IDR and original amount if shown)
- Transfers OUT (DEBIT column / direction "out")

SKIP completely:
- SALDO AWAL / Balance of last month / Saldo bulan lalu
- Payment received / (-) Pembayaran
- Summary sections (RINGKASAN, TOTAL rows, END OF STATEMENT)
- Promotional text, credit limit info, header/footer, barcodes

FOR EACH TRANSACTION return:
{
  "date": "YYYY-MM-DD",
  "description": "full description as written",
  "merchant": "cleaned merchant name",
  "amount": 150000,
  "currency": "IDR",
  "direction": "out",
  "currency_original": null,
  "amount_original": null,
  "rate_used": null,
  "is_installment": false,
  "installment_current": null,
  "installment_total": null,
  "is_fee": false,
  "fee_type": null,
  "is_transfer": false,
  "card_last4": null,
  "account_hint": null
}

IMPORTANT - Year detection:
- If document shows a year, use it.
- If no year visible or ambiguous, use current year (2026).
- Never use years before 2026 unless explicitly stated.

Return ONLY valid JSON array. No markdown, no explanation.
If no transactions found, return [].`;

type ClaudeResult =
  | { ok: true;  transactions: any[] }
  | { ok: false; is_encrypted: true }
  | { ok: false; is_encrypted: false; error: string };

async function callClaude(pdfBase64: string, anthropicKey: string): Promise<ClaudeResult> {
  const approxBytes = Math.round(pdfBase64.length * 0.75);
  console.log(`[reconcile-pdf] callClaude: approx_bytes=${approxBytes}`);

  if (approxBytes > 10 * 1024 * 1024) {
    return { ok: false, is_encrypted: false, error: "PDF too large (>10MB)." };
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
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      }],
    }),
  });

  if (res.status === 400) {
    console.error(`[reconcile-pdf] Claude 400 (likely encrypted)`);
    return { ok: false, is_encrypted: true };
  }
  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, is_encrypted: false, error: `Claude API error: ${res.status} ${errText.slice(0, 200)}` };
  }

  const data    = await res.json();
  const rawText = data.content?.[0]?.text || "";
  if (rawText.length === 0) {
    return { ok: false, is_encrypted: false, error: "Claude returned empty response" };
  }
  if (rawText.length < 500 && /password|encrypt|cannot\s+(read|access|open)|protected/i.test(rawText)) {
    return { ok: false, is_encrypted: true };
  }

  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { ok: false, is_encrypted: false, error: "No JSON array in Claude response" };
  }
  try {
    const txs = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(txs)) throw new Error("not array");
    return { ok: true, transactions: txs };
  } catch (err: any) {
    return { ok: false, is_encrypted: false, error: `JSON parse error: ${err.message}` };
  }
}

// Chunk large PDFs (>10 pages) so Claude doesn't truncate.
async function chunkAndProcess(pdfBase64: string, anthropicKey: string): Promise<ClaudeResult> {
  let pageCount = 0;
  let fullDoc: PDFDocument | null = null;
  try {
    const bytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
    fullDoc     = await PDFDocument.load(bytes);
    pageCount   = fullDoc.getPageCount();
  } catch {
    return callClaude(pdfBase64, anthropicKey);
  }

  if (pageCount <= 10) return callClaude(pdfBase64, anthropicKey);

  const CHUNK = 5;
  const all: any[] = [];
  for (let start = 0; start < pageCount; start += CHUNK) {
    const end      = Math.min(start + CHUNK, pageCount);
    const chunkDoc = await PDFDocument.create();
    const indices  = Array.from({ length: end - start }, (_, i) => start + i);
    const copied   = await chunkDoc.copyPages(fullDoc, indices);
    copied.forEach(p => chunkDoc.addPage(p));
    const bytes  = await chunkDoc.save();
    const b64    = btoa(Array.from(new Uint8Array(bytes)).map(b => String.fromCharCode(b)).join(""));
    const result = await callClaude(b64, anthropicKey);
    if (result.ok) all.push(...result.transactions);
    else if (result.is_encrypted) return result;
  }
  return { ok: true, transactions: all };
}

// ── Main handler ──────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")              || "";
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_KEY")             || "";
  const GOOGLE_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")      || "";

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const userId       = body.user_id;
  const emailId      = body.email_id;
  let   attachmentId = body.attachment_id || null;
  const password     = body.password || "";

  if (!userId || !emailId) {
    return new Response(JSON.stringify({ error: "user_id and email_id are required" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const accessToken = await getAccessToken(supabase, userId, GOOGLE_SECRET);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Gmail not connected" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!attachmentId) {
      attachmentId = await findPrimaryPdfAttachmentId(accessToken, emailId);
      if (!attachmentId) {
        return new Response(JSON.stringify({ error: "No PDF attachment found in message" }), {
          status: 404, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
    }

    console.log(`[reconcile-pdf] downloading email=${emailId} attachment=${attachmentId}`);
    let pdfBase64 = await downloadAttachment(accessToken, emailId, attachmentId);

    // If a password was provided up-front, decrypt before sending to Claude.
    if (password) {
      const dec = await tryDecryptPDF(pdfBase64, password);
      if ("error" in dec) {
        return new Response(JSON.stringify({
          success: false,
          needs_password: true,
          encrypted: true,
          encryption_unsupported: dec.error === "unsupported",
          error: dec.error === "unsupported"
            ? "PDF uses AES-256 encryption which can't be decrypted automatically."
            : "Wrong password. Try again.",
        }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }
      pdfBase64 = dec.base64;
    }

    // Ask Claude. If it reports encryption and no password was supplied, tell the UI.
    let claudeResult = await chunkAndProcess(pdfBase64, ANTHROPIC_KEY);

    if (!claudeResult.ok && claudeResult.is_encrypted && !password) {
      return new Response(JSON.stringify({
        success: false,
        needs_password: true,
        encrypted: true,
        error: "PDF is password-protected. Enter the password below.",
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (!claudeResult.ok) {
      return new Response(JSON.stringify({
        success: false,
        needs_password: false,
        error: "error" in claudeResult ? claudeResult.error : "Failed to extract transactions",
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Record that this attachment was processed (best-effort — never fail the call).
    try {
      await supabase.from("statement_attachments").update({
        processed_at:      new Date().toISOString(),
        transaction_count: claudeResult.transactions.length,
      }).eq("user_id", userId)
        .eq("gmail_message_id", emailId)
        .eq("attachment_id", attachmentId);
    } catch (e) {
      console.warn("[reconcile-pdf] statement_attachments update failed:", e);
    }

    return new Response(JSON.stringify({
      success: true,
      transactions: claudeResult.transactions,
      count: claudeResult.transactions.length,
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[reconcile-pdf] error:", e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
