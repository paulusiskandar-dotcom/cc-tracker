import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const TELEGRAM_API = "https://api.telegram.org";

const TG_PARSE_PROMPT = (input: string, type: "text" | "image" | "pdf") =>
  `You are a financial transaction extractor for Indonesian banking. The user is forwarding ${type === "image" ? "a screenshot or photo of" : type === "pdf" ? "a PDF document of" : ""} a bank notification (SMS, mobile banking notif, e-statement, e-wallet alert, etc).

${type === "pdf" ? "Extract ALL transactions from the attached PDF document (e-statement). May contain multiple transactions." : type === "image" ? "Extract transaction details from the attached image." : `Extract transaction details from this text:\n\n${input}\n\n`}

Return a JSON array of transactions. Most messages contain ONE transaction, but PDFs may have multiple. Each transaction:

{
  "date": "YYYY-MM-DD" (parse Indonesian date formats: "29/04/2026", "29 Apr 2026", etc — always output as YYYY-MM-DD),
  "type": "in" or "out" (KREDIT/masuk/diterima = "in", DEBET/keluar/dibayar = "out"),
  "amount": number (raw, e.g. 26521987),
  "amount_idr": number (same as amount if currency IDR, else convert estimate),
  "currency": "IDR" or "USD" or "SGD" etc,
  "description": string (concise summary of the transaction),
  "merchant_name": string or null (e.g. "Tokopedia", "Starbucks", "PT ABC Tbk"),
  "card_last4": string or null (extract last 4 visible digits if present, do NOT pad with 0; if only 3 digits visible like "868", output "868" not "0868"),
  "account_visible_digits": string or null (visible trailing digits from masked account, no padding; e.g. from "1 TB xxx868" → "868", from "rek. 0830****97" → "97"),
  "from_account_masked": string or null (raw masked string as appears in input, e.g. "1 TB xxx868", "0830****97"),
  "from_bank_name": string or null ("BCA", "Mandiri", "BNI", "BRI", "CIMB Niaga", "OCBC", "Jenius", "Danamon", "Maybank", "BLU", "Neobank", "Superbank", etc),
  "to_bank_name": string or null,
  "is_qris": boolean (true if QRIS payment),
  "is_debit": boolean (true if debit card / direct bank account),
  "is_transfer": boolean (true if transfer between accounts),
  "is_cc_payment": boolean (true if credit card bill payment),
  "suggested_category": string (e.g. "Salary" for income, "Food & Drink", "Transport", "Shopping" for expense, "Bank Charges", "Other Income"),
  "suggested_entity": "Personal" | "Hamasa" | "SDC" | "Travelio" (default "Personal" unless context suggests otherwise),
  "suggested_tx_type": "expense" | "income" | "transfer" | "pay_cc" | "reimburse_in" | "reimburse_out" (default "income" if KREDIT/in, "expense" if DEBET/out),
  "confidence": number 0-1 (0.95 if very clear, 0.7 if some ambiguity),
  "reasoning": string (1 sentence why)
}

INDONESIAN BANK IDENTIFICATION (CRITICAL):

Use customer service phone numbers and format keywords to identify the bank correctly. DO NOT guess — if ambiguous, leave from_bank_name null.

- BCA: CS 1500888, "Halo BCA", sender "BCA INFO" or "bca@bca.co.id", format "Source of Fund : 0831****88", uses "Tahapan" for savings
- Mandiri: CS 14000, "Mandiri Call", sender "Bank Mandiri", format "TAHAPAN - 0831****88" or "1 TB xxx868" (TB = Tabungan/savings), uses "Livin" for mobile banking
- BNI: CS 1500046, sender "BNI"
- BRI: CS 14017, sender "BRI"
- CIMB Niaga: CS 14041, sender "creditcard.notification@cimbniaga.co.id", format "5192-99XX-XXXX-XX87"
- OCBC: CS 1500999, "OCBC", "90N" product line
- Jenius: CS 1500365, "Jenius by SMBC", "btpn"
- Danamon: CS 1500090
- Maybank: CS 1500611
- BLU by BCA Digital: sender "BLU", "blu by BCA Digital" (separate from BCA)
- Jago: CS 1500746, "Bank Jago"

Common patterns:
- "KREDIT Rp.X pada rek. 1 TB xxx868 tgl. 29/04/2026 … hub 14000" → Mandiri (TB format + CS 14000), NOT BCA
- "BCA INFO: Anda menerima Rp X" → BCA
- "DEBET Rp X" or "Anda telah membayar Rp X" → expense
- QRIS payments → is_qris: true, usually expense
- Transfer between own accounts → is_transfer: true, suggested_tx_type "transfer"
- Credit card payment → is_cc_payment: true, suggested_tx_type "pay_cc"
- "GAJI", "PAYROLL", "SALARY" → suggested_category "Salary"
- "DIVIDEN", "DEVIDEN" → suggested_category "Dividend"

CRITICAL: If the message mentions CS "14000" or "Mandiri" or "TB xxx" format → from_bank_name MUST be "Mandiri". If "1500888" or sender BCA → "BCA". If "14041" → "CIMB Niaga". CS number overrides any other guess.

SETORAN TUNAI RULE (TELEGRAM ONLY):
If the text or image contains the keywords "Setoran Tunai" (cash deposit), apply these overrides regardless of other patterns:
- suggested_tx_type: "reimburse_in"
- suggested_entity: "Hamasa"
- suggested_category: "Reimbursement"
- type: "in"
- reasoning: "Setoran tunai detected — classified as Hamasa reimbursement"
Rationale: cash deposits to Paulus's accounts are always employee reimbursements from Hamasa business expenses.

Output ONLY the JSON array, no markdown fences, no explanation.`;

