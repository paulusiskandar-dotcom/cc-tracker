# New Asset Tab — Auto-Create Flow Audit

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15

---

## 1. UI Fields

**Tab location:** `src/components/shared/TxVerticalBig.jsx` — L1054-1096 (inside `if (type === "buy_asset")`)

**Tab toggle (L1054-1066):** Two buttons `["existing","new"]` toggling `form.asset_mode`.

**Fields rendered when `asset_mode = "new"` (L1088-1096):**

| Field | Label | State var | Default |
|---|---|---|---|
| Asset Name | "Asset Name *" | `form.asset_name` | `""` (empty string) |
| Asset Type | "Asset Type" (dropdown) | `form.asset_type` | `"Investment"` |
| From Account | "From Account" | `form.from_id` | null |
| Date | "Date" | `form.tx_date` | today |
| Amount | "Purchase Price (IDR)" | `form.amount` | `""` |
| Notes | "Notes" | `form.notes` | `""` |

**Asset Type options (L84, ASSET_TYPES constant):**
`["Property","Vehicle","Investment","Crypto","Collectible","Other"]`
Default selected: `"Investment"` — there is NO "Deposito" option here.
If user types "Deposito" as the name and leaves Asset Type as default, the account will be created with `subtype = "Investment"` (not "Deposito"/"Deposit").

**Validation (L560-567):**
```js
if (!form.from_id)              { showToast("Select source account", ...); return; }
if (!form.asset_name?.trim())   { showToast("Asset name is required", ...); return; }
// No validation on asset_type — defaults to "Investment" silently
```

**EMPTY() defaults (L78):**
```js
asset_name: "", asset_type: "Investment", asset_mode: "existing", asset_id: null
```
Note: default tab is `"existing"`. User must explicitly click "New Asset" button.

---

## 2. Save Handler

**File:** `src/components/shared/TxVerticalBig.jsx`
**Path:** L558-603, inside `if (type === "buy_asset" && !isEdit)`

```js
const price  = sn(form.amount);          // = 30,000,000
const isExst = form.asset_mode === "existing";  // = false for new tab
```

**Steps executed in order for "New Asset" mode:**

### Step 1 — Create asset account (L570-577)
```js
if (!isExst) {
  newAsset = await assetsApi.create(user.id, {
    name:           "Deposito",          // from form.asset_name
    type:           "Investment",        // from form.asset_type (default)
    current_value:  0,                   // ← hardcoded 0
    purchase_price: price,               // ← 30,000,000
    purchase_date:  form.tx_date,
    notes:          form.notes || null,
  });
}
```
See §3 for what `assetsApi.create` does with these values.

### Step 2 — Create buy_asset ledger entry (L581-591)
```js
const entry = {
  tx_date:    form.tx_date,
  amount:     price,         // 30,000,000
  amount_idr: price,         // 30,000,000
  tx_type:    "buy_asset",
  from_type:  "account",
  to_type:    "account",
  from_id:    uuid(form.from_id),   // Superbank bank account
  to_id:      newAsset?.id,         // ← newly created asset account ID
  ...
};
await ledgerApi.create(user.id, entry, ledgerAccounts);
```

### Step 3 — recalculateBalance called (L594-595)
```js
if (toId) {
  await recalculateBalance(toId, user.id);
}
```
This is called AFTER the ledger entry is created. See §4 for why this causes the double-count.

### Step 4 — asset_value_history: NOT created
No insert into `asset_value_history` anywhere in this path. The chart in AssetTimeline will show "No value history yet" until the user manually clicks "📈 Update Value". The initial purchase is not recorded in the history table.

---

## 3. assetsApi.create

**File:** `src/api.js` — L1079-1088

```js
create: async (userId, d) => {
  return accountsApi.create(userId, {
    name:            d.name,             // "Deposito"
    type:            "asset",
    subtype:         d.type || d.subtype || null,  // "Investment"
    currency:        d.currency || "IDR",
    current_value:   Number(d.current_value || 0),  // = 0 (passed explicitly)
    initial_balance: Number(d.purchase_price || d.current_value || 0),  // = 30,000,000 ← PROBLEM
    notes:           d.notes || (d.purchase_date ? `Purchased ${d.purchase_date}` : null),
    // purchase_price is NOT stored in the accounts table
  });
},
```

**DB INSERT payload for Deposito 30jt:**
```
accounts table row:
  type:            "asset"
  subtype:         "Investment"
  name:            "Deposito"
  current_value:   0          ← 0 at insert time
  initial_balance: 30,000,000 ← mapped from purchase_price ← PROBLEMATIC
  purchase_price:  NULL       ← not passed → DB default null
  is_active:       true
```

**Key observation:** `initial_balance = 30,000,000` is stored even though `current_value = 0`. This represents the "opening balance" of the asset, which `recalculateBalance` will then use as its starting point — and the buy_asset ledger entry ALSO adds to that total.

---

## 4. recalculateBalance for Asset

**File:** `src/api.js` — L530-575

