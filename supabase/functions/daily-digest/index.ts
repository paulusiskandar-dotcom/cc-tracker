// Daily Digest → Telegram (21:00 WIB via cron).
// Summarizes the day's pending email-sync transactions as a monospace table and
// sends inline buttons so Paulus can confirm-all / open review — all from Telegram.
// Pairs with telegram-webhook (callback_query handler applies the taps).
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_AUTHORIZED_CHAT_ID, AUTHORIZED_USER_ID,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TG = "https://api.telegram.org";
const rp = (n: number) => "Rp" + Math.round(n).toLocaleString("id-ID");

async function sendTelegram(token: string, chatId: number, text: string, keyboard?: unknown) {
  const body: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
  };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  const r = await fetch(`${TG}/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

Deno.serve(async () => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const CHAT_ID      = Number(Deno.env.get("TELEGRAM_AUTHORIZED_CHAT_ID"));
  const USER_ID      = Deno.env.get("TELEGRAM_AUTHORIZED_USER_ID") || Deno.env.get("AUTHORIZED_USER_ID");
  if (!BOT_TOKEN || !CHAT_ID || !USER_ID) {
    return new Response(JSON.stringify({ error: "missing telegram/user secrets" }), { status: 500 });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Day window = last 24h (WIB ~ UTC+7; use 24h back for simplicity)
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: rows } = await sb.from("email_sync")
    .select("id, subject, sender_email, ai_raw_result, status, received_at")
    .eq("user_id", USER_ID).eq("status", "pending").gte("received_at", since)
    .order("received_at", { ascending: true });

  // Flatten extracted transactions from ai_raw_result
  type Tx = { desc: string; amount: number; dir: string; entity?: string; cat?: string; conf?: number; ambiguous?: boolean };
  const txs: Tx[] = [];
  for (const r of rows || []) {
    let arr: unknown = r.ai_raw_result;
    try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
    const list = Array.isArray(arr) ? arr : (arr as { transactions?: unknown[] })?.transactions;
    for (const t of (Array.isArray(list) ? list : [])) {
      const tx = t as Record<string, unknown>;
      const amt = Number(tx.amount_idr ?? tx.amount ?? 0);
      const dir = (tx.type === "in" || tx.type === "income") ? "in" : "out";
      const entity = (tx.suggested_entity as string) || "Personal";
      const cat = (tx.suggested_category as string) || (tx.suggested_tx_type as string) || "";
      const conf = Number(tx.confidence ?? 1);
      // ambiguous = low confidence, or an entity/reimburse decision Paulus should confirm
      const ambiguous = conf < 0.7 || /tokopedia|tokped/i.test(String(tx.merchant_name ?? tx.description ?? ""));
      txs.push({ desc: String(tx.merchant_name ?? tx.description ?? "-").slice(0, 18), amount: amt, dir, entity, cat, conf, ambiguous });
    }
  }

  const dateStr = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (!txs.length) {
    await sendTelegram(BOT_TOKEN, CHAT_ID, `📊 <b>CC Tracker — ${dateStr}</b>\n\nTidak ada transaksi baru hari ini. ✅`);
    return new Response(JSON.stringify({ ok: true, txs: 0 }));
  }

  const totIn  = txs.filter(t => t.dir === "in").reduce((s, t) => s + t.amount, 0);
  const totOut = txs.filter(t => t.dir === "out").reduce((s, t) => s + t.amount, 0);
  const amb = txs.filter(t => t.ambiguous);

  // Monospace table
  let table = "";
  for (const t of txs) {
    const mark = t.ambiguous ? "❓" : "✅";
    const amtS = rp(t.amount).padStart(12);
    table += `${mark} ${t.desc.padEnd(18)} ${amtS}\n`;
  }
  const msg =
    `📊 <b>CC Tracker — ${dateStr}</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `💰 Masuk  ${rp(totIn)}  (${txs.filter(t=>t.dir==="in").length})\n` +
    `💸 Keluar ${rp(totOut)}  (${txs.filter(t=>t.dir==="out").length})\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `<pre>${table}</pre>` +
    (amb.length ? `\n⚠️ ${amb.length} perlu keputusanmu (tap di bawah)` : `\n✅ Semua jelas — konfirmasi buat import`);

  // Inline buttons: confirm-all + review-in-app; (per-item classify handled by telegram-webhook callbacks)
  const keyboard = [
    [{ text: "✅ Import Semua", callback_data: "digest:import_all" }],
    ...(amb.length ? [[{ text: `❓ Review ${amb.length} ambigu`, callback_data: "digest:review" }]] : []),
    [{ text: "🌐 Buka App", url: "https://cc.paulusiskandar.com" }],
  ];
  const res = await sendTelegram(BOT_TOKEN, CHAT_ID, msg, keyboard);
  return new Response(JSON.stringify({ ok: true, txs: txs.length, ambiguous: amb.length, tg: res?.ok }));
});
