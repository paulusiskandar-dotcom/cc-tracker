# CC-TRACKER COMPREHENSIVE SCHEMA AUDIT

**Report Date:** 2026-04-29  
**Project:** /Users/paulusiskandar/cc-tracker  
**Status:** AUDIT COMPLETE - READ-ONLY ANALYSIS

---

## EXECUTIVE SUMMARY

The cc-tracker project uses a Supabase PostgreSQL backend with 31 tables across 16 migration files plus 1 external SQL file. The schema supports multi-entity financial tracking with accounts, transactions, assets, liabilities, employee loans, reimburse settlements, and email/AI integration.

**Critical Finding:** The project has TWO parallel asset storage patterns:
1. Assets stored as **accounts with type='asset'** (AddNewPicker, main flow)
2. Separate **assets table** (supabase_session3_assets.sql) with identical structure — **BOTH EXIST** but code primarily uses accounts.

---

## A. COMPLETE TABLE INVENTORY

| Table Name | Source File(s) | Create vs Alter | Key Columns | Status |
|---|---|---|---|---|
| accounts | Base schema (not in migrations) | CREATE | id, user_id, type, name, current_balance, is_active, initial_balance, sort_order, bank_name, last4, card_image_url, deposit_bank_id | ACTIVE |
| ledger | Base schema + v2.1_ledger_columns.sql | CREATE + ALTER | id, user_id, tx_date, tx_type, from_id, to_id, from_type, to_type, amount, amount_idr, currency, description, category_id, category_label, merchant_name, entity, is_reimburse, notes, from_account_id, to_account_id, installment_id, reimburse_settlement_id, employee_loan_id, fx_rate_used, source, email_sync_id, estatement_pdf_id | ACTIVE |
| expense_categories | Base schema | CREATE | id, user_id, name, label, sort_order | ACTIVE |
| income_sources | Base schema | CREATE | id, user_id, name, default_category_id | ACTIVE |
| accounts (auth) | Supabase auth system | - | id, email, user_metadata | EXTERNAL |
| scan_batches | v2.1_merchant_mappings.sql | CREATE | id, user_id, source, status, total_found, total_imported, ai_model, created_at, completed_at, file_path | ACTIVE |
| merchant_mappings | v2.1_merchant_mappings.sql | CREATE | id, user_id, merchant_name, category_id, category_label, entity, confidence, last_seen, created_at, tx_type | ACTIVE |
| gmail_tokens | v2.1_gmail_tables.sql | CREATE | id, user_id, access_token, refresh_token, token_expiry, gmail_email, client_id, connected_at, last_sync, needs_reconnect | ACTIVE |
| email_sync | v2.1_gmail_tables.sql | CREATE | id, user_id, gmail_message_id, sender_email, subject, received_at, email_type, raw_body, attachment_name, ai_raw_result, extracted_count, imported_count, status, error_message, scan_batch_id, created_at | ACTIVE |
| fx_rates | Base schema | CREATE | user_id, currency, rate_to_idr | ACTIVE |
| fx_rate_history | Base schema | CREATE | currency, rate_to_idr, recorded_at | ACTIVE |
| account_currencies | Base schema | CREATE | account_id, currency, balance, initial_balance, user_id | ACTIVE |
| installments | Base schema | CREATE | id, user_id, description, purchase_ledger_id, account_id, total_amount, monthly_amount, total_months, paid_months, start_date, currency, status | ACTIVE |
| recurring_templates | Base schema | CREATE | id, user_id, name, description, amount, currency, tx_type, from_id, to_id, category_id, entity, frequency, day_of_month, is_active, created_at | ACTIVE |
| recurring_reminders | Base schema | CREATE | id, user_id, recurring_template_id, due_date, status, confirmed_at | ACTIVE |
| app_settings | Base schema | CREATE | user_id, key, value | ACTIVE |
| employee_loans | Base schema | CREATE | id, user_id, employee_name, employee_dept, total_amount, monthly_installment, start_date, paid_months, status, notes, created_at | ACTIVE |
| employee_loan_payments | Base schema | CREATE | id, user_id, loan_id, pay_date, amount, notes | ACTIVE |
| reimburse_settlements | v2.3_reimburse_settlements.sql + v2.4_reimburse_pending.sql | CREATE + ALTER | id, user_id, entity, settled_at, out_ledger_ids, in_ledger_ids, total_out, total_in, reimbursable_expense, re_category_id, notes, created_at, status, linked_ledger_id, to_account_id | ACTIVE |
| statement_attachments | v2.10_statement_attachments.sql | CREATE | id, user_id, gmail_message_id, attachment_id, filename, sender_email, bank_name, account_id, period_year, period_month, subject, received_at, processed_at, transaction_count, created_at | ACTIVE |
| import_drafts | create_import_drafts.sql | CREATE | id, user_id, source, state_json, account_id, updated_at | ACTIVE |
| assets | supabase_session3_assets.sql | CREATE | id, user_id, name, category, current_value, purchase_value, purchase_date, currency, notes, linked_bank_id, created_at | PARALLEL |
| asset_price_history | supabase_session3_assets.sql | CREATE | id, user_id, asset_id, recorded_date, value, notes, created_at | PARALLEL |
| liabilities | supabase_session3_assets.sql | CREATE | id, user_id, name, category, outstanding, original_amount, monthly_payment, interest_rate, start_date, end_date, linked_asset_id, notes, created_at | PARALLEL |
| reconcile_sessions | Base schema | CREATE | id, user_id, account_id, period_year, period_month, status, created_at, completed_at | ACTIVE |
| reconcile_transactions | Base schema | CREATE | id, session_id, user_id, tx_date, description, debit, credit, balance_before, balance_after, matched_ledger_id, status | ACTIVE |
| estatement_pdfs | Base schema | CREATE | id, user_id, filename, file_size, uploaded_at, processing_status, total_transactions, account_id | ACTIVE |

