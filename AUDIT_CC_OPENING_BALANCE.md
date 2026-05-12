# CC Opening Balance — Field Mapping Audit

Generated: 2026-05-12

---

## 1. Edit Card Modal

**File:** `src/components/CreditCards.jsx`

| Step | Line | Detail |
|---|---|---|
| Default state | 124 | `emptyEditCardForm()` includes `initial_balance: ""` |
| Form populate (Edit) | 441 | `initial_balance: cc.initial_balance != null ? String(cc.initial_balance) : ""` |
| Save handler | `saveEditCard()`, line 457 | |
| DB write | 468 | `initial_balance: sn(editCardForm.initial_balance)` |
| Maps to DB column | `accounts.initial_balance` | |

**`sn()` helper** (line 460): `(v) => { const n = Number(v); return (v === "" || v == null || isNaN(n)) ? null : n; }`
- Blank field → saves `null` (DB falls back to 0 in CCStatement)
- **Negative values: allowed** — no min constraint enforced
- **Positive values: allowed** — no max constraint enforced

**Side effects on save:** None.
`saveEditCard()` writes only: `name, bank_name, card_last4, network, card_limit, initial_balance, statement_day, due_day, color, card_image_url, shared_limit fields`.
It does **NOT** update `outstanding_amount` or `current_balance` after saving `initial_balance`.

**Gap:** Setting Opening Balance via Edit Card Modal does not recalculate `outstanding_amount`. The two fields drift immediately after save.

---

## 2. CC Display — Outstanding Badge

**File:** `src/components/CreditCards.jsx`, `cardStats` useMemo (line 201)

```js
const debt = Number(cc.outstanding_amount || 0) * rate;   // READ from DB column, not computed from ledger
const cr   = Number(cc.current_balance   || 0) * rate;   // CR/overpayment
```

**Outstanding source:** Stored in `accounts.outstanding_amount` — **read directly from DB, NOT computed from ledger in real-time.**
- Updated only when a ledger entry is saved via `api.js` (addLedgerEntry / updateLedgerEntry balance delta logic)
- For cards with no ledger transactions (e.g., BCA Card), `outstanding_amount` was set manually

**Available limit formula:**
```js
avail = Math.max(0, limit - debt + cr)   // limit - outstanding + CR credit
```

**Negative outstanding handling:** No special handling for negative `outstanding_amount`. If it goes negative, `avail` would exceed limit, which may be misleading. The `current_balance` field carries the CR/overpay side separately.

---

## 3. `current_balance` Field Usage

`current_balance` has **two completely different roles** depending on account type:

### Bank / Cash accounts
Primary balance field — represents actual account balance.

| File | Lines | Purpose |
|---|---|---|
| `Accounts.jsx` | 104, 732, 741, 805, 862, 938, 951, 954, 959, 1041, 1045, 1052, 1117 | Display, sort, net worth compute |
| `Accounts.jsx` | 166, 232 | Saved to DB; mirrors `initial_balance` on first create |
| `Accounts.jsx` | 218–220 | When `initial_balance` changes for bank/cash → triggers `recalculateBalance()` |
| `SearchModal.jsx` | 90 | Balance display in search |
| `shared.jsx` | 396 | Net worth bank subtotal |
| `shared/BankPickerSheet.jsx` | 64–66 | Bank picker balance display |

### Credit Card accounts
**Overpayment / CR balance only** — NOT the primary CC balance.

| File | Lines | Purpose |
|---|---|---|
| `CreditCards.jsx` | 182, 204 | CR added to shared group total; used in available limit calculation |
| `CreditCards.jsx` | 515 | Initialised to 0 on new card payment form |
| `CreditCards.jsx` | 1013 | Bank picker (shows bank balance, not CC) |
| `CCStatement.jsx` | 481–483 | Shows `+Rp X CR` badge if `current_balance > 0` (overpayment indicator) |
| `Upcoming.jsx` | 698–701 | "Current CR" display + available limit calc |

**`balField()` in api.js line 51–53:**
```js
if (type === "bank")          return "current_balance";    // bank balance field
if (type === "credit_card")   return "outstanding_amount"; // CC balance field
```

**`recalculateBalance()` in api.js lines 530–554:** For CC accounts, computes from scratch using `initial_balance` as seed:
```js
let outstanding = Number(acc?.initial_balance || 0);
let cr = 0;
for (const tx of txns) {
  if (tx.from_id === accountId) outstanding += amt;          // charge → adds to debt
  if (tx.to_id   === accountId) {
    if (amt <= outstanding) { outstanding -= amt; }          // payment → reduces debt
    else { cr += (amt - outstanding); outstanding = 0; }     // overpayment → CR
  }
}
await supabase.from("accounts")
  .update({ outstanding_amount: outstanding, current_balance: cr })
  .eq("id", accountId);
```

**Critical gap:** `recalculateBalance()` is only called automatically when `initial_balance` changes for **bank/cash** accounts (Accounts.jsx line 218–220). For **credit card** accounts, changing `initial_balance` via Edit Card Modal does NOT trigger `recalculateBalance()`. `outstanding_amount` and `current_balance` are left stale.

