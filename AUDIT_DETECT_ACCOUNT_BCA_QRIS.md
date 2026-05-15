# detectAccount Audit — BCA QRIS Failure

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15
**Reported symptom:** After deploying fix 8a (lower confidence gate) + 8b (amber border), every BCA QRIS email row still shows amber border (from_id empty) AND no ✨ auto-detect badge — i.e. `detectAccount` returned `null` for every row. Target account in app: BCA share, `account_no=0831361688` (last 2 = `88`).

---

## 1. `detectAccount` Function

- **File:** `src/lib/accountDetection.js`
- **Signature** (L52): `detectAccount({ subject, sender, pdfText, cardLast4, accounts, bankName, currency })`
- **Returns:** `{ accountId, accountName, confidence, matchedBy[], alternatives[] } | null`

**Phase 1 — Suffix matching (high confidence)** — L55-90

```js
const suffix = extractVisibleSuffix(pdfText);            // "TAHAPAN - 0831****88" → "88"
if (suffix && suffix.length >= 2 && bankName) {          // ← gated on bankName truthy
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
      // 1. account_no match
      const byAcct = pool.filter(a => a.account_no && String(a.account_no).endsWith(target));
      // 2. card_last4 match
      const byCard = pool.filter(a => a.card_last4 && String(a.card_last4).endsWith(target));
      // pickBestAccount(...) returns first hit
    }
  }
}
```

**Phase 2 — Keyword scoring (fallback)** — L92-199

| Signal | Score | Notes |
|---|---|---|
| `cardLast4` param matches `a.card_last4` (exact or suffix) | +100 | per match, only if `acc.card_last4` set |
| Card last4 found in `pdfText` via `[*x]+\d{4}` | +100 | per match |
| `acc.bank_name` substring in haystack (len ≥ 3) | +30 | direct |
| `acc.bank_name` ∈ BANK_KEYWORDS group keyword in haystack | +20 | first hit per group |
| Same as above AND keyword in `sender` | +15 (additive) | sender bonus |
| Acc `name` substring in haystack (only if score=0) | +15 | last-ditch |

`haystack = subjectL + " " + senderL + " " + pdfL` (all lowercase).

**Confidence thresholds** — L184-187:

```js
const confidence = top.score >= 100 ? 'high'
  : top.score >= 45               ? 'high'
  : top.score >= 30               ? 'medium'
  : 'low';
```

(Pre-fix the consumer gated on `'high' || 'medium'`; post-fix 8a accepts any non-null `accountId`.)

---

## 2. Edge Function `gmail-sync` Extraction

- **File:** `supabase/functions/gmail-sync/index.ts`
- **Model:** `claude-haiku-4-5-20251001` (L560, L736)
- **Output schema (extract relevant)** — L174-201:

```jsonc
[{
  "date": "YYYY-MM-DD",
  "merchant_name": "...",
  "amount": 150000,
  "amount_idr": 150000,
  "currency": "IDR",
  "card_last4": "1234 or null",
  "from_account_no": "account number or null",
  "from_account_masked": "raw masked string e.g. TAHAPAN - 0831****88 or null",
  "from_bank_name": "BCA or null",
  "is_qris": false,
  "is_cc_payment": false,
  "suggested_tx_type": "expense"
}]
```

**Special patterns the prompt knows about** — L141-172:
1. CIMB NIAGA CC TRANSACTION
3. MANDIRI "Pembayaran Berhasil"
4. BCA DEBIT / CREDIT CARD NOTIFICATION (subjects: "Transaksi Kartu Debit", "Transaksi Kartu Kredit", "Notifikasi Transaksi", "BCA Krisflyer")
5. TRANSFER NOTIFICATION

**There is NO dedicated pattern for BCA QRIS** (subjects like "Successful QRIS Transaction", "QRIS Payment"). BCA QRIS emails fall through to generic Rules at L210-218:

> "Extract `from_account_masked`: look in 'Source of Fund', 'Card number', 'Sumber Dana', 'Account' fields. Copy the raw masked string exactly."
> "QRIS/QR payment → `is_qris=true`, `suggested_tx_type=qris_debit`"

