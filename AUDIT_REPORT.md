# CC-Tracker Audit Report
**Date:** 2026-04-29  
**Auditor:** Claude Code (automated static analysis)  
**Scope:** Full source audit — src/api.js, src/App.js, src/components/*, supabase/migrations/*, supabase_*.sql

---

## Section 1 — Critical Bugs

### B1 — `new Date(s.settled_at)` with no null guard → "Jan 1 1970" in Settlement History
**File:** `src/components/Receivables.jsx:915`  
**What's wrong:** `new Date(s.settled_at)` is called directly without checking for null/undefined. `reimburse_settlements` rows created via the `ledgerApi.create` → auto-insert path (api.js:235–245) explicitly set `settled_at: null` for pending settlements. When such a row is displayed, `new Date(null)` resolves to the Unix epoch (Jan 1 1970 00:00:00 UTC), producing a visually incorrect date label.  
**Severity:** HIGH

```js
// Receivables.jsx:915 — current (broken):
const date = new Date(s.settled_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// Also: Receivables.jsx:359 passes null to comparison: new Date(s.settled_at) >= todayMidnight
// new Date(null) = epoch, so this comparison silently returns false but doesn't crash — medium risk.
```

---

### B2 — Fire-and-forget reimburse_settlements INSERT in `ledgerApi.create` (race condition)
**File:** `src/api.js:235–245`  
**What's wrong:** After a `reimburse_out` ledger entry is created, the follow-up INSERT into `reimburse_settlements` is deliberately fire-and-forget:  
```js
supabase.from("reimburse_settlements").insert([{...}]).then(null, (e) => console.error(...));
```
The `then(null, handler)` pattern does NOT await the result. If the caller then immediately calls `onRefresh()`, the settlement row may not yet exist in the database, causing the Receivables page to show stale state. Additionally, the async IIFE for `reimburse_in` settlement updates (lines 249–268) is also not awaited — if the parent `ledgerApi.create` function is awaited by the caller, the settlement state update races with the refresh.  
**Severity:** HIGH (intermittent stale UI, potential missed auto-settlement)

---

### B3 — `recalculateBalance` always writes to `current_balance` regardless of account type
**File:** `src/api.js:330`  
**What's wrong:** After recomputing, the function always writes:
```js
await supabase.from("accounts").update({ current_balance: balance }).eq("id", accountId);
```
But `balField()` shows that asset accounts use `current_value`, liability accounts use `outstanding_amount`, and receivable accounts use `receivable_outstanding`. Assets, liabilities, and receivables that trigger `recalculateBalance` (called from TxVerticalBig.jsx, Transactions.jsx, and AssetTimeline.jsx) will have their balance written to the wrong column, leaving the correct column stale.  
**Severity:** HIGH

---

### B4 — `applyBalanceDelta` fallback path (read-modify-write) has no user_id scope
**File:** `src/api.js:94–99`  
**What's wrong:** When the RPC `increment_account_balance` fails, the fallback reads and writes to `accounts` filtered only by `id`. This is fine for single-tenant use, but if the RPC is missing or broken for any user, the fallback path also silently discards the RPC error (swallowed by the `if (error)` branch without throwing) and continues with a potentially inconsistent balance update.  
**Severity:** MEDIUM

---

### B5 — Settlement delete: `supabase.from("ledger").delete().eq("reimburse_settlement_id", s.id)` has no user_id guard
**File:** `src/components/Receivables.jsx:504`  
**What's wrong:** The delete call filters only on `reimburse_settlement_id` and `tx_type`. Row-Level Security policies should protect this, but the application-level code has no explicit `user_id` guard. If RLS is misconfigured or disabled during a migration window, this would allow deletion of another user's ledger rows.  
**Severity:** MEDIUM

---

### B6 — `new Date(s.settled_at)` comparison with `todayMidnight` (null produces epoch)
**File:** `src/components/Receivables.jsx:359`  
**What's wrong:**
```js
const existingToday = settlements.find(s =>
  s.entity === entity && new Date(s.settled_at) >= todayMidnight
);
```
When `s.settled_at` is null (pending settlement), `new Date(null)` = Unix epoch (January 1, 1970), which is always less than `todayMidnight`. This means pending settlements are silently excluded from the "existing today" check — this is likely the _intended_ behaviour, but it is implicit and fragile. If a pending row is accidentally matched, it would be updated as if it were a settled-today row.  
**Severity:** MEDIUM

---

### B7 — `fxApi.saveHistory` inserts without `user_id` in the row
**File:** `src/api.js:736–741`  
**What's wrong:**
```js
const rows = Object.entries(ratesObj).map(([currency, rate_to_idr]) => ({
  currency, rate_to_idr, recorded_at: new Date().toISOString(),
  // user_id is NOT included
}));
await supabase.from("fx_rate_history").insert(rows);
```
If `fx_rate_history` has RLS requiring `user_id = auth.uid()`, every insert will fail silently (no error check after the insert). If it does not have RLS, the table becomes a shared log with no ownership.  
**Severity:** MEDIUM

---

### B8 — `importSelected` in AIImport silently swallows per-row errors
**File:** `src/components/AIImport.jsx:519–542`  
**What's wrong:**
```js
try {
  const created = await ledgerApi.create(user.id, buildEntry(r), accounts);
  ...
} catch { /* continue */ }
```
Any ledger creation error is swallowed with no user feedback. The toast at the end reports `ok` count, but the user cannot tell which rows failed or why.  
**Severity:** MEDIUM

---

### B9 — `recalculateBalance` does not handle `fx_exchange` / multi-currency correctly
**File:** `src/api.js:307–332`  
**What's wrong:** The recalculate loop uses `amount_idr` for all transactions. For `fx_exchange` transactions, the foreign-currency amount is tracked in `account_currencies`, not via `amount_idr`. The `recalculate` function ignores this entirely — calling it on an FX account will reset its IDR balance from ledger data, but the foreign currency sub-balances will remain stale.  
**Severity:** MEDIUM

---

## Section 2 — Code Health

### H1 — `console.log` left in production
**Files (selection):**
- `src/api.js:106,114` — `[accountsApi.getAll]` logs user ID and result count on every fetch
- `src/api.js:979–1034` — Multiple AI scan debug logs (raw preview, token counts, pass counts)
- `src/components/Assets.jsx:61,62,69,424` — `[AssetHistory]` debug logs
- `src/components/AIImport.jsx:356,358,425,432` — `[AIImport]` result count logs
- `src/components/Settings.jsx:2156,2185` — `[estatement] Saving row` logs
- `src/App.js:240,259,261` — `[loadData]` account counts
- Total: ~35 production console.log/warn statements across the codebase

**Severity:** LOW (no security risk here since none log sensitive PII, but they pollute prod logs)

---

### H2 — Hardcoded entity list duplicated in 3+ places
**What's wrong:** `["Hamasa", "SDC", "Travelio"]` / `ENTITY_CHOICES` / `REIMBURSE_ENTITIES` are defined independently in:
- `src/api.js:232` — `const REIMBURSE_ENTITIES = ["Hamasa", "SDC", "Travelio"]`
- `src/components/Receivables.jsx:30` — `const ENTITY_CHOICES = ["Hamasa", "SDC", "Travelio"]`
- `src/components/AIImport.jsx:65` — `const REIMBURSE_ENTITIES = ["Hamasa", "SDC", "Travelio"]`

Adding a new entity requires updating at least 3 separate files. Should be a single exported constant from `constants.js`.  
**Severity:** MEDIUM (maintainability)

---

### H3 — `loanPaymentsApi.recordAndIncrement` import logic duplicated in 4 places
**What's wrong:** The pattern of creating a `collect_loan` ledger entry and calling `loanPaymentsApi.recordAndIncrement` with a fire-and-forget `.catch` is copy-pasted in:
- `src/components/AIImport.jsx:526–530`
- `src/components/AIImport.jsx:568–572`
- `src/components/Email.jsx:525,569`
- `src/components/Settings.jsx:2191,2243`
- `src/components/shared/ReconcileOverlay.jsx:753`

This is 5+ identical blocks. Should be a shared helper.  
**Severity:** MEDIUM

---

### H4 — `installmentsApi.createFromImport` duplicated in 4 places
**What's wrong:** Similar to H3, the cicilan (installment) creation pattern with `.catch(e => console.error("[cicilan import]", e))` is identically duplicated at:
- `src/components/AIImport.jsx:532–539,572–580`
- `src/components/Email.jsx:533,577`
- `src/components/Settings.jsx:2199,2251`
- `src/components/shared/ReconcileOverlay.jsx:744`  
**Severity:** MEDIUM

---

### H5 — Raw `supabase` calls mixed with `api.js` abstraction layer
**What's wrong:** Several components bypass `api.js` and make direct raw Supabase calls:
- `src/components/Receivables.jsx:322–327,374–411,423–453,480–483,500–506` — Direct `supabase.from("reimburse_settlements")` and `supabase.from("ledger")` calls (no error normalization, no UUID sanitization)
- `src/components/Dashboard.jsx:32–41` — Direct `supabase.from("reconcile_sessions")`
- `src/components/Settings.jsx:58–65` — Direct `supabase.from("reconcile_sessions")`

This means those calls bypass `sanitizeUUIDs`, centralized error handling, and any future query caching.  
**Severity:** MEDIUM

---

### H6 — `App.js:237` — raw `supabase.from("budgets")` inline in `Promise.all`
**File:** `src/App.js:237`  
**What's wrong:**
```js
safe(supabase.from("budgets").select("*").eq("user_id", user.id).then(r => r.data || []), []),
```
This is the only table in `loadData` that doesn't go through the `api.js` layer — it's an inline query with ad-hoc `.then()`. No corresponding `budgetsApi` module exists.  
**Severity:** LOW

---

### H7 — `App.js:201–204` — Hardcoded FX rate defaults
**File:** `src/App.js:201–204`  
**What's wrong:**
```js
const [fxRates, setFxRates] = useState({
  USD: 16400, SGD: 12200, MYR: 3700, JPY: 110, EUR: 17800, AUD: 10500,
  GBP: 21200, CHF: 18500, CNY: 2250, THB: 470, KRW: 12, HKD: 2100,
});
```
These are hardcoded stale defaults. USD/IDR was 16,400 at time of coding but drifts over time. Used as fallback when the DB load fails. Should be clearly documented or sourced from a more recent constant file.  
**Severity:** LOW

---

### H8 — Super-large components (split candidates)
| Component | Lines |
|---|---|
| `Settings.jsx` | 2,723 |
| `Accounts.jsx` | 2,029 |
| `Dashboard.jsx` | 1,882 |
| `CreditCards.jsx` | 1,766 |
| `Receivables.jsx` | 1,647 |
| `ReconcileModal.jsx` | 1,139 |

`Settings.jsx` at 2,723 lines is the most severe — it contains at least 9 logically distinct sub-tabs that should each be their own component.

---

### H9 — AI model string hardcoded in two places
**Files:** `src/api.js:834` and `src/api.js:1430`  
**What's wrong:** `"claude-haiku-4-5-20251001"` appears at line 834 (as a default parameter) and is also set as `AI_MODEL` at line 1430. These should be the same constant.  
**Severity:** LOW

---

### H10 — `recStats` useMemo in Receivables.jsx includes unused fields
**File:** `src/components/Receivables.jsx:170–177`  
**What's wrong:** `recStats` is computed but the derived `aging` field is never rendered anywhere in the JSX. The `entries` field is also unused (reimburse uses `reimburseStats` instead). Dead computation inside a useMemo.  
**Severity:** LOW

---

## Section 3 — Data Integrity

### D1 — `reimburse_settlements.settled_at` is `NOT NULL DEFAULT now()` in v2.3 schema, but application inserts NULL
**Files:** `supabase/migrations/v2.3_reimburse_settlements.sql:7`, `src/api.js:241`  
**What's wrong:** The original schema declares `settled_at timestamptz NOT NULL DEFAULT now()`, but the auto-created pending settlement row (api.js:241) explicitly sets `settled_at: null`. This would have violated the NOT NULL constraint. The v2.4 migration does NOT alter `settled_at` to be nullable. Either the migration was applied before the constraint was enforced, or the `NOT NULL` constraint was dropped manually. The mismatch between schema definition and application code is a latent data integrity hazard.  
**Severity:** HIGH

---

### D2 — `reimburse_settlements.status` column added in v2.4 but not constrained to allowed values
**File:** `supabase/migrations/v2.4_reimburse_pending.sql:5`  
**What's wrong:** `ALTER TABLE reimburse_settlements ADD COLUMN IF NOT EXISTS status text` — no CHECK constraint limiting status to `('pending', 'settled')`. Application code uses only these two values, but nothing in the schema prevents arbitrary strings.  
**Severity:** MEDIUM

---

### D3 — `assets` table: `current_value` defaults to 0, no constraint on category values
**File:** `supabase_session3_assets.sql:18`  
**What's wrong:** `category text NOT NULL` has no CHECK constraint against the `ASSET_CATS` enum the comment references. Arbitrary category strings can be inserted, which would silently cause grouping/filtering bugs in the UI.  
**Severity:** LOW

---

### D4 — `supabase_migrate_tx_type.sql` references `transactions` table, not `ledger`
**File:** `supabase_migrate_tx_type.sql:4`  
**What's wrong:**
```sql
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_type text DEFAULT 'out';
```
The entire application uses a `ledger` table, not `transactions`. This migration appears to target an old schema name. If ever re-run against the production database, it would silently create a column on a non-existent (or irrelevant) `transactions` table.  
**Severity:** MEDIUM (stale migration, could confuse future developers)

---

### D5 — `ledger.reimburse_settlement_id` bulk-update without user_id scope
**File:** `src/components/Receivables.jsx:411,453,500`  
**What's wrong:** 
```js
await supabase.from("ledger").update({ reimburse_settlement_id: ... }).in("id", newIds);
```
These `IN` clauses operate on raw ledger IDs without an additional `user_id` filter. RLS should protect this, but is an application-level best-practice violation.  
**Severity:** LOW (RLS mitigates, but defence-in-depth is missing)

---

## Section 4 — UX/Visual Issues

### U1 — Missing loading state in Settlement History section
**File:** `src/components/Receivables.jsx:321–328`  
**What's wrong:** The `useEffect` that fetches `reimburse_settlements` on mount has no loading state variable. While settlements are being fetched, the "Settlement History" section renders as empty rather than showing a spinner or skeleton. On slow connections this looks like there is no history.  
**Severity:** LOW

---

### U2 — Settle button not disabled while `settling` state is true for OTHER entities
**File:** `src/components/Receivables.jsx:888–902`  
**What's wrong:** The Settle button is disabled when `!canSettle || settling`, but `settling` is a single boolean for the whole component. If a user triggers a settlement for Hamasa, ALL entity settle buttons become disabled until it completes — this is actually correct, but there's no visual indicator on _which_ entity is processing (no per-entity spinner).  
**Severity:** LOW

---

### U3 — `Email.jsx:256` and `Settings.jsx:620` format `last_sync` without null guard
**Files:** `src/components/Email.jsx:256`, `src/components/Settings.jsx:620`  
**What's wrong:**
```jsx
Last sync: {new Date(gmailToken.last_sync).toLocaleString()}
```
If `gmailToken.last_sync` is null or empty string, this renders "Invalid Date".  
**Severity:** MEDIUM

---

### U4 — Inconsistent currency formatting: `fmtIDR` vs raw `toLocaleString("id-ID")`
**What's wrong:** At least 8 locations use `Number(x).toLocaleString("id-ID")` or `"Rp " + x.toLocaleString("id-ID")` directly instead of `fmtIDR()`:
- `src/App.js:424` — Net Worth in sidebar
- `src/components/Dashboard.jsx:85` — `recFmtAmt`
- `src/components/Accounts.jsx:781,840,1452`
- `src/components/CreditCards.jsx:1153`
- `src/components/Settings.jsx:808`
- `src/components/shared/TxHorizontal.jsx:194`

`fmtIDR` applies `Math.round(Math.abs(...))` which prevents display of negative values and fractional cents. Places using raw `toLocaleString` may display negative signs or decimal places inconsistently.  
**Severity:** LOW

---

### U5 — `AIImport.jsx` import loop silently continues on error with no per-row feedback
**File:** `src/components/AIImport.jsx:541`  
**What's wrong:** `} catch { /* continue */ }` — when a row fails to import, the user only sees the final count mismatch (`Imported X of Y entries`) but doesn't know which rows failed or why.  
**Severity:** MEDIUM

---

## Section 5 — Performance

### P1 — Sequential `await` inside `for` loop in `ReconcileOverlay.jsx` "Confirm All"
**File:** `src/components/shared/ReconcileOverlay.jsx:778`  
**What's wrong:**
```js
onConfirmAll={async (sel) => { for (const r of sel) await confirmRow(r); }}
```
Each row confirmation hits the database sequentially. With 20 rows, this is 20 sequential round-trips instead of a batched insert or `Promise.all`. Could take 10–20 seconds for a typical statement.  
**Severity:** HIGH (performance)

---

### P2 — `loadData` fetches all ledger entries with `limit: 500`, no pagination
**File:** `src/App.js:222`  
**What's wrong:** `ledgerApi.getAll(user.id, { limit: 500 })` — hard-coded 500 row limit passed as a parameter, but no pagination or cursor exists. As the ledger grows beyond 500 entries, older transactions become invisible to all views (Reports, Transactions filter, Calendar). For a long-term user, this silently truncates history.  
**Severity:** HIGH (data completeness)

---

### P3 — `reimburseStats` useMemo iterates entire ledger on every render that changes ledger
**File:** `src/components/Receivables.jsx:186–199`  
**What's wrong:** `reimburseStats` walks the full `ledger` array every time. Since `ledger` is a global state updated by many operations, this recomputes frequently. For 500 entries this is fast, but as ledger grows this will slow down. This is compounded by `recStats` (line 170) running another full pass.  
**Severity:** LOW (acceptable at current scale, watch at >1000 entries)

---

### P4 — `Dashboard.jsx` `useEffect` with implicit/missing deps
**File:** `src/components/Dashboard.jsx:42` (ReconcileStatusWidget)  
**What's wrong:** 
```js
useEffect(() => {
  ...
}, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
```
The `eslint-disable` comment hides a real dependency: the `accounts` prop changes whenever accounts are refreshed, but the reconcile status data is never refetched. This means reconcile status can show stale "last reconciled" times after a reconciliation until a full page refresh.  
**Severity:** LOW

---

### P5 — `Settings.jsx:2519` `useEffect` cleanup has empty deps `[]`
**File:** `src/components/Settings.jsx:2519`  
**What's wrong:**
```js
useEffect(() => () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); }, []); // eslint-disable-line
```
The `pdfBlobUrl` dependency is omitted. If `pdfBlobUrl` changes (e.g., a new file is selected), the old blob URL is not revoked on change — only on unmount. This is a mild memory leak for long sessions with multiple PDF previews.  
**Severity:** LOW

---

## Section 6 — Security/Privacy

### S1 — `api.js:106,114` logs user ID to browser console
**File:** `src/api.js:106,114`  
**What's wrong:**
```js
console.log("[accountsApi.getAll] fetching for user:", userId);
```
The Supabase user UUID is logged on every account fetch. While UUIDs are not passwords, they are a personal identifier that should not appear in browser DevTools in production.  
**Severity:** MEDIUM

---

### S2 — `api.js:979–980` logs raw AI bank statement response preview
**File:** `src/api.js:979–980`  
**What's wrong:**
```js
console.log(`[AI scan] pass=${_aiPass} stop_reason=... input_tokens=...`);
console.log("[AI scan] raw preview:", raw.slice(0, 400));
```
The first 400 characters of the AI response — which contains parsed bank transaction descriptions, amounts, and possibly account details — are logged to the browser console.  
**Severity:** MEDIUM

---

### S3 — `accountCurrenciesApi.getForAccount` has no user_id filter
**File:** `src/api.js:618–625`  
**What's wrong:**
```js
getForAccount: async (accountId) => {
  const { data } = await supabase
    .from("account_currencies")
    .select("*")
    .eq("account_id", accountId);
```
This query is scoped only by `account_id`. If RLS on `account_currencies` does not enforce `user_id = auth.uid()`, a caller passing any `accountId` could read another user's currency balances. Relies entirely on RLS for multi-tenant isolation.  
**Severity:** MEDIUM (RLS-dependent; application should add defence-in-depth)

---

### S4 — Hardcoded Supabase anon key read from `process.env` in three separate fetch calls
**Files:** `src/api.js:957,1175,1218,1434`  
**What's wrong:** The Supabase anon key is read inline at 4 locations within `api.js` rather than being read once and imported from a single auth module or `constants.js`. There is inconsistency: `constants.js:180` exports `AI_ANON_KEY` but the scan and gmail API calls don't use that export — they re-read `process.env.REACT_APP_SUPABASE_ANON_KEY` directly. No secrets are hardcoded in the repo (correct), but the pattern is inconsistent.  
**Severity:** LOW

---

## Summary Table

| Section | Finding Count | High | Medium | Low |
|---|---|---|---|---|
| Section 1 — Critical Bugs | 9 | 3 | 6 | 0 |
| Section 2 — Code Health | 10 | 0 | 4 | 6 |
| Section 3 — Data Integrity | 5 | 1 | 2 | 2 |
| Section 4 — UX/Visual | 5 | 0 | 2 | 3 |
| Section 5 — Performance | 5 | 2 | 0 | 3 |
| Section 6 — Security/Privacy | 4 | 0 | 3 | 1 |
| **Total** | **38** | **6** | **17** | **15** |

---

## Top 5 Most Critical Findings

1. **B1 (HIGH)** — `Receivables.jsx:915`: `new Date(s.settled_at)` with no null guard renders "Jan 1, 1970" for pending settlements whose `settled_at` is null.

2. **D1 (HIGH)** — Schema vs code mismatch: `reimburse_settlements.settled_at` declared `NOT NULL` in migration v2.3 but application inserts `null` for pending rows (api.js:241). Latent constraint violation that could surface on schema redeployment.

3. **B3 (HIGH)** — `recalculateBalance` (api.js:330) always writes to `current_balance` regardless of account type — asset, liability, and receivable accounts will have their balances written to the wrong column, causing silent data corruption on reconcile/recalculate operations.

4. **P1 (HIGH)** — `ReconcileOverlay.jsx:778`: `for (const r of sel) await confirmRow(r)` — sequential DB round-trips in "Confirm All" causes 10–20 second hangs for typical bank statement sizes.

5. **P2 (HIGH)** — `App.js:222`: `ledgerApi.getAll(user.id, { limit: 500 })` — hard-coded 500-entry ledger limit silently truncates history for mature users, making older transactions invisible across all views.
