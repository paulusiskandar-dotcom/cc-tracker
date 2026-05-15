# Buy Asset Edit Modal — Asset Dropdown Not Pre-filling

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15

---

## 1. Component Location

- **File:** `src/components/shared/TxVerticalBig.jsx`
- **Dropdown render:** L1072-1080 (inside `if (type === "buy_asset")` at L1044)
- **Form state init:** L283-306 (useEffect — runs when `open` changes)
- **Asset list derivation:** L367

---

## 2. Data Flow

### How `assetAccs` (dropdown options) is built

**App.js (L145-146):**
```js
// accountsApi.getAll uses:
.neq("is_active", false)   // excludes is_active = false accounts
```

**App.js (L349):**
```js
const assets = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);
```
`accounts` already excludes inactive. `assets` is therefore also free of inactive accounts.

**TxVerticalBig.jsx (L367):**
```js
const assetAccs = assets.filter(a => a.is_active !== false);
```
Redundant but harmless — `assets` prop has already been cleaned by `accountsApi.getAll`.

**Net result:** The `<select>` options pool = accounts in Supabase WHERE `type = "asset"` AND `is_active != false`.

### How `form.asset_id` (selected value) is set

**TxVerticalBig.jsx (L283-306) — useEffect runs on `open`:**
```js
setFormState({
  ...EMPTY(),            // asset_mode: "existing", asset_id: null (L78)
  ...
  // buy_asset edit: back-fill asset_id from to_id so dropdown pre-selects correctly
  asset_id: txType === "buy_asset" ? (initialData.to_id || null) : null,  // L305
});
```