There is no explicit instruction to also extract `from_bank_name="BCA"` for QRIS. The Haiku model has to infer from "Acquirer: BCA".

---

## 3. Email.jsx → `detectAccount` Params

`src/components/Email.jsx:411-447` (inside `EmailPendingTab` useEffect):

```js
const spendAccounts = accounts.filter(a =>
  (a.type === "bank" && a.subtype !== "reimburse") ||   // ← FILTER 1
  a.type === "credit_card"
);
...
if (!row.from_id) {
  const sender = s.sender_email || "";
  const aiTx   = Array.isArray(s.ai_raw_result) ? s.ai_raw_result[s.tx_index ?? 0] : null;
  const detected = detectAccount({
    subject:   s.subject,
    sender,
    cardLast4: s.card_last4 || aiTx?.card_last4 || null,
    pdfText:   aiTx?.from_account_masked || null,
    bankName:  aiTx?.from_bank_name || s.from_bank_name || null,
    currency:  aiTx?.currency || s.currency || null,
    accounts:  spendAccounts,
  });
  if (detected && detected.accountId) {                  // ← post-fix 8a
    return { ...row, from_id: detected.accountId, _autoDetect: detected };
  }
}
```

---

## 4. Suffix Matching Logic

**Field tried (in order):** `a.account_no` first (L70), then `a.card_last4` (L79). Both client-side and edge-server.

**Wildcard handling:** `extractVisibleSuffix` strips everything before the trailing digits — works on `*`, `x`, `X` masks and dashes/spaces:

```js
// accountDetection.js:28-35
const m1 = masked.match(/[*xX]+(\d+)\s*$/);              // ← matches "****88"
if (m1) return m1[1];                                    // → "88"
const cleaned = masked.replace(/[\s\-]/g, "");
const m2 = cleaned.match(/(\d+)$/);
return m2 ? m2[1] : null;
```

**Min length:** **2** (per `for (const len of [4, 3, 2])` loop, gated by `suffix.length >= 2` precondition). Confirmed identical between client (`accountDetection.js`) and edge (`gmail-sync/index.ts:291`).

---

## 5. Currency Disambiguation

**Client:** `pickBestAccount` (`accountDetection.js:38-50`) — sort order:
1. Exact `bank_name` equality
2. `currency` equality (`a.currency === currency`)
3. `sort_order` numeric

**Edge:** `pickBest` (`gmail-sync/index.ts:275-288`) — identical sort except:
- The accounts query (L361) **does NOT select `currency`**, so `a.currency` is always undefined → currency tiebreak is effectively a no-op server-side.

---

## 6. Manual Trace — Sample BCA QRIS Email

**Assumed AI-extracted JSON for this email (best case):**

```jsonc
{
  "date": "2026-05-14",
  "merchant_name": "6863GUARD ORANGE GROOVE",
  "amount": 153500, "amount_idr": 153500, "currency": "IDR",
  "card_last4": null,
  "from_account_masked": "TAHAPAN - 0831****88",
  "from_bank_name": "BCA",
  "is_qris": true,
  "suggested_tx_type": "qris_debit",
  "from_account_id": null
}
```

### 6a. Server-side `resolveAccountIds` → `matchAccount`

- `suffix = extractVisibleSuffix("TAHAPAN - 0831****88")` → `"88"` (regex matches `****88`)
- `bankName = "BCA"`, `txBankLower = "bca"`
- Pool filter `gmail-sync/index.ts:261-267`:
  ```ts
  accounts.filter(a => {
    if (!a.bank_name || !a.is_active) return false;   // ← BUG: see §8
    const accBank = a.bank_name.toLowerCase();
    return accBank === txBankLower
      || txBankLower.includes(accBank)
      || accBank.includes(txBankLower);
  })
  ```
- **Critical**: the accounts SELECT at L361 is `"id,name,type,last4,account_no,bank_name"` — it does **NOT** include `is_active`. So `a.is_active === undefined` for every row → `!a.is_active === true` → **every account is filtered out** → `pool = []` → `matchAccount` returns `null`.
- Result: `from_account_id = null` for BCA QRIS, in fact for **every** email. This matches memory `#20` ("auto-detect dropped & broken per 2026-05-04").

### 6b. Client-side `detectAccount` (Phase 1 suffix)

