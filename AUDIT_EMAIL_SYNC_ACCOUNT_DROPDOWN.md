# Email Sync — Account Dropdown Audit

**Status:** READ-ONLY audit. No code changes made.
**Date:** 2026-05-15
**Symptom:** "From Account…" dropdown in Email Pending review list appears empty (no pre-selected default, user reports unable to pick option). Worked yesterday, regressed today.

---

## 0. UI Location Clarification

User said "Email Pending review list di Settings page". This is technically inaccurate — the actual review list lives on the **Email** page (top-level tab, `App.js:418`), not in Settings.

- **`Settings.jsx` subTab `email`** (`Settings.jsx:633`–`785`) only renders: Gmail connection card, Manual Sync date range, Sync History, Skipped Transactions, Setup Guide. **It does NOT render TxHorizontal.**
- **`Email.jsx` page** renders two pills: `✉️ Email Pending` and `🔄 Email Sync` (`Email.jsx:175-176`). The `pending` tab renders `<EmailPendingTab>` (`Email.jsx:201`), which is the only place TxHorizontal is invoked for the Gmail flow.

So this audit focuses on `Email.jsx → EmailPendingTab → TxHorizontal`.

---

## 1. TxHorizontal Component

- **File:** `src/components/shared/TxHorizontal.jsx`
- **Props received (relevant subset):**
  - `rows: TxRow[]` — flat editable rows (`L841`)
  - `accounts: Account[]` — full accounts list (`L851`)
  - `employeeLoans: EmployeeLoan[]` (`L852`)
  - `source: 'ai_scan'|'estatement'|'gmail'` (`L850`)
  - `categories`, `incomeSrcs`, `recurTemplates`, `T`, `busy`, etc.
- **Account dropdown rendering:**
  - Row-level dropdown rendered via `<AccountCell>` (`L389-449`) → delegates to `<TabbedAcctSelect>` (`L58-128`).
  - `<TabbedAcctSelect>` partitions accounts by `type`: bank, cash, credit_card, other (asset/receivable/liability). Renders `[B] [C] [CC]` tabs inline + a `<select>` (`L82-127`).
  - The list shown comes from `cfg.from` or `cfg.to` (per `tx_type`) computed in `getAcctCfg(txType, accounts)` (`L133-156`).
  - For `tx_type="expense"` (default for Gmail rows): `cfg = { mode: "from", from: bccc }` where `bccc = accounts.filter(a => ["bank","cash","credit_card"].includes(a.type))` (`L154`).
- **Dropdown source — important:** `<TabbedAcctSelect>` does **NOT** apply any `is_active` filter (`L58-127`). It only filters by `type`. So an active+inactive bank account would both show. *(However the Bulk-Edit inline form at `L1093` and `L1113` does apply `if (!a.is_active) return false;` — that is a separate code path.)*

```js
// L102-126 — actual <select> render
<select style={{ ...inSel(T), flex: 1, minWidth: 0 }}
  value={value || ""}
  onChange={e => onChange(e.target.value)}>
  <option value="">{placeholder}</option>           // ← placeholder "From Account…"
  {activeAccs.map(a => (
    <option key={a.id} value={a.id}>
      {a.name}{showLast4 && a.card_last4 ? ` ···${a.card_last4}` : ""}
    </option>
  ))}
  ...optgroups for other types
</select>
```

---

## 2. Settings / Email Pending Parent

- **File:** `src/components/Email.jsx`
- **Component:** `EmailPendingTab` (`L376`)
- **TxHorizontal invocation:** `Email.jsx:741-763`

```jsx
<TxHorizontal
  rows={rows}
  selected={selected}
  ...
  source="gmail"
  accounts={accounts}                  // L755 — passed straight through, UNFILTERED
  employeeLoans={employeeLoans}
  categories={categories}
  incomeSrcs={incomeSrcs}
  recurTemplates={recurTemplates}
  T={T}
  busy={importing}
  onMergeTransfer={handleMergeTransfer}
/>
```