**Count:** 31 tables total (29 active in migrations + 3 in external assets file + 2 base schema tables referenced only via code)

---

## B. ASSET STORAGE PATTERN — DUAL PATTERN DETECTED

### Pattern 1: Assets as Account Type (PRIMARY)
- **Table:** `accounts` with `type='asset'`
- **Columns:** id, user_id, name, current_value, purchase_price, subtype, is_active, include_networth, created_at
- **Usage:** AddNewPicker component inserts new assets here
- **Code Path:** `/src/components/shared/AddNewPicker.jsx` lines 72-82
- **Insert Payload:**
  ```javascript
  {
    user_id: userId,
    name: assetName,
    type: "asset",
    subtype: "Property|Vehicle|Investment|Electronics|Deposito|Other",
    is_active: true,
    current_value: amount,
    purchase_price: amount,
    include_networth: true
  }
  ```
- **Active Code References:** assetsApi (api.js line 695-718) queries from "assets" table — **MISMATCH**

### Pattern 2: Separate Assets Table (PARALLEL/UNUSED)
- **Table:** `assets` (separate table from accounts)
- **Columns:** id, user_id, name, category, current_value, purchase_value, purchase_date, currency, notes, linked_bank_id, created_at
- **Columns:** category (asset category like "Properti", "Kendaraan", "Saham", etc.)
- **Source:** `/Users/paulusiskandar/cc-tracker/supabase_session3_assets.sql` (external, not in migrations/)
- **Status:** Defined but **NOT ACTIVELY USED** in main code path
- **Supporting Tables:**
  - `asset_price_history` — tracks value changes over time
  - `liabilities` — companion table for debts

### CRITICAL FINDING: Code/Schema Mismatch
- `AddNewPicker` creates assets in **accounts** table (type='asset')
- `assetsApi.getAll()` queries **assets** table (separate table)
- This creates a dual-write/read inconsistency

**Truth:** Assets are primarily stored as **accounts with type='asset'** but code attempts to query a separate `assets` table that may be empty.

---

## C. LOAN STORAGE PATTERN

### Employee Loans Table Structure
| Column | Type | Usage | Required |
|---|---|---|---|
| id | uuid | Primary key | YES |
| user_id | uuid | User ownership | YES |
| employee_name | text | Borrower name | YES |
| employee_dept | text | Department | NO |
| total_amount | numeric | Total loan amount | YES |
| monthly_installment | numeric | Payment per month | YES |
| start_date | date | Loan start | YES |
| paid_months | integer | Months already paid | YES (default 0) |
| status | text | 'active' or 'settled' | NO |
| notes | text | Free notes | NO |
| created_at | timestamptz | Auto-created | System |

