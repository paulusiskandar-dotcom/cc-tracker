// Auto-detect bank account from email subject / sender / PDF text / card last4.
// Returns: { accountId, accountName, confidence, matchedBy, alternatives }
// confidence: 'high' | 'medium' | 'low' | null

const BANK_KEYWORDS = {
  bca:          ['bca', 'bank central asia', 'klikbca', '@bca.co.id'],
  maybank:      ['maybank', 'maybank2u', '@maybank.'],
  cimb:         ['cimb', 'cimb niaga', '@cimbniaga.', 'octo'],
  mandiri:      ['mandiri', 'bank mandiri', '@bankmandiri.', '@mandiri.'],
  bni:          ['bni', 'bank negara indonesia', '@bni.co.id'],
  bri:          ['bri', 'bank rakyat indonesia', '@bri.co.id'],
  jenius:       ['jenius', 'btpn', '@jenius.', 'smbc indonesia'],
  uob:          ['uob', '@uob.'],
  hsbc:         ['hsbc', '@hsbc.'],
  mega:         ['bank mega', '@bankmega.'],
  permata:      ['permata', '@permatabank.', '@permata.co.id'],
  ocbc:         ['ocbc', '@ocbc.'],
  danamon:      ['danamon', '@danamon.'],
  citibank:     ['citibank', 'citi bank', '@citi.', '@citibank.'],
  commonwealth: ['commonwealth', 'commbank', '@commbank.'],
  standard:     ['standard chartered', 'stanchart', '@sc.com'],
  skorcard:     ['skorcard', '@skor.'],
  panin:        ['panin', '@panin.'],
};

// Extract trailing digits from a masked account string.
// "TAHAPAN - 0831****88" → "88", "472647XXXX3776" → "3776", "0830xxxx43" → "43"
function extractVisibleSuffix(masked) {
  if (!masked || typeof masked !== "string") return null;
  const m1 = masked.match(/[*xX]+(\d+)\s*$/);
  if (m1) return m1[1];
  const cleaned = masked.replace(/[\s\-]/g, "");
  const m2 = cleaned.match(/(\d+)$/);
  return m2 ? m2[1] : null;
}

// Pick best candidate: exact bank match > currency match > sort_order
function pickBestAccount(matches, bankName, currency) {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  return [...matches].sort((a, b) => {
    const aExact = bankName && a.bank_name?.toLowerCase() === bankName.toLowerCase() ? 0 : 1;
    const bExact = bankName && b.bank_name?.toLowerCase() === bankName.toLowerCase() ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aCur = currency && a.currency?.toLowerCase() === currency.toLowerCase() ? 0 : 1;
    const bCur = currency && b.currency?.toLowerCase() === currency.toLowerCase() ? 0 : 1;
    if (aCur !== bCur) return aCur - bCur;
    return (a.sort_order ?? 9999) - (b.sort_order ?? 9999);
  })[0];
}