// ─── Account resolve helpers ─────────────────────────────────────────────────

function getVisibleDigits(input: string | null): string {
  if (!input) return "";
  return String(input).replace(/[^\d]/g, "");
}

function getTrailingDigits(input: string | null): string {
  if (!input) return "";
  const match = String(input).match(/(\d+)\s*$/);
  return match ? match[1] : "";
}

function matchAccount(
  visibleDigits: string,
  bankName: string | null,
  currency: string | null,
  candidates: any[],
): string | null {
  if (!visibleDigits || visibleDigits.length < 3) return null;

  let pool = candidates;
  if (bankName) {
    const bnLower = bankName.toLowerCase();
    const filtered = candidates.filter(
      (a) =>
        (a.bank_name && bnLower.includes(a.bank_name.toLowerCase())) ||
        (a.bank_name && a.bank_name.toLowerCase().includes(bnLower)),
    );
    if (filtered.length > 0) pool = filtered;
  }

  if (currency && currency !== "IDR") {
    const cFiltered = pool.filter((a) => a.currency === currency);
    if (cFiltered.length > 0) pool = cFiltered;
  }

  const byAccountNo = pool.filter((a) => a.account_no && a.account_no.endsWith(visibleDigits));
  if (byAccountNo.length === 1) return byAccountNo[0].id;
  if (byAccountNo.length > 1) {
    const idrFirst = byAccountNo.filter((a) => a.currency === "IDR");
    if (idrFirst.length === 1) return idrFirst[0].id;
    return null; // ambiguous
  }

  const last4 = visibleDigits.slice(-4);
  if (last4.length >= 3) {
    const byLast4 = pool.filter(
      (a) => a.card_last4 && (a.card_last4 === last4 || a.card_last4.endsWith(last4) || last4.endsWith(a.card_last4)),
    );
    if (byLast4.length === 1) return byLast4[0].id;
  }

  return null;
}

