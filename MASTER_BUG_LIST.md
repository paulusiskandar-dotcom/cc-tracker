# Master Bug List — Stabilization Sprint
**Date:** 2026-05-02
**Re-audit after:** Batch 1, 2, 3 fixes (commits up to `0dac8f9`)
**Previous audit:** AUDIT_REPORT.md (archived)

---

## Severity Definitions
- 🔴 CRITICAL — Data corruption, wrong calculations, completely broken flow
- 🟠 HIGH — Visible bug affecting daily use, but workaround exists
- 🟡 MEDIUM — Minor but persistent issue, could compound over time
- 🟢 LOW — Cosmetic, edge case, nice-to-have

---

## Section A: Critical Issues (🔴)

### A1 · Duplicate migration version numbers
**Severity:** 🔴 CRITICAL (schema ops)
**Files:** `supabase/migrations/`

Three files named `v2.1_*` and two named `v2.5_*`:
```
v2.1_gmail_tables.sql
v2.1_ledger_columns.sql
v2.1_merchant_mappings.sql   ← 3 files at v2.1

v2.5_estatement_account.sql
v2.5_settlement_nullable_date.sql  ← 2 files at v2.5
```
Also two files with no version prefix at all:
```
create_import_drafts.sql
create_merchant_rules.sql
```
Any automated migration tool (Supabase CLI `db push`, CI/CD) will fail or apply them in undefined order. Running `v2.5_settlement_nullable_date.sql` before `v2.5_estatement_account.sql` could silently break schema state.

**Fix:** Rename to `v2.1a_`, `v2.1b_`, `v2.5a_`, `v2.5b_` or increment to free version numbers. Prefix the two unprefixed files.

---

### A2 · ReconcileModal.jsx is dead code (replaced by ReconcileOverlay)
**Severity:** 🔴 CRITICAL (maintenance trap)
**File:** `src/components/ReconcileModal.jsx` (1147 lines)

Zero imports found across the entire codebase. The active reconcile component is `src/components/shared/ReconcileOverlay.jsx`. ReconcileModal.jsx still exists and diverges — any developer debugging reconcile would likely read/edit the wrong file.

The parallel `confirmMissingAll` fix (commit `d67e4e0`) was applied to ReconcileModal.jsx, not ReconcileOverlay.jsx. Verify ReconcileOverlay.jsx has the same chunked parallelism.

**Fix:** Delete `ReconcileModal.jsx` or clearly mark it `// DEPRECATED`. Verify ReconcileOverlay.jsx has all intended fixes.

---

### A3 · EmployeeLoanStatement.jsx is dead code
**Severity:** 🔴 (maintenance) / 🟡 (runtime)
**File:** `src/components/EmployeeLoanStatement.jsx`

Zero imports anywhere in the codebase. The loan statement UI appears to have been inlined into Receivables.jsx. This file is a maintenance trap — it will drift from the real implementation.

**Fix:** Delete or convert to a shared sub-component and import it.

---

### A4 · Upcoming.jsx is dead code
**Severity:** 🔴 (maintenance) / 🟡 (runtime)
**File:** `src/components/Upcoming.jsx`

Zero imports anywhere. Dashboard.jsx contains its own inline `UpcomingRow` component (line 1244+). The `Upcoming.jsx` file is fully orphaned.

**Fix:** Delete.

---

## Section B: High Priority (🟠)

### B1 · `budgets` table queried directly in App.js with no API wrapper
**Severity:** 🟠 HIGH
**File:** `src/App.js:237`

```js
safe(supabase.from("budgets").select("*").eq("user_id", user.id).then(r => r.data || []), []),
```

All other tables have API functions in `api.js` (e.g., `accountsApi`, `ledgerApi`, `categoriesApi`). The `budgets` table is the only one loaded directly in App.js with a raw supabase call. There is no `budgetsApi` in `api.js`. Any create/update/delete for budgets (in `BudgetWidget.jsx`) likely also does raw supabase calls.

**Impact:** Budget writes bypass error-handling conventions, can't be centrally mocked/tested.

**Fix:** Add `budgetsApi` to `api.js`. Update App.js and BudgetWidget.jsx.

---

