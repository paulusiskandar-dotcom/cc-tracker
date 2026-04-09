import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BACKUP_VERSION = "2.3.0";
const MAX_BACKUPS    = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Support two modes:
  //   1. Admin mode (no auth header, uses service role) — for cron
  //   2. User mode  (Bearer token)                      — for "Backup Now" button
  const authHeader = req.headers.get("Authorization") || "";
  const isUserMode = authHeader.startsWith("Bearer ");

  // Parse optional user_id override from body
  let bodyUserId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    bodyUserId = body.user_id || null;
  } catch { /* ignore */ }

  // Build supabase client
  const supabaseUrl     = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const adminClient     = createClient(supabaseUrl, serviceRoleKey);

  // Resolve user list
  let userIds: string[] = [];

  if (isUserMode) {
    // Verify the JWT and back up only that user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userIds = [user.id];
  } else if (bodyUserId) {
    userIds = [bodyUserId];
  } else {
    // Cron / admin: back up all users
    const { data: usersData } = await adminClient.auth.admin.listUsers();
    userIds = (usersData?.users || []).map((u) => u.id);
  }

  const results: Record<string, "ok" | "error"> = {};

  for (const userId of userIds) {
    try {
      // Fetch all tables in parallel
      const [
        accounts, ledger, income_sources, expense_categories,
        installments, recurring_templates,
        employee_loans, employee_loan_payments,
        fx_rates, merchant_mappings,
      ] = await Promise.all([
        adminClient.from("accounts").select("*").eq("user_id", userId),
        adminClient.from("ledger").select("*").eq("user_id", userId),
        adminClient.from("income_sources").select("*").eq("user_id", userId),
        adminClient.from("expense_categories").select("*").eq("user_id", userId),
        adminClient.from("installments").select("*").eq("user_id", userId),
        adminClient.from("recurring_templates").select("*").eq("user_id", userId),
        adminClient.from("employee_loans").select("*").eq("user_id", userId),
        adminClient.from("employee_loan_payments").select("*").eq("user_id", userId),
        adminClient.from("fx_rates").select("*").eq("user_id", userId),
        adminClient.from("merchant_mappings").select("*").eq("user_id", userId),
      ]);

      const backup = {
        exported_at: new Date().toISOString(),
        version:     BACKUP_VERSION,
        user_id:     userId,
        data: {
          accounts:               accounts.data               || [],
          ledger:                 ledger.data                 || [],
          income_sources:         income_sources.data         || [],
          expense_categories:     expense_categories.data     || [],
          installments:           installments.data           || [],
          recurring_templates:    recurring_templates.data    || [],
          employee_loans:         employee_loans.data         || [],
          employee_loan_payments: employee_loan_payments.data || [],
          fx_rates:               fx_rates.data               || [],
          merchant_mappings:      merchant_mappings.data      || [],
        },
      };

      const dateStr  = new Date().toISOString().slice(0, 10);
      const filename = `${userId}/backup-${dateStr}.json`;
      const content  = JSON.stringify(backup, null, 2);

      await adminClient.storage
        .from("backups")
        .upload(filename, content, { contentType: "application/json", upsert: true });

      // Prune old backups — keep latest MAX_BACKUPS
      const { data: files } = await adminClient.storage
        .from("backups")
        .list(userId, { sortBy: { column: "created_at", order: "desc" } });

      if (files && files.length > MAX_BACKUPS) {
        const toDelete = files.slice(MAX_BACKUPS).map((f) => `${userId}/${f.name}`);
        await adminClient.storage.from("backups").remove(toDelete);
      }

      // Record last_backup timestamp in app_settings
      await adminClient.from("app_settings").upsert(
        { user_id: userId, key: "last_backup", value: new Date().toISOString() },
        { onConflict: "user_id,key" }
      );

      console.log(`✅ Backup OK: ${userId} → ${filename}`);
      results[userId] = "ok";
    } catch (err) {
      console.error(`❌ Backup failed: ${userId}`, err);
      results[userId] = "error";
    }
  }

  return new Response(
    JSON.stringify({ success: true, results }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
