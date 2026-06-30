// ─────────────────────────────────────────────────────────────────
// payment-reminder/index.ts
// Daily Telegram reminder: upcoming CC payment due dates + outstanding reimburse.
//
// Reuses the same bot as telegram-webhook (TELEGRAM_BOT_TOKEN +
// TELEGRAM_AUTHORIZED_CHAT_ID secrets). Reads CC due_day + outstanding_amount and
// reimburse_out/in net per entity, then pushes one message.
//
// Deploy: supabase functions deploy payment-reminder
// Schedule (daily 08:00 WIB = 01:00 UTC) via Supabase Dashboard → Functions → Schedules
//   cron: 0 1 * * *
// ─────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const TELEGRAM_API = "https://api.telegram.org";
const LEAD_DAYS = 7;           // remind for CC due within the next N days

const fmtIDR = (n: number) => "Rp " + Math.round(Number(n || 0)).toLocaleString("id-ID");

// Next occurrence of a day-of-month from `today` (this month or next), as a Date.
function nextDue(today: Date, dueDay: number): Date {
  const y = today.getFullYear(), m = today.getMonth();
  let d = new Date(y, m, dueDay);
  if (d < new Date(y, m, today.getDate())) d = new Date(y, m + 1, dueDay);
  return d;
}

async function sendTelegram(token: string, chatId: number, text: string) {
  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("[payment-reminder] telegram send failed:", await res.text());
  return res.ok;
}

Deno.serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const CHAT_ID      = Number(Deno.env.get("TELEGRAM_AUTHORIZED_CHAT_ID"));
  const USER_ID      = Deno.env.get("AUTHORIZED_USER_ID");   // Paulus's user_id

  if (!BOT_TOKEN || !CHAT_ID) {
    return new Response(JSON.stringify({ error: "missing TELEGRAM_BOT_TOKEN / TELEGRAM_AUTHORIZED_CHAT_ID" }), { status: 500 });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── CC due dates ──────────────────────────────────────────────
  let accQ = sb.from("accounts").select("name,card_last4,due_day,outstanding_amount,type,user_id,is_active")
    .eq("type", "credit_card").not("due_day", "is", null);
  if (USER_ID) accQ = accQ.eq("user_id", USER_ID);
  const { data: ccs } = await accQ;

  const today = new Date();
  const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + LEAD_DAYS);
  const due = (ccs || [])
    .filter((c: any) => c.is_active !== false && Number(c.outstanding_amount || 0) >= 50000)
    .map((c: any) => ({ ...c, when: nextDue(today, c.due_day) }))
    .filter((c: any) => c.when <= horizon)
    .sort((a: any, b: any) => a.when - b.when);

  // ── Reimburse outstanding per entity (out − in) ───────────────
  let ledQ = sb.from("ledger").select("tx_type,amount_idr,entity")
    .in("tx_type", ["reimburse_out", "reimburse_in"]);
  if (USER_ID) ledQ = ledQ.eq("user_id", USER_ID);
  const { data: led } = await ledQ;
  const net: Record<string, number> = {};
  for (const l of (led || []) as any[]) {
    const e = l.entity || "Personal";
    net[e] = (net[e] || 0) + (l.tx_type === "reimburse_out" ? 1 : -1) * Number(l.amount_idr || 0);
  }

  // ── Build message ─────────────────────────────────────────────
  const lines: string[] = [];
  const d2 = (dt: Date) => `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
  lines.push(`🔔 Reminder Keuangan — ${d2(today)}/${today.getFullYear()}`);

  if (due.length) {
    lines.push("", `💳 Jatuh tempo bayar CC (≤${LEAD_DAYS} hari):`);
    for (const c of due) lines.push(`  • ${d2(c.when)} · ${c.name} — ${fmtIDR(c.outstanding_amount)}`);
    lines.push(`  Total: ${fmtIDR(due.reduce((s: number, c: any) => s + Number(c.outstanding_amount || 0), 0))}`);
  } else {
    lines.push("", "💳 Tidak ada CC jatuh tempo dalam 7 hari. ✅");
  }

  // Only surface entities that still OWE Paulus (net reimburse_out > reimburse_in).
  // Negative net is a data artifact (CC-fronted expenses not tagged reimburse_out) — skip.
  const owed = Object.entries(net).filter(([e, v]) => e !== "Personal" && v >= 100000);
  if (owed.length) {
    lines.push("", "🔄 Reimburse belum ditagih:");
    for (const [e, v] of owed) lines.push(`  • ${e}: ${fmtIDR(v)}`);
  }

  lines.push("", "— CC Tracker");
  const msg = lines.join("\n");

  // Only send if there's something actionable (or always — keep it simple: send daily summary)
  const ok = await sendTelegram(BOT_TOKEN, CHAT_ID, msg);
  return new Response(JSON.stringify({ sent: ok, due: due.length, reimburse: owed.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