### B2 · Settings.jsx has 15 raw supabase calls (estatement_pdfs, estatement-pdfs naming mismatch)
**Severity:** 🟠 HIGH
**File:** `src/components/Settings.jsx` (2714 lines, 15 raw supabase calls)

Two different names used for the same resource in the same file:
- `supabase.from("estatement_pdfs")` — DB table (underscore) — 10 occurrences
- `supabase.storage.from("estatement-pdfs")` — Storage bucket (hyphen) — 3 occurrences

This is intentional (table vs bucket have different names) but fragile. One typo swapping `_` ↔ `-` silently queries the wrong resource.

Also `Settings.jsx` has 15 raw supabase calls scattered across the file. These do not go through `api.js`, have no centralized error handling, and are difficult to find/test.

**Fix:** Extract all estatement DB operations into an `estatementApi` object in `api.js`. Add a constant `ESTATEMENT_BUCKET = "estatement-pdfs"` to eliminate the string duplication.

---

### B3 · ReconcileModal.jsx parallel fix was applied to the wrong file
**Severity:** 🟠 HIGH (reconcile may still be sequential)
**File:** `src/components/ReconcileModal.jsx` (dead), `src/components/shared/ReconcileOverlay.jsx` (active)

Commit `d67e4e0` added chunked `Promise.allSettled` in `confirmMissingAll`. This was applied to `ReconcileModal.jsx`. Since that file is dead code, the active `ReconcileOverlay.jsx` may still have a sequential `for await` loop for confirming missing rows.

**Fix:** Verify `ReconcileOverlay.jsx` has the chunked parallelism. If not, apply the same fix.

---

### B4 · importSelected in AIImport/Email/Settings still sequential for large batches
**Severity:** 🟠 HIGH (performance/UX)
**Files:** `src/components/AIImport.jsx:514`, `src/components/Email.jsx:560`, `src/components/Settings.jsx:2219`

All three use `for (const r of validRows) { await ledgerApi.create(...) }` — purely sequential. For 20 rows this can take 20× the round-trip time of a single insert.

`ReconcileModal.jsx` got chunked parallelism (though in the dead file). None of the three active import paths have it.

**Fix:** Apply the same `Promise.allSettled` chunked pattern (batch size 5) to `importSelected` in all three files.

---

### B5 · `Receivables.jsx:361` — `new Date(s.settled_at)` without null guard in `existingToday` check
**Severity:** 🟠 HIGH
**File:** `src/components/Receivables.jsx:361`

```js
const existingToday = settlements.find(s =>
  s.entity === entity && new Date(s.settled_at) >= todayMidnight
);
```

`settled_at` is nullable (after v2.5 migration). `new Date(null)` = epoch (Jan 1 1970). `epoch >= todayMidnight` is **false**, so the filter won't return a false positive — but this relies on accidental correctness. If the migration is not yet applied (null constraint still enforced), this is safe. Once nullable, any future refactor that reads this expression might be misled.

**Fix:**
```js
const existingToday = settlements.find(s =>
  s.entity === entity && s.settled_at && new Date(s.settled_at) >= todayMidnight
);
```

---

### B6 · `Dashboard.jsx:232` — Fire-and-forget reconcile session load with silent catch
**Severity:** 🟠 HIGH
**File:** `src/components/Dashboard.jsx:232`

```js
supabase.from("reconcile_sessions")
  ...
  .catch(() => {});
```

Silent catch discards all errors. If reconcile_sessions fails (RLS, schema drift), the dashboard silently shows stale/empty data with no user feedback.

**Fix:** Log the error or show a non-blocking warning toast.

---

## Section C: Medium Priority (🟡)

### C1 · Three largest components far exceed maintainable size
**Severity:** 🟡 MEDIUM (maintainability)

| File | Lines |
|------|-------|
| `Settings.jsx` | 2,714 |
| `Accounts.jsx` | 2,029 |
| `Dashboard.jsx` | 1,882 |
| `CreditCards.jsx` | 1,766 |
| `Receivables.jsx` | 1,726 |

Each of these handles 5–10 distinct concerns. At this size, adding a feature in one section can accidentally break another.

