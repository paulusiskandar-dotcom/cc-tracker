# Cost Basis Double — Audit

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15

---

## 1. Formula Location

- **File:** `src/components/AssetTimeline.jsx`
- **Variable:** `costBasis`
- **Lines:** L98-104

```js
const costBasis = useMemo(() => {
  const base = Number(asset.purchase_price || 0);
  const adds = assetLedger
    .filter(e => e.tx_type === "buy_asset" && e.to_id === asset.id)
    .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  return base + adds;
}, [asset, assetLedger]);
```

Formula in words: **`costBasis = asset.purchase_price + SUM(buy_asset ledger entries)`**

This always sums BOTH sources. There is no branch that says "if ledger entries exist, ignore purchase_price" or vice versa.

---

## 2. Sources Summed

### Source 1: `asset.purchase_price` (L99)

Field on the `accounts` table. Read directly from the `asset` prop — no DB query here.

**Where it gets set for deposito:**

`src/components/Assets.jsx` — `handleAddAsset` at L383-412:

```js
const isDeposito = addAssetForm.subtype === "Deposito";   // L388
const data = {
  current_value:  sn(addAssetForm.current_value) ?? 0,                            // L392
  purchase_price: isDeposito                                                        // L393
    ? (sn(addAssetForm.current_value) ?? 0)    // ← deposito: purchase_price = current_value
    : (sn(addAssetForm.purchase_price) ?? 0),  // ← other assets: user-entered
  ...
};
await accountsApi.create(user.id, data);
```

For a deposito created via Assets.jsx with Principal = 30M:
- `current_value = 30,000,000` ← user enters "Principal"
- `purchase_price = 30,000,000` ← **automatically copied from current_value** (L393)

**Result in DB:** `accounts.purchase_price = 30,000,000`

### Source 2: `SUM(buy_asset ledger entries)` (L100-102)

All `ledger` rows where `tx_type = "buy_asset"` AND `to_id = asset.id`, summed over `amount_idr`.

For Deposito Superbank May 2026: one buy_asset entry for 30,000,000 exists.

### Why it double-counts for this asset

```
asset.purchase_price  = 30,000,000   (set by Assets.jsx L393: purchase_price ← current_value)
SUM(buy_asset ledger) = 30,000,000   (1 buy_asset entry pointing to this deposito)
─────────────────────────────────────
costBasis             = 60,000,000   ← DOUBLE
```

The two sources represent the **same cost event**. `purchase_price` was set to record the deposit principal when the account was created. The buy_asset ledger entry was created separately (manually, or via TxVerticalBig "Existing Asset" flow) to record the same transfer from a bank account. The formula does not check whether they overlap.

---

## 3. Comparison with BYD Seal

BYD Seal reportedly displays correctly at 150M cost basis, with 2 buy_asset entries (10M + 140M = 150M).

**Why BYD Seal doesn't double:**

BYD Seal was created via the TxVerticalBig "New Asset" flow (or entered with purchase_price = 0 in Assets.jsx). In the TxVerticalBig flow, the asset account is created via `assetsApi.create`:

```js
// api.js L1079-1088 — assetsApi.create
return accountsApi.create(userId, {
  name:            d.name,
  type:            "asset",
  subtype:         d.type || d.subtype || null,
  currency:        d.currency || "IDR",
  current_value:   Number(d.current_value || 0),
  initial_balance: Number(d.purchase_price || d.current_value || 0),
  notes:           ...,
  // ← `purchase_price` is NOT in this object
});
```

`purchase_price` is deliberately **not passed** to `accountsApi.create`. So for new assets created via TxVerticalBig, the `purchase_price` column in accounts is `NULL / 0`.

```
asset.purchase_price  = 0            (not stored by assetsApi.create)
SUM(buy_asset ledger) = 150,000,000  (10M + 140M)
─────────────────────────────────────
costBasis             = 150,000,000  ← correct
```

**BYD's 10M entry (first buy):** Created by TxVerticalBig "New Asset" → asset was created fresh; the buy_asset entry is the only record of cost.

**BYD's 140M entry (second buy):** Created by TxVerticalBig "Existing Asset" → points to same BYD account; adds to `adds`.

Since `purchase_price = 0`, no double-count occurs. The formula happens to produce the correct result only because the asset was created in a way that left `purchase_price = NULL/0`.

---

## 4. Recent Commits

```
83bd9f6 audit: buy asset edit modal asset_id dropdown not pre-filling
2597ee5 feat(asset): chart use asset_value_history primary source + empty state CTA + Update Value persist record
26b36f4 feat(asset): chart use asset_value_history table primary source + empty state CTA + Update Value persist record
da0ae9b fix(asset): realized P&L for archived assets — sale proceeds factored, chart factor in sale, label conditional
a916bd9 fix(asset): persist to_id + recalculate on buy, add Sell button + archived section + relax StatementPage guard
6a3651a feat: unified statement layout for asset/loan/reimburse (grid template)
ae4fe68 refactor: rename TransactionModal→TxVerticalBig, TransactionReviewList→TxHorizontal
1bc21eb Add TransactionModal + edit/delete/export to AssetTimeline and EmployeeLoanStatement
```

