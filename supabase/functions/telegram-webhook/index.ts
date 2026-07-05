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

PAPER RECEIPT / STRUK RULES (foto struk fisik: setoran tunai ATM/CS, transfer, bukti bayar):
- Struk BCA "SETORAN TUNAI" → suggested_tx_type "reimburse_in", entity "Hamasa" (setoran tunai rule), amount = jumlah setoran, date = tanggal di struk (format DD/MM/YY atau DD-MM-YYYY), account = rekening tujuan yang tercetak.
- Struk transfer/pembayaran → type "out", amount & tanggal dari struk. Extract nomor rekening yang terlihat.
- Foto struk sering miring/blur/rotated — TETAP EKSTRAK bacaan terbaikmu. Kalau nominal kurang yakin, tetap keluarkan dengan confidence rendah (0.3-0.5) — user akan review sebelum import. Return [] HANYA kalau gambar sama sekali bukan dokumen keuangan.

BCA MUTASI SCREENSHOT RULES (CRITICAL — myBCA/BCA mobile transaction list):
- Account masks like "083-136-1688" / "083 - 026 - 7743" are BCA account numbers → from_bank_name MUST be "BCA" (NOT Mandiri!). 0831361688 / 0830267743 etc.
- COLOR = DIRECTION: BLUE amount = money IN (type "in", KREDIT). RED amount = money OUT (type "out", DEBIT). Trust the color over any other hint.
- Text suffix also tells direction: "CR" = masuk (type "in"), "DB" = keluar (type "out"). "TRSF E-BANKING CR" = INCOMING transfer even though it says transfer.
- Names of these people transferring IN = employee LOAN REPAYMENT (suggested_tx_type "collect_loan"): Kamdani, Fairuz, Lieche, Desy, Daniel, Chicie.
- "Gaji" / "SAHABAT DENTAL CEM Gaji" incoming = income, suggested_category "Salary".

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

  const bcaRAccount = accounts.find((a: any) => a.name === "BCA R" && a.type === "bank");

  for (const tx of transactions) {
    // SETORAN TUNAI OVERRIDE: force to_account_id = BCA R, skip regular resolve
    if (tx.is_setoran_tunai === true ||
        (tx.suggested_tx_type === "reimburse_in" && tx.suggested_entity === "Hamasa")) {
      if (bcaRAccount) {
        tx.to_account_id = bcaRAccount.id;
        tx.to_type = "account";
        tx.from_account_id = null;
        tx.from_type = null;
        tx.resolve_method = "setoran_tunai_override";
      }
      continue;
    }

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

  if (req.method === "GET") {
    // one-time webhook maintenance: ?wh=info | ?wh=fix (re-register webhook incl. callback_query)
    const url = new URL(req.url);
    const wh = url.searchParams.get("wh");
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (wh && token) {
      if (wh === "info") {
        const r = await fetch(`${TELEGRAM_API}/bot${token}/getWebhookInfo`);
        return new Response(JSON.stringify(await r.json()), { headers: { "Content-Type": "application/json" } });
      }
      if (wh === "cmds") {
        // register the command list shown when typing "/" in Telegram
        const commands = [
          { command: "menu", description: "📋 Semua fitur & cara pakai" },
          { command: "saldo", description: "💰 Semua saldo bank + net worth" },
          { command: "cc", description: "💳 Tagihan tiap kartu + jatuh tempo" },
          { command: "due", description: "🗓 Jadwal jatuh tempo billing" },
          { command: "hari", description: "📅 Transaksi hari ini" },
          { command: "bulan", description: "📆 Income/expense bulan ini" },
          { command: "digest", description: "📬 Kirim digest transaksi pending" },
          { command: "import", description: "📥 Import semua pending ke ledger" },
          { command: "pending", description: "👀 Lihat antrian pending" },
          { command: "undo", description: "↩️ Batalkan import terakhir" },
          { command: "cek", description: "🩺 Health check (anomali)" },
          { command: "trend", description: "📈 Trend 4 bulan + net worth" },
          { command: "reimburse", description: "🔄 Piutang Hamasa/SDC" },
          { command: "hutang", description: "🏛 Hutang, kartu & cicilan" },
          { command: "piutang", description: "🤝 Utang karyawan & reimburse" },
          { command: "investasi", description: "📈 Nilai investasi/aset" },
          { command: "report", description: "📊 Laporan lengkap (segera)" },
        ];
        const r = await fetch(`${TELEGRAM_API}/bot${token}/setMyCommands`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands }),
        });
        return new Response(JSON.stringify(await r.json()), { headers: { "Content-Type": "application/json" } });
      }
      if (wh === "report") {
        // for pg_cron (tgl 1): kirim laporan bulan LALU ke chat Paulus
        const chatId2 = Number(Deno.env.get("TELEGRAM_AUTHORIZED_CHAT_ID"));
        const uid2 = Deno.env.get("TELEGRAM_AUTHORIZED_USER_ID") || "";
        const sb2 = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
        const nowJ = jakartaNow();
        const prev = new Date(Date.UTC(nowJ.getUTCFullYear(), nowJ.getUTCMonth() - 1, 1));
        const ym = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
        await cmdReport(sb2, uid2, ym, token, chatId2);
        return new Response(JSON.stringify({ ok: true, month: ym }), { headers: { "Content-Type": "application/json" } });
      }
      if (wh === "weekly") {
        // pg_cron (Senin pagi): kirim insight mingguan ke chat Paulus
        const chatId2 = Number(Deno.env.get("TELEGRAM_AUTHORIZED_CHAT_ID"));
        const uid2 = Deno.env.get("TELEGRAM_AUTHORIZED_USER_ID") || "";
        const sb2 = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
        await sendTelegramHTML(token, chatId2, await cmdWeekly(sb2, uid2));
        return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
      }
      if (wh === "fix") {
        const self = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/telegram-webhook";
        const r = await fetch(`${TELEGRAM_API}/bot${token}/setWebhook`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: self, allowed_updates: ["message", "callback_query"] }),
        });
        return new Response(JSON.stringify(await r.json()), { headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("ok", { status: 200 });
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

  // ── investment sync from the Mac reconcile script: compare parsed values vs app, alert if diff ──
  if (update?.type === "investsync" && Array.isArray(update?.values)) {
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const out = await handleInvestSync(update.values, TELEGRAM_BOT_TOKEN, sb, AUTHORIZED_USER_ID, AUTHORIZED_CHAT_ID);
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  }

  // ── statement download notif from the Mac fetch script ──
  if (update?.type === "stmt_notify" && Array.isArray(update?.files)) {
    const files: string[] = update.files;
    if (files.length) {
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      let msg = `📥 <b>${files.length} statement baru kedownload</b>\n`;
      msg += files.slice(0, 25).map((f) => `• ${esc(String(f).slice(0, 44))}`).join("\n");
      msg += `\n\n` + await cmdStatements(sb, AUTHORIZED_USER_ID);
      await sendTelegramHTML(TELEGRAM_BOT_TOKEN, AUTHORIZED_CHAT_ID, msg);
    }
    return new Response(JSON.stringify({ ok: true, notified: files.length }), { headers: { "Content-Type": "application/json" } });
  }

  // ── 2-way callbacks (inline button taps from the daily digest) ──
  if (update?.callback_query) {
    const cb = update.callback_query;
    if (cb.message?.chat?.id === AUTHORIZED_CHAT_ID) {
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      try { await handleCallback(cb, TELEGRAM_BOT_TOKEN, sb, AUTHORIZED_USER_ID); }
      catch (err: any) {
        console.error("[telegram-webhook] callback error:", err);
        // answerCallback may already be consumed — send a real message so failures are never silent
        await sendTelegramHTML(TELEGRAM_BOT_TOKEN, cb.message.chat.id, "❌ Gagal: " + esc(err?.message || "error"));
      }
    } else {
      await answerCallback(TELEGRAM_BOT_TOKEN, cb.id, "Unauthorized");
    }
    return new Response("ok", { status: 200 });
  }

  const message = update?.message;
  if (!message) {
    // Ignore other non-message updates (edits, etc.)
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
    } else if (message.voice || message.audio) {
      await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, "🎙️ Voice note belum bisa auto\\-transcribe\\. Ketik aja transaksinya \\(mis\\. _makan 50rb bca idr_\\), atau kirim screenshot/PDF\\.");
    } else if (message.text) {
      const text: string = message.text.trim();

      if (text.startsWith("/")) {
        const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@[\w_]+$/, "");
        const arg = text.slice(text.split(/\s+/)[0].length).trim();
        await handleCommand(cmd, arg, supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId);
        return new Response("ok", { status: 200 });
      }

      // Settle selection: "hamasa out 2 in 1" / "settle sdc out 1,3 in 2"
      const selM = text.match(/^(?:settle\s+)?(hamasa|sdc|travelio)\s+out\s+((?:\d[\d,\s]*|semua|all))(?:\s+in\s+((?:\d[\d,\s]*|semua|all)))?\s*$/i);
      if (selM) {
        const ent = REIMBURSE_ENTITY(selM[1]);
        if (ent) { await handlePartialSettle(ent, selM[2], selM[3] || "", supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId); return new Response("ok", { status: 200 }); }
      }
      // Settle preview (numbered list): "settle hamasa" / "settle sdc"
      const settleM = text.match(/^settle\s+(\w+)/i);
      if (settleM) {
        const ent = REIMBURSE_ENTITY(settleM[1]);
        if (ent) { await handleSettlePreview(ent, supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId); return new Response("ok", { status: 200 }); }
      }
      // Edit: "ubah <kata> jadi <kategori/entity>"
      const editM = text.match(/^(?:ubah|edit|ganti)\s+(.+?)\s+(?:jadi|ke|=)\s+(.+)$/i);
      if (editM) { await handleEditCategory(editM[1], editM[2], supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId); return new Response("ok", { status: 200 }); }
      // Delete: "hapus <kata>" / "delete <kata>"
      const delM = text.match(/^(?:hapus|delete|del)\s+(.+)$/i);
      if (delM) { await handleDeleteSearch(delM[1], supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId); return new Response("ok", { status: 200 }); }

      // Free-text router: question -> AI Q&A; classify-reply -> tag pending; quick-add; else -> notification parse.
      if (looksLikeQuestion(text)) {
        await handleQuestion(text, ANTHROPIC_API_KEY, supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId);
        return new Response("ok", { status: 200 });
      }
      if (looksLikeCorrection(text)) {
        const done = await handleTextCorrection(text, supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId);
        if (done) return new Response("ok", { status: 200 });
      }
      if (looksLikeQuickAdd(text)) {
        await handleQuickAdd(text, ANTHROPIC_API_KEY, supabase, AUTHORIZED_USER_ID, TELEGRAM_BOT_TOKEN, chatId);
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

  const raw: string = ((data.content || []).find((b: any) => b.type === "text")?.text) || "[]";
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

async function callClaudeVision(apiKey: string, imageBytes: Uint8Array, prompt: string, mediaType = "image/jpeg"): Promise<any[]> {
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
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
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

  const raw: string = ((data.content || []).find((b: any) => b.type === "text")?.text) || "[]";
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

  const raw: string = ((data.content || []).find((b: any) => b.type === "text")?.text) || "[]";
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
  const IMG_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  // image sent as FILE (uncompressed — better than Telegram photo for small receipt text)
  if (IMG_MIMES.includes(doc.mime_type)) {
    await sendTelegramMessage(botToken, chatId, "🖼 Processing image\\.\\.\\.");
    const imgBytes = await downloadTelegramFile(botToken, doc.file_id);
    const caption0: string = message.caption || "";
    const p = TG_PARSE_PROMPT(caption0 || "(no caption)", "image");
    const txs = await callClaudeVision(apiKey, imgBytes, p, doc.mime_type);
    if (!txs.length) { await sendTelegramMessage(botToken, chatId, "⚠️ Tidak bisa extract transaksi dari gambar ini\\."); return; }
    await resolveAccountIds(supabase, userId, txs);
    const { error: e0 } = await supabase.from("email_sync").insert({
      user_id: userId, gmail_message_id: `tg-img-${message.message_id}-${Date.now()}`, sender_email: "telegram@paulus",
      subject: `Telegram Image: ${doc.file_name || "image"}`, received_at: new Date().toISOString(), email_type: "transaction_notification",
      raw_body: `[Image file from Telegram]\nFilename: ${doc.file_name}${caption0 ? "\nCaption: " + caption0 : ""}`,
      attachment_name: doc.file_name || `img-${message.message_id}.jpg`, ai_raw_result: txs, extracted_count: txs.length,
      imported_count: 0, status: "pending", source: "telegram",
    });
    if (e0) { await sendTelegramMessage(botToken, chatId, "❌ Gagal save: " + escapeMarkdown(e0.message)); return; }
    await sendTelegramMessage(botToken, chatId, `✅ Saved ${txs.length} transaksi pending review:\n\n${buildSummary(txs)}\n\nKetik /digest untuk review \\+ import\\.`);
    return;
  }

  if (doc.mime_type !== "application/pdf") {
    await sendTelegramMessage(botToken, chatId, `📄 Format ${escapeMarkdown(doc.mime_type || "unknown")} belum support\\. Kirim PDF atau gambar \\(jpg/png\\)\\.`);
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

// ═══════════════════════════════════════════════════════════════════════════════
// COMMAND CENTER (T1: query commands)
// ═══════════════════════════════════════════════════════════════════════════════

async function sendTelegramHTML(token: string, chatId: number, html: string, replyMarkup?: any) {
  try {
    const body: any = { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error("[telegram-webhook] sendHTML error:", err);
  }
}

// Send a chart image via QuickChart (Chart.js config -> PNG). Only aggregated
// numbers/labels leave the system.
async function sendTelegramChart(token: string, chatId: number, cfg: any, caption?: string) {
  try {
    const url = "https://quickchart.io/chart?w=600&h=380&bkg=white&c=" + encodeURIComponent(JSON.stringify(cfg));
    await fetch(`${TELEGRAM_API}/bot${token}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, photo: url, caption: caption || "", parse_mode: "HTML" }),
    });
  } catch (err) {
    console.error("[telegram-webhook] sendChart error:", err);
  }
}

function esc(s: any): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function idr(n: number): string {
  return "Rp" + Math.round(Number(n) || 0).toLocaleString("id-ID");
}
function fx(n: number, cur: string): string {
  return cur + " " + (Number(n) || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
// pad a value to width, right-aligned (monospace <pre>)
function padL(s: string, w: number): string {
  s = String(s);
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}
function padR(s: string, w: number): string {
  s = String(s);
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

const ID_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
// Jakarta = UTC+7
function jakartaNow(): Date {
  return new Date(Date.now() + 7 * 3600 * 1000);
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function getActiveAccounts(supabase: any, uid: string): Promise<any[]> {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, name, type, subtype, currency, current_balance, current_value, outstanding_amount, card_limit, due_day, entity, include_networth, monthly_installment, is_active")
    .eq("user_id", uid);
  if (error) { console.error("[cmd] accounts:", error); return []; }
  return (data || []).filter((a: any) => a.is_active !== false);
}

async function handleCommand(cmd: string, arg: string, supabase: any, uid: string, token: string, chatId: number) {
  try {
    switch (cmd) {
      case "/start":
      case "/menu":
      case "/help":
        return sendTelegramHTML(token, chatId, cmdMenu());
      case "/saldo": return sendTelegramHTML(token, chatId, await cmdSaldo(supabase, uid));
      case "/cc": return sendTelegramHTML(token, chatId, await cmdCC(supabase, uid));
      case "/reimburse": return sendTelegramHTML(token, chatId, await cmdReimburse(supabase, uid));
      case "/settle": {
        const ent = REIMBURSE_ENTITY(arg);
        if (!ent) return sendTelegramHTML(token, chatId, "Pakai: <code>/settle hamasa</code> atau <code>/settle sdc</code>");
        await handleSettlePreview(ent, supabase, uid, token, chatId);
        return;
      }
      case "/hutang": return sendTelegramHTML(token, chatId, await cmdHutang(supabase, uid));
      case "/weekly": return sendTelegramHTML(token, chatId, await cmdWeekly(supabase, uid));
      case "/statements": case "/statement": case "/tagihan":
        return sendTelegramHTML(token, chatId, await cmdStatements(supabase, uid));
      case "/piutang": return sendTelegramHTML(token, chatId, await cmdPiutang(supabase, uid));
      case "/investasi": return sendTelegramHTML(token, chatId, await cmdInvestasi(supabase, uid));
      case "/hari": return sendTelegramHTML(token, chatId, await cmdHari(supabase, uid));
      case "/bulan": return sendTelegramHTML(token, chatId, await cmdBulan(supabase, uid, arg));
      case "/digest": {
        const url = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/daily-digest";
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => {});
        return sendTelegramHTML(token, chatId, "📬 Digest dikirim...");
      }
      case "/import": return sendTelegramHTML(token, chatId, await importPending(supabase, uid));
      case "/cek":
      case "/health": return sendTelegramHTML(token, chatId, await cmdCek(supabase, uid));
      case "/trend": return sendTelegramHTML(token, chatId, await cmdTrend(supabase, uid));
      case "/pending": return sendTelegramHTML(token, chatId, await cmdPending(supabase, uid));
      case "/due":
      case "/jatuhtempo": return sendTelegramHTML(token, chatId, await cmdDue(supabase, uid));
      case "/undo": return sendTelegramHTML(token, chatId, await cmdUndo(supabase, uid));
      case "/report": { await cmdReport(supabase, uid, arg, token, chatId); return; }
      default:
        return sendTelegramHTML(token, chatId, "Command tidak dikenali.\n\n" + cmdMenu());
    }
  } catch (err: any) {
    console.error("[cmd] error:", cmd, err);
    await sendTelegramHTML(token, chatId, "❌ Error di " + esc(cmd) + ": " + esc(err?.message || "unknown"));
  }
}

function cmdMenu(): string {
  return [
    "🌟 <b>Ryūsei 隆盛</b>",
    "",
    "<b>📊 Lihat data</b>",
    "/saldo — saldo bank + net worth",
    "/cc — tagihan kartu + jatuh tempo",
    "/due — jadwal jatuh tempo billing",
    "/hari — transaksi hari ini",
    "/bulan — income & expense bulan ini",
    "/trend — trend 4 bulan + net worth",
    "/reimburse — piutang Hamasa/SDC",
    "/hutang — hutang, kartu & cicilan",
    "/piutang — utang karyawan & reimburse",
    "/investasi — nilai aset",
    "",
    "<b>📥 Transaksi masuk</b>",
    "/digest — review transaksi pending",
    "/pending — lihat antrian pending",
    "/import — import semua ke ledger",
    "/undo — batalkan import terakhir",
    "",
    "<b>💬 Tanya bebas</b> (tanpa command)",
    "<i>\"berapa abis makan bulan ini?\"</i>",
    "<i>\"sisa hutang BYD?\"</i>",
    "",
    "<b>📸 Kirim aja</b> — SMS/foto/PDF notif bank",
    "langsung ke-parse jadi transaksi.",
  ].join("\n");
}

async function cmdSaldo(supabase: any, uid: string): Promise<string> {
  const acc = await getActiveAccounts(supabase, uid);
  const banksIDR = acc.filter((a) => a.type === "bank" && a.currency === "IDR");
  const banksFX = acc.filter((a) => a.type === "bank" && a.currency !== "IDR" && Math.abs(Number(a.current_balance) || 0) > 0);
  const cc = acc.filter((a) => a.type === "credit_card");
  const assets = acc.filter((a) => a.type === "asset" && a.include_networth !== false);
  const liab = acc.filter((a) => a.type === "liability");

  const sumBankIDR = banksIDR.reduce((s, a) => s + (Number(a.current_balance) || 0), 0);
  const sumAsset = assets.reduce((s, a) => s + (Number(a.current_value) || 0), 0);
  const sumCC = cc.reduce((s, a) => s + (Number(a.outstanding_amount) || 0), 0);
  const sumLiab = liab.reduce((s, a) => s + (Number(a.outstanding_amount) || 0), 0);
  const netWorth = sumBankIDR + sumAsset - sumCC - sumLiab;

  const topBanks = banksIDR
    .filter((a) => Math.abs(Number(a.current_balance) || 0) > 0)
    .sort((a, b) => (Number(b.current_balance) || 0) - (Number(a.current_balance) || 0));

  // compact <pre> tables sized for phone width (~27 chars) so columns stay aligned
  // amount-first lines: every angka starts flush-left, so nothing can look crooked
  let out = "💰 <b>SALDO BANK</b>\n\n";
  for (const a of topBanks) out += `${esc(a.name)}\n<b>${idr(a.current_balance)}</b>\n\n`;
  out += `━━━━━━━━━━━━━━━\nTotal bank: <b>${idr(sumBankIDR)}</b>\n`;

  if (banksFX.length) {
    out += "\n💱 <b>VALAS</b>\n";
    for (const a of banksFX) out += `${esc(a.name)}\n<b>${fx(a.current_balance, a.currency)}</b>\n\n`;
  }

  out += "\n💎 <b>NET WORTH</b>\n";
  out += `Bank: ${idr(sumBankIDR)}\n`;
  out += `Investasi: ${idr(sumAsset)}\n`;
  out += `Kartu kredit: −${idr(sumCC)}\n`;
  out += `Hutang: −${idr(sumLiab)}\n`;
  out += `━━━━━━━━━━━━━━━\n<b>${idr(netWorth)}</b>\n`;
  out += "<i>valas belum dihitung ke net worth</i>";
  return out;
}

async function cmdCC(supabase: any, uid: string): Promise<string> {
  const acc = await getActiveAccounts(supabase, uid);
  const cc = acc.filter((a) => a.type === "credit_card")
    .sort((a, b) => (Number(b.outstanding_amount) || 0) - (Number(a.outstanding_amount) || 0));
  const total = cc.reduce((s, a) => s + (Number(a.outstanding_amount) || 0), 0);
  const today = jakartaNow().getUTCDate();

  let out = "💳 <b>KARTU KREDIT</b>\n\n";
  for (const a of cc) {
    const os = Number(a.outstanding_amount) || 0;
    if (os === 0) continue;
    const daysTo = a.due_day ? ((a.due_day - today + 31) % 31) : null;
    const soon = daysTo !== null && daysTo <= 3 ? " ⚠️" : "";
    out += `${esc(a.name)}${a.due_day ? ` · tgl ${a.due_day}` : ""}${soon}\n<b>${idr(os)}</b>\n\n`;
  }
  out += `━━━━━━━━━━━━━━━\nTotal: <b>${idr(total)}</b>\n`;
  const zero = cc.filter((a) => (Number(a.outstanding_amount) || 0) === 0).length;
  if (zero) out += `<i>${zero} kartu lunas (Rp0) disembunyikan</i>\n`;
  out += "Jadwal jatuh tempo: /due";
  return out;
}

async function cmdDue(supabase: any, uid: string): Promise<string> {
  const acc = await getActiveAccounts(supabase, uid);
  const now = jakartaNow();
  const today = now.getUTCDate();
  const num = (n: number) => Math.round(Number(n) || 0).toLocaleString("id-ID");
  // cards with outstanding, sorted by days-to-due
  const items = acc.filter((a) => a.type === "credit_card" && (Number(a.outstanding_amount) || 0) > 0 && a.due_day)
    .map((a) => ({ name: a.name, amt: Number(a.outstanding_amount) || 0, due: a.due_day, days: (a.due_day - today + 31) % 31 }))
    .sort((x, y) => x.days - y.days);
  // liabilities with monthly installment
  for (const a of acc.filter((x) => x.type === "liability" && Number(x.monthly_installment) > 0)) {
    const dd = a.due_day || null;
    items.push({ name: a.name + " (cicilan)", amt: Number(a.monthly_installment), due: dd || "?", days: dd ? (dd - today + 31) % 31 : 99 });
  }
  // recurring bills (IPL, listrik, internet, subscription…) — amount may be unknown (0)
  const { data: rts } = await supabase.from("recurring_templates").select("name, amount, day_of_month, tx_type, is_active").eq("user_id", uid).eq("is_active", true);
  const bills = (rts || []).filter((r: any) => r.tx_type === "expense" && r.day_of_month);
  // paid-this-month detection: any expense this month whose description contains the template name
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const { data: mLed } = await supabase.from("ledger").select("description").eq("user_id", uid).eq("tx_type", "expense").gte("tx_date", monthStart);
  const normB = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const paidSet = (mLed || []).map((r: any) => normB(r.description));
  const isPaid = (name: string) => { const n = normB(name).slice(0, 8); return n.length >= 4 && paidSet.some((d: string) => d.includes(n)); };

  if (!items.length && !bills.length) return "🗓 <b>JATUH TEMPO</b>\n\nTidak ada tagihan aktif. 🎉";
  let out = "🗓 <b>JATUH TEMPO BILLING</b>\n\n💳 <b>Kartu & cicilan</b>\n";
  let tot7 = 0;
  for (const it of items) {
    const when = it.days === 0 ? "HARI INI ‼️" : it.days === 1 ? "besok ⚠️" : it.days <= 3 ? `${it.days} hari lagi ⚠️` : `${it.days} hari lagi`;
    out += `\n<b>tgl ${it.due}</b> — ${when}\n${esc(it.name)}\n<b>Rp${num(it.amt)}</b>\n`;
    if (it.days <= 7) tot7 += it.amt;
  }
  if (bills.length) {
    out += "\n🧾 <b>Tagihan rutin bulan ini</b>\n";
    const bl = bills.map((b: any) => ({ name: b.name, amt: Number(b.amount) || 0, due: b.day_of_month, days: (b.day_of_month - today + 31) % 31, paid: isPaid(b.name) }))
      .sort((x: any, y: any) => (x.paid === y.paid ? x.days - y.days : x.paid ? 1 : -1));
    for (const b of bl) {
      const status = b.paid ? "✅ sudah dibayar" : b.days === 0 ? "HARI INI ‼️" : b.days === 1 ? "besok ⚠️" : `${b.days} hari lagi`;
      out += `\n<b>tgl ${b.due}</b> — ${status}\n${esc(b.name)}\n${b.amt > 0 ? `<b>Rp${num(b.amt)}</b>` : "<i>nilai belum pasti</i>"}\n`;
      if (!b.paid && b.days <= 7) tot7 += b.amt;
    }
  }
  out += `\n━━━━━━━━━━━━━━━\n💸 Perlu disiapkan ≤7 hari: <b>Rp${num(tot7)}</b>`;
  return out;
}

async function cmdReimburse(supabase: any, uid: string): Promise<string> {
  // Show only the REMAINING (unsettled) reimburse_out transactions — the ones
  // still owed to Paulus — with date + amount. No recap/total.
  const { data: led, error } = await supabase
    .from("ledger").select("tx_date, amount_idr, entity, description, merchant_name")
    .eq("user_id", uid).eq("tx_type", "reimburse_out")
    .is("reimburse_settlement_id", null)
    .order("tx_date", { ascending: false });
  if (error) throw error;
  const rows = led || [];
  if (!rows.length) return "🔄 <b>REIMBURSE</b>\n\n✅ Ga ada sisa piutang reimburse.";
  const d2 = (s: string) => { const p = String(s || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
  // group by entity (header only, no totals)
  const byEnt: Record<string, any[]> = {};
  for (const r of rows) { const e = r.entity || "?"; (byEnt[e] = byEnt[e] || []).push(r); }
  let out = "🔄 <b>REIMBURSE — sisa belum ditagih</b>\n";
  for (const [e, list] of Object.entries(byEnt)) {
    out += `\n<b>${esc(e)}</b>\n`;
    for (const r of list) {
      const nm = String(r.merchant_name || r.description || "-").slice(0, 26);
      out += `${d2(r.tx_date)} · ${esc(nm)}\n<b>${idr(r.amount_idr)}</b>\n`;
    }
  }
  return out;
}

// ── STATEMENT STATUS REPORT: mana yang udah masuk/lunas/belum ──
async function cmdStatements(supabase: any, uid: string): Promise<string> {
  const { data: cc } = await supabase.from("accounts")
    .select("id, name, last_statement_amount, last_statement_date, due_day, is_active")
    .eq("user_id", uid).eq("type", "credit_card");
  const cards = (cc || []).filter((c: any) => c.is_active !== false);
  const ids = cards.map((c: any) => c.id);
  const { data: pays } = await supabase.from("ledger")
    .select("to_id, amount_idr, tx_date").in("to_id", ids).eq("to_type", "account").gte("tx_date", "2026-05-01");
  const paidSince = (c: any) => (pays || [])
    .filter((p: any) => p.to_id === c.id && p.tx_date >= c.last_statement_date)
    .reduce((s: number, p: any) => s + Number(p.amount_idr || 0), 0);
  const d2 = (s: string) => { const p = String(s || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
  const lunas: any[] = [], belum: any[] = [], noStmt: any[] = [];
  for (const c of cards) {
    if (c.last_statement_amount == null || !c.last_statement_date) { noStmt.push(c); continue; }
    const pending = Math.max(0, Number(c.last_statement_amount) - paidSince(c));
    if (pending <= 25000) lunas.push(c); else belum.push({ c, pending });
  }
  belum.sort((a, b) => b.pending - a.pending);
  let out = `📄 <b>STATUS STATEMENT & TAGIHAN</b>\n`;
  if (belum.length) {
    out += `\n🔴 <b>Belum dibayar (${belum.length})</b>\n`;
    out += belum.map((x) => `${esc(x.c.name)} · stmt ${d2(x.c.last_statement_date)}\n<b>${idr(x.pending)}</b>${x.c.due_day ? ` — JT tgl ${x.c.due_day}` : ""}`).join("\n") + "\n";
  }
  if (lunas.length) out += `\n✅ <b>Lunas (${lunas.length})</b>\n${lunas.map((c) => esc(c.name)).join(" · ")}\n`;
  if (noStmt.length) out += `\n⚪ <b>Statement belum masuk (${noStmt.length})</b>\n${noStmt.map((c) => esc(c.name)).join(" · ")}\n`;
  return out;
}

// ── #1 SETTLE REIMBURSE from Telegram (preview + confirm) ──
const REIMBURSE_ENTITY = (s: string): string | null =>
  /\bsdc\b/i.test(s) ? "SDC" : /hamasa/i.test(s) ? "Hamasa" : /travelio/i.test(s) ? "Travelio" : null;

async function unsettledFor(supabase: any, uid: string, entity: string) {
  const { data } = await supabase.from("ledger")
    .select("id, amount_idr, amount, tx_type, tx_date, description, merchant_name")
    .eq("user_id", uid).eq("entity", entity)
    .in("tx_type", ["reimburse_out", "reimburse_in"]).is("reimburse_settlement_id", null)
    .order("tx_date", { ascending: false }).order("id", { ascending: true });   // deterministic numbering
  const rows = data || [];
  const outR = rows.filter((r: any) => r.tx_type === "reimburse_out");
  const inR = rows.filter((r: any) => r.tx_type === "reimburse_in");
  return { outR, inR };
}
const settleAmt = (r: any) => Number(r?.amount_idr || r?.amount || 0);
const settleName = (r: any) => String(r?.merchant_name || r?.description || "tx").slice(0, 22);
const d2date = (s: string) => { const p = String(s || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
function parseSel(str: string, max: number): number[] {
  if (!str) return [];
  if (/semua|all/i.test(str)) return Array.from({ length: max }, (_, i) => i + 1);
  return [...new Set((str.match(/\d+/g) || []).map(Number).filter((n) => n >= 1 && n <= max))];
}

// Numbered list — user picks which out/in to match.
async function handleSettlePreview(entity: string, supabase: any, uid: string, token: string, chatId: number) {
  const { outR, inR } = await unsettledFor(supabase, uid, entity);
  if (!outR.length && !inR.length) { await sendTelegramHTML(token, chatId, `✅ <b>${esc(entity)}</b> — ga ada reimburse yang belum di-settle.`); return; }
  let out = `🧾 <b>SETTLE ${esc(entity)}</b>\n\n<b>OUT (talangin):</b>\n`;
  out += outR.length ? outR.map((r: any, i: number) => `${i + 1}. ${d2date(r.tx_date)} ${esc(settleName(r))} — <b>${idr(settleAmt(r))}</b>`).join("\n") : "(belum ada)";
  out += `\n\n<b>IN (dibalikin):</b>\n`;
  out += inR.length ? inR.map((r: any, i: number) => `${i + 1}. ${d2date(r.tx_date)} ${esc(settleName(r))} — <b>${idr(settleAmt(r))}</b>`).join("\n") : "(belum ada)";
  const e = entity.toLowerCase();
  out += `\n\nPilih yang mau dicocokin, balas mis:\n<code>${e} out 2 in 1</code>  (bisa banyak: <code>out 1,3 in 2</code>)\nAtau tap <b>Settle semua</b>.`;
  await sendTelegramHTML(token, chatId, out, { inline_keyboard: [[{ text: "✅ Settle semua", callback_data: `psettle:${entity}:all:all` }, { text: "❌ Batal", callback_data: "noop:x" }]] });
}

// User replied "hamasa out 2 in 1" → preview the selected match + confirm.
async function handlePartialSettle(entity: string, outStr: string, inStr: string, supabase: any, uid: string, token: string, chatId: number) {
  const { outR, inR } = await unsettledFor(supabase, uid, entity);
  const outSel = parseSel(outStr, outR.length), inSel = parseSel(inStr, inR.length);
  if (!outSel.length && !inSel.length) { await sendTelegramHTML(token, chatId, `Pilih minimal satu, mis. <code>${entity.toLowerCase()} out 2 in 1</code>.`); return; }
  const selOut = outSel.map((n) => outR[n - 1]).filter(Boolean);
  const selIn = inSel.map((n) => inR[n - 1]).filter(Boolean);
  const to = selOut.reduce((s: number, r: any) => s + settleAmt(r), 0);
  const ti = selIn.reduce((s: number, r: any) => s + settleAmt(r), 0);
  const net = to - ti;
  let out = `🧾 <b>SETTLE ${esc(entity)} — pilihan</b>\n\n`;
  out += `OUT (${selOut.length}): ${selOut.map((r: any) => idr(settleAmt(r))).join(" + ") || "-"} = <b>${idr(to)}</b>\n`;
  out += `IN (${selIn.length}): ${selIn.map((r: any) => idr(settleAmt(r))).join(" + ") || "-"} = <b>${idr(ti)}</b>\n`;
  out += net > 0 ? `\n⚠️ <b>Reimbursable LOSS: ${idr(net)}</b>` : net < 0 ? `\n💰 <b>Reimbursable SURPLUS: ${idr(-net)}</b>` : `\n✅ <b>Pas (balance)</b>`;
  await sendTelegramHTML(token, chatId, out, { inline_keyboard: [[{ text: "✅ Settle ini", callback_data: `psettle:${entity}:${outSel.join(",") || "0"}:${inSel.join(",") || "0"}` }, { text: "❌ Batal", callback_data: "noop:x" }]] });
}

// Execute a settlement over the selected out/in rows (replicates app handleSettleEntity).
async function executeSettle(entity: string, selOut: any[], selIn: any[], supabase: any, uid: string, token: string, chatId: number) {
  const LOSS_CAT = "e054e34e-9251-461b-a118-718077cf3293";
  const SURPLUS_SRC = "0afb406d-fc3d-49af-a002-c40d3d865c4d";
  if (!selOut.length && !selIn.length) { await sendTelegramHTML(token, chatId, `⚠️ Ga ada yang dipilih buat settle.`); return; }
  const outIds = selOut.map((r) => r.id), inIds = selIn.map((r) => r.id);
  const totalOut = selOut.reduce((s: number, r: any) => s + settleAmt(r), 0);
  const totalIn = selIn.reduce((s: number, r: any) => s + settleAmt(r), 0);
  const reimbursable = Math.max(0, totalOut - totalIn), surplus = Math.max(0, totalIn - totalOut);
  const today = ymd(jakartaNow());
  const { data: settlement, error } = await supabase.from("reimburse_settlements").insert([{
    user_id: uid, entity, settled_at: today, out_ledger_ids: outIds, in_ledger_ids: inIds,
    total_out: totalOut, total_in: totalIn, reimbursable_expense: reimbursable,
    re_category_id: LOSS_CAT, status: "settled", notes: "via Telegram",
  }]).select().single();
  if (error) { await sendTelegramHTML(token, chatId, "❌ Gagal settle: " + esc(error.message)); return; }
  if (reimbursable > 0) await supabase.from("ledger").insert([{
    user_id: uid, tx_date: today, description: `${entity} Reimbursable Loss`,
    amount: reimbursable, amount_idr: reimbursable, currency: "IDR",
    tx_type: "expense", from_type: null, to_type: "expense", from_id: null, to_id: null,
    category_id: LOSS_CAT, category_name: "Reimbursable Loss", entity, is_reimburse: false,
    notes: `Settlement: ${entity}`, reimburse_settlement_id: settlement.id,
  }]);
  if (surplus > 0) await supabase.from("ledger").insert([{
    user_id: uid, tx_date: today, description: `${entity} Reimbursable Surplus`,
    amount: surplus, amount_idr: surplus, currency: "IDR",
    tx_type: "income", from_type: "income_source", from_id: SURPLUS_SRC, to_type: null, to_id: null,
    category_id: null, category_name: null, entity, is_reimburse: false,
    notes: `Settlement: ${entity}`, reimburse_settlement_id: settlement.id,
  }]);
  await supabase.from("ledger").update({ reimburse_settlement_id: settlement.id }).in("id", [...outIds, ...inIds]);
  let msg = `✅ <b>${esc(entity)} settled</b>\nOut ${idr(totalOut)} (${outIds.length}) · In ${idr(totalIn)} (${inIds.length})`;
  if (reimbursable > 0) msg += `\n⚠️ Reimbursable Loss: <b>${idr(reimbursable)}</b>`;
  if (surplus > 0) msg += `\n💰 Reimbursable Surplus: <b>${idr(surplus)}</b>`;
  await sendTelegramHTML(token, chatId, msg);
}

// callback psettle:<entity>:<outCsv>:<inCsv>  (csv of 1-based numbers, or "all")
async function doSettleByIndex(entity: string, outCsv: string, inCsv: string, supabase: any, uid: string, token: string, chatId: number) {
  const { outR, inR } = await unsettledFor(supabase, uid, entity);
  const outSel = parseSel(outCsv, outR.length), inSel = parseSel(inCsv, inR.length);
  await executeSettle(entity, outSel.map((n) => outR[n - 1]).filter(Boolean), inSel.map((n) => inR[n - 1]).filter(Boolean), supabase, uid, token, chatId);
}

// ── #2 EDIT / DELETE ledger transactions from chat ──
async function findLedger(supabase: any, uid: string, query: string) {
  const since = ymd(new Date(jakartaNow().getTime() - 150 * 86400000));
  const { data } = await supabase.from("ledger")
    .select("id, tx_date, amount_idr, tx_type, description, merchant_name, from_id, to_id, from_type, to_type, entity, category_name")
    .eq("user_id", uid).neq("tx_type", "opening_balance").gte("tx_date", since)
    .order("tx_date", { ascending: false });
  const q = query.toLowerCase().trim();
  return (data || []).filter((t: any) => `${t.description || ""} ${t.merchant_name || ""} ${t.category_name || ""} ${t.entity || ""}`.toLowerCase().includes(q));
}

async function recalcTouched(supabase: any, uid: string, ids: string[]) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return;
  const { data: accs } = await supabase.from("accounts").select("id, type, initial_balance, currency").in("id", uniq).eq("user_id", uid);
  for (const a of accs || []) await recalcAccountEdge(supabase, uid, a);
}

async function handleDeleteSearch(query: string, supabase: any, uid: string, token: string, chatId: number) {
  const rows = (await findLedger(supabase, uid, query)).slice(0, 6);
  if (!rows.length) { await sendTelegramHTML(token, chatId, `🔍 Ga nemu transaksi dengan "<b>${esc(query)}</b>" (150 hari terakhir).`); return; }
  const d2 = (s: string) => { const p = String(s).split("-"); return p.length === 3 ? `${p[2]}/${p[1]}` : s; };
  const kb = rows.map((t: any) => [{ text: `🗑 ${d2(t.tx_date)} ${String(t.merchant_name || t.description || "tx").slice(0, 16)} ${idr(t.amount_idr)}`, callback_data: `del:${t.id}` }]);
  await sendTelegramHTML(token, chatId, `🗑 <b>Hapus yang mana?</b> (tap buat hapus)`, { inline_keyboard: kb });
}

async function doDelete(id: string, supabase: any, uid: string, token: string, chatId: number) {
  const { data: t } = await supabase.from("ledger").select("id, description, merchant_name, amount_idr, from_id, to_id, from_type, to_type").eq("id", id).eq("user_id", uid).single();
  if (!t) { await sendTelegramHTML(token, chatId, "⚠️ Transaksi ga ketemu (mungkin udah dihapus)."); return; }
  const { error } = await supabase.from("ledger").delete().eq("id", id).eq("user_id", uid);
  if (error) { await sendTelegramHTML(token, chatId, "❌ Gagal hapus: " + esc(error.message)); return; }
  await recalcTouched(supabase, uid, [t.from_type === "account" ? t.from_id : null, t.to_type === "account" ? t.to_id : null]);
  await sendTelegramHTML(token, chatId, `✅ Dihapus: <b>${esc(t.merchant_name || t.description || "tx")}</b> ${idr(t.amount_idr)}\nSaldo akun sudah di-recalc.`);
}

async function handleEditCategory(query: string, target: string, supabase: any, uid: string, token: string, chatId: number) {
  const cat = matchCategory(target);
  const ent = REIMBURSE_ENTITY(target);
  if (!cat && !ent) { await sendTelegramHTML(token, chatId, `Kategori/entity "<b>${esc(target)}</b>" ga dikenali. Contoh: <code>ubah grab jadi transport</code>.`); return; }
  const rows = await findLedger(supabase, uid, query);
  if (!rows.length) { await sendTelegramHTML(token, chatId, `🔍 Ga nemu transaksi "<b>${esc(query)}</b>".`); return; }
  const t = rows[0];   // most recent match
  if (cat) {
    const { data: c } = await supabase.from("expense_categories").select("id,name").ilike("name", `%${cat}%`).limit(1);
    const catId = c?.[0]?.id || null;
    await supabase.from("ledger").update({ category_id: catId, category_name: cat }).eq("id", t.id).eq("user_id", uid);
    await sendTelegramHTML(token, chatId, `✅ <b>${esc(t.merchant_name || t.description || "tx")}</b> ${idr(t.amount_idr)}\n→ kategori <b>${esc(cat)}</b>`);
  } else if (ent) {
    await supabase.from("ledger").update({ entity: ent }).eq("id", t.id).eq("user_id", uid);
    await sendTelegramHTML(token, chatId, `✅ <b>${esc(t.merchant_name || t.description || "tx")}</b> → entity <b>${esc(ent)}</b>`);
  }
}

// ── #6 + #3 WEEKLY INSIGHT (spending vs last week, top cats, budget alerts, income) ──
async function cmdWeekly(supabase: any, uid: string): Promise<string> {
  const now = jakartaNow();
  const today = ymd(now);
  const w1 = ymd(new Date(now.getTime() - 7 * 86400000));
  const w2 = ymd(new Date(now.getTime() - 14 * 86400000));
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const { data: led } = await supabase.from("ledger")
    .select("tx_date, tx_type, amount_idr, category_name, category_id, description")
    .eq("user_id", uid).gte("tx_date", w2).lte("tx_date", today).in("tx_type", ["expense", "income"]);
  let thisExp = 0, prevExp = 0, thisInc = 0; const cats: Record<string, number> = {}; const bigInc: string[] = [];
  for (const t of led || []) {
    const amt = Number(t.amount_idr || 0);
    const inThis = t.tx_date > w1;
    if (t.tx_type === "expense") { if (inThis) { thisExp += amt; const c = t.category_name || "Lainnya"; cats[c] = (cats[c] || 0) + amt; } else prevExp += amt; }
    else if (t.tx_type === "income" && inThis) { thisInc += amt; if (amt >= 1000000) bigInc.push(`${esc(String(t.description || "income").slice(0, 20))} ${idr(amt)}`); }
  }
  const delta = prevExp > 0 ? Math.round((thisExp - prevExp) / prevExp * 100) : 0;
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // budget alerts (this month spend vs budget)
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const { data: budgets } = await supabase.from("budgets").select("category_name, amount").eq("user_id", uid).eq("period_year", y).eq("period_month", m);
  let monthSpend: Record<string, number> = {};
  if ((budgets || []).length) {
    const { data: mLed } = await supabase.from("ledger").select("amount_idr, category_name").eq("user_id", uid).eq("tx_type", "expense").gte("tx_date", monthStart).lte("tx_date", today);
    for (const t of mLed || []) { const c = t.category_name || "Lainnya"; monthSpend[c] = (monthSpend[c] || 0) + Number(t.amount_idr || 0); }
  }
  const alerts: string[] = [];
  for (const b of budgets || []) {
    const spent = monthSpend[b.category_name] || 0; const bud = Number(b.amount || 0);
    if (bud > 0 && spent / bud >= 0.8) alerts.push(`${spent >= bud ? "🔴" : "🟠"} ${esc(b.category_name)}: ${idr(spent)} / ${idr(bud)} (${Math.round(spent / bud * 100)}%)`);
  }

  let out = `📅 <b>INSIGHT MINGGUAN</b>\n\n`;
  out += `💸 Pengeluaran 7 hari: <b>${idr(thisExp)}</b>`;
  out += prevExp > 0 ? ` (${delta >= 0 ? "🔺+" : "🔻"}${Math.abs(delta)}% vs minggu lalu)\n` : `\n`;
  if (topCats.length) out += `Top: ${topCats.map(([c, v]) => `${esc(c)} ${idr(v)}`).join(" · ")}\n`;
  if (thisInc > 0) out += `\n💰 Pemasukan 7 hari: <b>${idr(thisInc)}</b>\n`;
  if (bigInc.length) out += bigInc.slice(0, 3).map((s) => `  • ${s}`).join("\n") + "\n";
  if (alerts.length) out += `\n⚠️ <b>Budget bulan ini</b>\n` + alerts.join("\n") + "\n";
  out += `\n<i>Tanya "grafik pengeluaran 6 bulan" buat lihat trend.</i>`;
  return out;
}

async function cmdHutang(supabase: any, uid: string): Promise<string> {
  const acc = await getActiveAccounts(supabase, uid);
  const liab = acc.filter((a) => a.type === "liability");
  const ccTotal = acc.filter((a) => a.type === "credit_card").reduce((s, a) => s + (Number(a.outstanding_amount) || 0), 0);
  // cicilan berjalan di kartu (installments)
  const { data: inst } = await supabase.from("installments").select("description, monthly_amount, total_months, tenor_months, paid_months, status").eq("user_id", uid).eq("status", "active");
  const instList = (inst || []).map((i: any) => {
    const tenor = Number(i.total_months || i.tenor_months || 0), paid = Number(i.paid_months || 0);
    const left = Math.max(0, tenor - paid);
    return { name: String(i.description || "-").slice(0, 28), monthly: Number(i.monthly_amount || 0), left, sisa: left * Number(i.monthly_amount || 0) };
  }).filter((i: any) => i.left > 0).sort((a: any, b: any) => b.sisa - a.sisa);
  const instMonthly = instList.reduce((s: number, i: any) => s + i.monthly, 0);
  const instSisa = instList.reduce((s: number, i: any) => s + i.sisa, 0);
  let liabTotal = 0;

  let out = "🏛 <b>HUTANG & CICILAN</b>\n";
  out += `\n💳 <b>Kartu kredit</b>\n<b>${idr(ccTotal)}</b> · detail /cc\n`;
  for (const a of liab) {
    const os = Number(a.outstanding_amount) || 0; liabTotal += os;
    out += `\n🚗 <b>${esc(a.name)}</b>\nSisa: <b>${idr(os)}</b>${a.monthly_installment ? `\nCicilan: <b>${idr(a.monthly_installment)}</b>/bln` : ""}\n`;
  }
  if (instList.length) {
    out += `\n📆 <b>Cicilan di kartu</b> <i>(termasuk di tagihan kartu)</i>\n\n`;
    for (const i of instList) out += `${esc(i.name)} · sisa ${i.left}×\n<b>${idr(i.monthly)}</b>/bln (sisa ${idr(i.sisa)})\n\n`;
    out += `Total cicilan/bln: <b>${idr(instMonthly)}</b>\nTotal sisa cicilan: <b>${idr(instSisa)}</b>\n`;
  }
  out += `\n━━━━━━━━━━━━━━━\nTOTAL KEWAJIBAN: <b>${idr(ccTotal + liabTotal)}</b>\n<i>(kartu + pinjaman; cicilan kartu sudah di dalam tagihan kartu)</i>\n\nPiutang (yang orang utang ke kamu): /piutang`;
  return out;
}

async function cmdPiutang(supabase: any, uid: string): Promise<string> {
  // 1. utang karyawan
  const { data: loans } = await supabase.from("employee_loans").select("employee_name, total_amount, monthly_installment, paid_months, status").eq("user_id", uid).eq("status", "active");
  let loanTotal = 0;
  let out = "🤝 <b>PIUTANG</b> <i>(yang orang utang ke kamu)</i>\n";
  out += "\n👥 <b>Utang karyawan</b>\n\n";
  for (const l of (loans || [])) {
    const sisa = Math.max(0, Number(l.total_amount || 0) - Number(l.paid_months || 0) * Number(l.monthly_installment || 0));
    if (sisa <= 0) continue;
    loanTotal += sisa;
    out += `${esc(l.employee_name)} · cicilan ${idr(l.monthly_installment)}/bln\n<b>${idr(sisa)}</b>\n\n`;
  }
  out += `Total utang karyawan: <b>${idr(loanTotal)}</b>\n`;
  // 2. reimburse belum settled per entity
  const { data: led } = await supabase.from("ledger").select("tx_type, amount_idr, entity").eq("user_id", uid).in("tx_type", ["reimburse_out", "reimburse_in"]).is("reimburse_settlement_id", null);
  const ent: Record<string, { out: number; in: number }> = {};
  for (const e of led || []) {
    const k = e.entity || "?"; ent[k] = ent[k] || { out: 0, in: 0 };
    if (e.tx_type === "reimburse_out") ent[k].out += Number(e.amount_idr) || 0; else ent[k].in += Number(e.amount_idr) || 0;
  }
  out += "\n🔄 <b>Reimburse belum settled</b>\n\n";
  let reimbTotal = 0;
  for (const [k, v] of Object.entries(ent)) {
    const net = v.out - v.in;
    reimbTotal += net;
    out += `${esc(k)} · talangin ${idr(v.out)} − balik ${idr(v.in)}\n<b>${net >= 0 ? idr(net) : "−" + idr(-net) + " (kelebihan bayar)"}</b>\n\n`;
  }
  out += `━━━━━━━━━━━━━━━\nTOTAL PIUTANG: <b>${idr(loanTotal + Math.max(0, reimbTotal))}</b>`;
  return out;
}

async function cmdInvestasi(supabase: any, uid: string): Promise<string> {
  const acc = await getActiveAccounts(supabase, uid);
  const assets = acc.filter((a) => a.type === "asset" && a.include_networth !== false)
    .sort((a, b) => (Number(b.current_value) || 0) - (Number(a.current_value) || 0));
  const total = assets.reduce((s, a) => s + (Number(a.current_value) || 0), 0);
  let out = "📈 <b>INVESTASI & ASET</b>\n\n";
  for (const a of assets) {
    const v = Number(a.current_value) || 0;
    if (v === 0) continue;
    out += `${esc(a.name)}\n<b>${idr(v)}</b>\n\n`;
  }
  out += `\n━━━━━━━━━━━━━━━\nTotal: <b>${idr(total)}</b>`;
  return out;
}

async function cmdPending(supabase: any, uid: string): Promise<string> {
  const { data: rows } = await supabase.from("email_sync").select("id, ai_raw_result").eq("user_id", uid).eq("status", "pending");
  let n = 0, tot = 0; const lines: string[] = [];
  for (const r of rows || []) {
    let arr: any = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
    for (const t of (Array.isArray(arr) ? arr : [])) {
      if (t._imported || t._skipped) continue;
      n++; const amt = Number(t.amount_idr || t.amount || 0); tot += amt;
      if (n <= 15) lines.push(`${t.type === "in" ? "🟢" : "🔴"} ${esc(t.merchant_name || t.description || "-")} — ${idr(amt)}`);
    }
  }
  if (!n) return "📭 <b>PENDING</b>\n\nKosong — semua sudah diimport. ✅";
  return `📥 <b>PENDING (${n})</b>\n${lines.join("\n")}${n > 15 ? `\n<i>… +${n - 15} lagi</i>` : ""}\n\nKetik /digest untuk review + import.`;
}

async function cmdUndo(supabase: any, uid: string): Promise<string> {
  // delete the most recent telegram_import batch (rows created within 3 min of the newest one)
  const { data: last } = await supabase.from("ledger").select("id, created_at").eq("user_id", uid).eq("source", "telegram_import").order("created_at", { ascending: false }).limit(1);
  if (!last || !last.length) return "↩️ Tidak ada import Telegram yang bisa dibatalkan.";
  const newest = new Date(last[0].created_at).getTime();
  const { data: batch } = await supabase.from("ledger").select("id, amount_idr, description, from_id, to_id, notes, created_at").eq("user_id", uid).eq("source", "telegram_import");
  const del = (batch || []).filter((r: any) => newest - new Date(r.created_at).getTime() <= 3 * 60 * 1000);
  const affected = new Set<string>();
  for (const r of del) { if (r.from_id) affected.add(r.from_id); if (r.to_id) affected.add(r.to_id); }
  await supabase.from("ledger").delete().in("id", del.map((r: any) => r.id));
  // unmark the source email items so they come back as pending
  const { data: rows } = await supabase.from("email_sync").select("id, ai_raw_result, status").eq("user_id", uid).in("status", ["imported", "pending"]);
  let unmarked = 0;
  for (const r of rows || []) {
    let arr: any = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    let changed = false;
    for (const t of arr) {
      if (!t._imported) continue;
      if (del.some((d: any) => Math.round(Number(d.amount_idr)) === Math.round(Number(t.amount_idr || t.amount || 0)))) { delete t._imported; changed = true; unmarked++; }
    }
    if (changed) await supabase.from("email_sync").update({ ai_raw_result: arr, status: "pending" }).eq("id", r.id);
  }
  const { data: accs } = await supabase.from("accounts").select("*").eq("user_id", uid);
  for (const id of affected) { const a = (accs || []).find((x: any) => x.id === id); if (a) await recalcAccountEdge(supabase, uid, a); }
  let out = `↩️ <b>UNDO — ${del.length} transaksi dihapus dari ledger</b>\n`;
  for (const r of del.slice(0, 10)) out += `•  ${esc(r.description || "-")} — ${idr(r.amount_idr)}\n`;
  out += `\n${unmarked} item balik ke pending. Saldo sudah dihitung ulang.`;
  return out;
}

function txLabel(t: any): string {
  return t.merchant_name || t.description || t.category_name || t.tx_type || "—";
}

async function cmdHari(supabase: any, uid: string): Promise<string> {
  const today = ymd(jakartaNow());
  const { data: led, error } = await supabase
    .from("ledger").select("tx_type, amount_idr, description, merchant_name, category_name")
    .eq("user_id", uid).eq("tx_date", today).order("created_at", { ascending: true });
  if (error) throw error;
  const d = jakartaNow();
  const header = `📅 <b>Hari ini</b> — ${d.getUTCDate()} ${ID_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (!led || !led.length) return header + "\n\nBelum ada transaksi hari ini.";
  let inc = 0, exp = 0, out = header + "\n<pre>";
  for (const t of led) {
    const amt = Number(t.amount_idr) || 0;
    const isIn = ["income", "reimburse_in", "collect_loan", "sell_asset"].includes(t.tx_type);
    if (isIn) inc += amt; else if (t.tx_type === "expense" || t.tx_type === "reimburse_out") exp += amt;
    const sign = isIn ? "+" : "-";
    out += padR(txLabel(t), 22) + padL(sign + idr(amt), 14) + "\n";
  }
  out += "</pre>";
  out += `\n<b>Masuk:</b> ${idr(inc)}  •  <b>Keluar:</b> ${idr(exp)}`;
  return out;
}

async function cmdBulan(supabase: any, uid: string, arg: string): Promise<string> {
  const now = jakartaNow();
  let year = now.getUTCFullYear(), month = now.getUTCMonth(); // 0-based
  const m = arg.match(/(\d{4})-(\d{2})/);
  if (m) { year = Number(m[1]); month = Number(m[2]) - 1; }
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year, month + 1, 0));
  const end = ymd(endDate);
  const { data: led, error } = await supabase
    .from("ledger").select("tx_type, amount_idr, category_name")
    .eq("user_id", uid).gte("tx_date", start).lte("tx_date", end);
  if (error) throw error;
  let inc = 0, exp = 0;
  const cats: Record<string, number> = {};
  for (const t of led || []) {
    const amt = Number(t.amount_idr) || 0;
    if (t.tx_type === "income") inc += amt;
    else if (t.tx_type === "expense") {
      exp += amt;
      const c = t.category_name || "Lainnya";
      cats[c] = (cats[c] || 0) + amt;
    }
  }
  const net = inc - exp;
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 8);
  let out = `📆 <b>${ID_MONTHS[month]} ${year}</b>\n<pre>`;
  out += padR("Income", 12) + padL(idr(inc), 18) + "\n";
  out += padR("Expense", 12) + padL("-" + idr(exp), 18) + "\n";
  out += "─".repeat(30) + "\n";
  out += padR("Net", 12) + padL((net >= 0 ? "+" : "") + idr(net), 18) + "\n</pre>";
  if (top.length) {
    out += "\n<b>Top kategori (expense)</b>\n<pre>";
    for (const [c, v] of top) out += padR(c, 20) + padL(idr(v), 14) + "\n";
    out += "</pre>";
  }
  out += "<i>*P&amp;L tidak termasuk transfer/pay_cc/reimburse/aset</i>";
  return out;
}

// ── 2-way callback handling (digest classify buttons) ──
async function answerCallback(token: string, cbId: string, text: string) {
  try {
    await fetch(`${TELEGRAM_API}/bot${token}/answerCallbackQuery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cbId, text }),
    });
  } catch (err) { console.error("[telegram-webhook] answerCallback error:", err); }
}

const ENT_MAP: Record<string, string> = { H: "Hamasa", S: "SDC", P: "Personal" };

async function handleCallback(cb: any, token: string, supabase: any, uid: string) {
  const data: string = cb.data || "";
  const parts = data.split(":");

  // #1 settle reimburse — psettle:<entity>:<outCsv>:<inCsv>
  if (parts[0] === "psettle" && parts[1]) {
    await answerCallback(token, cb.id, "⏳ Settle...");
    await doSettleByIndex(parts[1], parts[2] || "0", parts[3] || "0", supabase, uid, token, cb.message.chat.id);
    return;
  }
  // #2 delete ledger tx
  if (parts[0] === "del" && parts[1]) {
    await answerCallback(token, cb.id, "🗑 Menghapus...");
    await doDelete(parts.slice(1).join(":"), supabase, uid, token, cb.message.chat.id);
    return;
  }

  // classify/reject: cls:<emailSyncId>:<txIdx>:<H|S|P|X>  → tag entity, or X = tolak (won't be imported)
  if (parts[0] === "cls" && parts.length === 4) {
    const [, esId, idxS, entC] = parts;
    const idx = Number(idxS);
    const { data: row, error } = await supabase.from("email_sync").select("ai_raw_result").eq("id", esId).eq("user_id", uid).single();
    if (error || !row) { await answerCallback(token, cb.id, "⚠️ item tidak ketemu"); return; }
    let arr: any = row.ai_raw_result;
    try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
    if (!Array.isArray(arr) || !arr[idx]) { await answerCallback(token, cb.id, "⚠️ index error"); return; }
    const label = String(arr[idx].merchant_name || arr[idx].description || "tx").slice(0, 24);
    if (entC === "X") {
      arr[idx]._skipped = true; arr[idx]._tg_classified = true;
      await supabase.from("email_sync").update({ ai_raw_result: arr }).eq("id", esId);
      await answerCallback(token, cb.id, `🗑 ${label} DITOLAK — tidak akan diimport`);
      return;
    }
    const entity = ENT_MAP[entC] || "Personal";
    arr[idx].suggested_entity = entity;
    arr[idx].suggested_tx_type = entity === "Personal" ? "expense" : "reimburse_out";
    arr[idx].is_reimburse = entity !== "Personal";
    arr[idx]._tg_classified = true;
    delete arr[idx]._skipped;
    await supabase.from("email_sync").update({ ai_raw_result: arr }).eq("id", esId);
    await answerCallback(token, cb.id, `✅ ${label} → ${entity}`);
    return;
  }

  // review-all: one message listing EVERY pending item, each with reject/classify buttons
  if (data === "dg:reviewall") {
    const { data: rows } = await supabase.from("email_sync").select("id, ai_raw_result").eq("user_id", uid).eq("status", "pending");
    const lines: string[] = []; const kb: any[] = []; let n = 0;
    for (const r of rows || []) {
      let arr: any = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
      (Array.isArray(arr) ? arr : []).forEach((t: any, idx: number) => {
        if (t._imported || t._skipped || n >= 20) return;
        n++;
        lines.push(`<b>${n}.</b> ${esc(t.merchant_name || t.description || "-")} — ${idr(t.amount_idr || t.amount)}`);
        kb.push([
          { text: `${n}`, callback_data: `noop:${n}` },
          { text: "❌", callback_data: `cls:${r.id}:${idx}:X` },
          { text: "🏢", callback_data: `cls:${r.id}:${idx}:H` },
          { text: "🦷", callback_data: `cls:${r.id}:${idx}:S` },
          { text: "👤", callback_data: `cls:${r.id}:${idx}:P` },
        ]);
      });
    }
    await answerCallback(token, cb.id, n ? `${n} item` : "kosong");
    if (n) {
      await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cb.message.chat.id, parse_mode: "HTML", text: `✏️ <b>Review pending (${n})</b>\n${lines.join("\n")}\n\n❌ tolak · 🏢 Hamasa · 🦷 SDC · 👤 Pribadi`, reply_markup: { inline_keyboard: kb } }),
      });
    } else {
      await sendTelegramHTML(token, cb.message.chat.id, "📭 Tidak ada item pending.");
    }
    return;
  }

  // review: list today's still-ambiguous pending items
  if (data === "dg:review") {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: rows } = await supabase.from("email_sync").select("ai_raw_result").eq("user_id", uid).eq("status", "pending").gte("received_at", since);
    let n = 0, txt = "";
    for (const r of rows || []) {
      let arr: any = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
      for (const t of (Array.isArray(arr) ? arr : [])) {
        const amb = (Number(t.confidence ?? 1) < 0.7) || /tokopedia|tokped/i.test(String(t.merchant_name ?? t.description ?? ""));
        if (amb && !t._tg_classified) { n++; txt += `• ${esc(t.merchant_name || t.description || "-")} ${idr(t.amount_idr || t.amount)} <i>(${t.suggested_entity || "?"})</i>\n`; }
      }
    }
    await answerCallback(token, cb.id, n ? `${n} item ambigu` : "Tidak ada yang ambigu 🎉");
    if (n) await sendTelegramHTML(token, cb.message.chat.id, `❓ <b>Perlu keputusan (${n})</b>\n${txt}\nTap tombol entity di digest untuk klasifikasi.`);
    return;
  }

  // legacy button ids from older digest messages
  if (data === "digest:import_all") { return handleCallback({ ...cb, data: "dg:importall" }, token, supabase, uid); }
  if (data === "digest:review") { return handleCallback({ ...cb, data: "dg:review" }, token, supabase, uid); }

  // investment value update confirm: iset:<assetId>:<value>  (Paulus approved the change)
  if (parts[0] === "iset" && parts.length === 3) {
    const [, aid, valS] = parts; const val = Math.round(Number(valS));
    const { data: a } = await supabase.from("accounts").select("id, name, current_value").eq("id", aid).eq("user_id", uid).single();
    if (!a) { await answerCallback(token, cb.id, "⚠️ akun ga ketemu"); return; }
    await supabase.from("accounts").update({ current_value: val }).eq("id", aid);
    await answerCallback(token, cb.id, `✅ ${a.name} → ${idr(val)}`);
    await sendTelegramHTML(token, cb.message.chat.id, `✅ <b>${esc(a.name)}</b> diupdate ke <b>${idr(val)}</b> <i>(dari ${idr(a.current_value)})</i>`);
    return;
  }
  if (data.startsWith("iskip:")) { await answerCallback(token, cb.id, "⏭ Dilewati, nilai app tetap"); return; }

  // import-all: run the real importer (reclassify -> merge -> dedup -> insert -> recalc -> mark imported)
  if (data === "dg:importall") {
    await answerCallback(token, cb.id, "⏳ Importing...");
    const summary = await importPending(supabase, uid);
    await sendTelegramHTML(token, cb.message.chat.id, summary);
    return;
  }

  await answerCallback(token, cb.id, "ok");
}

// ── TEXT CORRECTION: reply to classify pending items ("dua ini reimburse out hamasa", "tokped hamasa") ──
// Short category words -> canonical expense_categories.name. First match wins,
// so more-specific rows (Groceries, Coffee) come before broad ones (Shopping).
const CAT_KW: [RegExp, string][] = [
  [/\bcoffee\b|kopi|snack|cemilan|jajan/, "Coffee & Snacks"],
  [/grocer|belanja\s*bulanan|sembako|supermarket|indomaret|alfamart/, "Groceries"],
  [/\bfood\b|makan|makanan|resto|restoran|f\s*&?\s*b|fnb|kuliner/, "Food & Drink"],
  [/gadget|elektronik|electronic|gawai|hp\b|laptop/, "Electronics & Gadgets"],
  [/\bhome\b|furnitur|furniture|rumah|perabot|dekorasi/, "Home & Furniture"],
  [/fuel|bensin|bbm|pertamax|vehicle|kendaraan|bengkel|servis\s*mobil|parkir|\btol\b/, "Fuel & Vehicle"],
  [/transport|transportasi|ojek|taksi|taxi|angkot|kereta|busway|mrt/, "Transport"],
  [/health|kesehatan|obat|dokter|rumah\s*sakit|klinik|apotek/, "Health"],
  [/fashion|apparel|baju|pakaian|sepatu|clothing|tas\b/, "Fashion & Apparel"],
  [/bills?|utilit|listrik|\bpln\b|\bpdam\b|internet|wifi|pulsa|telepon/, "Bills (Utilities)"],
  [/charity|donasi|sedekah|zakat|amal/, "Charity"],
  [/education|pendidikan|sekolah|kuliah|kursus|\bles\b|buku/, "Education"],
  [/entertainment|hiburan|nonton|bioskop|\bgame\b|\bfilm\b/, "Entertainment"],
  [/family|keluarga/, "Family"],
  [/subscription|langganan|netflix|spotify|icloud|apple\s*one|youtube/, "Subscription"],
  [/\btax\b|pajak|pph|ppn/, "Tax"],
  [/travel|liburan|hotel|tiket|pesawat|wisata/, "Travel"],
  [/personal\s*care|perawatan|salon|\bspa\b|barber|skincare/, "Personal Care"],
  [/property|\bipl\b|apartemen|apartment/, "Property & IPL"],
  [/bank\s*charge|biaya\s*bank|admin\s*bank/, "Bank Charges"],
  [/staff|salary|gaji|payroll/, "Staff & Salary"],
  [/shopping|belanja/, "Shopping"],
];
function matchCategory(s: string): string | null {
  for (const [re, name] of CAT_KW) if (re.test(s)) return name;
  return null;
}

// Classify a short type phrase (e.g. "sdc out", "food", "transfer") into a
// suggested tx_type/entity/category. Shared by single- and multi-assign.
function classifyText(s: string) {
  s = s.toLowerCase();
  const entity =
    /\bsdc\b/.test(s) ? "SDC" :
    /hamasa/.test(s) ? "Hamasa" :
    /travelio/.test(s) ? "Travelio" :
    (/pribadi|personal|expense|income|pengeluaran|pemasukan/.test(s) ? "Personal" : null);
  const category = matchCategory(s);
  const forceIn = /\b(in|masuk|pemasukan|income)\b/.test(s);
  const forceOut = /\b(out|keluar|pengeluaran|expense)\b/.test(s);
  const wantTransfer = /\b(transfer|tf|pindah)\b/.test(s);
  return { entity, category, forceIn, forceOut, wantTransfer, valid: !!(entity || category || wantTransfer) };
}

// Apply a classification onto a pending item; returns a human label of the result.
function applyCls(t: any, c: ReturnType<typeof classifyText>): string {
  const isIn = c.forceIn ? true : c.forceOut ? false : (t.type === "in");
  if (c.wantTransfer) { t.suggested_tx_type = "transfer"; t.suggested_entity = null; t.is_reimburse = false; }
  else if (c.entity && c.entity !== "Personal") { t.suggested_tx_type = isIn ? "reimburse_in" : "reimburse_out"; t.suggested_entity = c.entity; t.is_reimburse = true; }
  else { t.suggested_tx_type = isIn ? "income" : "expense"; t.suggested_entity = "Personal"; if (c.category) t.suggested_category = c.category; t.is_reimburse = false; }
  t._tg_classified = true;
  return c.wantTransfer ? "transfer"
    : (c.entity && c.entity !== "Personal") ? `reimburse_${isIn ? "in" : "out"} ${c.entity}`
    : `${isIn ? "income" : "expense"} (pribadi)${c.category ? " · " + c.category : ""}`;
}

// Parse per-item assignments: "1 food 2 transfer 3 sdc out" -> [{n:1,txt:"food"},...]
function parseAssignments(s: string, maxN: number): { n: number; txt: string }[] {
  const out: { n: number; txt: string }[] = [];
  const re = /(\d{1,2})\s*([^\d]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const n = Number(m[1]); const txt = (m[2] || "").replace(/[.:)\-=]/g, " ").trim();
    if (n >= 1 && n <= maxN && txt) out.push({ n, txt });
  }
  return out;
}

function looksLikeCorrection(t: string): boolean {
  const s = t.toLowerCase();
  if (s.length > 160) return false;
  const hasEntity = /\b(hamasa|sdc|travelio|pribadi|personal|reimburse|expense|income|pengeluaran|pemasukan|transfer|bayar|masuk|keluar)\b/.test(s);
  const hasCat = matchCategory(s) !== null;
  const isNotif = /(rp\s*[\d.,]{4,}|\botp\b|kode|debet|kredit|saldo|va |virtual|berhasil)/.test(s);
  return (hasEntity || hasCat) && !isNotif;
}

// Two-way correction: the digest told the user what a pending tx is; the user
// replies (e.g. "reimburse sdc", "personal", "grab hamasa") and we re-tag the
// matching pending item(s). Selection priority:
//   1. merchant keyword mentioned  -> match by merchant
//   2. explicit "semua/dua/ini/itu" -> all pending
//   3. exactly ONE pending item     -> that one (the common digest case)
//   4. multiple, no hint            -> ambiguous ones; if none, list & ask
async function handleTextCorrection(text: string, supabase: any, uid: string, botToken: string, chatId: number): Promise<boolean> {
  const s = text.toLowerCase();
  const entity =
    /\bsdc\b/.test(s) ? "SDC" :
    /hamasa/.test(s) ? "Hamasa" :
    /travelio/.test(s) ? "Travelio" :
    (/pribadi|personal|expense|income|pengeluaran|pemasukan/.test(s) ? "Personal" : null);
  const category = matchCategory(s);
  if (!entity && !category) return false;
  const nrm = (x: any) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // direction: explicit override, else fall back to the item's own in/out
  const forceIn = /\b(in|masuk|pemasukan|income)\b/.test(s);
  const forceOut = /\b(out|keluar|pengeluaran|expense)\b/.test(s);
  const wantTransfer = /\b(transfer|tf|pindah)\b/.test(s);
  // merchant keyword mentioned? (tokped/tokopedia, grab, lazada, blibli, gojek, shopee, dst)
  const KW: Record<string, RegExp> = { tokopedia: /tokped|tokopedia/, grab: /\bgrab\b/, gojek: /gojek|gopay/, lazada: /lazada/, blibli: /blibli/, shopee: /shopee/, allianz: /allianz/, digitalocean: /digitalocean|ocean/, auto2000: /auto\s*2000/ };
  const wantKW = Object.entries(KW).filter(([, re]) => re.test(s)).map(([k]) => k);
  const explicitAll = /\b(semua|semuanya|keduanya|dua|ketiga|tiga|ini|itu)\b/.test(s);

  // flatten all pending items across email_sync rows (ordered by id so the
  // numbering the user sees stays stable between /pending and a follow-up reply)
  const { data: rows } = await supabase.from("email_sync").select("id, ai_raw_result").eq("user_id", uid).eq("status", "pending").order("id", { ascending: true });
  const rowArr = new Map<string, any[]>();
  const flat: { rowId: string; t: any }[] = [];
  for (const r of rows || []) {
    let arr: any = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
    if (!Array.isArray(arr)) continue;
    rowArr.set(r.id, arr);
    arr.forEach((t: any) => { if (!t._imported && !t._skipped) flat.push({ rowId: r.id, t }); });
  }
  if (!flat.length) { await sendTelegramHTML(botToken, chatId, "📭 Ga ada transaksi pending buat diubah."); return true; }

  // Resolve a user-typed number to a pending item. Prefer _tg_no (the number the
  // digest showed & persisted) so it matches exactly what the user sees; fall back
  // to list position.
  const noMap = new Map<number, { rowId: string; t: any }>();
  for (const f of flat) { const no = Number(f.t._tg_no); if (no) noMap.set(no, f); }
  const pick = (n: number) => noMap.get(n) || flat[n - 1];
  const maxNo = Math.max(flat.length, ...[...noMap.keys(), 0]);

  // MULTI-ASSIGN: "1 food 2 transfer 3 sdc out" -> tiap nomor tipe sendiri.
  // Aktif kalau ada >=2 pasangan nomor+tipe yang valid.
  const assigns = parseAssignments(s, maxNo)
    .map((p) => ({ n: p.n, cls: classifyText(p.txt) }))
    .filter((p) => p.cls.valid && pick(p.n));
  if (assigns.length >= 2) {
    const seen = new Map<number, ReturnType<typeof classifyText>>();
    for (const a of assigns) seen.set(a.n, a.cls);   // dedup, last wins
    const lines: string[] = []; const touched = new Set<string>();
    for (const n of [...seen.keys()].sort((x, y) => x - y)) {
      const picked = pick(n); if (!picked) continue;
      const { rowId, t } = picked;
      const label = applyCls(t, seen.get(n)!);
      lines.push(`${n}. ${esc(String(t.merchant_name || t.description || "tx").slice(0, 28))} · ${idr(t.amount_idr || t.amount)} → <b>${esc(label)}</b>`);
      touched.add(rowId);
    }
    for (const id of touched) await supabase.from("email_sync").update({ ai_raw_result: rowArr.get(id) }).eq("id", id);
    await sendTelegramHTML(botToken, chatId,
      `✅ <b>${seen.size} transaksi diubah</b>\n${lines.join("\n")}`,
      { inline_keyboard: [[{ text: "✅ Import Semua", callback_data: "dg:importall" }]] });
    return true;
  }

  // numeric selection: "2 sdc out", "1 3 food" -> pick items by their list number
  // (only integers within 1..N; anything bigger is treated as an amount, not an index)
  const idxSel = Array.from(new Set((s.match(/\b\d{1,2}\b/g) || []).map(Number).filter((n) => n >= 1 && n <= maxNo)));

  const labelOf = (t: any) => nrm(t.merchant_name || t.description);
  const kwHit = (t: any) => { const l = labelOf(t); return wantKW.some((k) => l.includes(k.slice(0, 6)) || (k === "tokopedia" && /tokp/.test(l))); };
  const numberedList = () => flat.map((f, i) => `${f.t._tg_no || i + 1}. ${esc(f.t.merchant_name || f.t.description || "tx")} — ${esc(idr(f.t.amount_idr || f.t.amount))}`).join("\n");

  let targets: { rowId: string; t: any }[];
  if (idxSel.length) {
    targets = idxSel.map(pick).filter(Boolean) as { rowId: string; t: any }[];  // pick specific rows by number
  } else if (wantKW.length) {
    targets = flat.filter(({ t }) => kwHit(t));         // pick by merchant name
  } else if (explicitAll || flat.length === 1) {
    targets = flat;                                     // "semua", or the single-item case
  } else {
    // multiple pending, no hint — don't guess: show numbered list and ask
    await sendTelegramHTML(botToken, chatId, `❓ Ada <b>${flat.length}</b> transaksi pending. Yang mana mau diubah jadi <b>${esc(entity || category || "")}</b>?\n${numberedList()}\n\nBalas pakai <b>nomor</b> (mis. <code>2 ${esc(text)}</code> atau <code>1 3 ${esc(text)}</code>), atau <b>semua</b>.`);
    return true;
  }
  if (!targets.length) { await sendTelegramHTML(botToken, chatId, `⚠️ Ga nemu transaksi pending yang cocok.\n${numberedList()}\n\nCoba balas pakai nomornya.`); return true; }

  // resolve account/bank names so the reply shows detail (e.g. "Mandiri Signa")
  const { data: accs } = await supabase.from("accounts").select("id, name").eq("user_id", uid);
  const accName = (id: any) => (accs || []).find((a: any) => a.id === id)?.name || null;
  const bankOf = (t: any) => accName(t.from_account_id) || accName(t.to_account_id) || t.from_bank_name || t.to_bank_name || "—";

  const changed: string[] = []; const touched = new Set<string>();
  for (const { rowId, t } of targets) {
    const isIn = forceIn ? true : forceOut ? false : (t.type === "in");
    if (wantTransfer) {
      t.suggested_tx_type = "transfer"; t.suggested_entity = null; t.is_reimburse = false;
    } else if (entity && entity !== "Personal") {
      t.suggested_tx_type = isIn ? "reimburse_in" : "reimburse_out"; t.suggested_entity = entity; t.is_reimburse = true;
    } else {
      t.suggested_tx_type = isIn ? "income" : "expense"; t.suggested_entity = "Personal"; t.is_reimburse = false;
      if (category) t.suggested_category = category;
    }
    t._tg_classified = true;
    changed.push(`${t.merchant_name || t.description || "tx"} · ${idr(t.amount_idr || t.amount)} · <i>${esc(bankOf(t))}</i>`);
    touched.add(rowId);
  }
  for (const id of touched) await supabase.from("email_sync").update({ ai_raw_result: rowArr.get(id) }).eq("id", id);

  const t0 = targets[0].t;
  const dir0 = forceIn ? true : forceOut ? false : (t0.type === "in");
  const tt = wantTransfer ? "transfer"
    : (entity && entity !== "Personal") ? `reimburse_${dir0 ? "in" : "out"} ${entity}`
    : `${dir0 ? "income" : "expense"} (pribadi)${category ? " · " + category : ""}`;
  await sendTelegramHTML(botToken, chatId,
    `✅ <b>${changed.length} transaksi → ${esc(tt)}</b>\n${changed.slice(0, 8).map((c) => "• " + c).join("\n")}`,
    { inline_keyboard: [[{ text: "✅ Import Semua", callback_data: "dg:importall" }]] });
  return true;
}

// ── QUICK-ADD: "makan 50rb bca" -> expense langsung ke ledger ──
function looksLikeQuickAdd(t: string): boolean {
  const s = t.trim();
  if (s.length > 80) return false;
  const hasAmt = /\b\d+\s*(rb|ribu|k|jt|juta)\b/i.test(s) || /\b\d{4,}\b/.test(s.replace(/[.,]/g, ""));
  const isNotif = /(debet|kredit|rek\.|rekening|berhasil|bca info|transfer dari|saldo anda|otp|va |virtual)/i.test(s);
  return hasAmt && !isNotif;
}

async function handleQuickAdd(text: string, apiKey: string, supabase: any, uid: string, botToken: string, chatId: number) {
  const accounts = await getActiveAccounts(supabase, uid);
  const spendable = accounts.filter((a) => a.type === "bank" || a.type === "credit_card");
  const names = spendable.map((a) => a.name).join(", ");
  const { data: cats } = await supabase.from("expense_categories").select("id,name").or(`user_id.is.null,user_id.eq.${uid}`);
  const catNames = (cats || []).map((c: any) => c.name).join(", ");
  const prompt = `Parse catatan pengeluaran singkat Indonesia menjadi JSON. Input: "${text}"

Akun user (pilih yang PALING cocok disebut di input; null kalau tidak disebut): ${names}
Kategori valid: ${catNames}

Output HANYA JSON: {"amount": number (50rb=50000, 1.5jt=1500000), "account": "nama akun persis dari daftar atau null", "category": "kategori valid paling cocok", "description": "deskripsi singkat"}`;
  try {
    const raw = await callClaudeAnswerText(apiKey, prompt);
    const j = JSON.parse(raw.replace(/```json?/g, "").replace(/```/g, "").trim());
    const amt = Math.round(Number(j.amount) || 0);
    if (!amt) { await sendTelegramHTML(botToken, chatId, "⚠️ Nominal tidak kebaca. Contoh: <i>makan 50rb bca</i>"); return; }
    const accRow = j.account ? spendable.find((a) => a.name.toLowerCase() === String(j.account).toLowerCase()) : null;
    if (!accRow) {
      await sendTelegramHTML(botToken, chatId, `⚠️ Sebut akunnya ya. Contoh: <i>${esc(text)} <b>bca idr</b></i>\n\nAkun: ${esc(names)}`);
      return;
    }
    // merchant-memory: kategori dari mapping kalau ada
    const { data: mm } = await supabase.from("merchant_mappings").select("merchant_name, category_name").eq("user_id", uid);
    const nrm = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const nd = nrm(j.description);
    const hit = (mm || []).filter((m: any) => { const n = nrm(m.merchant_name); return n.length >= 4 && (nd.includes(n) || n.includes(nd.slice(0, 10))); }).sort((a: any, b: any) => nrm(b.merchant_name).length - nrm(a.merchant_name).length)[0];
    const catName = hit?.category_name || j.category || "Other";
    const catRow = (cats || []).find((c: any) => c.name === catName) || (cats || []).find((c: any) => c.name === "Other");
    const { error } = await supabase.from("ledger").insert({
      user_id: uid, tx_date: ymd(jakartaNow()), tx_type: "expense", amount: amt, amount_idr: amt, currency: "IDR",
      description: j.description || text, from_type: "account", from_id: accRow.id, to_type: "expense", to_id: null,
      category_id: catRow?.id || null, category_name: catRow?.name || null, entity: "Personal", source: "telegram_import",
    });
    if (error) throw new Error(error.message);
    await recalcAccountEdge(supabase, uid, accRow);
    await sendTelegramHTML(botToken, chatId, `✅ <b>Tercatat</b>\n${esc(j.description || text)}\n<b>${idr(amt)}</b> · ${esc(catRow?.name || "-")} · ${esc(accRow.name)}${hit ? "\n<i>kategori dari memory merchant</i>" : ""}\n\nSalah? /undo`);
  } catch (err: any) {
    await sendTelegramHTML(botToken, chatId, "❌ Gagal quick-add: " + esc(err?.message || "error"));
  }
}

// ── /report: laporan bulanan HTML dikirim sebagai file ──
async function cmdReport(supabase: any, uid: string, arg: string, token: string, chatId: number) {
  const now = jakartaNow();
  let year = now.getUTCFullYear(), month = now.getUTCMonth();
  const m = arg.match(/(\d{4})-(\d{2})/); if (m) { year = Number(m[1]); month = Number(m[2]) - 1; }
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const end = ymd(new Date(Date.UTC(year, month + 1, 0)));
  const label = `${ID_MONTHS[month]} ${year}`;
  await sendTelegramHTML(token, chatId, `📊 Membuat laporan <b>${label}</b>...`);
  const { data: led } = await supabase.from("ledger").select("tx_date, tx_type, amount_idr, description, merchant_name, category_name, entity").eq("user_id", uid).gte("tx_date", start).lte("tx_date", end).order("tx_date");
  const acc = await getActiveAccounts(supabase, uid);
  let inc = 0, exp = 0; const cats: Record<string, number> = {}; const incSrc: Record<string, number> = {};
  const topExp: any[] = [];
  for (const t of led || []) {
    const a = Number(t.amount_idr) || 0;
    if (t.tx_type === "income") { inc += a; incSrc[t.description?.slice(0, 30) || "-"] = (incSrc[t.description?.slice(0, 30) || "-"] || 0) + a; }
    else if (t.tx_type === "expense") { exp += a; const c = t.category_name || "Lainnya"; cats[c] = (cats[c] || 0) + a; topExp.push(t); }
  }
  topExp.sort((a, b) => Number(b.amount_idr) - Number(a.amount_idr));
  const banks = acc.filter((a) => a.type === "bank" && a.currency === "IDR" && Number(a.current_balance) > 0).sort((a, b) => b.current_balance - a.current_balance);
  const ccs = acc.filter((a) => a.type === "credit_card" && Number(a.outstanding_amount) > 0).sort((a, b) => b.outstanding_amount - a.outstanding_amount);
  const rpn = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>${c}</td><td class="r">${rpn(v)}</td><td class="r">${exp ? Math.round(v / exp * 100) : 0}%</td></tr>`).join("");
  const html = `<meta charset="utf-8"><title>Laporan ${label}</title><style>
  body{font-family:-apple-system,Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px;max-width:720px;margin:auto}
  h1{font-size:22px}h2{font-size:15px;color:#94a3b8;margin:28px 0 8px;text-transform:uppercase;letter-spacing:.05em}
  .kpi{display:flex;gap:12px;flex-wrap:wrap}.kpi div{background:#1e293b;border-radius:12px;padding:14px 18px;flex:1;min-width:140px}
  .kpi b{display:block;font-size:19px;margin-top:4px}.g{color:#4ade80}.r2{color:#f87171}
  table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:12px;overflow:hidden}
  td,th{padding:8px 12px;border-bottom:1px solid #334155;font-size:13px;text-align:left}.r{text-align:right}
  </style>
  <h1>📊 Laporan Keuangan — ${label}</h1>
  <div class="kpi"><div>Income<b class="g">${rpn(inc)}</b></div><div>Expense<b class="r2">${rpn(exp)}</b></div><div>Net<b class="${inc - exp >= 0 ? "g" : "r2"}">${rpn(inc - exp)}</b></div></div>
  <h2>Pengeluaran per kategori</h2><table>${catRows}</table>
  <h2>Top 15 pengeluaran</h2><table>${topExp.slice(0, 15).map((t) => `<tr><td>${t.tx_date.slice(5)}</td><td>${(t.merchant_name || t.description || "-").slice(0, 38)}</td><td class="r">${rpn(Number(t.amount_idr))}</td></tr>`).join("")}</table>
  <h2>Income</h2><table>${Object.entries(incSrc).sort((a, b) => b[1] - a[1]).map(([d, v]) => `<tr><td>${d}</td><td class="r">${rpn(v)}</td></tr>`).join("")}</table>
  <h2>Saldo bank saat ini</h2><table>${banks.map((a) => `<tr><td>${a.name}</td><td class="r">${rpn(Number(a.current_balance))}</td></tr>`).join("")}</table>
  <h2>Tagihan kartu saat ini</h2><table>${ccs.map((a) => `<tr><td>${a.name}</td><td class="r">${rpn(Number(a.outstanding_amount))}</td></tr>`).join("")}</table>
  <p style="color:#64748b;font-size:12px">Dibuat otomatis oleh Ryūsei 隆盛 · P&amp;L tidak termasuk transfer/pay_cc/reimburse/aset</p>`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("document", new Blob([html], { type: "text/html" }), `Laporan-${start.slice(0, 7)}.html`);
  form.append("caption", `📊 Laporan ${label} — buka di browser`);
  const r = await fetch(`${TELEGRAM_API}/bot${token}/sendDocument`, { method: "POST", body: form });
  const jr = await r.json();
  if (!jr.ok) await sendTelegramHTML(token, chatId, "❌ Gagal kirim laporan: " + esc(jr.description || "error"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTER: pending email_sync -> ledger (typed correctly), then hide from app.
// Type is derived from the RESOLVED destination account (statement-of-truth), not the
// AI's suggested label: to=credit_card => pay_cc, to=liability => pay_liability,
// bank->bank => transfer (double legs merged), else expense/income.
// ═══════════════════════════════════════════════════════════════════════════════

const DAYMS = 86400000;
const dnum = (d: string) => new Date((d || "2026-01-01") + "T00:00:00Z").getTime();
// issuer/brand -> card_last4 (for unresolved to-side): Mayapada issues Skorcard
const ISSUER_CARD: Array<[RegExp, string]> = [[/mayapada|skorcard/i, "2362"]];

async function recalcAccountEdge(supabase: any, uid: string, acc: any) {
  const { data: txns } = await supabase.from("ledger")
    .select("tx_type, amount, amount_idr, from_id, from_type, to_id, to_type")
    .eq("user_id", uid).or(`from_id.eq.${acc.id},to_id.eq.${acc.id}`);
  const isForeign = acc.currency && acc.currency !== "IDR";
  const amtOf = (tx: any) => isForeign ? Number(tx.amount || tx.amount_idr || 0) : Number(tx.amount_idr || tx.amount || 0);
  if (acc.type === "credit_card") {
    let ch = 0, pa = 0;
    for (const tx of txns || []) {
      const a = Number(tx.amount_idr || tx.amount || 0);
      if (tx.from_id === acc.id && tx.from_type === "account") ch += a;
      if (tx.to_id === acc.id && tx.to_type === "account") pa += a;
    }
    const net = Number(acc.initial_balance || 0) + ch - pa;
    await supabase.from("accounts").update({ outstanding_amount: net > 0 ? net : 0, current_balance: net < 0 ? -net : 0 }).eq("id", acc.id);
    return;
  }
  if (acc.type === "liability") {
    let out = Number(acc.initial_balance || 0);
    for (const tx of txns || []) {
      const a = amtOf(tx);
      if (tx.from_id === acc.id && tx.from_type === "account") out += a;
      if (tx.to_id === acc.id && tx.to_type === "account") out -= a;
    }
    await supabase.from("accounts").update({ outstanding_amount: out }).eq("id", acc.id);
    return;
  }
  const field = acc.type === "asset" ? "current_value" : acc.type === "receivable" ? "receivable_outstanding" : "current_balance";
  let bal = Number(acc.initial_balance || 0);
  for (const tx of txns || []) {
    const a = amtOf(tx);
    if (tx.to_id === acc.id && tx.to_type === "account") bal += a;
    if (tx.from_id === acc.id && tx.from_type === "account") bal -= a;
  }
  await supabase.from("accounts").update({ [field]: bal }).eq("id", acc.id);
}

async function importPending(supabase: any, uid: string): Promise<string> {
  const { data: accountsRaw } = await supabase.from("accounts").select("*").eq("user_id", uid);
  const accounts = (accountsRaw || []).filter((a: any) => a.is_active !== false);
  const byId: Record<string, any> = Object.fromEntries(accounts.map((a: any) => [a.id, a]));
  const byL4: Record<string, any> = Object.fromEntries(accounts.filter((a: any) => a.card_last4).map((a: any) => [a.card_last4, a]));
  const { data: rows } = await supabase.from("email_sync").select("id, ai_raw_result").eq("user_id", uid).eq("status", "pending");
  const { data: cats } = await supabase.from("expense_categories").select("id,name").or(`user_id.is.null,user_id.eq.${uid}`);
  const catId = (n: string | null) => (cats || []).find((c: any) => c.name === n)?.id || (cats || []).find((c: any) => c.name === "Other")?.id || null;
  const { data: srcs } = await supabase.from("income_sources").select("id,name");
  const { data: mmaps } = await supabase.from("merchant_mappings").select("merchant_name, category_name").eq("user_id", uid);
  const nrmM = (x: any) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const mapCat = (desc: string): string | null => {
    const nd = nrmM(desc);
    const hit = (mmaps || []).filter((m: any) => { const n = nrmM(m.merchant_name); return n.length >= 4 && (nd.includes(n) || n.includes(nd.slice(0, 10))); })
      .sort((a: any, b: any) => nrmM(b.merchant_name).length - nrmM(a.merchant_name).length)[0];
    return hit?.category_name || null;
  };
  const srcId = (n: string) => ((srcs || []).find((s: any) => s.name === n) || (srcs || []).find((s: any) => s.name === "Other Income"))?.id;

  type Item = { esId: string; idx: number; t: any; res?: any; drop?: string; dupInfo?: string; skippedByUser?: boolean };
  const items: Item[] = [];
  for (const r of rows || []) {
    let arr: any = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
    (Array.isArray(arr) ? arr : []).forEach((t: any, idx: number) => { if (!t._imported && !t._skipped) items.push({ esId: r.id, idx, t, skippedByUser: false }); });
  }
  if (!items.length) return "📭 Tidak ada transaksi pending.";

  const today = ymd(jakartaNow());
  // 1) resolve + reclassify
  for (const it of items) {
    const t = it.t;
    if (t.currency && t.currency !== "IDR") { it.drop = "valas"; continue; }
    const amt = Math.round(Number(t.amount_idr ?? t.amount ?? 0));
    if (!amt || amt <= 0) { it.drop = "no-amount"; continue; }
    const fromA = byId[t.from_account_id]; let toA = byId[t.to_account_id];
    if (!toA) {
      const hay = `${t.to_bank_name || ""} ${t.merchant_name || ""} ${t.description || ""}`;
      for (const [re, l4] of ISSUER_CARD) if (re.test(hay) && byL4[l4]) { toA = byL4[l4]; break; }
    }
    const date = (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) ? t.date : today;
    const desc = String(t.merchant_name || t.description || "-").slice(0, 80);
    let ty: string;
    if (toA?.type === "credit_card") ty = "pay_cc";
    else if (toA?.type === "liability") ty = "pay_liability";
    else if (t.suggested_tx_type === "collect_loan" && (toA || fromA)) ty = "collect_loan";
    else if (fromA && toA) ty = "transfer";
    else if ((t.suggested_tx_type === "income" || t.type === "in") && (toA || fromA)) ty = "income";
    else if (t.suggested_tx_type === "reimburse_out" && fromA) ty = "reimburse_out";
    else if (fromA) ty = "expense";
    else { it.drop = "no-account"; continue; }
    it.res = { ty, amt, date, fromA, toA, desc, cat: t.suggested_category || null, entity: t.suggested_entity || "Personal" };
  }

  const live = items.filter((i) => i.res && !i.drop);
  // 2) merge pay_cc double legs: card-side notif (from=card, is_cc_payment) + bank-side notif same amount
  for (const a of live) {
    if (a.drop || !a.res) continue;
    if (a.res.fromA?.type === "credit_card" && a.t.is_cc_payment) {
      const b = live.find((x) => x !== a && !x.drop && x.res && x.res.fromA?.type === "bank" && x.t.is_cc_payment && x.res.amt === a.res.amt && Math.abs(dnum(x.res.date) - dnum(a.res.date)) <= 2 * DAYMS);
      if (b) { b.res.ty = "pay_cc"; b.res.toA = a.res.fromA; b.res.desc = "Bayar CC " + a.res.fromA.name; a.drop = "merged-leg"; }
    }
  }
  // 3) merge transfer double legs (same amount + same account pair)
  const seenTf = new Set<string>();
  for (const it of live) {
    if (it.drop || !it.res || it.res.ty !== "transfer") continue;
    const key = it.res.amt + "|" + [it.res.fromA?.id, it.res.toA?.id].sort().join("~");
    if (seenTf.has(key)) it.drop = "merged-leg"; else seenTf.add(key);
  }
  // 4) dedup vs existing ledger. Exact amount + shares an account, PLUS:
  //    same-day always counts as dup; ±3d only if the description/merchant also matches
  //    (so recurring same-amount txns like daily Grab 9.000 are NOT wrongly rejected).
  const norm = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const descMatch = (a: any, b: any) => { const x = norm(a), y = norm(b); if (!x || !y) return false; return x.includes(y.slice(0, 8)) || y.includes(x.slice(0, 8)); };
  const { data: led } = await supabase.from("ledger").select("amount_idr, tx_date, from_id, to_id, description").eq("user_id", uid).gte("tx_date", "2026-06-15");
  for (const it of live) {
    if (it.drop || !it.res) continue; const r = it.res;
    const dup = (led || []).find((L: any) => {
      if (Math.round(Number(L.amount_idr || 0)) !== r.amt) return false;
      if (!(L.from_id === r.fromA?.id || L.to_id === r.toA?.id || L.to_id === r.fromA?.id)) return false;
      const dd = Math.abs(dnum(L.tx_date) - dnum(r.date));
      if (dd === 0) return true;                                  // same day, same amount, same account = dup
      return dd <= 3 * DAYMS && descMatch(L.description, r.desc); // near-day needs matching description too
    });
    if (dup) { it.drop = "dup-ledger"; it.dupInfo = `${r.desc} — ${idr(r.amt)} (sudah ada ${dup.tx_date})`; }
  }

  // 5) build inserts
  const INCOME_SRC = ["Salary", "Dividend", "Freelance", "Rental Income", "Bank Interest", "Cashback"];
  const PIU: Record<string, string> = {};
  for (const a of accounts) if (a.type === "receivable" && a.entity) PIU[a.entity] = a.id;
  const ins: any[] = []; const counts: Record<string, number> = {}; let totalAmt = 0;
  const handled = new Set<Item>();
  for (const it of live) {
    if (it.drop === "merged-leg") { handled.add(it); continue; }
    if (it.drop) continue;
    const r = it.res; handled.add(it);
    const base = { user_id: uid, tx_date: r.date, amount: r.amt, amount_idr: r.amt, currency: "IDR", description: r.desc, source: "telegram_import" };
    if (r.ty === "collect_loan") {
      // match employee loan by counterparty name; if none, hold it (never guess)
      const { data: loans } = await supabase.from("employee_loans").select("id, employee_name, paid_months").eq("user_id", uid);
      const nm = norm(r.desc);
      const loan = (loans || []).find((l: any) => nm.includes(norm(l.employee_name).slice(0, 5)));
      if (!loan) { it.drop = "no-account"; handled.delete(it); continue; }
      ins.push({ ...base, tx_type: "collect_loan", from_type: "employee_loan", from_id: null, employee_loan_id: loan.id, to_type: "account", to_id: (r.toA || r.fromA).id, description: "Cicilan " + loan.employee_name });
      await supabase.from("employee_loans").update({ paid_months: (loan.paid_months || 0) + 1 }).eq("id", loan.id);
    } else if (r.ty === "pay_cc" || r.ty === "pay_liability" || r.ty === "transfer") {
      ins.push({ ...base, tx_type: r.ty, from_type: "account", from_id: r.fromA.id, to_type: "account", to_id: r.toA.id, description: r.ty === "pay_cc" ? "Bayar CC " + r.toA.name : r.ty === "pay_liability" ? "Bayar " + r.toA.name : r.desc });
    } else if (r.ty === "income") {
      ins.push({ ...base, tx_type: "income", from_type: "income_source", from_id: srcId(INCOME_SRC.includes(r.cat) ? r.cat : "Other Income"), to_type: "account", to_id: (r.toA || r.fromA).id });
    } else if (r.ty === "reimburse_out" && PIU[r.entity]) {
      ins.push({ ...base, tx_type: "reimburse_out", from_type: "account", from_id: r.fromA.id, to_type: "account", to_id: PIU[r.entity], entity: r.entity, is_reimburse: true });
    } else {
      const finalCat = mapCat(r.desc) || r.cat || "Other";
      ins.push({ ...base, tx_type: "expense", from_type: "account", from_id: r.fromA.id, to_type: "expense", to_id: null, category_id: catId(finalCat), category_name: finalCat, entity: "Personal" });
    }
    counts[r.ty] = (counts[r.ty] || 0) + 1; totalAmt += r.amt;
  }
  if (ins.length) { const { error } = await supabase.from("ledger").insert(ins); if (error) throw new Error("insert: " + error.message); }

  // 6) recalc affected accounts
  const affected = new Set<string>();
  for (const it of handled) { const r = it.res; if (!r) continue; if (r.fromA) affected.add(r.fromA.id); if (r.toA && byId[r.toA.id]) affected.add(r.toA.id); }
  for (const id of affected) if (byId[id]) await recalcAccountEdge(supabase, uid, byId[id]);

  // 7) mark items imported; row disappears from the app's pending list when all its items are done
  const byRow: Record<string, Item[]> = {};
  for (const it of items) (byRow[it.esId] ||= []).push(it);
  for (const [esId, list] of Object.entries(byRow)) {
    const row = (rows || []).find((r: any) => r.id === esId); if (!row) continue;
    let arr: any = row.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { continue; }
    if (!Array.isArray(arr)) continue;
    let all = true, impCount = 0;
    for (const it of list) {
      const done = handled.has(it) || it.drop === "dup-ledger";
      if (done) { arr[it.idx]._imported = true; impCount++; } else all = false;
    }
    await supabase.from("email_sync").update({ ai_raw_result: arr, status: all ? "imported" : "pending", imported_count: impCount }).eq("id", esId);
  }

  // rows whose every item is already imported/skipped (none made it into `items`) → clear from app too
  const liveRowIds = new Set(items.map((i) => i.esId));
  for (const r of rows || []) {
    if (liveRowIds.has(r.id)) continue;
    let arr: any = r.ai_raw_result; try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { continue; }
    if (Array.isArray(arr) && arr.length && arr.every((t: any) => t._imported || t._skipped)) {
      await supabase.from("email_sync").update({ status: "imported" }).eq("id", r.id);
    }
  }

  const parts = Object.entries(counts).map(([k, v]) => `${v}× ${k}`).join(" · ") || "-";
  const dupList = items.filter((i) => i.drop === "dup-ledger");
  const left = items.filter((i) => i.drop === "no-account" || i.drop === "valas").length;
  let dupTxt = "";
  if (dupList.length) {
    dupTxt = `\n↩️ <b>${dupList.length} DITOLAK — duplikat, sudah ada di ledger:</b>\n`;
    for (const d of dupList.slice(0, 8)) dupTxt += `• ${esc(d.dupInfo || "")}\n`;
    if (dupList.length > 8) dupTxt += `… +${dupList.length - 8} lagi\n`;
  }
  return `✅ <b>Imported ${ins.length} transaksi ke ledger</b>\n${parts}\nTotal ${idr(totalAmt)}\n` + dupTxt +
    (left ? `⚠️ ${left} tertahan (akun tak dikenal / valas) — cek di app\n` : "") +
    `🧹 Pending di app sudah dibersihkan. Cek /saldo & /cc.`;
}

// ── Investment reconcile: compare Mac-parsed values vs app assets, alert with confirm buttons ──
async function handleInvestSync(values: any[], token: string, supabase: any, uid: string, chatId: number) {
  const { data: assets } = await supabase.from("accounts").select("id, name, current_value").eq("user_id", uid).eq("type", "asset");
  const nrm = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  let flagged = 0; const okList: string[] = [];
  for (const v of values) {
    const val = Math.round(Number(v.value) || 0); if (!val) continue;
    const a = (assets || []).find((x: any) => nrm(x.name).includes(nrm(v.name).slice(0, 5)) || nrm(v.name).includes(nrm(x.name).slice(0, 5)));
    if (!a) { okList.push(`❓ ${esc(v.name)} ${idr(val)} (akun app ga ketemu)`); continue; }
    const diff = val - Number(a.current_value || 0);
    if (Math.abs(diff) <= 100000) { okList.push(`✅ ${esc(a.name)} cocok (${idr(val)})`); continue; }
    flagged++;
    const kb = [[
      { text: `✅ Update ke ${idr(val)}`, callback_data: `iset:${a.id}:${val}` },
      { text: "⏭ Skip", callback_data: `iskip:${a.id}` },
    ]];
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", reply_markup: { inline_keyboard: kb },
        text: `📊 <b>${esc(a.name)}</b> beda${v.date ? " (per " + esc(v.date) + ")" : ""}\nApp: <b>${idr(a.current_value)}</b>\nStatement: <b>${idr(val)}</b>\nSelisih: <b>${diff > 0 ? "+" : ""}${idr(diff)}</b>` }),
    });
  }
  if (flagged === 0) await sendTelegramHTML(token, chatId, `📊 <b>Investasi dicek</b> — semua cocok ✅\n${okList.slice(0, 12).join("\n")}`);
  return { flagged, checked: values.length };
}

// ── /trend: P&L 4 bulan terakhir + net worth sekarang ──
async function cmdTrend(supabase: any, uid: string): Promise<string> {
  const now = jakartaNow();
  const months: { y: number; m: number }[] = [];
  for (let i = 3; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() }); }
  const start = `${months[0].y}-${String(months[0].m + 1).padStart(2, "0")}-01`;
  const { data: led } = await supabase.from("ledger").select("tx_date, tx_type, amount_idr").eq("user_id", uid).gte("tx_date", start);
  const agg: Record<string, { inc: number; exp: number }> = {};
  for (const t of led || []) {
    const key = t.tx_date.slice(0, 7); agg[key] = agg[key] || { inc: 0, exp: 0 };
    if (t.tx_type === "income") agg[key].inc += Number(t.amount_idr) || 0;
    else if (t.tx_type === "expense") agg[key].exp += Number(t.amount_idr) || 0;
  }
  let out = "📈 <b>TREND 4 BULAN</b> <i>(income − expense)</i>\n";
  for (const mm of months) {
    const key = `${mm.y}-${String(mm.m + 1).padStart(2, "0")}`;
    const a = agg[key] || { inc: 0, exp: 0 }; const net = a.inc - a.exp;
    out += `\n<b>${ID_MONTHS[mm.m]} ${mm.y}</b>\nIn ${idr(a.inc)} · Out ${idr(a.exp)}\nNet: <b>${net >= 0 ? "+" : ""}${idr(net)}</b>\n`;
  }
  // net worth sekarang
  const acc = await getActiveAccounts(supabase, uid);
  const nw = acc.filter((a) => a.type === "bank" && a.currency === "IDR").reduce((s, a) => s + (Number(a.current_balance) || 0), 0)
    + acc.filter((a) => a.type === "asset" && a.include_networth !== false).reduce((s, a) => s + (Number(a.current_value) || 0), 0)
    - acc.filter((a) => a.type === "credit_card").reduce((s, a) => s + (Number(a.outstanding_amount) || 0), 0)
    - acc.filter((a) => a.type === "liability").reduce((s, a) => s + (Number(a.outstanding_amount) || 0), 0);
  out += `\n━━━━━━━━━━━━━━━\n💎 Net worth sekarang: <b>${idr(nw)}</b>`;
  return out;
}

// ── /cek: health-check keuangan (anomali) ──
async function cmdCek(supabase: any, uid: string): Promise<string> {
  const acc = await getActiveAccounts(supabase, uid);
  const nm: Record<string, string> = Object.fromEntries(acc.map((a: any) => [a.id, a.name]));
  const issues: string[] = [];

  // 1. saldo bank minus
  for (const a of acc.filter((x: any) => x.type === "bank" && Number(x.current_balance) < -1000)) {
    issues.push(`🔴 Saldo minus: <b>${esc(a.name)}</b> ${idr(a.current_balance)}`);
  }
  // 2. CC / liability minus (outstanding negatif = kelebihan bayar, biasanya ok tapi flag besar)
  for (const a of acc.filter((x: any) => x.type === "credit_card" && Number(x.outstanding_amount) < -1000)) {
    issues.push(`🟡 Kartu saldo kredit: <b>${esc(a.name)}</b> ${idr(a.outstanding_amount)}`);
  }
  // 3. transaksi dobel (amount+tx_date+from+to sama persis, 90 hari terakhir)
  const since = ymd(new Date(Date.now() - 90 * 86400000));
  const { data: led } = await supabase.from("ledger").select("id, tx_date, amount_idr, tx_type, from_id, to_id, description").eq("user_id", uid).gte("tx_date", since).neq("tx_type", "opening_balance");
  const seen: Record<string, any> = {}; const dups: any[] = [];
  const nrmD = (x: any) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const DUP_TYPES = new Set(["expense", "reimburse_out", "reimburse_in", "income", "buy_asset"]);
  const RECUR = /notifikasi|stamp|materai|reimbursable|iuran|biaya|admin|interest|bunga|cashback/i;
  for (const r of led || []) {
    if (Number(r.amount_idr) < 50000) continue;           // tiny fees off
    if (!DUP_TYPES.has(r.tx_type)) continue;               // pay_cc/transfer repeats are legit
    if (RECUR.test(r.description || "")) continue;         // recurring fees/loss off
    const k = `${Math.round(r.amount_idr)}|${r.tx_date}|${r.from_id || "-"}|${r.to_id || "-"}|${nrmD(r.description).slice(0, 12)}`;
    if (seen[k]) dups.push({ a: seen[k], b: r }); else seen[k] = r;
  }
  if (dups.length) {
    issues.push(`🟠 <b>${dups.length} kemungkinan transaksi DOBEL:</b>`);
    for (const d of dups.slice(0, 6)) issues.push(`   • ${esc((d.b.description || "-").slice(0, 24))} ${idr(d.b.amount_idr)} (${d.b.tx_date})`);
  }
  // 4. settlement pincang (out 0 / in 0)
  const { data: sts } = await supabase.from("reimburse_settlements").select("id, entity, total_out, total_in, settled_at").eq("user_id", uid);
  const lame = (sts || []).filter((s: any) => (Number(s.total_out) === 0) !== (Number(s.total_in) === 0));
  if (lame.length) issues.push(`🟠 <b>${lame.length} settlement pincang</b> (satu sisi kosong) — cek halaman Receivables`);
  // 5. transaksi jumbo (>50jt) 14 hari terakhir → info, bukan error
  const since2 = ymd(new Date(Date.now() - 14 * 86400000));
  const jumbo = (led || []).filter((r: any) => Number(r.amount_idr) >= 50000000 && r.tx_date >= since2 && ["expense", "reimburse_out"].includes(r.tx_type));

  let out = "🩺 <b>HEALTH CHECK</b>\n";
  if (!issues.length) out += "\n✅ Semua sehat — ga ada anomali kedeteksi.\n";
  else out += "\n" + issues.join("\n") + "\n";
  if (jumbo.length) out += `\nℹ️ ${jumbo.length} transaksi jumbo (≥50jt) 14 hari terakhir — normal? cek: ${jumbo.slice(0, 3).map((r: any) => esc((r.description || "-").slice(0, 14)) + " " + idr(r.amount_idr)).join(", ")}`;
  out += `\n<i>Cek ${(led || []).length} transaksi (90 hari).</i>`;
  return out;
}

// ── AI Q&A over Paulus's finances (free-text questions) ──
function looksLikeQuestion(t: string): boolean {
  const s = t.trim();
  if (/\?\s*$/.test(s)) return true;
  if (/\b(grafik|chart|visualisasi|diagram|trend|tren)\b/i.test(s)) return true;
  return /^(berapa|brp|apa|apakah|kapan|gimana|gmn|bagaimana|kenapa|napa|mengapa|list|tampilkan|show|lihat|liat|total|sisa|siapa|mana|dimana|di ?mana|ada berapa|hitung|jelas|cek|status|net ?worth|worth|abis|abisin|habis|pengeluaran|pemasukan|income|expense|saldo|hutang|piutang|udah|sudah|kenapa)\b/i.test(s);
}

async function callClaudeAnswerText(apiKey: string, prompt: string): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await resp.json();
  if (!resp.ok) { console.error("[telegram-webhook] Q&A API error:", data); throw new Error(data.error?.message || "AI error"); }
  return (((data.content || []).find((b: any) => b.type === "text")?.text) || "(kosong)").trim();
}

async function buildFinancialContext(supabase: any, uid: string): Promise<string> {
  const acc = await getActiveAccounts(supabase, uid);
  const banksIDR = acc.filter((a) => a.type === "bank" && a.currency === "IDR" && Math.abs(Number(a.current_balance) || 0) > 0);
  const cc = acc.filter((a) => a.type === "credit_card" && Number(a.outstanding_amount) > 0);
  const assets = acc.filter((a) => a.type === "asset" && a.include_networth !== false && Number(a.current_value) > 0);
  const liab = acc.filter((a) => a.type === "liability");
  const sumBank = banksIDR.reduce((s, a) => s + (Number(a.current_balance) || 0), 0);
  const sumCC = cc.reduce((s, a) => s + (Number(a.outstanding_amount) || 0), 0);
  const sumAsset = assets.reduce((s, a) => s + (Number(a.current_value) || 0), 0);
  const sumLiab = liab.reduce((s, a) => s + (Number(a.outstanding_amount) || 0), 0);

  // this month P&L + top categories
  const now = jakartaNow();
  const start = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const { data: mLed } = await supabase.from("ledger").select("tx_type, amount_idr, category_name, entity").eq("user_id", uid).gte("tx_date", start).lte("tx_date", ymd(now));
  let inc = 0, exp = 0; const cats: Record<string, number> = {};
  for (const t of mLed || []) { const a = Number(t.amount_idr) || 0; if (t.tx_type === "income") inc += a; else if (t.tx_type === "expense") { exp += a; const c = t.category_name || "Lainnya"; cats[c] = (cats[c] || 0) + a; } }
  const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, v]) => `${c} ${idr(v)}`).join(", ");

  // reimburse per entity
  const { data: rLed } = await supabase.from("ledger").select("tx_type, amount_idr, entity").eq("user_id", uid).in("tx_type", ["reimburse_out", "reimburse_in"]);
  const ent: Record<string, { out: number; in: number }> = {};
  for (const e of rLed || []) { const k = e.entity || "?"; ent[k] = ent[k] || { out: 0, in: 0 }; if (e.tx_type === "reimburse_out") ent[k].out += Number(e.amount_idr) || 0; else ent[k].in += Number(e.amount_idr) || 0; }

  const L: string[] = [];
  L.push(`NET WORTH: ${idr(sumBank + sumAsset - sumCC - sumLiab)} (bank ${idr(sumBank)} + investasi ${idr(sumAsset)} - kartu kredit ${idr(sumCC)} - hutang ${idr(sumLiab)})`);
  L.push(`BANK (IDR): ${banksIDR.map((a) => `${a.name} ${idr(a.current_balance)}`).join(", ")}`);
  L.push(`KARTU KREDIT (outstanding, due): ${cc.map((a) => `${a.name} ${idr(a.outstanding_amount)}${a.due_day ? " (tgl" + a.due_day + ")" : ""}`).join(", ")}`);
  L.push(`INVESTASI: ${assets.map((a) => `${a.name} ${idr(a.current_value)}`).join(", ")}`);
  L.push(`HUTANG/LIABILITAS: ${liab.map((a) => `${a.name} ${idr(a.outstanding_amount)}${a.monthly_installment ? " cicilan " + idr(a.monthly_installment) + "/bln" : ""}`).join(", ") || "-"}`);
  L.push(`BULAN INI (${ID_MONTHS[now.getUTCMonth()]}): income ${idr(inc)}, expense ${idr(exp)}, net ${idr(inc - exp)}. Top kategori: ${topCats || "-"}`);
  L.push(`REIMBURSE (talangin-dibalikin=sisa): ${Object.entries(ent).map(([k, v]) => `${k} ${idr(v.out - v.in)}`).join(", ")}`);
  return L.join("\n");
}