**Recommended splits:**
- `Settings.jsx` → `Settings/CategorySettings.jsx`, `Settings/FxSettings.jsx`, `Settings/EStatementSettings.jsx`, `Settings/EmailSettings.jsx`
- `Dashboard.jsx` → inline sub-components extracted to `shared/widgets/`
- `Accounts.jsx` → `Accounts/BankTab.jsx`, `Accounts/CashTab.jsx`, `Accounts/LiabilityTab.jsx`

---

### C2 · ReconcileModal.jsx and ReconcileOverlay.jsx co-exist and diverge
**Severity:** 🟡 MEDIUM
**Files:** `src/components/ReconcileModal.jsx` (1147L), `src/components/shared/ReconcileOverlay.jsx` (870L)

Both implement reconcile. ReconcileModal has more features (parallel confirm, undo). ReconcileOverlay is the active one but may be missing those features (see B3). Until ReconcileModal is deleted, every reconcile-related bug will require checking both files.

---

### C3 · Receivables.jsx line 9: `reimburseAccs = receivables` was aliased incorrectly (just fixed but stats code still uses full receivables)
**Severity:** 🟡 MEDIUM
**File:** `src/components/Receivables.jsx:172-179`

```js
const recStats = useMemo(() => receivables.map(r => { ... }), [receivables, ledger]);
```

`recStats` still maps over `receivables` (all type='receivable'), not `reimburseAccs` (REIMBURSE_ENTITIES only). This means personal loan accounts (Fairuz, etc.) will appear in `recStats`, potentially showing in the reimburse tab stats sorting even though they have no reimburse entries.

**Fix:** Change to `reimburseAccs.map(...)`.

---

### C4 · `Income.jsx:248` — `new Date(l.start_date)` without null guard
**Severity:** 🟡 MEDIUM
**File:** `src/components/Income.jsx:248`

```js
const day = new Date(l.start_date).getDate();
```

`l.start_date` is nullable on recurring templates. `new Date(null).getDate()` = `NaN`. `.getDate()` on an invalid date returns NaN. Arithmetic on NaN propagates silently. The resulting upcoming date would show "Invalid Date" or compute wrong.

**Fix:**
```js
if (!l.start_date) return null;
const day = new Date(l.start_date + "T00:00:00").getDate();
```

---

### C5 · Missing `useMemo` on totals in Accounts.jsx (inline renders)
**Severity:** 🟡 MEDIUM (performance)
**File:** `src/components/Accounts.jsx:100-112, 898-912, 994-1000`

Total calculations (`totalIDR`, `foreignIDR`, `grandTotal`) for bank/cash tabs are computed inline in JSX rather than in `useMemo`. Every keystroke or state change in any part of Accounts re-runs these reduce chains over the full accounts array.

**Fix:** Wrap in `useMemo` with `[accounts]` dependency.

---

### C6 · `App.js` auto-creates default receivable accounts on every cold load if none exist
**Severity:** 🟡 MEDIUM
**File:** `src/App.js:248-265`

```js
if (acc.filter(a => a.type === "receivable").length === 0) {
  // creates Hamasa, SDC, Travelio
}
```

After the recent fix that separated `reimburseAccs` from `personalLoanAccts`, a user who has ONLY personal-loan receivables (no REIMBURSE entities) would trigger this auto-create on every load, silently adding Hamasa/SDC/Travelio to their accounts.

**Fix:** The condition should check specifically for REIMBURSE-named accounts, not all type='receivable':
```js
const hasReimburse = acc.some(a => a.type === "receivable" && REIMBURSE_ENTITIES.includes(a.name));
if (!hasReimburse) { ... }
```

---

### C7 · Sequential await in `importOne` for cicilan (installments)
**Severity:** 🟡 MEDIUM
**Files:** `AIImport.jsx:570`, `Email.jsx:532`, `Settings.jsx:2179`

```js
installmentsApi.createFromImport(user.id, {...}).catch(...)
```

These are fire-and-forget — which is fine — but not awaited. If the page navigates away before these resolve, the installment may be created with a stale `ledgerId` or the UI won't reflect the installment on next load.

**Fix:** Await inside a non-blocking wrapper or add to the existing import confirmation response.

---

### C8 · Migration files inconsistent naming convention
**Severity:** 🟡 MEDIUM (ops)
**Files:** `supabase/migrations/`

Three different naming patterns exist:
1. `v2.X_description.sql` — most files
2. `create_import_drafts.sql` — no version prefix
3. `create_merchant_rules.sql` — no version prefix

