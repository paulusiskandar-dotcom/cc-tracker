import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export function useReconcileDrafts(userId) {
  const [drafts, setDrafts] = useState([]);
  const reload = async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("import_drafts")
      .select("*")
      .eq("user_id", userId)
      .eq("source", "reconcile")
      .order("updated_at", { ascending: false });
    setDrafts(data || []);
  };
  useEffect(() => { reload(); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { drafts, reload };
}