**Formula:**
```js
const field = balField(accType);          // balField("asset") = "current_value"  [L54]
let balance = Number(acc?.initial_balance || 0);   // = 30,000,000
for (const tx of txns) {
  const amt = Number(tx.amount_idr || 0);
  if (tx.to_id   === accountId && tx.to_type   === "account") balance += amt;  // credit
  if (tx.from_id === accountId && tx.from_type === "account") balance -= amt;  // debit
}
await supabase.from("accounts").update({ current_value: balance }).eq("id", accountId);
```

**Why it double-counts for new asset:**

| Step | balance |
|---|---|
| Start: `initial_balance` | 30,000,000 |
| buy_asset tx: `to_id = asset, to_type = "account"` → `balance += 30,000,000` | **60,000,000** |
| Written to DB: `current_value = 60,000,000` | ❌ DOUBLE |

`recalculateBalance` was designed for bank accounts where `initial_balance` is the opening balance BEFORE tracked ledger entries begin. For a new asset, the buy_asset ledger entry IS the opening transaction — there is no "pre-ledger" period. Setting `initial_balance = purchase_price` in `assetsApi.create` treats it as a "pre-ledger" balance that gets added AGAIN when the ledger entry runs through recalculate.

---

## 5. Sample Trace — Deposito 30jt (deleted)

**Input:**
- form.asset_name = "Deposito"
- form.asset_type = "Investment"
- form.amount = 30,000,000
- form.tx_date = 2026-05-15

**Step 1 — assetsApi.create:**
```
INSERT accounts: { current_value: 0, initial_balance: 30000000, ... }
→ newAsset.id = "64bb3dfc-..."
```

**Step 2 — ledgerApi.create buy_asset:**
```
INSERT ledger: { tx_type: "buy_asset", amount_idr: 30000000, to_id: "64bb3dfc-...", to_type: "account" }
```

**Step 3 — recalculateBalance("64bb3dfc-..."):**
```
SELECT initial_balance FROM accounts → 30,000,000
SELECT ledger WHERE to_id = "64bb3dfc-..." → [{ amount_idr: 30000000, to_type: "account" }]

balance = 30,000,000            (initial_balance)
balance += 30,000,000           (buy_asset credit to asset account)
         = 60,000,000

UPDATE accounts SET current_value = 60,000,000 WHERE id = "64bb3dfc-..."
```

**Observed in UI:**
```
Current Value:   60,000,000  ← WRONG (should be 30M)
Cost Basis:      30,000,000  ← now correct after Fix A applied (uses adds only, purchase_price=NULL)
Unrealized P&L:  +30,000,000 ← WRONG (60M - 30M = +30M phantom gain)
Return %:        +100%        ← WRONG
```

**Note:** The recently applied Fix A (costBasis = `adds > 0 ? adds : purchase_price`) partially helps: cost basis is now 30M (using ledger entries, not null purchase_price). But `current_value = 60M` is STILL wrong because it's set by recalculateBalance independently. The P&L is therefore also still wrong (+30M phantom gain).

---

## 6. Existing Asset Tab Comparison

**Save flow differences:**
- `isExst = true` → `assetsApi.create` is NOT called
- No new account row created — uses existing asset's `initial_balance` from DB
- Creates buy_asset ledger entry pointing to existing asset
- `recalculateBalance` called on existing asset

**Does "Existing Asset" tab double-count?**

Depends on the existing asset's `initial_balance`:

| Asset creation path | initial_balance | buy_asset entries | recalculate result | Double? |
|---|---|---|---|---|
| Assets.jsx `handleAddAsset` | **0** (not set, DB default) | 30M | 0 + 30M = 30M ✓ | No |
| Accounts.jsx form | **0** (form default for asset type) | 30M | 0 + 30M = 30M ✓ | No |
| TxVerticalBig "New Asset" (buggy) | **30M** (set by assetsApi.create) | 30M (original) + 140M (new) | 30M + 30M + 140M = 200M ❌ | Yes — triple |

**Conclusion:** "Existing Asset" tab is safe for assets created via Assets.jsx or Accounts.jsx (because they have `initial_balance = 0`). It becomes problematic for assets that were themselves created via TxVerticalBig "New Asset" tab (which sets `initial_balance = price`), because each additional buy through "Existing Asset" tab would stack correctly, but the initial_balance still causes the original double-count to persist.

---

## 7. Recent Commits

```
71c4e6c fix(asset): cost basis priority-based — ledger entries authoritative, purchase_price fallback only when no ledger
43e29be audit: cost basis double-counted in AssetTimeline
83bd9f6 audit: buy asset edit modal asset_id dropdown not pre-filling
2597ee5 feat(asset): chart use asset_value_history primary source + empty state CTA + Update Value persist record
26b36f4 feat(asset): chart use asset_value_history table primary source + empty state CTA + Update Value persist record
da0ae9b fix(asset): realized P&L for archived assets — sale proceeds factored, chart factor in sale, label conditional
a916bd9 fix(asset): persist to_id + recalculate on buy, add Sell button + archived section + relax StatementPage guard
```

