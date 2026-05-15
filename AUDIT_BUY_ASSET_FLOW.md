# Buy Asset Flow — Audit

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15

---

## 1. Add/Edit Transaction Modal

- **File:** `src/components/shared/TxVerticalBig.jsx`
- **Modal type for buy_asset:** `renderFields()` branch at L1035; special save handler at L557
- **Asset selector source:** `assetAccs = assets.filter(a => a.is_active !== false)` (L365), where `assets` prop comes from `App.js → accounts.filter(a => a.type === 'asset')`. Passed as `<select value={form.asset_id || ""} ...>` at L1063.
- **Save handler:** `save()` at L402 → `if (type === "buy_asset" && !isEdit)` branch at L557
- **Fields written to ledger (existing-asset path):**
  ```js
  {
    tx_date, description: assetName,
    amount: price, currency: "IDR", amount_idr: price,
    tx_type: "buy_asset", from_type: "account", to_type: "account",
    from_id: uuid(form.from_id),
    to_id:   isExst ? uuid(form.asset_id) : null,    // ← uses form.asset_id, NOT form.to_id
    category_id: null, ...
  }
  ```

---

## 2. Asset Balance Update

- **File:** `src/api.js`
- **Balance field for asset:** `balField("asset") = "current_value"` (L54)
- **Delta map for buy_asset:** `getDeltas("buy_asset", amount)` → `{ from: {bank: -a}, to: {asset: +a} }` (L69)
- **Function:** `applyBalanceDelta(accountId, accountType, delta)` at L93
- **Logic for asset:**
  ```js
  const field = balField("asset");            // "current_value"
  const { error } = await supabase.rpc("increment_account_balance", {
    p_account_id: accountId,
    p_field:      "current_value",
    p_delta:      delta,                      // +amount
  });
  if (error) {                                // RPC doesn't exist in local migrations
    const { data } = await supabase.from("accounts").select("current_value")...
    const newVal = Number(data["current_value"] || 0) + delta;
    await supabase.from("accounts").update({ current_value: newVal })...;
  }
  ```
- **Trigger on ledger insert for buy_asset:** `applyBalanceDelta` is called inside `ledgerApi.create` (L337-341) for both `fromAcc` and `toAcc`. BUT — **`recalculateBalance` is NOT called explicitly** after the buy_asset special-path save (lines 577-592). The general path (`isEdit=false` non-special types) DOES call `recalculateBalance` at L750 after `ledgerApi.create`, as a safety net. The buy_asset path skips this.

---

## 3. Save Flow Trace (sample: ARISTA, existing BYD Seal, Rp 10.000.000)

```
User clicks save
  ↓
save() → isEdit = false
  ↓
if (type === "buy_asset" && !isEdit) branch (L557)
  ↓
  isExst = (form.asset_mode === "existing")   // true (default)
  form.asset_id = <BYD_SEAL_UUID>             // set when user selected from dropdown
  toId = uuid(form.asset_id) = <BYD_SEAL_UUID>

  entry = {
    tx_type: "buy_asset", from_type: "account", to_type: "account",
    from_id: <BCA_IDR_UUID>,
    to_id:   <BYD_SEAL_UUID>,
    amount_idr: 10000000, ...
  }

  ledgerApi.create(user.id, entry, accounts)
    ↓ sanitizeUUIDs → safeEntry.to_id = <BYD_SEAL_UUID> (cleanUUID passes 36-char UUID)
    ↓ new_asset undefined → pre-insert block skipped
    ↓ INSERT into ledger → row created
    ↓ toAcc = accounts.find(a => a.id === <BYD_SEAL_UUID>)  ← BYD Seal found
    ↓ deltas.to["asset"] = +10000000
    ↓ applyBalanceDelta(<BYD_SEAL_UUID>, "asset", +10000000)
        → supabase.rpc("increment_account_balance", { p_field: "current_value", p_delta: 10M })
        → [RPC may not exist → error] → fallback: select current_value → update current_value
    ↓ deltas.from["bank"] = -10000000
    ↓ applyBalanceDelta(<BCA_IDR_UUID>, "bank", -10000000) → current_balance -= 10M
  ↓ return created ledger row

  setLedger + showToast("Asset purchased")
  await onRefresh() → loadData() → accountsApi.getAll → reloads accounts state
  onClose()
```

**Bank balance:** decremented via `applyBalanceDelta` → should work.
**Asset balance:** incremented via `applyBalanceDelta` → depends on whether RPC or fallback succeeds (see §8).
**Note:** No explicit `recalculateBalance` for the asset in this path (unlike the general add-transaction path at L750).

