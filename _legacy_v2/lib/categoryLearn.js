import { supabase } from "./supabase";

export const categoryLearn = {
  getLearned: async (userId) => {
    const { data } = await supabase
      .from("ledger")
      .select("description, merchant_name, category_id, category_name, tx_type")
      .eq("user_id", userId)
      .not("category_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(2000);
    return data || [];
  },

  // Returns { category_id, category_name, tx_type, confidence } or null
  suggest: (description, merchant, learned) => {
    if (!description && !merchant) return null;
    if (!learned?.length) return null;
    const normalize = s => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const queryTerms = [...new Set([
      ...normalize(description).split(/\s+/),
      ...normalize(merchant).split(/\s+/),
    ].filter(w => w.length >= 3))];
    if (!queryTerms.length) return null;

    const scores = new Map();
    for (const tx of learned) {
      const txNorm = normalize((tx.description || "") + " " + (tx.merchant_name || ""));
      const overlap = queryTerms.filter(q => txNorm.includes(q)).length;
      if (overlap === 0) continue;
      const key = tx.category_id;
      const prev = scores.get(key) || { count: 0, name: tx.category_name, tx_type: tx.tx_type };
      prev.count += overlap;
      scores.set(key, prev);
    }
    if (!scores.size) return null;

    let best = null, bestScore = 0;
    for (const [cat_id, v] of scores) {
      if (v.count > bestScore) { bestScore = v.count; best = { category_id: cat_id, ...v }; }
    }
    if (!best) return null;

    return {
      category_id:   best.category_id,
      category_name: best.name,
      tx_type:       best.tx_type,
      confidence:    bestScore >= 3 ? 2 : 1,
    };
  },
};