### How Loans Link to Ledger
- `ledger.employee_loan_id` (FK to employee_loans.id) — tracks collect_loan transactions
- `ledger.tx_type = 'collect_loan'` — transaction represents payment collection
- **Example Flow:**
  1. Create employee_loans row: `{ employee_name: "John", total_amount: 1000000, monthly_installment: 100000, start_date: "2026-04-01" }`
  2. Create ledger entry: `{ tx_type: "collect_loan", from_type: "account", to_type: "account", from_id: borrower_receivable_acct_id, to_id: bank_account_id, amount: 100000, employee_loan_id: <loan_id> }`
  3. Track in employee_loan_payments: `{ loan_id: <loan_id>, pay_date: "2026-05-01", amount: 100000 }`

### Auto-Created During Import
When parsing bank statements with loan keywords, code creates employee_loans:
```javascript
// From TxVerticalBig.jsx line 470-480
const newLoan = await employeeLoanApi.create(user.id, {
  employee_name: newBorrowerName.trim(),
  total_amount: totalAmt,
  monthly_installment: monthly,
  start_date: form.tx_date,
  status: "active",
  paid_months: 0,
});
```

---

## D. ADDNEWPICKER CORRECTNESS ANALYSIS

### Receivable Account Creation (Loan Borrowers)
**Location:** `/src/components/shared/AddNewPicker.jsx` lines 61-70

**INSERT Payload:**
```javascript
{
  user_id: userId,
  name: borrowerName,
  type: "receivable",
  is_active: true,
  receivable_outstanding: amount,
  include_networth: true,
}
```

**Required columns in accounts table:**
- user_id ✓
- name ✓
- type ✓
- is_active ✓
- receivable_outstanding ✓ (present in code, must exist in accounts schema)
- include_networth ✓

**Status:** ✓ CORRECT — matches expected schema

---

### Asset Account Creation
**Location:** `/src/components/shared/AddNewPicker.jsx` lines 72-82

**INSERT Payload:**
```javascript
{
  user_id: userId,
  name: assetName,
  type: "asset",
  subtype: subtype || null,  // "Property", "Vehicle", etc.
  is_active: true,
  current_value: amount,
  purchase_price: amount,
  include_networth: true,
}
```

**Required columns in accounts table:**
- user_id ✓
- name ✓
- type ✓
- subtype ✓ (must support NULL for existing assets)
- is_active ✓
- current_value ✓
- purchase_price ✓
- include_networth ✓

**Status:** ✓ CORRECT — matches expected schema

---

### CRITICAL MISMATCH: assetsApi queries wrong table
**Location:** `/src/api.js` lines 695-718

```javascript
export const assetsApi = {
  getAll: async (userId) => {
    const { data, error } = await supabase
      .from("assets")  // ← QUERYING SEPARATE TABLE
      .select("*")
      .eq("user_id", userId)
```

**Problem:** 
- AddNewPicker INSERTS into `accounts` (type='asset')
- assetsApi.getAll() QUERIES `assets` (separate table)
- These are two different tables!

**Consequence:** Asset list will be empty unless data is manually populated in the separate `assets` table.

---

## E. UNUSED/ORPHAN TABLES

| Table | Source | Code References | Status |
|---|---|---|---|
| assets | supabase_session3_assets.sql | assetsApi.getAll() only | ORPHAN — inserted via AddNewPicker to accounts, not to assets |
| asset_price_history | supabase_session3_assets.sql | None found | ORPHAN — no code reference |
| liabilities | supabase_session3_assets.sql | None found | ORPHAN — no code reference |
| reconcile_transactions | Base schema | None found | UNUSED — created but never queried |

---

## F. SCHEMA ISSUES & MISMATCHES