---

## 4. Load / Edit Flow

When `mode === "edit"` and `initialData` is the buy_asset ledger entry, the `useEffect` (L263) sets form state:

```js
setFormState({
  ...EMPTY(),                  // asset_id: null, asset_mode: "existing" ← from EMPTY()
  tx_date: initialData.tx_date,
  description: initialData.description,
  amount: initialData.amount,
  tx_type: "buy_asset",
  from_id: initialData.from_id,       // BCA IDR → correctly populated
  to_id:   initialData.to_id,         // BYD Seal UUID → correctly populated
  ...
  // ⚠ MISSING: asset_id is NOT mapped from initialData.to_id
});
```

`EMPTY()` initialises `asset_id: null`. The `useEffect` does NOT include `asset_id: initialData.to_id`. So:
- `form.to_id = <BYD_SEAL_UUID>` ✓
- `form.asset_id = null` ✗

The buy_asset `renderFields()` (L1035) renders the asset selector as:
```jsx
const selectedAsset = assetAccs.find(a => a.id === form.asset_id);  // undefined (null)
<select value={form.asset_id || ""} ...>                            // shows "Select asset…"
```

→ **Asset dropdown shows blank** even though the linked asset IS stored in `form.to_id`.

When the user opens edit mode and sees the blank dropdown, if they save without re-selecting, the **general edit path** (L698) runs (`isEdit = true`, special paths gated on `!isEdit`):
```js
const entry = {
  ...
  to_id: type === "reimburse_out" ? null : uuid(form.to_id),  // L682 — uses form.to_id
};
```
Since `form.to_id = <BYD_SEAL_UUID>` was correctly loaded, the edit save preserves the correct `to_id`. But the UI display is still broken.

---

## 5. Existing Ledger Entry (ARISTA)

Cannot run SQL directly — no Supabase MCP/CLI in this session. Manual Supabase SQL Editor query:

```sql
SELECT id, tx_date, tx_type, amount, amount_idr,
       from_id, from_type, to_id, to_type, description
FROM ledger
WHERE user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND tx_type = 'buy_asset'
ORDER BY tx_date DESC
LIMIT 5;
```

**Expected if save worked correctly:**
- `to_id = <BYD_SEAL_UUID>` (not null)
- `to_type = 'account'`
- `from_id = <BCA_IDR_UUID>`
- `amount_idr = 10000000`

**If `to_id = NULL`:** The `applyBalanceDelta` for the asset side was skipped (toAcc = null), confirming Bug B root cause. Would happen only if `form.asset_id` was invalid/null at save time.

**Check this column to disambiguate Bug B root cause.**

---

## 6. Asset Account (BYD Seal)

Cannot run SQL directly. Query to run:

```sql
SELECT id, name, type, subtype, initial_balance, current_value, purchase_price, purchase_date
FROM accounts
WHERE user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND type = 'asset'
ORDER BY name;
```

**Expected after successful buy:**
- `BYD Seal.current_value` = original value + 10,000,000
- `BYD Seal.initial_balance` = original purchase price (unchanged by buy_asset transaction)

**If `current_value` unchanged:** either `applyBalanceDelta` failed silently, or the RPC `increment_account_balance` errored AND the fallback also failed (RLS? column name mismatch?).

---

## 7. Recent Commits

```
8be0ac2 fix(gmail-sync): SELECT is_active + card_last4 …
cf68b30 fix(email): lower auto-detect confidence gate + amber border …
ea5ae96 fix(cc): trigger recalculateBalance after save Opening Balance
26c3c22 fix(creditcards): add Opening Balance field to Edit Card modal
05486f3 feat(accounts): add Opening Balance field to CC edit form
```

```sh
git log --oneline -30 | grep -i asset
# (no results — no recent commit touches asset or buy_asset logic)
```

**No recent commit touched the buy_asset flow.** This is a first-use bug (feature untested before).

---

## 8. Root Cause Hypothesis

### Bug A: Asset dropdown blank in edit modal

**Root cause confirmed in code:** `TxVerticalBig.jsx:283-304` — the `setFormState()` call in edit mode spreads `EMPTY()` (which has `asset_id: null`) but does NOT add `asset_id: initialData.to_id`. Only `to_id` is populated; `asset_id` stays null.