Input (assuming AI populated both fields):

```js
{
  subject:   "Successful QRIS Transaction",
  sender:    "noreply@bca.co.id",
  cardLast4: null,
  pdfText:   "TAHAPAN - 0831****88",
  bankName:  "BCA",
  currency:  "IDR",
  accounts:  spendAccounts,         // bank (not subtype=reimburse) + credit_card
}
```

- `suffix = "88"`, `length 2 ≥ 2`, `bankName = "BCA"` → enter Phase 1.
- `pool`: filter `spendAccounts` for accounts whose `bank_name` fuzzy-matches "BCA". If BCA share is in `spendAccounts` and `bank_name = "BCA"`, **it's in the pool**.
- Loop `len = [4,3,2]`, only `len=2` runs (suffix is 2 chars):
  - `byAcct = pool.filter(a => a.account_no && String(a.account_no).endsWith("88"))` → `0831361688` ends with `88` ✓ → BCA share matches.
  - `pickBestAccount(byAcct, "BCA", "IDR")` → returns BCA share.
- **Expected return:** `{ accountId: <bca-share-id>, confidence: 'high', matchedBy: ['account_no_suffix'] }`.

**This means, IF the AI actually extracts both `from_account_masked` AND `from_bank_name`, the client suffix path should match BCA share.** Since the user reports null, one of these inputs is missing or the BCA share isn't in `spendAccounts`.

### 6c. Client-side fallback (Phase 2 keyword)

If AI returns `from_account_masked = null` AND `from_bank_name = null` (e.g. Haiku missed both for the QRIS layout):
- `pdfText = null` → Phase 1 skipped entirely.
- `haystack = "successful qris transaction noreply@bca.co.id "` (assuming the sender domain literally contains "bca").
- For BCA share account (`bank_name = "BCA"`, `name = "BCA share"`, `card_last4 = null`):
  - Skip card_last4 branch (acc.card_last4 falsy).
  - bank_name branch: `bnLower = "bca"`, `"bca".length = 3 ≥ 3` and `haystack.includes("bca")` → +30, matchedBy `bank_name`.
  - Keyword group: "bca" keyword group includes `'bca'` → `haystack.includes("bca")` → +20; `senderL.includes("bca")` → +15 sender bonus, matchedBy `sender`.
  - **Subtotal: 65 → confidence `'high'`** (≥45).
- Result: still a match.

### 6d. Failure scenarios that cause Phase 1 + Phase 2 both to return null

The only ways the client returns `null` for a BCA QRIS email with a recognizable sender are:

| # | Condition | How it causes null |
|---|---|---|
| **F1** | `spendAccounts` excludes the BCA share account | If BCA share has `subtype = "reimburse"` (filter at `Email.jsx:413`) or non-`bank`/`credit_card` type (e.g. someone tagged it as `joint_account`), detect never sees it. Other BCA accounts in `spendAccounts` would still keyword-match → would return SOME BCA account (not null), so this only causes null if the user has **no other BCA bank account** in spendAccounts. |
| **F2** | The BCA share account's `bank_name` is empty/null in DB | bank_name branch (L129) is gated on `acc.bank_name` truthy. With null, only the name-fallback (L168) runs, scoring +15 if `"bca share"` is a substring of haystack. `haystack.includes("bca share")` is **false** unless the email body literally says "bca share" — almost never. Score stays 0 → null. |
| **F3** | `sender_email` for these rows is empty or non-BCA | If the email was forwarded or `s.sender_email` is null, the sender bonus and the substring "bca" disappears from haystack. With `subject` lacking "bca" too (e.g. "QRIS Payment Successful"), keyword scoring drops to 0. |
| **F4** | AI emits `from_bank_name: "BCA"` but `from_account_masked: null` AND `cardLast4: null` AND sender lacks "bca" | Phase 1 needs `pdfText` (so `null` skips it). Phase 2 with bankName but empty haystack → no keyword hit → null. |
| **F5** | `accounts` array reaches detectAccount as `[]` (e.g. `spendAccounts.length === 0`) | Returns null at L53. Only happens if user has zero non-reimburse bank accounts and zero credit cards. Unlikely. |

---