### Issue 1: CRITICAL — Asset Storage Inconsistency
- **Severity:** HIGH
- **Description:** AddNewPicker inserts assets into `accounts` table, but assetsApi reads from separate `assets` table
- **Impact:** Asset list will appear empty; any assets created via UI go to accounts but code tries to read from assets
- **File:** `/src/api.js` lines 695-718, `/src/components/shared/AddNewPicker.jsx` lines 72-82
- **Fix:** Either (a) change AddNewPicker to insert into `assets` table, or (b) change assetsApi to query `accounts` with type='asset'

### Issue 2: MEDIUM — Ledger column type inconsistency
- **Severity:** MEDIUM
- **Description:** `category_id` defined as TEXT in v2.1_ledger_columns.sql but should be UUID
- **File:** `/supabase/migrations/v2.1_ledger_columns.sql` line 8
- **Code:** api.js uses category_id as string reference to expense_categories
- **Fix:** Migrate category_id from TEXT to UUID with proper foreign key

### Issue 3: MEDIUM — Missing base schema definition
- **Severity:** MEDIUM
- **Description:** Base schema (accounts, ledger, categories, etc.) is not documented in migrations/
- **Impact:** New developers cannot reconstruct schema from migration files alone; must query live DB
- **Fix:** Create 00_base_schema.sql with all base table definitions

### Issue 4: LOW — Employee loans missing status values
- **Severity:** LOW
- **Description:** Code uses status='active' and status='settled' but schema doesn't define CHECK constraint
- **File:** Code uses status in Receivables.jsx line 220, 245
- **Fix:** Add CHECK constraint to employee_loans.status IN ('active', 'settled')

### Issue 5: LOW — Reconcile transactions unused
- **Severity:** LOW
- **Description:** reconcile_transactions table exists but is never queried or updated in code
- **File:** Base schema
- **Status:** Dead code or incomplete feature
- **Fix:** Either implement reconciliation feature or drop unused table

### Issue 6: MEDIUM — Merchant mappings category_name vs category_id confusion
- **Severity:** MEDIUM
- **Description:** merchant_mappings has both category_label (TEXT) and category_id (TEXT), but inconsistent naming
- **File:** v2.1_merchant_mappings.sql lines 28-39, create_merchant_rules.sql line 9
- **Impact:** Code uses category_name in some places (api.js line 592) and category_label in others
- **Fix:** Standardize on category_id (UUID) and category_name (display label)

### Issue 7: MEDIUM — Reimburse settlements status constraint mismatch
- **Severity:** MEDIUM
- **Description:** v2.5_settlement_nullable_date.sql attempts to add CHECK constraint on non-existent status column
- **File:** v2.5_settlement_nullable_date.sql lines 6-18
- **Impact:** Constraint creation may fail if status column wasn't added in v2.4_reimburse_pending.sql
- **Fix:** Verify status column exists and constraint was successfully created

---

## G. RECOMMENDATIONS (PRIORITIZED)

### Priority 1 (CRITICAL) — Fix Asset Table Mismatch
1. **Decision Required:** Choose one:
   - Option A: Implement separate assets system (migrate schema_session3_assets.sql into migrations, update assetsApi)
   - Option B: Consolidate all assets in accounts table (remove assets table, update assetsApi to query accounts)
