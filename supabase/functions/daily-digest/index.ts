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
  // Resolve accounts so we can show the TRUE type (destination=card => PAY CC, etc.)
  const { data: accRaw } = await sb.from("accounts").select("id, name, type, card_last4, is_active").eq("user_id", USER_ID);
  const accounts = (accRaw || []).filter((a: any) => a.is_active !== false);
  const byId: Record<string, any> = Object.fromEntries(accounts.map((a: any) => [a.id, a]));
  const byL4: Record<string, any> = Object.fromEntries(accounts.filter((a: any) => a.card_last4).map((a: any) => [a.card_last4, a]));
  const ISSUER_CARD: Array<[RegExp, string]> = [[/mayapada|skorcard/i, "2362"]];
  const dnum = (d: string) => new Date((d || "2026-01-01") + "T00:00:00Z").getTime();

  type Tx = { desc: string; amount: number; dir: string; ty: string; fromN?: string; toN?: string; entity?: string; cat?: string; ambiguous?: boolean; esId?: string; idx?: number; date?: string; fromType?: string; isCcPay?: boolean; _skip?: boolean; _no?: number };
  const txs: Tx[] = [];
  const rowArrays: Record<string, any[]> = {};   // keep parsed arrays to write _tg_no back
  for (const r of rows || []) {
    let arr: unknown = r.ai_raw_result;
    try { if (typeof arr === "string") arr = JSON.parse(arr); } catch { arr = null; }
    const list = Array.isArray(arr) ? arr : (arr as { transactions?: unknown[] })?.transactions;
    if (Array.isArray(arr)) rowArrays[r.id as string] = arr;
    (Array.isArray(list) ? list : []).forEach((t, idx) => {
      const tx = t as Record<string, unknown>;
      if (tx._imported || tx._skipped || tx._waiting_statement) return; // imported, rejected, or valas parked for statement
      const amt = Number(tx.amount_idr ?? tx.amount ?? 0);
      const dir = (tx.type === "in" || tx.type === "income") ? "in" : "out";
      const entity = (tx.suggested_entity as string) || "Personal";
      const cat = (tx.suggested_category as string) || "";
      const conf = Number(tx.confidence ?? 1);
      const fromA = byId[tx.from_account_id as string];
      let toA = byId[tx.to_account_id as string];
      if (!toA) { const hay = `${tx.to_bank_name || ""} ${tx.merchant_name || ""} ${tx.description || ""}`; for (const [re, l4] of ISSUER_CARD) if (re.test(hay) && byL4[l4]) { toA = byL4[l4]; break; } }
      let ty = "expense";
      if (toA?.type === "credit_card") ty = "pay_cc";
      else if (toA?.type === "liability") ty = "pay_liability";
      else if (fromA && toA) ty = "transfer";
      else if (dir === "in") ty = "income";
      const ambiguous = !(tx._tg_classified) && (conf < 0.7 || /tokopedia|tokped/i.test(String(tx.merchant_name ?? tx.description ?? "")));
      txs.push({ desc: String(tx.merchant_name ?? tx.description ?? "-").slice(0, 28), amount: amt, dir, ty, fromN: fromA?.name, toN: toA?.name, entity, cat, ambiguous, esId: r.id as string, idx, date: (tx.date as string) || "", fromType: fromA?.type, isCcPay: tx.is_cc_payment === true });
    });
  }
  // merge display legs: pay_cc card-side + bank-side same amount; transfer same amount+pair
  for (const a of txs) {
    if (a._skip) continue;
    if (a.fromType === "credit_card" && a.isCcPay) {
      const b = txs.find((x) => x !== a && !x._skip && x.fromType === "bank" && x.isCcPay && x.amount === a.amount);
      if (b) { b.ty = "pay_cc"; b.toN = a.fromN; a._skip = true; }
    }
  }
  const seenTf = new Set<string>();
  for (const t of txs) {
    if (t._skip || t.ty !== "transfer") continue;
    const key = t.amount + "|" + [t.fromN, t.toN].sort().join("~");
    if (seenTf.has(key)) t._skip = true; else seenTf.add(key);
  }

  const dateStr = new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (!txs.length) {
    await sendTelegram(BOT_TOKEN, CHAT_ID, `🌟 <b>Ryūsei 隆盛 — ${dateStr}</b>\n\nTidak ada transaksi baru hari ini. ✅`);
    return new Response(JSON.stringify({ ok: true, txs: 0 }));
  }

  const shown = txs.filter(t => !t._skip);
  const amb = shown.filter(t => t.ambiguous);
  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Number the SHOWN items in display order and persist _tg_no back to email_sync,
  // so a reply like "1 food 2 sdc out" maps to exactly what the user sees here.
  for (const arr of Object.values(rowArrays)) for (const it of arr) if (it && typeof it === "object") delete it._tg_no;
  const SECTION_ORDER = ["pay_cc", "pay_liability", "transfer", "expense", "income"];
  let noCounter = 0;
  for (const ty of SECTION_ORDER) for (const t of shown.filter(x => x.ty === ty)) {
    t._no = ++noCounter;
    const arr = rowArrays[t.esId as string];
    if (arr && arr[t.idx as number] && typeof arr[t.idx as number] === "object") arr[t.idx as number]._tg_no = t._no;
  }
  for (const [id, arr] of Object.entries(rowArrays)) await sb.from("email_sync").update({ ai_raw_result: arr }).eq("id", id);

  // Sections by TRUE transaction type (what will actually be imported)
  const TYPE_META: Record<string, { label: string; icon: string }> = {
    pay_cc: { label: "BAYAR KARTU KREDIT", icon: "💳" },
    pay_liability: { label: "BAYAR HUTANG", icon: "🏦" },
    transfer: { label: "TRANSFER ANTAR REKENING", icon: "🔁" },
    expense: { label: "PENGELUARAN", icon: "💸" },
    income: { label: "PEMASUKAN", icon: "💰" },
  };
  const section = (ty: string): string => {
    const list = shown.filter(t => t.ty === ty);
    if (!list.length) return "";
    const meta = TYPE_META[ty];
    const sub = list.reduce((a, t) => a + t.amount, 0);
    let s = `\n${meta.icon} <b>${meta.label}</b>  ·  ${rp(sub)}\n`;
    if (ty === "pay_cc" || ty === "pay_liability" || ty === "transfer") {
      for (const t of list) s += `<b>${t._no}.</b>${t.ambiguous ? " ❓" : ""}  ${esc(t.fromN || "?")} → <b>${esc(t.toN || "?")}</b>\n     ${rp(t.amount)}\n`;
    } else if (ty === "expense") {
      for (const t of list) {
        const ent = t.entity && t.entity !== "Personal" ? `  [${esc(t.entity)}]` : "";
        s += `<b>${t._no}.</b>${t.ambiguous ? " ❓" : ""}  ${esc(t.desc)}${ent}\n     ${rp(t.amount)}  ·  <i>${esc(t.cat || "Lainnya")}${t.fromN ? " · " + esc(t.fromN) : ""}</i>\n`;
      }
    } else {
      for (const t of list) s += `<b>${t._no}.</b>${t.ambiguous ? " ❓" : ""}  ${esc(t.desc)}${t.toN ? ` → ${esc(t.toN)}` : ""}\n     ${rp(t.amount)}  ·  <i>${esc(t.cat || "Income")}</i>\n`;
    }
    return s;
  };
  const merged = txs.length - shown.length;
  const msg =
    `🌟 <b>Ryūsei 隆盛</b>  ·  ${dateStr}\n` +
    `${shown.length} transaksi siap import\n` +
    `━━━━━━━━━━━━━━━\n` +
    section("pay_cc") + section("pay_liability") + section("transfer") + section("expense") + section("income") +
    (merged ? `\n🔗 <i>${merged} notifikasi dobel sudah di-merge</i>` : "") +
    (amb.length ? `\n⚠️ <b>${amb.length} ambigu</b> — balas nomornya buat benerin dulu (mis. "1 hamasa", "2 sdc", "3 skip"), baru Import` : `\n✅ Semua jelas — tap <b>Import</b> untuk masukin ke ledger`) +
    `\n\n💡 <i>Salah tipe/entity? Balas aja, mis. "1 food", "2 sdc out", "3 transfer", "4 skip".</i>`;

  // Inline buttons: just the actions. Per-item classify buttons were removed —
  // ambiguous items are corrected by replying with text (e.g. "1 hamasa"), which
  // the telegram-webhook text-correction / AI handler resolves.
  const keyboard = [
    [{ text: "✅ Import Semua", callback_data: "dg:importall" }, { text: "✏️ Review semua", callback_data: "dg:reviewall" }],
    [{ text: "🌐 Buka App", url: "https://ryusei.paulusiskandar.com" }],
  ];
  const res = await sendTelegram(BOT_TOKEN, CHAT_ID, msg, keyboard);
  return new Response(JSON.stringify({ ok: true, txs: txs.length, ambiguous: amb.length, tg: res?.ok }));
});
