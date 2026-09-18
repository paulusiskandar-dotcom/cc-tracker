// One way to revalue an asset, shared by the desktop timeline and the phone Assets screen:
// write the new value on the account and keep the old → new step in asset_value_history.
import { supabase } from "./supabase";
import { todayStr } from "../utils";

export async function updateAssetValue({ userId, assetId, value, date, notes }) {
  const newVal = Number(value);
  if (!Number.isFinite(newVal)) throw new Error("Enter a value");
  const { data: current, error: e0 } = await supabase.from("accounts").select("current_value").eq("id", assetId).single();
  if (e0) throw e0;
  const oldValue = current?.current_value || 0;
  const { error: e1 } = await supabase.from("accounts").update({ current_value: newVal }).eq("id", assetId);
  if (e1) throw e1;
  const row = { account_id: assetId, user_id: userId, old_value: oldValue, new_value: newVal, date: date || todayStr(), notes: notes || "Manual update" };
  const { error: e2 } = await supabase.from("asset_value_history").insert(row);
  if (e2) throw e2;
  return row;
}