## 7. `ai_raw_result` Real Data Sample

**Not available in this session.** No Supabase MCP / CLI is connected. The query you suggested:

```sql
SELECT id, sender_email, subject, ai_raw_result->0 AS first_tx, status
FROM email_sync
WHERE user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND status IN ('pending','review')
  AND sender_email LIKE '%bca%'
LIMIT 3;
```

…needs to be run by you in the Supabase SQL editor or `supabase db --linked`. The two fields that would pinpoint the failure mode are:

- `first_tx ->> 'from_account_masked'` — is it `"TAHAPAN - 0831****88"` or `null`?
- `first_tx ->> 'from_bank_name'` — is it `"BCA"` or `null`?
- `sender_email` — does it contain `"bca"` literally?

Without that, the diagnosis below ranks hypotheses by likelihood given the code.

---

## 8. Root Cause Hypothesis (ranked)

### H1 (highest): Server-side `matchAccount` pool is always empty due to missing `is_active` in SELECT

**Where:** `supabase/functions/gmail-sync/index.ts:361` and `:692`:
```ts
const { data: accounts } = await supabase.from("accounts")
  .select("id,name,type,last4,account_no,bank_name")        // ← no `is_active`
  .eq("user_id", userId).eq("is_active", true);
```

Then in `matchAccount` (L262):
```ts
if (!a.bank_name || !a.is_active) return false;   // a.is_active === undefined → !undefined === true
```

→ every account is rejected → `pool = []` → `matchAccount` returns `null` for every transaction. This is exactly the symptom described in memory `#20`: "Auto-detect dropped & broken per 2026-05-04". The query *filtered* by `is_active=true` but did not *select* the column, so the post-fetch JS filter rejected everything.

Same bug at L692 (the reprocess code path).

**Bonus bug:** the SELECT pulls `last4`, but the DB column is `card_last4` (confirmed by `src/components/Accounts.jsx:165` writing `card_last4: form.last4 || null` and `CreditCards.jsx:465, 516`). So `a.card_last4` is undefined in the edge function — the byCardLast4 branch (L299) never matches. For BCA QRIS this doesn't matter (account_no path is what should match), but it is dead code right now.

### H2 (likely): For BCA QRIS, the AI omits `from_bank_name` (and possibly `from_account_masked`)

The prompt has no dedicated rule for BCA QRIS (only patterns 1, 3, 4, 5 — pattern 4 is BCA card notifications, different subjects). With no example for the "Acquirer: BCA" / "Source of Fund: TAHAPAN - …" layout, Haiku-4.5 is inconsistent. If `from_bank_name` is null, the client's Phase 1 suffix block is **gated** (`if (suffix && suffix.length >= 2 && bankName)`) and skipped. Phase 2 keyword still works **provided** the sender domain contains "bca" (or `subject` does).

### H3 (plausible): `spendAccounts` filter excludes the BCA "share" account

`Email.jsx:412-415`:
```js
const spendAccounts = accounts.filter(a =>
  (a.type === "bank" && a.subtype !== "reimburse") ||
  a.type === "credit_card"
);
```

If the BCA share account is tagged `subtype = "reimburse"` (or has a non-standard `type` like `joint_account`), `detectAccount` never receives it. Other BCA accounts (if any) would still keyword-match and return *some* match. Returns null only if **no** in-scope BCA account survives the filter.

### H4 (less likely): `bank_name` is null on the BCA accounts

If the user created the account without setting `bank_name` (or `bank_name = ""`), Phase 1 pool filter (L60) and Phase 2 bank-name branch (L129) both skip. Phase 2 falls to name-fallback (L168), which only fires if the account's `name` is a substring of the haystack — practically never for "BCA share" against a typical QRIS email body.

### Why "kemarin worked, today regressed"

- Pre 2026-05-04: server `resolveAccountIds` worked (maybe `is_active` was actually selected in an earlier version, then someone simplified the SELECT) → `matched_account_id` populated → client never needed to detect → from_id pre-filled regardless of any client-side gap. Today the server is silently always-null, so the burden falls on the client, exposing the missing/inconsistent AI fields for QRIS.

---

## 9. Suggested Fix (NOT IMPLEMENTED)