async function resolveAccountIds(supabase: any, userId: string, transactions: any[]): Promise<void> {
  if (!transactions || transactions.length === 0) return;

  const { data: accounts, error } = await supabase
    .from("accounts")
    .select("id, name, type, bank_name, account_no, card_last4, currency, is_active")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error || !accounts) {
    console.error("[telegram-webhook] Failed to fetch accounts for resolve:", error);
    return;
  }

  for (const tx of transactions) {
    if (!tx.from_account_id) {
      const visibleFrom = tx.account_visible_digits || getTrailingDigits(tx.from_account_masked) || tx.card_last4 || "";
      const cleanedFrom = getVisibleDigits(visibleFrom);
      if (cleanedFrom.length >= 3) {
        const fromId = matchAccount(cleanedFrom, tx.from_bank_name, tx.currency, accounts);
        if (fromId) {
          tx.from_account_id = fromId;
          tx.resolve_method = "server_side_match";
        }
      }
    }

    // For income: the receiving account is "to", not "from"
    if (!tx.to_account_id && tx.suggested_tx_type === "income" && tx.from_account_id) {
      tx.to_account_id = tx.from_account_id;
      tx.from_account_id = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const AUTHORIZED_CHAT_ID = Number(Deno.env.get("TELEGRAM_AUTHORIZED_CHAT_ID"));
  const AUTHORIZED_USER_ID = Deno.env.get("TELEGRAM_AUTHORIZED_USER_ID");
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const missing: string[] = [];
  if (!TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
  if (!AUTHORIZED_CHAT_ID) missing.push("TELEGRAM_AUTHORIZED_CHAT_ID");
  if (!AUTHORIZED_USER_ID) missing.push("TELEGRAM_AUTHORIZED_USER_ID");
  if (!ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    console.error("[telegram-webhook] Missing env vars:", missing.join(", "));
    return new Response(`Server misconfig - missing: ${missing.join(", ")}`, { status: 500 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const message = update?.message;
  if (!message) {
    // Ignore non-message updates (edits, callbacks, etc.)
    return new Response("ok", { status: 200 });
  }

  const chatId: number = message.chat?.id;

  if (chatId !== AUTHORIZED_CHAT_ID) {
    console.log("[telegram-webhook] Unauthorized chat_id:", chatId);
    await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, "Unauthorized. Bot ini private untuk Paulus.");
    return new Response("ok", { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (message.photo && message.photo.length > 0) {
      await handlePhoto(message, TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, supabase, AUTHORIZED_USER_ID, chatId);
    } else if (message.document) {
      await handleDocument(message, TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, supabase, AUTHORIZED_USER_ID, chatId);
    } else if (message.voice) {
      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, "🎙️ Voice support coming soon\\. Untuk sekarang, kirim text, foto, atau PDF\\.");
    } else if (message.text) {
      const text: string = message.text.trim();

      if (text.startsWith("/")) {
        if (text === "/start") {
          await sendTelegramMessage(
            TELEGRAM_BOT_TOKEN,
            chatId,
            "Halo Paulus\\! 👋\n\nKirim:\n• Text SMS bank yang di\\-copy\n• Foto/screenshot notifikasi bank\n• PDF e\\-statement bank\n• Atau ketik manual transaksi\n\nSaya akan parse otomatis dan save ke Paulus Finance\\.",
          );
        } else if (text === "/help") {
          await sendTelegramMessage(
            TELEGRAM_BOT_TOKEN,
            chatId,
            "Forward SMS bank, foto notif, atau text manual\\. Saya akan parse jadi transaksi pending review\\.",
          );
        } else {
          await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, "Command tidak dikenali\\. Coba /start atau /help\\.");
        }
        return new Response("ok", { status: 200 });
      }

      await handleText(text, message, ANTHROPIC_API_KEY, supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId);
    } else {
      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, "Format tidak didukung\\. Kirim text, foto, atau PDF\\.");
    }
  } catch (err: any) {
    console.error("[telegram-webhook] Handler error:", err);
    await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, "❌ Error: " + (err?.message || "Unknown error"));
  }

  return new Response("ok", { status: 200 });
});

// ─── Telegram API helpers ────────────────────────────────────────────────────

async function sendTelegramMessage(token: string, chatId: number, text: string) {
  try {
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "MarkdownV2" }),
    });
  } catch (err) {
    console.error("[telegram-webhook] sendMessage error:", err);
  }
}