// ── AGENTIC Q&A (Tier A): Claude queries the ledger via tools, DB does the math ──
const QA_TOOLS = [
  {
    name: "aggregate_transactions",
    description: "Jumlahkan/hitung transaksi dengan filter. Pakai untuk 'berapa total ...' (mis. total pengeluaran Travel Juni, total makan tahun ini). Balikin grand_total + rincian per group. group_by bisa category/month/entity/tx_type.",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string", description: "YYYY-MM-DD (opsional)" },
        date_to:   { type: "string", description: "YYYY-MM-DD (opsional)" },
        tx_types:  { type: "array", items: { type: "string" }, description: "mis. ['expense'] / ['reimburse_out']. Kosong = semua." },
        category:  { type: "string", description: "nama kategori partial, mis. 'Travel','Food'" },
        entity:    { type: "string", description: "'Hamasa','SDC','Travelio','Personal'" },
        search:    { type: "string", description: "kata kunci di deskripsi/merchant, mis. 'grab','tokyo'" },
        group_by:  { type: "string", enum: ["none", "category", "month", "entity", "tx_type"] },
        metric:    { type: "string", enum: ["sum", "count", "avg"] },
      },
    },
  },
  {
    name: "list_transactions",
    description: "Ambil daftar transaksi detail dengan filter. Pakai untuk 'transaksi apa aja / terbesar'. order: date|amount.",
    input_schema: {
      type: "object",
      properties: {
        date_from: { type: "string" }, date_to: { type: "string" },
        tx_types: { type: "array", items: { type: "string" } },
        category: { type: "string" }, entity: { type: "string" }, search: { type: "string" },
        min_amount: { type: "number" }, order: { type: "string", enum: ["date", "amount"] },
        limit: { type: "number", description: "default 30, max 80" },
      },
    },
  },
  {
    name: "get_summary",
    description: "Ringkasan: net worth, saldo bank, kartu kredit + jatuh tempo, investasi, hutang, P&L bulan ini, reimburse per entity. Pakai untuk saldo/net worth/hutang/investasi.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "render_chart",
    description: "Kirim GRAFIK ke user. Pakai kalau user minta 'grafik/chart/visualisasi/diagram'. Agregasi datanya dulu (aggregate_transactions), lalu panggil ini dengan labels + values yang sudah jadi. bar=perbandingan, line=trend waktu, pie/doughnut=proporsi.",
    input_schema: {
      type: "object",
      properties: {
        chart_type: { type: "string", enum: ["bar", "line", "pie", "doughnut"] },
        title: { type: "string", description: "judul grafik" },
        labels: { type: "array", items: { type: "string" }, description: "label sumbu-x / kategori" },
        values: { type: "array", items: { type: "number" }, description: "nilai (Rupiah), urut sama dengan labels" },
      },
      required: ["chart_type", "labels", "values"],
    },
  },
];