**`a916bd9` is directly relevant:** This commit added `recalculateBalance` call after buy_asset saves in TxVerticalBig. Before this commit, `recalculateBalance` was NOT called — so the double-count in `current_value` did not exist. The bug was introduced here: the commit correctly added the recalculate call but did not account for `initial_balance` already being set to the purchase price in `assetsApi.create`.

The `assetsApi.create` `initial_balance = purchase_price` mapping predates `a916bd9` — it existed before recalculate was called. When recalculate wasn't called, `current_value = 0` (as set by assetsApi.create). Once `a916bd9` added the recalculate call, `current_value` jumped to `initial_balance + ledger = 2× amount`.

---

## 8. Root Cause

**Primary cause:** `assetsApi.create` maps `purchase_price` → `initial_balance` (api.js L1086), and `recalculateBalance` starts balance computation from `initial_balance` then adds all ledger entries (api.js L560-572).

For a new asset created via TxVerticalBig:
- `initial_balance = purchase_price = 30M` (set at account creation)
- `+ buy_asset ledger entry = 30M` (recalculate adds it)
- `current_value = 60M` ❌

**The mismatch:** `initial_balance` for bank accounts means "balance before tracked transactions." For a new asset, the buy_asset ledger entry IS the first and only transaction — there is no "before" period. Setting `initial_balance = purchase_price` implies there was a 30M balance before any ledger tracking, then the buy_asset adds another 30M.

**Introduced by:** commit `a916bd9` (adding `recalculateBalance` call after buy_asset). The `initial_balance` assignment in `assetsApi.create` was always there but was harmless when `recalculateBalance` wasn't called (current_value stayed 0 regardless).

**Why cost basis was also affected (before Fix A):** The now-fixed `costBasis` formula added `asset.purchase_price + ledger`. For assets from "New Asset" tab, `purchase_price = NULL/0` so cost basis was correct (`0 + 30M = 30M`). For assets from Assets.jsx (which DO set `purchase_price` in the accounts table), cost basis doubled.

**Current state after Fix A:** Cost basis is now correct. Current value is STILL wrong for assets created via TxVerticalBig "New Asset" tab. The phantom gain (+30M / +100%) is still displayed in the P&L metric and Return % cards.

---

## 9. Suggested Fixes (NOT IMPLEMENTED)

### Fix Option A (Quick): Set `initial_balance = 0` in assetsApi.create

**Where:** `src/api.js` — L1086

```js
// Before:
initial_balance: Number(d.purchase_price || d.current_value || 0),

// After:
initial_balance: 0,
```

**Effect on recalculate:**
```
balance = 0               (initial_balance = 0)
balance += 30M            (buy_asset credit)
         = 30M → current_value = 30M  ✓
```

**Side effects:**
- Only affects assets created via TxVerticalBig "New Asset" tab (only caller of `assetsApi.create`)
- Existing assets unaffected (no existing `initial_balance` changed)
- If asset creation succeeds but ledger creation fails (partial failure), `current_value` stays 0 instead of wrongly showing `purchase_price`. This is slightly safer than the current state.
- Assets.jsx `handleAddAsset` uses `accountsApi.create` directly — unaffected.
- For the already-broken Deposito asset (deleted by user) — no action needed.

**This is the minimal, targeted fix.**

---

### Fix Option B (Logic): Skip `initial_balance` in recalculate for asset type

**Where:** `src/api.js` — L560

```js
// Before:
let balance = Number(acc?.initial_balance || 0);

// After:
let balance = accType === "asset" ? 0 : Number(acc?.initial_balance || 0);
```

**Effect:** `recalculateBalance` for assets always starts from 0 and only counts ledger entries.

**Side effects:**
- Any existing asset that has `initial_balance > 0` AND no buy_asset ledger entries would have its `current_value` set to 0 by the next recalculate call. This would break legacy assets created with `initial_balance` as the only cost record.
- More invasive — changes behavior for all existing assets.
- NOT recommended without first auditing all existing assets in DB.

---

### Fix Option C (Defensive): Replace "New Asset" tab with confirm/redirect flow

Instead of creating the asset account inline during a buy_asset transaction, show a modal:
> "This will create a new asset. Please set it up in Assets first, then come back to log the purchase."

**Effect:** Eliminates accidental asset creation with wrong subtype (e.g., user types "Deposito" free-text but gets subtype "Investment"). Forces user to use Assets.jsx proper form.

**Side effects:**
- UX-disruptive. Users lose the ability to create assets in one step.
- Doesn't fix the existing double-count bug in DB for already-created assets.
- NOT recommended — convenience of "New Asset" tab is valuable.

---

### Recommended Fix Combination

**Apply Fix A only** (`initial_balance = 0` in `assetsApi.create`).

Additionally, consider inserting an `asset_value_history` record on new asset creation to ensure the chart shows purchase price from day one:

```js
// After assetsApi.create returns newAsset:
if (newAsset?.id) {
  await supabase.from("asset_value_history").insert({
    account_id: newAsset.id, user_id: userId,
    old_value: 0, new_value: price,
    date: form.tx_date, notes: "Initial purchase",
  });
}
```

This is optional but makes the chart meaningful immediately after asset creation.