- **`accounts` prop value:** Comes from `App.js:359-376` shared spread → originally fetched in `App.js:243` via `accountsApi.getAll(user.id)` (`src/api.js:144-147`), which filters `.neq("is_active", false)` (includes is_active=true and null, excludes false). No additional filter is applied before reaching `EmailPendingTab`.
- **Filter applied at parent level?** **No.** `accounts` is forwarded verbatim. There is a `spendAccounts = accounts.filter(a => (a.type === "bank" && a.subtype !== "reimburse") || a.type === "credit_card")` at `Email.jsx:412`, but that derivation is **only used as input to `detectAccount(...)` for auto-detect**, not passed to TxHorizontal.

---

## 3. Recent Commits (Last 20 — relevant files)

### TxHorizontal.jsx
```
13f23f6 feat(bills): inline Bill picker di TxHorizontal expanded row
e4cb141 feat(bills): manual Bill picker in TxVerticalBig modal …
aa6153f feat(bulk-edit): inline horizontal row replacing modal, per-type aware fields
0b87538 fix(bulk-edit): show button at >=1 selected (was >=2)
ee9a5c1 feat(bulk-edit): unified BulkEditModal replacing 2 inline duplicate bars
082b99a chore(t3b-5): remove all EXPENSE_CATEGORIES/INCOME_CATEGORIES_LIST callers
32b1799 chore(t3b-3): TxHorizontal swap static categories → DB props
```
**No commit within the last ~14 commits touched the account-dropdown rendering logic (`TabbedAcctSelect` / `AccountCell` / `getAcctCfg`).**

### Email.jsx (recent)
```
d41b993 fix(upcoming) … fix(email): propagate setReminders after auto-confirm …
24caca3 fix(email-sync): per-tx confirmation tracking for multi-tx batches
468efb8 fix(email-import): remove double onRefresh + toast race condition …
a49ad04 feat(recurring): rename Bill→Recurring + client-side detectAccount suffix matching fallback
74cc244 fix(gmail-sync): fuzzy bank_name match
014d9e1 fix(gmail-sync): relax matchAccount suffix length 4→2 + currency disambiguation
2c1fc30 fix(email): collect_loan import use employee_loan_id + ledgerId linkage
c822982 fix(email): wire detectAccount with card_last4 + masked, add server suffix min-length guard
0d54fa8 feat: auto-detect account in 3 import flows (AI Scan, E-Statement, Gmail Sync)
```
**Recent Email.jsx commits are about reminder/toast/per-tx tracking, not the account-dropdown rendering or `accounts` prop wiring.**

### src/api.js (around `flattenEmailSync`)
- `24caca3` added per-tx skip flag filter inside `flattenEmailSync` (`L1472`).
- No other recent touch to `flattenEmailSync` field mapping.

---

## 4. Notifications K/M Fix Impact

`HEAD = 99b373e` — `fix(notifications): use full IDR format instead of K/M abbreviation`

```
src/components/Notifications.jsx | 2 +-
1 file changed, 1 insertion(+), 1 deletion(-)
```

**Files changed:** `src/components/Notifications.jsx` only (one-line change).
**Touch on Email Sync / TxHorizontal / accounts logic?** **No.** This commit is fully orthogonal to the email-import dropdown flow.

`HEAD~1 = 71d4357 feat(transactions): expand search …` → `Transactions.jsx` only.
`HEAD~2 = d5982ae` → audit `.md` only.
`HEAD~3 = ea5ae96 fix(cc) …` → `CreditCards.jsx` only.
`HEAD~4 = fcd0116` → audit `.md` only.
`HEAD~5 = 26c3c22` → `CreditCards.jsx` only.

**None of the last 6 commits touch any file in the Gmail import dropdown code path.** This rules out a code-level regression introduced in the immediately preceding commits.

---

## 5. Comparison with Other Flows (AIImport)

- **Same TxHorizontal component?** Yes (`AIImport.jsx:10` imports it, `AIImport.jsx:825` invokes it).
- **Different prop passing?** **No — essentially identical for `accounts`:**

```jsx
// AIImport.jsx:825-847
<TxHorizontal
  rows={results}
  ...
  source="ai_scan"
  accounts={accounts}              // ← also unfiltered, same source as Email
  employeeLoans={employeeLoans}
  categories={categories}
  incomeSrcs={incomeSrcs}
  ...
/>
```