async function agentFetchLedger(supabase: any, uid: string, f: any): Promise<any[]> {
  let q = supabase.from("ledger")
    .select("tx_date, tx_type, amount_idr, description, merchant_name, category_name, entity")
    .eq("user_id", uid).neq("tx_type", "opening_balance");
  if (f.date_from) q = q.gte("tx_date", f.date_from);
  if (f.date_to)   q = q.lte("tx_date", f.date_to);
  if (Array.isArray(f.tx_types) && f.tx_types.length) q = q.in("tx_type", f.tx_types);
  if (f.entity)    q = q.eq("entity", f.entity);
  if (f.category)  q = q.ilike("category_name", `%${f.category}%`);
  q = q.limit(6000);
  const { data } = await q;
  let rows: any[] = data || [];
  if (f.search) {
    const s = String(f.search).toLowerCase();
    rows = rows.filter((r) => `${r.description || ""} ${r.merchant_name || ""} ${r.category_name || ""} ${r.entity || ""}`.toLowerCase().includes(s));
  }
  if (f.min_amount) rows = rows.filter((r) => Number(r.amount_idr) >= Number(f.min_amount));
  return rows;
}

async function runAgentTool(name: string, input: any, supabase: any, uid: string): Promise<any> {
  if (name === "get_summary") return { summary: await buildFinancialContext(supabase, uid) };
  if (name === "aggregate_transactions") {
    const rows = await agentFetchLedger(supabase, uid, input || {});
    const metric = input?.metric || "sum";
    const gb = input?.group_by || "none";
    const keyOf = (r: any) => gb === "category" ? (r.category_name || "Lainnya")
      : gb === "entity" ? (r.entity || "Personal")
      : gb === "month" ? String(r.tx_date).slice(0, 7)
      : gb === "tx_type" ? r.tx_type : "total";
    const groups: Record<string, { sum: number; count: number }> = {};
    for (const r of rows) { const k = keyOf(r); groups[k] = groups[k] || { sum: 0, count: 0 }; groups[k].sum += Number(r.amount_idr) || 0; groups[k].count++; }
    const val = (g: any) => metric === "count" ? g.count : metric === "avg" ? Math.round(g.sum / (g.count || 1)) : Math.round(g.sum);
    const out = Object.entries(groups).map(([k, g]) => ({ group: k, value: val(g), count: g.count })).sort((a, b) => b.value - a.value).slice(0, 40);
    return { metric, group_by: gb, rows_scanned: rows.length, grand_total: Math.round(rows.reduce((s, r) => s + (Number(r.amount_idr) || 0), 0)), groups: out };
  }
  if (name === "list_transactions") {
    const rows = await agentFetchLedger(supabase, uid, input || {});
    rows.sort((a, b) => (input?.order === "amount")
      ? (Number(b.amount_idr) - Number(a.amount_idr))
      : String(b.tx_date).localeCompare(String(a.tx_date)));
    const lim = Math.min(Number(input?.limit) || 30, 80);
    return {
      count: rows.length,
      transactions: rows.slice(0, lim).map((r) => ({ date: r.tx_date, name: r.description || r.merchant_name || "-", category: r.category_name || null, entity: r.entity || "Personal", type: r.tx_type, amount: Math.round(Number(r.amount_idr) || 0) })),
    };
  }
  return { error: "unknown tool" };
}

