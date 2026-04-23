export const merchantRules = {
  apply: (description, merchant, rules) => {
    if (!rules?.length) return null;
    const d = ((description || "") + " " + (merchant || "")).toLowerCase();
    for (const rule of rules) {
      const kw = (rule.merchant_name || "").toLowerCase().trim();
      if (kw.length >= 2 && d.includes(kw)) {
        return {
          category_id:   rule.category_id   || null,
          category_name: rule.category_name || rule.category_label || null,
          tx_type:       rule.tx_type       || null,
          confidence: 2,
        };
      }
    }
    return null;
  },
};
