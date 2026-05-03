// Daily FX rate sync from open.er-api.com (free, no API key)
// Run via pg_cron OR manual call from app
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "SGD", "AUD", "HKD", "CHF", "CNY", "MYR", "THB"];

Deno.serve(async (req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const res = await fetch("https://open.er-api.com/v6/latest/IDR");
    if (!res.ok) {
      return new Response(`API error: ${res.status}`, { status: 500 });
    }
    const data = await res.json();
    if (data.result !== "success") {
      return new Response(`API result not success: ${JSON.stringify(data)}`, { status: 500 });
    }

    // Get all distinct user_ids
    const { data: users, error: uErr } = await supabase
      .from("accounts")
      .select("user_id")
      .limit(1000);
    if (uErr) throw uErr;
    const userIds = [...new Set((users ?? []).map((u: any) => u.user_id))];

    let upsertCount = 0;
    let historyCount = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const uid of userIds) {
      const upserts: any[] = [];
      const histories: any[] = [];

      for (const cur of CURRENCIES) {
        const foreignPerIdr = data.rates[cur];
        if (!foreignPerIdr || foreignPerIdr === 0) continue;
        const rateToIdr = 1 / foreignPerIdr;

        upserts.push({
          user_id: uid,
          currency: cur,
          rate_to_idr: rateToIdr,
          source: "open.er-api.com",
          updated_at: new Date().toISOString(),
        });

        histories.push({
          user_id: uid,
          currency: cur,
          rate_to_idr: rateToIdr,
          effective_date: today,
          source: "open.er-api.com",
        });
      }

      // IDR base = 1
      upserts.push({
        user_id: uid,
        currency: "IDR",
        rate_to_idr: 1,
        source: "system",
        updated_at: new Date().toISOString(),
      });

      const { error: e1 } = await supabase
        .from("fx_rates")
        .upsert(upserts, { onConflict: "user_id,currency" });
      if (e1) throw e1;
      upsertCount += upserts.length;

      const { error: e2 } = await supabase.from("fx_rate_history").insert(histories);
      if (e2 && !e2.message.includes("duplicate")) {
        console.error("history insert failed", e2);
      } else {
        historyCount += histories.length;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        users: userIds.length,
        rates_upserted: upsertCount,
        history_inserted: historyCount,
        timestamp: new Date().toISOString(),
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(`Error: ${err}`, { status: 500 });
  }
});