Also three v2.1 files and two v2.5 files (see A1). Should be a linear sequence.

**Fix:** Rename to a linear sequence: `v2.1_gmail_tables.sql` → keep as is, rename the two extra v2.1 to `v2.1b_` and `v2.1c_`. Rename `create_*` to `v2.0_*` or `v1.x_*`.

---

### C9 · `AssetTimeline.jsx` has 4 raw supabase calls with no API wrapper
**Severity:** 🟡 MEDIUM
**File:** `src/components/AssetTimeline.jsx:199-239`

```js
const { data: current } = await supabase.from("accounts").select("current_value")...
await supabase.from("accounts").update({ current_value: newVal })...
await supabase.from("asset_value_history").insert({...})
await supabase.from("asset_value_history").delete()...
```

`asset_value_history` has no API wrapper in `api.js`. `accounts` has `accountsApi` but the component bypasses it for current_value updates. This is inconsistent with how Assets.jsx calls `accountsApi.update`.

**Fix:** Add `assetValueHistoryApi` to `api.js`. Use `accountsApi.update` for current_value changes.

---

### C10 · `Receivables.jsx` has 9 raw supabase calls (reimburse_settlements + ledger inserts)
**Severity:** 🟡 MEDIUM
**File:** `src/components/Receivables.jsx:325-508`

The entire settle/unsettle flow uses raw supabase calls inline. While wrapped in try/catch, any change to the settlement schema requires editing deep inside a 1700-line component.

**Fix:** Extract to `reimburseSettlementsApi.settle()`, `.unsettle()`, `.create()` in `api.js`.

---

## Section D: Low / Polish (🟢)

### D1 · `shared.jsx` file exists alongside `shared/index.js`
**Severity:** 🟢 LOW
**Files:** `src/components/shared.jsx` (73 imports), `src/components/shared/index.js`

There is both a `shared.jsx` file and a `shared/` directory with `index.js`. The `shared.jsx` file has 73 import-from references pointing at it — it's likely the old location. Having both creates confusion about which is canonical.

**Verify:** Does `shared.jsx` just re-export from `shared/index.js`? Or is it a legacy entry point that should be removed?

---

### D2 · `ReconcileModal.jsx` line 621 — `then(null, e => ...)` pattern (non-standard)
**Severity:** 🟢 LOW
**File:** `src/components/ReconcileModal.jsx:621`

```js
supabase.from("reconcile_transactions").update({...}).then(null, e => console.error(...))
```

`Promise.then(null, onRejected)` is equivalent to `.catch()` but less readable and flagged by linters. This pattern appears twice in the file (lines 621, 701, 716). Since ReconcileModal is dead code, low priority — but the pattern also appears in `Settings.jsx:1751` which is live.

**Fix (Settings.jsx:1751):** Replace `.then(null, e => ...)` with `.catch(e => ...)`.

---

### D3 · `api.js` missing `budgetsApi` — budgets feature has no centralized API
**Severity:** 🟢 LOW (duplicate of B1, lower priority fix)

BudgetWidget.jsx likely uses raw supabase for budget CRUD. Not audited yet.

---

### D4 · `src/components/PILogo.jsx` — only 2 import-from references
**Severity:** 🟢 LOW
**File:** `src/components/PILogo.jsx`

Used in only 2 places. Very small component that could be inlined if needed, but keep if shared.

---

### D5 · Missing loading states in several components
**Severity:** 🟢 LOW
**Files:** `Accounts.jsx`, `CreditCards.jsx`, `Calendar.jsx`, `Transactions.jsx`, `Reports.jsx`

Components with few or no `loading` state references:
- `Calendar.jsx` — 0 loading states found
- `Transactions.jsx` — unclear (not in top results)
- `Reports.jsx` — not in loading state scan

If data fetch fails, these show blank/empty without any spinner or error message.

---

### D6 · `utils.js:70` — `new Date(target)` without "T00:00:00" suffix
**Severity:** 🟢 LOW
**File:** `src/utils.js:70`

```js
const target = new Date(dateStr);
```