- **Implication:** If AIImport's "From Account" dropdown is working today, the Email flow's dropdown must also be rendering with the same option list. The difference between the two flows is **what pre-fills `row.from_id`**, not the option list itself:
  - **AIImport** — `from_id` typically extracted from `detectAccount` on PDF/statement text (often high confidence due to readable account_no / bank).
  - **Email Sync** — `from_id` set from server `matched_account_id` (which per memory `#20` is dropped/broken) OR client-side `detectAccount` (only commits if confidence ≥ medium per `Email.jsx:434`). Many Gmail rows currently fail both → `from_id = ""` → dropdown renders the placeholder `"From Account…"` with no pre-selection.

---

## 6. flattenEmailSync / Data Shape

- **Function:** `flattenEmailSync` at `src/api.js:1465-1504`
- **Email_sync row → TxHorizontal row mapping (account-relevant fields):**

```js
// api.js:1473-1500
{
  id:                 (single-tx ? row.id : `${row.id}_${i}`),
  email_sync_id:      row.id,
  tx_index:           i,
  sender_email:       row.sender_email,
  subject:            row.subject,
  transaction_date:   tx.date,
  merchant_name:      tx.merchant_name || tx.description,
  amount:             tx.amount,
  currency:           tx.currency || "IDR",
  amount_idr:         tx.amount_idr || tx.amount,
  tx_type:            normEmailTxType(...) (default "expense"),
  matched_account_id: tx.from_account_id,    // ← server-side auto-detect (currently broken)
  to_account_id:      tx.to_account_id,
  suggested_category_label: tx.suggested_category,
  entity:             tx.suggested_entity || "Personal",
  from_bank_name:     tx.from_bank_name,    // ← passed to detectAccount as bankName hint
  card_last4:         tx.card_last4,        // ← passed to detectAccount as cardLast4 hint
  is_qris, is_transfer, is_cc_payment,
}
```

Then `syncToRow(s)` in `Email.jsx:20-40` maps these into editable row format:

```js
from_id:       s.matched_account_id || "",   // L33 — empty string if server didn't match
to_id:         s.to_account_id || "",        // L34
```

And the auto-detect fallback runs inside the `useEffect` at `Email.jsx:411-447`:

```js
if (!row.from_id) {
  const detected = detectAccount({
    subject:   s.subject,
    sender,
    cardLast4: s.card_last4 || aiTx?.card_last4 || null,
    pdfText:   aiTx?.from_account_masked || null,
    bankName:  aiTx?.from_bank_name || s.from_bank_name || null,
    currency:  aiTx?.currency || s.currency || null,
    accounts:  spendAccounts,
  });
  if (detected && (detected.confidence === 'high' || detected.confidence === 'medium')) {
    return { ...row, from_id: detected.accountId, _autoDetect: detected };  // ← only sets if ≥ medium
  }
}
```

**Account hints exposed to `detectAccount`:** `sender_email`, `subject`, `card_last4`, `from_account_masked` (if present in ai_raw_result), `from_bank_name`, `currency`.

---

## 7. Root Cause Hypothesis

**Most likely (high confidence):** the dropdown is NOT actually empty of options — it has all bank/cash/CC accounts listed in the `[B][C][CC]` tabbed select. What is empty is the **selected value** (`row.from_id === ""`), so the visible state is the grey placeholder `"From Account…"` with no highlighted choice. The user is reading "no pre-selection" as "dropdown kosong".

Why pre-selection regressed:
1. Per memory `#20`, the **edge-function `gmail-sync` auto-detect was dropped on 2026-05-04**, so `ai_raw_result[i].from_account_id` arrives as `null` for fresh syncs → `matched_account_id` is null → `row.from_id = ""` after `syncToRow`.
2. The **client-side `detectAccount` fallback** (`Email.jsx:425-436`) only commits a result if `confidence === 'high' || 'medium'`. For many Gmail notifications, the available signal is weak (e.g. notification-style email with no card_last4 in body, no `from_account_masked`, generic sender like `notification@bca.co.id`). Scoring ends up `< 30` → confidence `'low'` → discarded → `from_id` stays `""`.
3. So **as of today, the typical Gmail row has no pre-selected from-account.** Yesterday this may have worked if (a) the user's last sync still had server-side `matched_account_id` populated (pre-2026-05-04 rows already in `email_sync` table), or (b) yesterday's emails happened to score ≥ 30 (medium) but today's don't.