The asset UI selector reads `form.asset_id` (not `form.to_id`). The two fields are parallel — `to_id` is the ledger DB field; `asset_id` is the UI form field for buy_asset. The edit mode loader doesn't bridge them.

Additionally, in the context of `buy_asset` UI:
- **Add mode** stores selected asset in `form.asset_id` and derives `to_id` at save time
- **Edit mode** loads `to_id` from the ledger, but never back-fills `form.asset_id`

### Bug B: Asset `current_value` not updated after buy

**Most likely cause — missing `recalculateBalance` call in buy_asset special path:**

The buy_asset save path (L557-593) relies entirely on the incremental `applyBalanceDelta` inside `ledgerApi.create`. There is no subsequent `recalculateBalance(assetId, userId)` call, unlike:
- The general add path (L746-750): calls `recalculateBalance` for all affected accounts after `ledgerApi.create`
- The edit path (L701-707): calls `recalculateBalance` for all affected accounts after `ledgerApi.update`

If `applyBalanceDelta` fails silently for the asset (e.g., `increment_account_balance` RPC doesn't exist AND the fallback UPDATE also fails due to RLS or another Supabase error), the `current_value` stays unchanged. The function returns without throwing — there is no error propagation to the caller.

**Contributing factor — `increment_account_balance` RPC not in local migrations:**
```sh
grep -rn "increment_account_balance" supabase/
# (no results in any migration file)
```
If this RPC doesn't exist in the Supabase project, every `applyBalanceDelta` call hits the fallback path (L128-135). This fallback does a SELECT then UPDATE. If the RPC is the production path and the fallback has any issue (e.g., RLS `UPDATE` on `accounts` table for `current_value` column is restricted), the silent error explains Bug B.

**Secondary issue — new asset path is doubly broken:**

For the `!isExst` (new asset) path:
1. `to_id = null` in the ledger entry → `applyBalanceDelta` for the asset is skipped entirely
2. `assetsApi.create` is called separately (L581) with hardcoded `current_value: price`
3. The ledger row permanently has `to_id = null` → future `recalculateBalance(newAsset.id)` would give `initial_balance + 0 = initial_balance`, not the purchase price from the ledger
4. Inconsistency: asset `current_value` set by creation, not by the ledger entry

---

## 9. Suggested Fix (NOT IMPLEMENTED)

### Fix A — Populate `asset_id` from `initialData.to_id` in edit mode (one-liner)

`TxVerticalBig.jsx:283-304` in the `setFormState` for edit mode:

```js
setFormState({
  ...EMPTY(),
  // ... existing fields ...
  to_id:     formToId,
  // ADD: back-fill asset_id for buy_asset
  asset_id:  txType === "buy_asset" ? (initialData.to_id || null) : null,
  asset_mode: txType === "buy_asset" ? "existing" : "existing",
  // ...
});
```

This ensures the asset dropdown reads the correct value in edit mode.

### Fix B1 — Add explicit `recalculateBalance` after buy_asset special-path save (one-liner)

`TxVerticalBig.jsx:588` after `showToast("Asset purchased")`:

```js
// After ledgerApi.create:
await Promise.all([
  recalculateBalance(uuid(form.from_id), user.id),
  isExst ? recalculateBalance(uuid(form.asset_id), user.id) : null,
].filter(Boolean));
```

This guarantees the asset `current_value` is recomputed from all ledger entries (robust to incremental update failures). Mirrors the pattern already used in the general path (L750) and edit path (L707).

### Fix B2 (defensive): Also fix `recalculateBalance` after new-asset creation

`TxVerticalBig.jsx:581-586` — after `assetsApi.create`, call `recalculateBalance` with the new asset id. But first, the ledger entry must also have `to_id = newAsset.id` (currently `to_id = null`). This requires a more involved refactor for the new-asset path (create asset first, then pass to `ledgerApi.create` with the new id — similar to how `ledgerApi.create` itself would do it if `new_asset` was passed). Full fix deferred.

### Fix B3 — Ensure `increment_account_balance` RPC handles "current_value"

If the RPC exists but only handles certain fields (`current_balance`, `outstanding_amount`), add `current_value` and `initial_balance` to the allowed fields. Or simply rely on the fallback path (the JS SELECT+UPDATE code), which doesn't depend on the RPC.

### Minimal combined fix order:
1. **Fix A** (one-liner in `setFormState`) — restores edit modal display
2. **Fix B1** (add `recalculateBalance` after buy_asset save) — guarantees asset balance correct, works around any RPC issue