`dateStr` is expected to be a date-only string like `"2026-05-02"`. Without the `T00:00:00` suffix, `new Date("2026-05-02")` is parsed as UTC midnight, which displays as the day before in UTC-8 to UTC-12 timezones (e.g., "May 1" instead of "May 2"). Most other date conversions in the codebase correctly append `T00:00:00`.

**Fix:** `const target = new Date(dateStr + "T00:00:00");`

---

### D7 · `src/lib/importDrafts.js` has 3 raw supabase calls
**Severity:** 🟢 LOW
**File:** `src/lib/importDrafts.js`

Direct supabase calls in a lib file — not necessarily wrong, but inconsistent with the api.js pattern.

---

### D8 · Console.error calls for silent failures mask real bugs
**Severity:** 🟢 LOW

Over 20 `.catch(e => console.error(...))` calls for non-critical operations (cicilan creation, collect_loan payment recording, recon tx updates). These fail silently in production. Users see no error; engineers see logs only in dev tools.

**Fix:** Aggregate background errors into a non-blocking error toast after the main action succeeds. "3 background tasks failed" is actionable; silent console.error is not.

---

## Section E: DB Integrity Findings
*SQL queries to run are in Section G below. Results pending.*

Expected findings based on code analysis:
- Possible orphan `ledger.employee_loan_id` → `employee_loans.id` for rows created by AddNewPicker (which writes UUID account IDs to this field). **High likelihood** of orphan references until today's fix (commit `0dac8f9`) is applied to all historical rows.
- `ledger.from_id` for collect_loan rows may be null (collect_loan buildEntry sets `from_id: null` for employee_loan-type rows). This is intentional per current design but causes `null_from` count to appear in Query 2C.
- Possible duplicate transactions from reconcile + manual entry.

---

## Section F: Schema Consistency Map

| Table | Canonical Use | Legacy/Duplicate | Components |
|-------|--------------|-----------------|------------|
| `accounts` | All accounts (bank/cc/cash/asset/receivable/liability) | ~~`assets`~~ (dropped v2.12), ~~`liabilities`~~ (dropped v2.12) | App.js, Accounts.jsx, Assets.jsx, api.js |
| `ledger` | All transactions | — | App.js, all components, api.js |
| `employee_loans` | Structured monthly installment loans | Partial overlap with `accounts` type='receivable' for informal loans | Receivables.jsx, api.js |
| `employee_loan_payments` | Monthly payment records | — | Receivables.jsx, api.js |
| `reimburse_settlements` | Reimburse settlement tracking | — | Receivables.jsx (raw supabase), api.js |
| `reconcile_sessions` | Reconcile session metadata | — | ReconcileOverlay.jsx (raw), Dashboard.jsx (raw), api.js |
| `reconcile_transactions` | Per-row reconcile state | ~~`reconcile_transactions`~~ (pending drop, see v2.12) | ReconcileModal.jsx (dead), ReconcileOverlay.jsx (raw) |
| `estatement_pdfs` | E-statement PDF records | — | Settings.jsx (raw, 10 calls) |
| `estatement-pdfs` (bucket) | E-statement PDF files | — | Settings.jsx (raw, 3 calls) |
| `asset_value_history` | Manual asset value updates | — | AssetTimeline.jsx (raw, 4 calls) |
| `budgets` | Budget entries | — | App.js (raw, 1 call), BudgetWidget.jsx |
| `scan_batches` | AI scan batch metadata | — | AIImport.jsx (1 raw call) |
| `import_drafts` | In-progress import state | — | lib/importDrafts.js (3 raw calls) |
| `recurring_templates` | Recurring TX templates | — | api.js (recurringApi) |
| `merchant_mappings` | Merchant→category rules | `merchant_rules` (migration only) | api.js (merchantApi), Settings.jsx |
| `fx_rates` | Current FX rates | — | api.js (fxApi) |
| `fx_rate_history` | Historical FX rates | — | api.js (fxApi) |
| `income_sources` | Income sources | — | api.js (incomeSrcApi) |
| `installments` | CC installment plans | — | api.js (installmentsApi) |
| `account_currencies` | Per-account foreign currency balances | — | api.js (accountCurrenciesApi), BankStatement.jsx (raw) |
| `gmail_tokens` | Gmail OAuth tokens | — | api.js (gmailApi) |
| `email_sync` | Gmail email sync records | — | api.js (gmailApi) |
| `app_settings` | User preferences | — | api.js (settingsApi) |
| `statement_attachments` | PDF statement file refs | — | (unclear — may be defunct) |
| `ai-scan-uploads` (bucket) | Uploaded receipt images | — | api.js (scanApi) |
| `card-images` (bucket) | CC card images | — | Accounts.jsx (likely raw) |
| `backups` (bucket) | DB backups | — | Settings.jsx (likely raw) |