---

## 4. CC Statement Compute

**File:** `src/components/CCStatement.jsx`, `load()` function (line 246)

**Opening balance source:** `accounts.initial_balance`

```js
// Line 268–278
const initialBal    = Number(selectedAccount?.initial_balance || 0);
const preTxs        = beforeRange || [];  // ledger WHERE tx_date < fromDate AND (from_id=cc OR to_id=cc)
const beforeCharge  = preTxs
  .filter(t => t.from_id === accountId && t.from_type === "account")
  .reduce((s, t) => s + Number(t.amount_idr || 0), 0);
const beforePayment = preTxs
  .filter(t => t.to_id === accountId && t.to_type === "account")
  .reduce((s, t) => s + Number(t.amount_idr || 0), 0);
const openingBal = initialBal + beforeCharge - beforePayment;
```

**Full formula chain:**
```
openingBal  = initial_balance + Σ(charges before period) - Σ(payments before period)
totalCharge = Σ(from_id=cc charges within period)
totalPayment= Σ(to_id=cc payments within period)
closingBal  = openingBal + totalCharge - totalPayment
```

**`outstanding_amount` NOT used in any KPI compute** — only shown in the header badge (lines 475–481).

**Negative openingBal handling:** Yes. Line 525:
```js
color={data.openingBal < 0 ? "#059669" : "#1d4ed8"}   // green = credit, blue = debt
```
Negative opening balance (credit/overpayment) is supported and colour-coded.

**Period auto-compute** (lines 229–238):
```
statement_day = 18 → period = 19th prev month → 18th selected month
Example: selected = 2026-05 → period = 2026-04-19 → 2026-05-18
```

---

## 5. Reconcile CC

**Files:** `src/components/Reconcile.jsx`, `src/lib/useReconcileDrafts.js`

**Opening balance source for reconcile mode:** Passed as prop from PDF parse or manual input.

```js
// Reconcile.jsx lines 133, 149
openingBal = r.opening_balance ?? null;         // from AI PDF parse result
openingBal = result.opening_balance ?? null;    // from reconcilePdfUpload result
```

This `openingBal` is passed via navigation as `initialReconcileOpeningBal` → received by `CCStatement.jsx` line 133:
```js
openingBal: initialReconcileOpeningBal,
```

In **reconcile mode**, the opening balance seeds the reconcile wizard from the uploaded PDF statement, overriding the computed `initial_balance`-based value. In **normal statement view** (no PDF), opening is always `initial_balance + pre-period ledger`.

`useReconcileDrafts.js` has no references to `opening_balance` — it stores draft rows but defers opening balance to CCStatement.

---

## 6. Recommendations

### Is "Opening Balance" UI connected to the correct DB column?
**Yes.** `initial_balance` in `accounts` table is the correct semantic field:
- CCStatement reads it to seed opening balance
- `recalculateBalance()` uses it as starting point for outstanding compute
- Edit Card Modal (CreditCards.jsx) now correctly writes to `accounts.initial_balance`

### Critical missing step after saving Opening Balance
When `initial_balance` is changed via Edit Card Modal, `recalculateBalance()` is **not called** (only happens for bank/cash — Accounts.jsx line 218–220). This means `outstanding_amount` and `current_balance` stay stale.

**Fix needed in `saveEditCard()`:** After the `accountsApi.update()` call, add:
```js
if (editCardForm.initial_balance !== "") {
  await recalculateBalance(editCardAcc.id, user.id);
}
```
This will re-derive `outstanding_amount` from `initial_balance` + all existing ledger transactions — syncing the Outstanding badge with the new opening balance.

### Is a new `opening_balance` column needed?
**No.** `accounts.initial_balance` already serves this purpose correctly across all compute paths. Adding a new column would create another source of truth to keep in sync.

### Can `current_balance` be deprecated for CC?
**No** — it has a valid purpose as the CC **credit/overpayment** store. When a payment exceeds the outstanding debt, the excess goes into `current_balance` as CR. Removing it would break available limit calculations and the CR badge display.

### Summary of field roles for CC accounts

| DB Column | Role | Updated by |
|---|---|---|
| `initial_balance` | Pre-tracking seed debt (Opening Balance UI) | Edit Card Modal (manual) |
| `outstanding_amount` | Current live debt | api.js balance delta on each ledger entry; `recalculateBalance()` |
| `current_balance` | CR/overpayment amount | api.js payment delta when payment > outstanding |

### For cards with no ledger tracking (BCA Card, BRI, CIMB, etc.)
- `outstanding_amount` was set manually and does not reflect `initial_balance`
- Setting `initial_balance` via Edit Card Modal + calling `recalculateBalance()` will re-derive `outstanding_amount` correctly (from ledger only — if there are no ledger entries, `outstanding_amount` = `initial_balance`, `current_balance` = 0)
- Recommend: set `initial_balance` = known outstanding debt for each untracked card, then trigger recalculate