async function callClaudeTools(apiKey: string, system: string, messages: any[], tools: any[]): Promise<any> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, system, tools, messages }),
  });
  const data = await resp.json();
  if (!resp.ok) { console.error("[telegram-webhook] Q&A tools error:", data); throw new Error(data.error?.message || "AI error"); }
  return data;
}

async function runAgentQA(text: string, apiKey: string, supabase: any, uid: string, botToken?: string, chatId?: number): Promise<{ answer: string; trace: any[] }> {
  const trace: any[] = [];
  const d = jakartaNow();
  const system = `Kamu asisten keuangan pribadi Paulus. Jawab bahasa Indonesia santai & ringkas, pakai format Rupiah (mis. Rp1.234.567). Hari ini ${d.getUTCDate()} ${ID_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} (tahun default 2026).

Kamu punya TOOLS untuk baca data keuangan Paulus dari database. SELALU pakai tool untuk dapat angka — JANGAN mengarang.
- "berapa total X" → aggregate_transactions (pakai group_by kalau perlu rincian).
- "transaksi apa aja / terbesar" → list_transactions.
- saldo / net worth / hutang / investasi → get_summary.

PENTING soal WAKTU: kata seperti "kemarin", "waktu itu", "tempo hari", "kmrn" sering berarti "baru-baru ini" — JANGAN diartikan harfiah tanggal kemarin. Kalau pencarian rentang sempit hasilnya KOSONG, LEBARKAN rentangnya (mis. 3-4 bulan terakhir, atau tanpa batas tanggal) SEBELUM menyimpulkan "tidak ada".

Untuk pertanyaan TRIP/PERJALANAN (mis. Jepang): panggil aggregate_transactions dengan category='Travel' TANPA batas tanggal sempit (atau 4 bulan terakhir, group_by='month') untuk lihat bulan mana ada Travel besar — itu tripnya. Boleh juga search 'tokyo'/'osaka'/'japan'/'jpn'. Jangan menyerah setelah 1 pencarian sempit.

Kalau user minta GRAFIK/chart/visualisasi: agregasi datanya (aggregate_transactions, mis. group_by month/category) lalu panggil render_chart dengan labels+values. Setelah grafik terkirim, kasih 1 kalimat ringkasan.

Kalau ada riwayat percakapan sebelumnya, pakai konteksnya (mis. "kalo bulan lalu?" = pertanyaan yang sama tapi bulan sebelumnya).

Setelah dapat data, jawab singkat & to-the-point (sebut periodenya, mis. "sekitar Juni"). Boleh <b>tebal</b> HTML (JANGAN markdown, JANGAN * atau #). Kalau benar-benar tidak ada data, baru bilang terus terang.`;

  // #5 multi-turn memory: load recent conversation (last ~25 min) for this chat
  let history: any[] = [];
  if (chatId) {
    try {
      const { data: mem } = await supabase.from("tg_chat_memory").select("turns, updated_at").eq("chat_id", chatId).maybeSingle();
      if (mem && mem.updated_at && (Date.now() - new Date(mem.updated_at).getTime() < 25 * 60 * 1000) && Array.isArray(mem.turns)) history = mem.turns;
    } catch { /* table may not exist yet — memory disabled gracefully */ }
  }
  const saveMemory = async (answer: string) => {
    if (!chatId) return;
    try {
      const turns = [...history, { role: "user", content: text }, { role: "assistant", content: answer }].slice(-6);
      await supabase.from("tg_chat_memory").upsert({ chat_id: chatId, turns, updated_at: new Date().toISOString() });
    } catch { /* noop */ }
  };

  const messages: any[] = [...history, { role: "user", content: text }];
  for (let i = 0; i < 6; i++) {
    const resp = await callClaudeTools(apiKey, system, messages, QA_TOOLS);
    trace.push({ iter: i, stop: resp.stop_reason, blocks: (resp.content || []).map((b: any) => b.type + (b.name ? ":" + b.name : "")) });
    if (resp.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: resp.content });
      const results: any[] = [];
      for (const block of resp.content || []) {
        if (block.type === "tool_use") {
          let out: any;
          try {
            if (block.name === "render_chart" && botToken && chatId) {
              const inp: any = block.input || {};
              const palette = ["#3b5bdb", "#0891b2", "#059669", "#d97706", "#7c3aed", "#e03131", "#0f766e", "#c026d3"];
              const isPie = ["pie", "doughnut"].includes(inp.chart_type);
              const cfg = {
                type: inp.chart_type || "bar",
                data: {
                  labels: inp.labels || [],
                  datasets: [{
                    label: inp.title || "",
                    data: inp.values || [],
                    backgroundColor: (inp.chart_type === "line") ? "rgba(59,91,219,0.15)" : (inp.labels || []).map((_: any, i: number) => palette[i % palette.length]),
                    borderColor: "#3b5bdb", borderWidth: 2, fill: inp.chart_type === "line", tension: 0.3,
                  }],
                },
                options: { plugins: { title: { display: !!inp.title, text: inp.title }, legend: { display: isPie } } },
              };
              await sendTelegramChart(botToken, chatId, cfg, inp.title ? `📊 <b>${esc(inp.title)}</b>` : "");
              out = { ok: true, note: "Grafik sudah dikirim ke user sebagai gambar. Beri 1 kalimat ringkasan." };
            } else {
              out = await runAgentTool(block.name, block.input || {}, supabase, uid);
            }
          }
          catch (e: any) { out = { error: String(e?.message || e) }; }
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out) });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    const answer = (((resp.content || []).find((b: any) => b.type === "text")?.text) || "(kosong)").trim();
    await saveMemory(answer);
    return { answer, trace };
  }
  return { answer: "⚠️ Kebanyakan langkah — coba pertanyaan lebih spesifik.", trace };
}

async function handleQuestion(text: string, apiKey: string, supabase: any, uid: string, botToken: string, chatId: number) {
  await sendTelegramHTML(botToken, chatId, "💭 <i>Sebentar...</i>");
  try {
    const { answer } = await runAgentQA(text, apiKey, supabase, uid, botToken, chatId);
    await sendTelegramHTML(botToken, chatId, answer);
  } catch (err: any) {
    console.error("[telegram-webhook] handleQuestion error:", err);
    await sendTelegramHTML(botToken, chatId, "❌ Gagal jawab: " + esc(err?.message || "error"));
  }
}