**Tables potentially unused / orphaned:**
- `statement_attachments` — only 2 query occurrences; may be superseded by `estatement_pdfs`
- `reconcile_transactions` — v2.12 migration dropped it, but 7 occurrences in code remain (ReconcileModal dead file + ReconcileOverlay)

---

## Section G: Manual Test Checklist

### Dashboard
- [ ] Net Worth total matches Reports → Total
- [ ] Net Worth trend chart renders (no blank/crash)
- [ ] Alert Center: visible if alerts exist, hidden if none
- [ ] CC This Month: all cards appear, totals correct
- [ ] Bank & Cash / Assets / Receivables totals match detail pages
- [ ] Budget widget renders if budgets exist
- [ ] Spending breakdown donut renders (no blank)
- [ ] Cash Flow 6mo chart renders
- [ ] Upcoming Next 7 Days: correct dates and colors
- [ ] Recurring Suggestions widget: shows or hides correctly
- [ ] Reconcile Status widget: shows per-account last-reconcile dates
- [ ] "+" FAB button opens TxVerticalBig modal
- [ ] Reconcile / Email Sync / E-Statement / AI Scan buttons in header work

### Transactions Page
- [ ] Full list loads (check count vs expected)
- [ ] Filter by entity, type, account all work
- [ ] Edit transaction modal opens and saves
- [ ] Delete confirms and Undo toast appears
- [ ] Add Transaction modal works (all tx_types)
- [ ] Currency formatting consistent — no "NaN" or "Rp NaN"
- [ ] No "Invalid Date" anywhere in date columns

### Bank / CC / Cash Pages
- [ ] All accounts render with correct balances
- [ ] Edit account modal saves (name, initial_balance, bank_name, etc.)
- [ ] Recurring Fees section in Edit modal: Use Defaults, Add, Edit, Delete
- [ ] Statement page: opens, shows transactions, correct closing balance
- [ ] Reconcile button: opens ReconcileOverlay (NOT ReconcileModal)
- [ ] PDF statement upload works
- [ ] PDF viewer appears after upload

### Assets Page
- [ ] All assets render (property, vehicle, investment, deposito, other)
- [ ] Cost basis: no double-counting (ledger-only, no `purchase_price + ledger`)
- [ ] Current Value correct (post add via AddNewPicker — should NOT be doubled)
- [ ] Edit button visible for ALL asset types
- [ ] "Update Value" modal works, creates `asset_value_history` record
- [ ] Timeline shows buy/sell/update events
- [ ] AddNewPicker: creates asset at current_value=0 (delta applied on give_loan)

### Receivables Page
- [ ] Reimburse tab: Hamasa, SDC, Travelio show correct outstanding (from ledger)
- [ ] Reimburse tab: personal loan accounts NOT shown here anymore (after fix)
- [ ] Loans tab > Employee Loans: all structured loans visible
- [ ] Loans tab > Personal Loans section: borrowers added via AddNewPicker visible
- [ ] Settlement History: dates show correctly ("Pending" for null, date for settled)
- [ ] Settle button creates settlement record and shows in history
- [ ] `existingToday` check: can't double-settle same entity on same day

### Reports Page
- [ ] Monthly trend chart renders
- [ ] Category breakdown chart renders
- [ ] Income vs Expense totals match dashboard
- [ ] Per-account totals match Accounts page

### Settings (All Sub-tabs)
- [ ] Categories — CRUD works, icon shows
- [ ] FX Rates — current rates correct, update works
- [ ] Email Sync — connection status correct, last_sync timestamp valid (not epoch)
- [ ] E-Statement — upload PDF, processes, appears in list
- [ ] E-Statement — delete removes from both `estatement_pdfs` table AND `estatement-pdfs` bucket
- [ ] Reconcile History — past sessions render
- [ ] Merchants — rules CRUD works, auto-apply on scan
- [ ] Backup / Export — no errors

