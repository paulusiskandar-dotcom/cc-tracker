// ─────────────────────────────────────────────────────────────────
// payment-reminder/index.ts
// Daily Telegram reminder: upcoming CC payment due dates + outstanding reimburse.
//
// Reuses the same bot as telegram-webhook (TELEGRAM_BOT_TOKEN +
// TELEGRAM_AUTHORIZED_CHAT_ID secrets). Reads CC due_day + outstanding_amount and
// reimburse_out/in net per entity, then pushes one message.
//
// Deploy: supabase functions deploy payment-reminder
// Schedule (daily 21:00 WIB = 14:00 UTC) via Supabase Dashboard → Functions → Schedules
//   cron: 0 14 * * *
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
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("[payment-reminder] telegram send failed:", await res.text());
  return res.ok;
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (_req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BOT_TOKEN    = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const CHAT_ID      = Number(Deno.env.get("TELEGRAM_AUTHORIZED_CHAT_ID"));
  const USER_ID      = Deno.env.get("TELEGRAM_AUTHORIZED_USER_ID") || Deno.env.get("AUTHORIZED_USER_ID");

  if (!BOT_TOKEN || !CHAT_ID) {
    return new Response(JSON.stringify({ error: "missing TELEGRAM_BOT_TOKEN / TELEGRAM_AUTHORIZED_CHAT_ID" }), { status: 500 });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── CC due dates (statement-aware: only the PENDING bill, not post-cutoff usage) ──
  let accQ = sb.from("accounts").select("id,name,card_last4,due_day,statement_day,outstanding_amount,type,user_id,is_active")
    .eq("type", "credit_card").not("due_day", "is", null);
  if (USER_ID) accQ = accQ.eq("user_id", USER_ID);
  const { data: ccs } = await accQ;

  const today = new Date(Date.now() + 7 * 3600 * 1000); // Jakarta (UTC+7)
  const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + LEAD_DAYS);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dstr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // Charges after the last statement cutoff belong to NEXT month's bill, so
  // subtract them from outstanding to get the amount actually due now. If the
  // statement is already paid, pending = 0 and the card is skipped. (< Rp25rb ignored.)
  const sinceStr = dstr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 62));
  let chQ = sb.from("ledger").select("from_id,from_type,amount_idr,tx_date").eq("from_type", "account").gte("tx_date", sinceStr);
  if (USER_ID) chQ = chQ.eq("user_id", USER_ID);
  const { data: charges } = await chQ;
  const lastStmt = (statementDay: any, ref: Date): Date | null => {
    if (!statementDay) return null;
    const cand = new Date(ref.getFullYear(), ref.getMonth(), Number(statementDay));
    return cand < ref ? cand : new Date(ref.getFullYear(), ref.getMonth() - 1, Number(statementDay));
  };
  const pendingDue = (c: any): number => {
    const outstanding = Number(c.outstanding_amount || 0);
    if (outstanding <= 0) return 0;
    if (!c.statement_day) return outstanding;
    const ls = lastStmt(c.statement_day, today);
    if (!ls) return outstanding;
    const lsStr = dstr(ls);
    const after = (charges || []).filter((e: any) => e.from_id === c.id && e.from_type === "account" && e.tx_date > lsStr).reduce((s: number, e: any) => s + Number(e.amount_idr || 0), 0);
    return Math.max(0, outstanding - after);
  };
  // Due date of the current statement: if due_day is before the cut-off, it's next month.
  const ccDue = (c: any): Date => {
    const dd = Number(c.due_day);
    const sd = c.statement_day ? Number(c.statement_day) : null;
    if (!sd) return nextDue(today, dd);
    const ls = lastStmt(sd, today);
    if (!ls) return nextDue(today, dd);
    return new Date(ls.getFullYear(), ls.getMonth() + (dd < sd ? 1 : 0), dd);
  };
  const due = (ccs || [])
    .filter((c: any) => c.is_active !== false)
    .map((c: any) => ({ name: c.name, amt: pendingDue(c), when: ccDue(c) }))
    .filter((c: any) => c.amt >= 25000 && c.when <= horizon);
  // liability cicilan (BYD dll) with due_day
  let liabQ = sb.from("accounts").select("name,monthly_installment,due_day,type,user_id,is_active").eq("type", "liability").not("due_day", "is", null);
  if (USER_ID) liabQ = liabQ.eq("user_id", USER_ID);
  const { data: liabs } = await liabQ;
  for (const l of (liabs || []) as any[]) {
    if (l.is_active === false || !Number(l.monthly_installment)) continue;
    const when = nextDue(today, l.due_day);
    if (when <= horizon) due.push({ name: l.name + " (cicilan)", amt: Number(l.monthly_installment), when });
  }
  due.sort((a: any, b: any) => a.when - b.when);

  // ── Recurring monthly bills (subscriptions, rent, insurance…) ──
  let rtQ = sb.from("recurring_templates").select("name,amount,currency,tx_type,day_of_month,is_active,user_id")
    .eq("is_active", true).not("tx_type", "in", "(income)");
  if (USER_ID) rtQ = rtQ.eq("user_id", USER_ID);
  const { data: rts } = await rtQ;
  // Only MANUAL bills (utilities/property/tax/telco) need reminders. Subscriptions
  // that auto-charge on a card don't — they already show up in the CC bill.
  const MANUAL_RE = /listrik|metro|apart|internet|wifi|indihome|\bpph\b|pajak|telkomsel|\bipl\b|pdam|bpjs|iuran|residence|riverside|circleone/i;
  const bills = (rts || [])
    .filter((t: any) => t.day_of_month && MANUAL_RE.test(t.name || ""))
    .map((t: any) => ({ ...t, when: nextDue(today, t.day_of_month) }))
    .filter((t: any) => t.when <= horizon)
    .sort((a: any, b: any) => a.when - b.when);

  // ── Reimburse belum settled per entity + aging (out − in, UNSETTLED only) ──
  let ledQ = sb.from("ledger").select("tx_type,amount_idr,entity,tx_date,reimburse_settlement_id")
    .in("tx_type", ["reimburse_out", "reimburse_in"]);
  if (USER_ID) ledQ = ledQ.eq("user_id", USER_ID);
  const { data: led } = await ledQ;
  const net: Record<string, number> = {}; const oldest: Record<string, string> = {};
  for (const l of (led || []) as any[]) {
    if (l.reimburse_settlement_id) continue; // hanya yang belum di-settle
    const e = l.entity || "Personal";
    net[e] = (net[e] || 0) + (l.tx_type === "reimburse_out" ? 1 : -1) * Number(l.amount_idr || 0);
    if (l.tx_type === "reimburse_out" && (!oldest[e] || l.tx_date < oldest[e])) oldest[e] = l.tx_date;
  }

  // ── Build message (HTML, name-first) ──────────────────────────
  const d2 = (dt: Date) => `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
  const daysTo = (dt: Date) => Math.round((new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  const lines: string[] = [`🔔 <b>REMINDER</b> · ${d2(today)}/${today.getFullYear()}`];

  if (due.length) {
    lines.push("", `💳 <b>Jatuh tempo ≤${LEAD_DAYS} hari</b>`);
    for (const c of due) {
      const dd = daysTo(c.when);
      const tag = dd === 0 ? "HARI INI ‼️" : dd === 1 ? "besok ⚠️" : `${dd} hari lagi`;
      lines.push(`\n<b>tgl ${c.when.getDate()}</b> — ${tag}\n${esc(c.name)}\n<b>${fmtIDR(c.amt)}</b>`);
    }
    lines.push(`\n💸 Total: <b>${fmtIDR(due.reduce((s: number, c: any) => s + c.amt, 0))}</b>`);
  } else {
    lines.push("", "💳 Tidak ada jatuh tempo dalam 7 hari ✅");
  }

  if (bills.length) {
    lines.push("", "📅 <b>Tagihan bulanan ≤7 hari</b>");
    for (const b of bills) lines.push(`${esc(b.name)} · tgl ${b.day_of_month}\n<b>${Number(b.amount) > 0 ? fmtIDR(b.amount) : "nilai belum pasti"}</b>`);
  }

  const owed = Object.entries(net).filter(([e, v]) => e !== "Personal" && v >= 100000);
  if (owed.length) {
    lines.push("", "🔄 <b>Reimburse belum ditagih</b>");
    for (const [e, v] of owed) {
      const age = oldest[e] ? Math.round((today.getTime() - new Date(oldest[e]).getTime()) / 86400000) : 0;
      lines.push(`${esc(e)}: <b>${fmtIDR(v)}</b>${age > 30 ? ` ⏳ ada yang &gt;${age} hari — nagih!` : ""}`);
    }
  }
  const msg = lines.join("\n");

  // Only send if there's something actionable (or always — keep it simple: send daily summary)
  const ok = await sendTelegram(BOT_TOKEN, CHAT_ID, msg);
  return new Response(JSON.stringify({ sent: ok, due: due.length, reimburse: owed.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
