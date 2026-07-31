// statement-check — monthly (30th) Telegram report on credit-card statement
// completeness. For each active CC that issues statements, checks whether THIS
// month's statement is in the system (a reconcile_session for the month, or
// last_statement_date landing in the month → the fetch pipeline downloaded +
// prepared it). Flags the ones still missing so Paulus can chase them.
// Reuses the telegram-webhook bot secrets. Schedule: cron 0 1 30 * * (WIB 08:00).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TG = "https://api.telegram.org";
const ID_MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

async function sendTelegram(token: string, chatId: number, text: string) {
  const r = await fetch(`${TG}/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
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
  const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const now = new Date(Date.now() + 7 * 3600 * 1000); // Jakarta
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const ymPrefix = `${y}-${String(m).padStart(2, "0")}`;

  // Active credit cards
  const { data: ccs } = await sb.from("accounts")
    .select("id, name, statement_day, last_statement_date")
    .eq("user_id", USER_ID).eq("type", "credit_card").eq("is_active", true);

  // Any reconcile_session for this month (prepared OR completed = statement is in)
  const { data: sess } = await sb.from("reconcile_sessions")
    .select("account_id, status").eq("user_id", USER_ID)
    .eq("period_year", y).eq("period_month", m);
  const hasSession = new Set((sess || []).map((s: any) => s.account_id));

  const ready: string[] = [], missing: string[] = [], dormant: string[] = [];
  for (const c of (ccs || []) as any[]) {
    // Dormant / non-statement cards: no statement_day, or never had a statement.
    if (!c.statement_day || !c.last_statement_date) { dormant.push(c.name); continue; }
    const inThisMonth = hasSession.has(c.id) ||
      (typeof c.last_statement_date === "string" && c.last_statement_date.startsWith(ymPrefix));
    (inThisMonth ? ready : missing).push(c.name);
  }
  ready.sort(); missing.sort(); dormant.sort();

  const lines: string[] = [`📄 <b>Cek Statement — ${ID_MONTHS[m - 1]} ${y}</b>`];
  lines.push(`\n${ready.length}/${ready.length + missing.length} kartu statement-nya sudah masuk.`);
  if (!missing.length) {
    lines.push(`\n✅ <b>Semua statement bulan ini sudah lengkap.</b>`);
  } else {
    lines.push(`\n⏳ <b>Belum masuk (${missing.length}):</b>`);
    for (const n of missing) lines.push(`• ${esc(n)}`);
    lines.push(`\n<i>Statement auto-download tiap 12 jam. Kalau ada yang telat lewat jatuh tempo, cek email/app-nya.</i>`);
  }
  if (ready.length) lines.push(`\n✓ <i>Sudah masuk: ${ready.map(esc).join(", ")}</i>`);
  if (dormant.length) lines.push(`\n💤 <i>Dorman/tanpa statement: ${dormant.map(esc).join(", ")}</i>`);

  const res = await sendTelegram(BOT_TOKEN, CHAT_ID, lines.join("\n"));
  return new Response(JSON.stringify({ ok: true, ready: ready.length, missing: missing.length, dormant: dormant.length, tg: res?.ok }), {
    headers: { "Content-Type": "application/json" },
  });
});