**`da0ae9b` (most relevant):** Added `saleProceeds` for realized P&L on archived assets. Did NOT touch the `costBasis` formula — `base + adds` has been unchanged since at least commit `1bc21eb`.

**`a916bd9`:** Added `recalculateBalance` call after buy_asset saves (TxVerticalBig). This call sets `current_value = initial_balance + SUM(buy_asset entries)` for the asset. For Deposito Superbank: `initial_balance = 0` + `buy_asset = 30M` = 30M → `current_value = 30M` ✓. This does NOT affect `purchase_price`.

**No commit has introduced the double-count** — the `costBasis` formula has always summed `purchase_price + ledger`. The bug was latent and only triggered once a deposito created via Assets.jsx (which sets `purchase_price = current_value`) also acquired a buy_asset ledger entry.

---

## 5. Root Cause

**Two overlapping cost-tracking systems that the formula blindly sums:**

| System | Where set | What it stores | Should contribute to costBasis |
|---|---|---|---|
| `accounts.purchase_price` | Assets.jsx L393 | Deposit principal (= current_value for depositos) | Yes, ONLY if no ledger entries exist |
| `buy_asset` ledger entries | TxVerticalBig save | Cash actually debited from a bank account | Yes, always |

The `costBasis` formula was designed for two mutually exclusive cases:
- **Case A — Legacy / manual accounts:** `purchase_price > 0`, no ledger entries → `costBasis = purchase_price`
- **Case B — Ledger-tracked accounts:** `purchase_price = 0`, ledger entries exist → `costBasis = SUM(entries)`

The formula works correctly only if these cases remain mutually exclusive. **They are not enforced to be exclusive.** Assets.jsx L393 explicitly sets `purchase_price = current_value` for all depositos, and users can independently create buy_asset ledger entries for the same asset — resulting in double-count.

**Why specifically for deposito:**
- Assets.jsx `handleAddAsset` has special logic: `purchase_price = isDeposito ? current_value : form.purchase_price`
- This auto-populates `purchase_price = 30M` even though the user only entered "Principal"
- The user (or some flow) also created a buy_asset entry → double-counted

**Side note — subtype check inconsistency:**
Assets.jsx L388 checks `addAssetForm.subtype === "Deposito"` (Indonesian spelling only). Accounts.jsx L333 checks both `"Deposit"` OR `"Deposito"`. So a deposito with subtype `"Deposit"` created via Assets.jsx would NOT trigger the `purchase_price = current_value` assignment — it would use the user-entered `purchase_price` field instead. Only `"Deposito"` subtype is affected by the auto-copy.

---

## 6. Suggested Fix (NOT IMPLEMENTED)

### Fix A — Change costBasis to prefer ledger entries (AssetTimeline.jsx)

Replace the current `base + adds` formula with a priority-based approach:

```js
// src/components/AssetTimeline.jsx — replace L98-104
const costBasis = useMemo(() => {
  const adds = assetLedger
    .filter(e => e.tx_type === "buy_asset" && e.to_id === asset.id)
    .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  // If buy_asset ledger entries exist, use them as cost basis (they are the authoritative record).
  // Only fall back to purchase_price for legacy/manually-created assets with no ledger entries.
  return adds > 0 ? adds : Number(asset.purchase_price || 0);
}, [asset, assetLedger]);
```

Result for Deposito Superbank May 2026:
- `adds = 30,000,000 > 0` → `costBasis = 30,000,000` ✓
- `P&L = 30M − 30M = 0` ✓
- `Return = 0%` ✓

Result for BYD Seal (unchanged):
- `adds = 150,000,000 > 0` → `costBasis = 150,000,000` ✓

Result for legacy assets with `purchase_price > 0` and no ledger entries:
- `adds = 0` → falls back to `purchase_price` ✓

**Minimal change:** 1 file, replace 6 lines with 5 lines. No DB changes, no API changes.

### Fix B — Stop copying `current_value` into `purchase_price` for depositos (Assets.jsx)

Change Assets.jsx L393:
```js
// Before:
purchase_price: isDeposito ? (sn(addAssetForm.current_value) ?? 0) : (sn(addAssetForm.purchase_price) ?? 0),

// After:
purchase_price: sn(addAssetForm.purchase_price) ?? 0,
// (deposito users would enter purchase_price explicitly if they want it, or leave blank)
```

This prevents the auto-copy that creates the inconsistency. Existing assets with `purchase_price` already set would not be affected unless Fix A is also applied.

**Fix A alone is sufficient** and safer — it handles both new and existing data without requiring the user to re-enter anything. Fix B prevents the problem for future depositos created via Assets.jsx but doesn't fix existing data.