Listed minimal → broader. Combined, F1 + F2 should restore pre-2026-05-04 behaviour.

### F1 (one-line, fixes ALL non-QRIS too — high priority): Restore server-side suffix matching

`supabase/functions/gmail-sync/index.ts:361` and `:692` — add `is_active` (and `card_last4`, `currency` for completeness) to the SELECT so post-fetch filters and currency tiebreak actually function:

```ts
- .select("id,name,type,last4,account_no,bank_name")
+ .select("id,name,type,card_last4,account_no,bank_name,is_active,currency,sort_order,subtype")
```

Then in `matchAccount` (L295, L299) the existing logic reads correct values. Also rename L262 `!a.is_active` to `a.is_active === false` to be consistent with client behaviour (treat undefined as active), in case the column ever isn't returned.

Deploy: `supabase functions deploy gmail-sync`.

### F2 (prompt fix): Add a dedicated BCA QRIS pattern

`supabase/functions/gmail-sync/index.ts:165-172` — append a pattern 6 so Haiku reliably extracts `from_account_masked` and `from_bank_name` for QRIS emails:

```
6. BCA QRIS (subject contains "QRIS", body has "Source of Fund" and "Acquirer"):
   - Extract "Source of Fund" → from_account_masked (e.g. "TAHAPAN - 0831****88")
   - Extract bank from "Source of Fund" product (Tahapan/BCA/Mandiri/…) → from_bank_name = "BCA"
   - amount = "Total Payment" (IDR), strip "IDR" + commas
   - merchant_name = "Payment to" value (cleaned)
   - suggested_tx_type = "qris_debit", is_qris = true
   - confidence = 0.95
```

### F3 (defensive — client): Drop the `bankName` gate on Phase 1 suffix

`src/lib/accountDetection.js:57` — let suffix matching fall back to "any account with that suffix" when `bankName` is missing, then let `pickBestAccount` disambiguate:

```js
- if (suffix && suffix.length >= 2 && bankName) {
+ if (suffix && suffix.length >= 2) {
+   const txBankLower = bankName ? bankName.toLowerCase() : null;
+   const pool = txBankLower
+     ? accounts.filter(a => /* same fuzzy bank match as today */)
+     : accounts.filter(a => a.bank_name && a.is_active !== false);
    ...
```

This makes the client robust to H2 (AI omits `from_bank_name`).

### F4 (UX — narrow): Widen `spendAccounts` to include `subtype = "reimburse"`

`src/components/Email.jsx:412-415` — let detection see reimburse-flagged bank accounts (still bank accounts), to handle H3:

```js
const spendAccounts = accounts.filter(a => a.type === "bank" || a.type === "credit_card");
```

(Or whitelist by `type` only; the `subtype !== "reimburse"` carve-out was a UI choice for AI Scan and probably shouldn't apply to email detection.)

### F5 (only if needed): Surface why detection failed

In `_autoDetect`, optionally include `{ reason: "no_suffix_match" | "no_keyword_hit" | "out_of_pool" }` so the user can see in DevTools why a row didn't pre-fill. Pure observability; no behaviour change.

---

## Summary

The dropdown stays empty for BCA QRIS because (almost certainly) **server-side `resolveAccountIds` is silently a no-op** (missing `is_active` column in SELECT → `pool = []` → null for every transaction) **and** the BCA QRIS email layout isn't covered by any specific Haiku prompt rule, so client-side fields needed for Phase 1 suffix matching (`from_account_masked`, `from_bank_name`) may be missing, and client falls back to keyword scoring which itself fails if the BCA share account is excluded from `spendAccounts` (`subtype="reimburse"`) or has a blank `bank_name`.

Recommended order to fix (no implementation):
1. Patch the edge-function SELECT (`F1`) — restores most of the pre-regression behaviour for all banks, including BCA QRIS, without any prompt change.
2. Add a BCA QRIS prompt rule (`F2`) — eliminates the residual gap.
3. Optionally drop the `bankName` gate client-side (`F3`) and widen `spendAccounts` (`F4`) as defensive improvements.

To confirm before implementing, query `email_sync` for one BCA QRIS row's `ai_raw_result->0` and verify the three values listed in §7.