export function detectAccount({ subject, sender, pdfText, cardLast4, accounts, bankName, currency }) {
  if (!accounts || accounts.length === 0) return null;

  // === Account suffix matching (highest confidence, mirrors edge function) ===
  const suffix = extractVisibleSuffix(pdfText);
  if (suffix && suffix.length >= 2 && bankName) {
    const txBankLower = bankName.toLowerCase();
    const pool = accounts.filter(a => {
      if (!a.bank_name || a.is_active === false) return false;
      const accBank = a.bank_name.toLowerCase();
      return accBank === txBankLower
        || txBankLower.includes(accBank)
        || accBank.includes(txBankLower);
    });
    if (pool.length > 0) {
      for (const len of [4, 3, 2]) {
        if (suffix.length < len) continue;
        const target = suffix.slice(-len);
        const byAcct = pool.filter(a => a.account_no && String(a.account_no).endsWith(target));
        const bestAcct = pickBestAccount(byAcct, bankName, currency);
        if (bestAcct) return {
          accountId:    bestAcct.id,
          accountName:  bestAcct.name,
          confidence:   'high',
          matchedBy:    ['account_no_suffix'],
          alternatives: [],
        };
        const byCard = pool.filter(a => a.card_last4 && String(a.card_last4).endsWith(target));
        const bestCard = pickBestAccount(byCard, bankName, currency);
        if (bestCard) return {
          accountId:    bestCard.id,
          accountName:  bestCard.name,
          confidence:   'high',
          matchedBy:    ['card_last4_suffix'],
          alternatives: [],
        };
      }
    }
  }

  // === Fallback: keyword scoring (existing logic) ===
  const subjectL = (subject || '').toLowerCase();
  const senderL  = (sender  || '').toLowerCase();
  const pdfL     = (pdfText || '').toLowerCase();
  const haystack = `${subjectL} ${senderL} ${pdfL}`;

  const matches = [];

  for (const acc of accounts) {
    let score = 0;
    const matchedBy = [];

    // 1. card_last4 — highest weight (most specific)
    if (acc.card_last4) {
      const l4 = acc.card_last4;
      // direct parameter — exact match OR suffix match after stripping X/* wildcards
      // e.g. AI returns "XX87", DB has "8587" → visible "87" → "8587".endsWith("87") ✓
      if (cardLast4) {
        const visible = String(cardLast4).replace(/[Xx*\s\-]/g, '');
        const isExact  = cardLast4 === l4;
        const isSuffix = visible.length >= 2 && l4.endsWith(visible);
        if (isExact || isSuffix) {
          score += 100;
          if (!matchedBy.includes('card_last4')) matchedBy.push('card_last4');
        }
      }
      // in pdf text: "****1234", "xxxx 1234", " 1234 " patterns
      if (pdfL) {
        const pat = new RegExp(`[*x]+\\s*${l4}|\\b${l4}\\b`, 'i');
        if (pat.test(pdfL)) {
          score += 100;
          if (!matchedBy.includes('card_last4')) matchedBy.push('card_last4');
        }
      }
    }

    // 2. bank_name keyword group match
    if (acc.bank_name) {
      const bnLower = acc.bank_name.toLowerCase();

      // Direct bank_name substring in haystack
      if (bnLower.length >= 3 && haystack.includes(bnLower)) {
        score += 30;
        if (!matchedBy.includes('bank_name')) matchedBy.push('bank_name');
      }

      // Keyword-group match
      for (const [, keywords] of Object.entries(BANK_KEYWORDS)) {
        // Does this account's bank_name belong to this keyword group?
        const accInGroup = keywords.some(kw => {
          const kwBase = kw.replace(/^@/, '').replace(/\.$/, '');
          return bnLower.includes(kwBase) || kwBase.includes(bnLower);
        });
        if (!accInGroup) continue;

        // Does the haystack contain any keyword from this group?
        for (const kw of keywords) {
          const kwL = kw.toLowerCase();
          if (!haystack.includes(kwL)) continue;

          score += 20;
          if (senderL.includes(kwL)) {
            score += 15; // sender domain bonus
            if (!matchedBy.includes('sender')) matchedBy.push('sender');
          } else if (subjectL.includes(kwL)) {
            if (!matchedBy.includes('subject')) matchedBy.push('subject');
          } else if (pdfL.includes(kwL)) {
            if (!matchedBy.includes('pdf_text')) matchedBy.push('pdf_text');
          }
          break; // only count once per group
        }
        break; // only one group match per account
      }
    }

    // 3. account name fallback (only if nothing else matched)
    if (score === 0 && acc.name) {
      const nameLower = acc.name.toLowerCase();
      if (nameLower.length >= 4 && haystack.includes(nameLower)) {
        score += 15;
        matchedBy.push('account_name');
      }
    }

    if (score > 0) matches.push({ account: acc, score, matchedBy });
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => b.score - a.score);
  const top = matches[0];

  const confidence = top.score >= 100 ? 'high'
    : top.score >= 45               ? 'high'
    : top.score >= 30               ? 'medium'
    : 'low';

  return {
    accountId:    top.account.id,
    accountName:  top.account.name,
    confidence,
    matchedBy:    top.matchedBy,
    alternatives: matches.slice(1, 4).map(m => ({
      accountId:   m.account.id,
      accountName: m.account.name,
      score:       m.score,
    })),
  };
}