### AI Sources (4 entry points)
- [ ] AI Scan — upload photo, AI extracts rows, review, save, Undo toast
- [ ] Gmail Sync — fetch emails, review, save; auto-refresh token works
- [ ] E-Statement — upload PDF, AI extracts, review, save
- [ ] Reconcile (ReconcileOverlay) — missing rows form, Confirm All runs in parallel (check chunked)
- [ ] AddNewPicker for loan: creates `accounts` (type='receivable'), appears in Personal Loans tab
- [ ] AddNewPicker for asset: creates `accounts` (type='asset'), current_value=0
- [ ] collect_loan with accounts-based borrower: `receivable_outstanding` decrements correctly
- [ ] Multi-file upload: processes all files, progress visible
- [ ] Save All button: triggers Undo toast, counter shows correct count

---

## Section H: Performance Hot Spots

### H1 · Sequential import loops (AIImport, Email, Settings)
**File:** `AIImport.jsx:514`, `Email.jsx:560`, `Settings.jsx:2219`
**Impact:** 20 transactions × ~200ms/call = 4 seconds minimum. No progress indicator.
**Fix:** Chunked Promise.allSettled (batch 5) — same pattern as ReconcileModal.

### H2 · Accounts.jsx inline totals re-computed on every render
**File:** `Accounts.jsx:100-112, 898-912, 994-1000`
**Impact:** With 50+ accounts, these reduce chains run on every interaction in Accounts.
**Fix:** Wrap in `useMemo`.

### H3 · `ledger` loaded at `limit: 10000` in App.js, passed as prop to all components
**File:** `App.js:232`
**Impact:** With a growing ledger, initial page load carries the full history in memory. Each child component receives the entire array and filters it independently.
**Fix:** Pagination or date-range scoping. Near-term: reduce limit to 3000 (last ~1 year) and add per-component on-demand fetch for older history.

### H4 · `recStats` in Receivables.jsx iterates full ledger per receivable account
**File:** `Receivables.jsx:172-179`
**Impact:** For N receivable accounts × M ledger entries, this is O(N×M). At 3000 ledger entries and 10 accounts = 30,000 comparisons on every re-render.
**Fix:** Build a single ledger index keyed by entity before the map.

---

## Summary Table

| Section | 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low | Total |
|---------|------------|---------|----------|--------|-------|
| Code (dead code) | 3 | 0 | 0 | 1 | 4 |
| Code (logic bugs) | 0 | 3 | 4 | 4 | 11 |
| Architecture | 1 | 2 | 4 | 3 | 10 |
| DB/Schema | 1 | 0 | 1 | 0 | 2 |
| UX (checklist) | 0 | 0 | 3 | 4 | 7 |
| Performance | 0 | 1 | 2 | 1 | 4 |
| **Total** | **5** | **6** | **14** | **13** | **38** |

---

## Suggested Sprint Plan

### Week 1: Dead Code + Migration Cleanup (Low risk, high clarity)
1. Delete `ReconcileModal.jsx`, `EmployeeLoanStatement.jsx`, `Upcoming.jsx`
2. Verify `ReconcileOverlay.jsx` has chunked parallelism (B3)
3. Rename duplicate migration version numbers (A1 / C8)
4. Fix `recStats` to use `reimburseAccs` not `receivables` (C3)
5. Fix App.js auto-create condition to check for REIMBURSE-named accounts (C6)

### Week 2: Data Layer Centralization
1. Add `budgetsApi` to `api.js`, update App.js + BudgetWidget
2. Add `estatementApi` to `api.js`, refactor Settings.jsx estatement section (B2)
3. Add `assetValueHistoryApi` to `api.js`, refactor AssetTimeline.jsx (C9)
4. Extract Receivables.jsx settle/unsettle to `api.js` (C10)
5. Fix `then(null, ...)` → `.catch()` in Settings.jsx:1751 (D2)

### Week 3: Bug Fixes + UX Polish
1. Add null guard to `new Date(s.settled_at)` in Receivables:361 (B5)
2. Fix `new Date(l.start_date)` in Income.jsx:248 (C4)
3. Fix `new Date(dateStr)` → `new Date(dateStr + "T00:00:00")` in utils.js:70 (D6)
4. Apply chunked parallelism to `importSelected` in all 3 files (B4)
5. Walk the manual UX checklist (Section G)