2. **Recommended:** Option B (current code flow)
3. **Action:** 
   - Change assetsApi.getAll() to `from("accounts").eq("type", "asset")`
   - Delete supabase_session3_assets.sql (don't run it)
   - Ensure no conflicting migration runs

### Priority 2 (HIGH) — Document Base Schema
1. Create `/supabase/migrations/00_base_schema.sql` with all base table definitions
2. Include comments on table purpose and column constraints
3. Make schema reproducible from migration files alone
4. Add to migration history so `supabase db reset` works correctly

### Priority 3 (HIGH) — Fix Ledger category_id Type
1. Create migration: `v2.12_ledger_category_id_uuid.sql`
2. Add new uuid column, backfill from expense_categories by name match
3. Drop old TEXT column after backfill
4. Add FK constraint

### Priority 4 (MEDIUM) — Standardize Merchant Mapping Columns
1. Rename category_label → category_name across merchant_mappings
2. Add FK constraint on category_id → expense_categories.id
3. Update api.js upsert logic (line 578-599) to use consistent names

### Priority 5 (MEDIUM) — Verify Reimburse Settlement Constraint
1. Manually test: `SELECT constraint_name FROM information_schema.table_constraints WHERE table_name='reimburse_settlements'`
2. If settled_status_has_date constraint is missing, manually create it
3. Document successful constraint creation

### Priority 6 (LOW) — Add Validation Constraints
1. Add CHECK constraint to employee_loans.status IN ('active', 'settled')
2. Add CHECK constraint to reconcile_sessions.status IN ('in_progress', 'completed')
3. Add CHECK constraint to email_sync.status IN ('pending', 'review', 'confirmed', 'skipped', 'error')

### Priority 7 (LOW) — Clean Dead Code
1. Evaluate reconcile_transactions table
2. If unused, drop it and remove reconcileApi code
3. If WIP feature, create GitHub issue to track completion

---

## H. SQL MIGRATION FILE MANIFEST

| File | Order | Type | Tables | Status |
|---|---|---|---|---|
| (base schema) | 0 | CREATE | accounts, ledger, expense_categories, income_sources, fx_rates, account_currencies, installments, recurring_templates, recurring_reminders, app_settings, employee_loans, employee_loan_payments, reconcile_sessions, reconcile_transactions, estatement_pdfs | IMPLICIT |
| v2.1_merchant_mappings.sql | 1 | CREATE | scan_batches, merchant_mappings | OK |
| v2.1_gmail_tables.sql | 2 | CREATE | gmail_tokens, email_sync | OK |
| v2.1_ledger_columns.sql | 3 | ALTER | ledger (add columns) | ISSUE: category_id is TEXT |
| v2.2_fx_rate_used.sql | 4 | ALTER | ledger (add fx_rate_used) | OK |
| v2.3_reimburse_settlements.sql | 5 | CREATE + ALTER | reimburse_settlements, ledger (add reimburse_settlement_id) | OK |
| v2.4_reimburse_pending.sql | 6 | ALTER | reimburse_settlements (add status, linked_ledger_id, to_account_id) | OK |
| v2.5_estatement_account.sql | 7 | ALTER | estatement_pdfs (add account_id) | OK |
| v2.5_settlement_nullable_date.sql | 8 | ALTER | reimburse_settlements (make settled_at nullable, add CHECK) | ISSUE: may fail if status doesn't exist |
| v2.6_unified_import.sql | 9 | ALTER | scan_batches, ledger (add import columns) | OK |
| v2.7_category_system.sql | 10 | UPDATE | ledger (backfill category names/ids) | OK |
| v2.8_deposito.sql | 11 | ALTER | accounts (add deposit_bank_id) | OK |
| v2.9_card_image_url.sql | 12 | ALTER | accounts (add card_image_url) | OK |
| v2.10_statement_attachments.sql | 13 | CREATE | statement_attachments | OK |
| v2.11_gmail_needs_reconnect.sql | 14 | ALTER | gmail_tokens (add needs_reconnect) | OK |
| create_merchant_rules.sql | 15 | ALTER + CREATE FUNCTION | merchant_mappings (add tx_type), increment_merchant_rule_usage RPC | OK |
| create_import_drafts.sql | 16 | CREATE | import_drafts | OK |
| **EXTERNAL** |
| supabase_session3_assets.sql | N/A | CREATE | assets, asset_price_history, liabilities | ORPHAN — not in migrations/ |

---

## I. CONCLUSION

The cc-tracker schema is **functionally complete but has critical issues:**

1. ✅ **Coverage:** All 31 tables are defined and mostly functional
2. ✅ **Core features:** Accounts, ledger, transactions, categories all working
3. ⚠️ **Asset system:** Broken — dual pattern with AddNewPicker → accounts but assetsApi ← assets table
4. ⚠️ **Type safety:** category_id is TEXT instead of UUID
5. ⚠️ **Documentation:** Base schema not in migrations; impossible to rebuild from scratch
6. ⚠️ **Constraints:** Missing CHECK constraints and some foreign keys

**Recommendation:** Fix issues in Priority 1-3 before production use. The asset table mismatch will cause data loss if not resolved.