async function downloadTelegramFile(token: string, fileId: string): Promise<Uint8Array> {
  const fileInfoResp = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`);
  const fileInfo = await fileInfoResp.json();
  if (!fileInfo.ok) throw new Error("Failed to get file info from Telegram");

  const filePath: string = fileInfo.result.file_path;
  const fileResp = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  const buffer = await fileResp.arrayBuffer();
  return new Uint8Array(buffer);
}

// ─── AI parse helpers ────────────────────────────────────────────────────────

async function callClaudeText(apiKey: string, prompt: string): Promise<any[]> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("[telegram-webhook] Claude text API error:", data);
    throw new Error("AI parse failed: " + (data.error?.message || "Unknown"));
  }

  const raw: string = data.content?.[0]?.text || "[]";
  return parseJsonArray(raw);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function callClaudeVision(apiKey: string, imageBytes: Uint8Array, prompt: string): Promise<any[]> {
  const base64 = uint8ArrayToBase64(imageBytes);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("[telegram-webhook] Claude vision API error:", data);
    throw new Error("AI vision parse failed: " + (data.error?.message || "Unknown"));
  }

  const raw: string = data.content?.[0]?.text || "[]";
  return parseJsonArray(raw);
}

async function callClaudePDF(apiKey: string, pdfBytes: Uint8Array, prompt: string): Promise<any[]> {
  const base64 = uint8ArrayToBase64(pdfBytes);

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("[telegram-webhook] Claude PDF API error:", data);
    throw new Error("AI PDF parse failed: " + (data.error?.message || "Unknown"));
  }

  const raw: string = data.content?.[0]?.text || "[]";
  return parseJsonArray(raw);
}

function parseJsonArray(raw: string): any[] {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    console.error("[telegram-webhook] Failed to parse AI JSON:", cleaned.slice(0, 200));
    throw new Error("AI response not valid JSON");
  }
}

// ─── Message handlers ────────────────────────────────────────────────────────

async function handleText(
  text: string,
  message: any,
  apiKey: string,
  supabase: any,
  userId: string,
  botToken: string,
  chatId: number,
) {
  const prompt = TG_PARSE_PROMPT(text, "text");
  const transactions = await callClaudeText(apiKey, prompt);

  if (transactions.length === 0) {
    await sendTelegramMessage(botToken, chatId, "⚠️ Tidak bisa extract transaksi dari pesan ini\\.");
    return;
  }

  await resolveAccountIds(supabase, userId, transactions);

  const { error } = await supabase.from("email_sync").insert({
    user_id: userId,
    gmail_message_id: `tg-${message.message_id}-${Date.now()}`,
    sender_email: "telegram@paulus",
    subject: `Telegram: ${text.slice(0, 50)}`,
    received_at: new Date().toISOString(),
    email_type: "transaction_notification",
    raw_body: text,
    attachment_name: null,
    ai_raw_result: transactions,
    extracted_count: transactions.length,
    imported_count: 0,
    status: "pending",
    source: "telegram",
  });

  if (error) {
    console.error("[telegram-webhook] Insert error:", error);
    await sendTelegramMessage(botToken, chatId, "❌ Gagal save: " + escapeMarkdown(error.message));
    return;
  }

  const summary = buildSummary(transactions);
  await sendTelegramMessage(
    botToken,
    chatId,
    `✅ Saved ${transactions.length} transaksi pending review:\n\n${summary}\n\nBuka Paulus Finance untuk confirm\\.`,
  );
}

async function handlePhoto(
  message: any,
  botToken: string,
  apiKey: string,
  supabase: any,
  userId: string,
  chatId: number,
) {
  const photos: any[] = message.photo;
  const largest = photos[photos.length - 1];

  await sendTelegramMessage(botToken, chatId, "📸 Processing photo\\.\\.\\.");

  const imageBytes = await downloadTelegramFile(botToken, largest.file_id);
  const caption: string = message.caption || "";
  const prompt = TG_PARSE_PROMPT(caption || "(no caption)", "image");
  const transactions = await callClaudeVision(apiKey, imageBytes, prompt);

  if (transactions.length === 0) {
    await sendTelegramMessage(botToken, chatId, "⚠️ Tidak bisa extract transaksi dari foto ini\\.");
    return;
  }

  await resolveAccountIds(supabase, userId, transactions);

  const { error } = await supabase.from("email_sync").insert({
    user_id: userId,
    gmail_message_id: `tg-photo-${message.message_id}-${Date.now()}`,
    sender_email: "telegram@paulus",
    subject: `Telegram Photo${caption ? ": " + caption.slice(0, 50) : ""}`,
    received_at: new Date().toISOString(),
    email_type: "transaction_notification",
    raw_body: `[Photo from Telegram]${caption ? "\nCaption: " + caption : ""}`,
    attachment_name: `photo-${message.message_id}.jpg`,
    ai_raw_result: transactions,
    extracted_count: transactions.length,
    imported_count: 0,
    status: "pending",
    source: "telegram",
  });

  if (error) {
    console.error("[telegram-webhook] Insert error:", error);
    await sendTelegramMessage(botToken, chatId, "❌ Gagal save: " + escapeMarkdown(error.message));
    return;
  }

  const summary = buildSummary(transactions);
  await sendTelegramMessage(
    botToken,
    chatId,
    `✅ Saved ${transactions.length} transaksi pending review:\n\n${summary}\n\nBuka Paulus Finance untuk confirm\\.`,
  );
}

async function handleDocument(
  message: any,
  botToken: string,
  apiKey: string,
  supabase: any,
  userId: string,
  chatId: number,
) {
  const doc = message.document;

  if (doc.mime_type !== "application/pdf") {
    await sendTelegramMessage(botToken, chatId, `📄 Format ${escapeMarkdown(doc.mime_type || "unknown")} belum support\\. Cuma PDF yang support\\.`);
    return;
  }

  await sendTelegramMessage(botToken, chatId, "📄 Processing PDF\\.\\.\\.");

  const pdfBytes = await downloadTelegramFile(botToken, doc.file_id);
  const caption: string = message.caption || "";
  const prompt = TG_PARSE_PROMPT(caption || "(no caption)", "pdf");
  const transactions = await callClaudePDF(apiKey, pdfBytes, prompt);

  if (transactions.length === 0) {
    await sendTelegramMessage(botToken, chatId, "⚠️ Tidak bisa extract transaksi dari PDF ini\\.");
    return;
  }

  await resolveAccountIds(supabase, userId, transactions);

  const { error } = await supabase.from("email_sync").insert({
    user_id: userId,
    gmail_message_id: `tg-pdf-${message.message_id}-${Date.now()}`,
    sender_email: "telegram@paulus",
    subject: `Telegram PDF: ${doc.file_name || "document"}`,
    received_at: new Date().toISOString(),
    email_type: "transaction_notification",
    raw_body: `[PDF from Telegram]\nFilename: ${doc.file_name}${caption ? "\nCaption: " + caption : ""}`,
    attachment_name: doc.file_name || `pdf-${message.message_id}.pdf`,
    ai_raw_result: transactions,
    extracted_count: transactions.length,
    imported_count: 0,
    status: "pending",
    source: "telegram",
  });

  if (error) {
    console.error("[telegram-webhook] Insert error:", error);
    await sendTelegramMessage(botToken, chatId, "❌ Gagal save: " + escapeMarkdown(error.message));
    return;
  }

  const preview = transactions.slice(0, 5);
  const moreCount = transactions.length - preview.length;
  const summary = buildSummary(preview) + (moreCount > 0 ? `\n\\.\\.\\. dan ${moreCount} transaksi lain` : "");

  await sendTelegramMessage(
    botToken,
    chatId,
    `✅ Saved ${transactions.length} transaksi pending review:\n\n${summary}\n\nBuka Paulus Finance untuk confirm\\.`,
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSummary(transactions: any[]): string {
  return transactions
    .map((tx) => {
      const sign = tx.type === "in" ? "\\+" : "\\-";
      const amount = escapeMarkdown(formatIDR(tx.amount_idr || tx.amount));
      const label = escapeMarkdown(tx.merchant_name || tx.description || "—");
      return `${sign}${amount} ${label}`;
    })
    .join("\n");
}

function formatIDR(n: number): string {
  if (!n || isNaN(n)) return "Rp 0";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

// Escape special chars for MarkdownV2
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => "\\" + c);
}