### Week 4: Performance + Verification
1. Wrap Accounts.jsx totals in `useMemo` (C5, H2)
2. Build ledger entity index in Receivables (H4)
3. Consider ledger pagination strategy (H3)
4. Re-run audit script
5. Manual test all flows from checklist

---

## Section I: SQL Queries to Run in Supabase

Run all 5 queries and paste results back for DB integrity analysis.

### Query I-1: Orphan FK references
```sql
SELECT 'ledger.from_id orphan' AS issue, COUNT(*) AS cnt FROM ledger l 
LEFT JOIN accounts a ON l.from_id = a.id 
WHERE l.from_id IS NOT NULL AND a.id IS NULL
UNION ALL
SELECT 'ledger.to_id orphan', COUNT(*) FROM ledger l 
LEFT JOIN accounts a ON l.to_id = a.id 
WHERE l.to_id IS NOT NULL AND a.id IS NULL
UNION ALL
SELECT 'ledger.employee_loan_id orphan (UUID-based — expected after AddNewPicker)', COUNT(*) 
FROM ledger l 
LEFT JOIN employee_loans el ON CAST(l.employee_loan_id AS TEXT) = CAST(el.id AS TEXT)
WHERE l.employee_loan_id IS NOT NULL AND el.id IS NULL
UNION ALL
SELECT 'ledger.reimburse_settlement_id orphan', COUNT(*) FROM ledger l 
LEFT JOIN reimburse_settlements rs ON l.reimburse_settlement_id = rs.id 
WHERE l.reimburse_settlement_id IS NOT NULL AND rs.id IS NULL;
```

### Query I-2: Null/zero critical fields
```sql
SELECT 'ledger.tx_date null' AS issue, COUNT(*) FROM ledger WHERE tx_date IS NULL
UNION ALL
SELECT 'ledger.amount_idr null', COUNT(*) FROM ledger WHERE amount_idr IS NULL
UNION ALL
SELECT 'ledger.amount_idr = 0', COUNT(*) FROM ledger WHERE amount_idr = 0
UNION ALL
SELECT 'ledger.tx_type null', COUNT(*) FROM ledger WHERE tx_type IS NULL
UNION ALL
SELECT 'accounts.name empty', COUNT(*) FROM accounts WHERE name IS NULL OR TRIM(name) = ''
UNION ALL
SELECT 'accounts with negative balance (bank/cc)', COUNT(*) FROM accounts 
WHERE type IN ('bank','credit_card') AND current_balance < 0;
```

### Query I-3: tx_type vs from_id/to_id consistency
```sql
SELECT tx_type, 
  COUNT(*) AS total,
  COUNT(CASE WHEN from_id IS NULL THEN 1 END) AS null_from,
  COUNT(CASE WHEN to_id IS NULL THEN 1 END) AS null_to,
  COUNT(CASE WHEN employee_loan_id IS NOT NULL THEN 1 END) AS has_loan_id
FROM ledger 
GROUP BY tx_type 
ORDER BY total DESC;
```

### Query I-4: Duplicate transactions
```sql
SELECT tx_date, amount_idr, COALESCE(from_id::text, 'null') AS from_acc, 
  COALESCE(description, '') AS descr, COUNT(*) AS dups
FROM ledger 
WHERE tx_date IS NOT NULL 
GROUP BY tx_date, amount_idr, COALESCE(from_id::text, 'null'), COALESCE(description, '')
HAVING COUNT(*) > 1 
ORDER BY dups DESC, tx_date DESC
LIMIT 20;
```

### Query I-5: All tables (compare with migration files)
```sql
SELECT table_name, 
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables 
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;
```

### Query I-6: RLS policy coverage
```sql
SELECT t.table_name,
  COUNT(p.policyname) AS policy_count,
  CASE WHEN COUNT(p.policyname) = 0 THEN '⚠️ NO POLICIES' ELSE 'OK' END AS status
FROM information_schema.tables t
LEFT JOIN pg_policies p ON p.tablename = t.table_name AND p.schemaname = 'public'
WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
GROUP BY t.table_name
ORDER BY policy_count ASC, t.table_name;
```
