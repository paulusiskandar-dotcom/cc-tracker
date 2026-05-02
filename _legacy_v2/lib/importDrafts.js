import { supabase } from "./supabase";

export const importDrafts = {
  save: async (userId, source, state, accountId = null) => {
    const { error } = await supabase.from("import_drafts").upsert({
      user_id: userId, source, state_json: state, account_id: accountId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,source,account_id" });
    if (error) console.error("[draft save]", error);
  },
  load: async (userId, source, accountId = null) => {
    const q = supabase.from("import_drafts").select("*").eq("user_id", userId).eq("source", source);
    const { data } = accountId
      ? await q.eq("account_id", accountId).maybeSingle()
      : await q.is("account_id", null).maybeSingle();
    return data || null;
  },
  clear: async (userId, source, accountId = null) => {
    const q = supabase.from("import_drafts").delete().eq("user_id", userId).eq("source", source);
    if (accountId) await q.eq("account_id", accountId);
    else await q.is("account_id", null);
  },
};