**Less likely (worth checking):**
- If user has zero `bank`/`cash`/`credit_card` accounts where `is_active != false` (e.g. all bank accounts were toggled inactive), then `bccc = []` → tabs `[]` → fallback to full `accounts` list — but specifically for tx_type=expense that still includes any other types, so the dropdown wouldn't be literally empty.
- If `accounts` prop is unexpectedly `[]` during render (e.g. partial reload), but `App.js:378-387` blocks render with `<Spinner>` while `loading` — unlikely.
- If `tx_type` after `normEmailTxType` is something that maps to a special cell (`collect_loan`, `give_loan`, `buy_asset`) and the relevant secondary list is empty (employeeLoans empty, assets empty). For Gmail rows this shouldn't happen by default — `normEmailTxType` defaults to `"expense"` — but if `tx.suggested_tx_type` is `"collect_loan"` for some emails, the CollectLoanCell would show a "Borrower…" select with 0 options when no active employee loans exist.

---

## 8. Suggested Fix (NOT IMPLEMENTED)

Listed minimal → broader.

### 8a. Minimal: also accept `'low'` confidence as pre-fill (auto-detect path)

In `Email.jsx:434`, broaden the gate so even a weak match becomes the default selection (still user-editable):

```js
// Email.jsx:434
- if (detected && (detected.confidence === 'high' || detected.confidence === 'medium')) {
+ if (detected && detected.accountId) {
    return { ...row, from_id: detected.accountId, _autoDetect: detected };
  }
```

The auto-detect badge (`r._autoDetect`) is already rendered in `TxHorizontalCard` (`L539-547`) so the user sees ✨ on low-confidence picks and can override.

### 8b. Better UX: explicit "needs review" highlight when `from_id` is empty

Render the from-account `<select>` with a red/amber border when its value is empty, so the user immediately sees "this dropdown needs my attention" rather than a soft grey placeholder. Touch in `TabbedAcctSelect` (`L102`) — conditional border colour when `!value`.

### 8c. Last-used account heuristic

If `detectAccount` returns null and the user has previously imported from this `sender_email` (lookup recent ledger entries with `source='gmail'` + matching merchant/subject), pre-fill `from_id` from the historical pick. Lives in `Email.jsx:411-447` useEffect.

### 8d. Restore server-side detection

If the gmail-sync edge function was intentionally broken (per memory `#20`), the longer fix is to re-enable a server-side `detectAccount` so `matched_account_id` lands in `email_sync.ai_raw_result[i].from_account_id` again. Out of scope for a frontend fix.

### 8e. If literal "options empty" (less likely)

If the user can confirm via DevTools the `<select>` actually has 0 `<option>` siblings (i.e. options-empty, not pre-selection-empty), check:
- `accounts.length > 0` at render time
- For row's `tx_type`, the corresponding `cfg.from` / `cfg.to` slice has members
- The `<TabbedAcctSelect>` `activeTab` isn't pointing at an empty tab — see `TxHorizontal.jsx:78` `initTab()`; if `value` matches a type whose tab was omitted (because `bankAccs.length === 0`), `activeTab` falls back to `tabs[0]?.id` which is fine, but the user wouldn't see the value's tab.

---

## Summary

- The Gmail Pending dropdown rendering pipeline (`Email.jsx` → `TxHorizontal.jsx` → `TabbedAcctSelect`) is structurally **identical to AIImport's**, which is presumably still working.
- No code change in the last 6 commits (Notifications K/M, Transactions search, CC opening balance, audits) touches this path. The K/M fix is fully orthogonal.
- The dropdown almost certainly has its full `[B][C][CC]` options — what's missing is a **pre-selected default value**, because (a) server auto-detect was dropped 2026-05-04, and (b) client `detectAccount` only commits at confidence ≥ medium and most Gmail emails fail to reach that threshold.
- Confirm with the user whether "kosong" means *no options to pick* (then investigate `accounts` shape / `cfg.from` filter) or *no default highlighted* (then apply fix 8a or 8b).