So `form.asset_id = initialData.to_id` (the ledger entry's `to_id` field).

### Dropdown render

**TxVerticalBig.jsx (L1072-1080):**
```jsx
<select value={form.asset_id || ""} onChange={...}>
  <option value="">Select asset…</option>
  {assetAccs.map(a => <option key={a.id} value={a.id}>{a.name}...</option>)}
</select>
```

A controlled React `<select>` with `value={X}` but no matching `<option value={X}>` renders the element **visually blank** — browser shows nothing selected.

---

## 3. Root Cause Analysis

There are two independent bugs, either of which causes the blank dropdown.

---

### Bug A — `initialData.to_id` is null (likely cause for this specific entry)

**Affected entry:** ledger `e0d9c947-dffc-42be-9f78-ac96607ce649`

The buy_asset flow historically had a bug where `to_id` was never saved (fixed in commit `a916bd9`). If this ledger entry was created BEFORE that fix, its `to_id = null` in Supabase.

**Trace:**
```
initialData.to_id = null
→ form.asset_id = (null || null) = null      [L305]
→ <select value="">                           [L1072]
→ "Select asset…" placeholder shown
```

The L305 code is correct but has nothing to back-fill because `to_id` was never written.

**Verify via SQL:**
```sql
SELECT id, to_id, from_id, tx_type, description, tx_date
FROM ledger
WHERE id = 'e0d9c947-dffc-42be-9f78-ac96607ce649';
```
Expected: `to_id = '0bed28ba-4e51-4e80-88e2-eb258f0353ac'`. If `to_id = null`, Bug A is the cause.

**Fix for Bug A (DB-level):**
```sql
UPDATE ledger
SET to_id = '0bed28ba-4e51-4e80-88e2-eb258f0353ac'
WHERE id = 'e0d9c947-dffc-42be-9f78-ac96607ce649'
  AND user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772';
```
Run `recalculateBalance('0bed28ba...')` afterward (or let the user update value to trigger it).

---

### Bug B — Referenced asset has `is_active = false` (systematic issue)

If the deposit account `0bed28ba-4e51-4e80-88e2-eb258f0353ac` was later "cairkan" (withdrawn/closed), the sell handler sets `is_active = false`:

```js
// Accounts.jsx saveWithdraw
const updateFields = isDeposito
  ? { deposit_status: "closed", is_active: false, current_value: 0 }
  : { is_active: false, current_value: 0 };
```

**Trace:**
```
accounts table:  0bed28ba → is_active = false
accountsApi.getAll: .neq("is_active", false) → row excluded
App.js accounts: does NOT contain 0bed28ba
App.js assets:   does NOT contain 0bed28ba   (derived from accounts)
TxVerticalBig assetAccs: does NOT contain 0bed28ba

form.asset_id = "0bed28ba..."   [L305: set from initialData.to_id]
<select value="0bed28ba...">    [L1072]
  — no matching <option> —
→ visually blank
```

This affects ANY buy_asset whose target asset was subsequently sold or closed. It will keep occurring as more assets are retired over time.

**Verify via SQL:**
```sql
SELECT id, name, is_active, deposit_status, current_value
FROM accounts
WHERE id = '0bed28ba-4e51-4e80-88e2-eb258f0353ac';
```

---

## 4. useEffect Dependency Audit

**TxVerticalBig.jsx L341:**
```js
}, [open, mode, initialData, defaultGroup, defaultTxType, defaultAccount, openCicilan, defaultEmployeeName]);
```

`accounts` and `assets` are NOT in the dependency array. This is intentional — they are used directly at render time (not inside the effect) for `assetAccs`. No race condition here: when the useEffect fires setting `form.asset_id`, the next render re-computes `assetAccs` from the current `assets` prop. They are always in sync.

---

## 5. Asset Timeline Edit Path

When the edit is triggered from the AssetTimeline (deposito's statement page):

```
StatementPage.jsx:
  effectiveAccount = account || archivedAccount  // archivedAccount fetched separately
  passes: accounts={accounts}   → App.js accounts (no inactive)
          assets={assets}       → App.js assets (no inactive)

AssetTimeline.jsx (L77):
  const assetAccs = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);
  // No is_active filter here, but accounts already excludes inactive

TxVerticalBig receives assets={assetAccs} where assetAccs has no inactive accounts
```

So even from AssetTimeline, the inactive asset doesn't reach the dropdown. The `archivedAccount` is only used as `asset=` (the subject of the page) — it is NOT injected into `accounts` or `assetAccs`.

---

## 6. Summary — Which Bug Applies

| Condition | `to_id` in DB | `is_active` of asset | Dropdown shows |
|---|---|---|---|
| Entry old (pre-a916bd9), asset active | null | true | Blank — Bug A |
| Entry correct, asset still active | `0bed28ba` | true | **Works ✓** |
| Entry correct, asset archived | `0bed28ba` | false | Blank — Bug B |
| Entry old, asset archived | null | false | Blank — both bugs |

---

## 7. Suggested Fixes (NOT IMPLEMENTED)

### Fix A — DB migration for entries with null to_id

Run SQL in Supabase editor to back-fill `to_id` for the specific entry (see §3 Bug A above).

For a broader fix, identify all buy_asset entries with `to_id = null`:
```sql
SELECT id, description, tx_date, amount_idr
FROM ledger
WHERE user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND tx_type = 'buy_asset'
  AND to_id IS NULL;
```

### Fix B — Code: include the referenced asset in the dropdown even if archived

**`TxVerticalBig.jsx` — around L367:**

```js
// Current:
const assetAccs = assets.filter(a => a.is_active !== false);

// Suggested (for edit mode): add referenced asset even if inactive
const editRefId = (mode === "edit" && initialData?.tx_type === "buy_asset")
  ? (initialData.to_id || null)
  : null;
const assetAccs = (() => {
  const active = assets.filter(a => a.is_active !== false);
  if (!editRefId || active.find(a => a.id === editRefId)) return active;
  // Referenced asset not in active list — add a placeholder so select isn't blank
  return [...active, { id: editRefId, name: "(Archived account)", is_active: false }];
})();
```

This ensures the `<select>` always has a matching option for the pre-filled value. The user sees "(Archived account)" rather than blank, and the value is preserved for saving.

A more complete version: fetch the account from Supabase when `editRefId` is set and not in `assetAccs`:

```js
// After the useEffect on [open, mode, initialData...], add:
useEffect(() => {
  if (mode !== "edit" || !initialData?.to_id || form.tx_type !== "buy_asset") return;
  if (assetAccs.find(a => a.id === initialData.to_id)) return; // already there
  supabase.from("accounts").select("*").eq("id", initialData.to_id).maybeSingle()
    .then(({ data }) => {
      if (data) setExtraAsset(data);  // new state: useState(null)
    });
}, [mode, initialData?.to_id, form.tx_type]);

// Then:
const assetAccsWithExtra = extraAsset && !assetAccs.find(a => a.id === extraAsset.id)
  ? [...assetAccs, { ...extraAsset, name: `${extraAsset.name} (Archived)` }]
  : assetAccs;
// Use assetAccsWithExtra in the dropdown instead of assetAccs
```

**No changes needed in:** api.js, App.js, Transactions.jsx, StatementPage.jsx.
**1 file changed:** `TxVerticalBig.jsx` — add `extraAsset` state + useEffect to fetch archived asset + merge into dropdown options.

---

## 8. Verification Sequence

1. Run SQL in §3 Bug A — check if `to_id` is null or populated
2. Run SQL in §3 Bug B — check if asset `is_active = false`
3. If Bug A: apply DB UPDATE then reopen edit modal to confirm pre-fill works
4. If Bug B: apply code Fix B to include archived asset in dropdown
