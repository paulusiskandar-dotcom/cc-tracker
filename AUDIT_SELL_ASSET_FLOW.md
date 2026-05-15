# Sell Asset — Audit

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15

---

## 1. UI Location

There is **no dedicated "Sell Asset" button** on the Accounts page for regular (non-Deposito) assets.

| Entry point | File | Button | Handler | Confirm dialog |
|---|---|---|---|---|
| Accounts page → asset card → 🗑 Delete | `Accounts.jsx:1408` | `<button onClick={onDelete}>🗑</button>` | `confirmDelete()` at L299 | Yes (`ConfirmModal`, message: "This will hide it from view") |
| Transactions page → "+ Add" → Asset group → Sell Asset | `TxVerticalBig.jsx:597` | Group tab "Asset" → type "Sell Asset" | `save() → if (type === "sell_asset" && !isEdit)` at L597 | No |
| AssetTimeline → "+ Transaction" | `AssetTimeline.jsx:279` | "+ Transaction" button → `setTxOpen(true)` | Same TxVerticalBig (opens with `defaultTxType="buy_asset"` — user must manually switch to Sell) | No |

**For Deposito/Deposit subtypes only:** Accounts.jsx has a dedicated "💰 Cair" button (L1396) → `openWithdraw()` → `saveWithdraw()` at L353, which DOES create a sell_asset ledger entry AND marks `is_active: false`.

---

## 2. Handler Logic

### Path A: Delete button on Accounts page (`confirmDelete`, L299)

```js
const confirmDelete = async () => {
  if (!deleteAcc) return;
  try {
    await accountsApi.delete(deleteAcc.id);          // ← sets is_active: false only
    setAccounts(p => p.filter(x => x.id !== deleteAcc.id)); // ← removed from local state
    showToast("Account deleted");
  } catch (e) { showToast(e.message, "error"); }
  setDeleteAcc(null);
};
```

`accountsApi.delete(id)` at `api.js:185`:
```js
delete: async (id) => {
  const { error } = await supabase
    .from("accounts")
    .update({ is_active: false })         // ← SOFT DELETE ONLY
    .eq("id", id);
  if (error) throw new Error(error.message);
},
```

**Result:** `is_active = false`. **No sell_asset ledger entry is created.** No sale price recorded. No date. No history.

### Path B: Sell Asset via TxVerticalBig (`save()`, L597)

```js
if (type === "sell_asset" && !isEdit) {
  // 1. Build ledger entry
  const entry = {
    tx_date, description: `Sell ${assetName}`,
    amount: sellPrice, amount_idr: sellPrice,
    tx_type: "sell_asset",
    from_type: "account", to_type: "account",
    from_id: uuid(form.from_id),    // ← asset account
    to_id:   uuid(form.to_id),      // ← destination bank
    ...
  };
  // 2. Insert ledger row via ledgerApi.create
  const created = await ledgerApi.create(user.id, entry, accounts);
  // 3. applyBalanceDelta inside ledgerApi.create:
  //    → asset current_value -= sellPrice
  //    → bank current_balance += sellPrice
  // 4. POST-INSERT SIDE EFFECT (api.js:344):
  await accountsApi.update(safeEntry.from_id, { is_active: false, current_value: 0 });
  //    ↑ asset account silently set is_active: false, current_value: 0
}
```

**Result:** ledger entry preserved ✓, bank balance credited ✓, asset `is_active: false` → disappears from all UI.

---

## 3. Schema for Asset Lifecycle

Fields on the `accounts` table relevant to asset lifecycle (from migration files + form defaults):

| Field | Type | Purpose |
|---|---|---|
| `is_active` | bool | `false` → hidden from `accountsApi.getAll` (uses `.neq("is_active", false)`) |
| `current_value` | numeric | Zeroed out on sell (`{ is_active: false, current_value: 0 }`) |
| `purchase_price` | numeric | Preserved (original cost basis) |
| `purchase_date` | date | Preserved |
| `deposit_status` | text | `'active'` / `'closed'` — Deposito only; regular assets not used |
| `end_date` | date | Present in schema (migration v2.8), but NOT set on sell_asset anywhere |
| `subtype` | text | Asset subtype (Property, Vehicle, Investment, etc.) |

**No `sold_date` or `sold_price` field** exists on the accounts table. These are captured only via the sell_asset ledger entry (when Path B is used).

- **Soft delete capable:** Yes (`is_active: false`)
- **Hard delete:** No — `accountsApi.delete` only sets `is_active: false`
- **Ledger entry created by sell_asset flow:** Yes (`tx_type = 'sell_asset'`) — but ONLY via TxVerticalBig, NOT via the Delete button
- **Undo (`ledgerApi.delete` of sell_asset):** restores `is_active: true` (api.js:472)

---

## 4. Display Filter

**`accountsApi.getAll` (api.js:140):**
```js
supabase.from("accounts")
  .select("*")
  .eq("user_id", userId)
  .neq("is_active", false)     // ← excludes is_active=false rows; includes is_active=null/true
  .order("sort_order", { nullsLast: true })
  .order("created_at", { ascending: false })
```

**App.js derives all account subsets from this single query:**
```js
const [accounts, setAccounts] = useState([]);
// loaded once at startup and on onRefresh()
// assets = useMemo(() => accounts.filter(a => a.type === 'asset'), [accounts])
```

**Accounts.jsx display** (L95-98):
```js
if (subTab === "asset") return accounts.filter(a => a.type === "asset");
```
— comes directly from the `accounts` state, which already excludes `is_active=false`.

**Toggle for sold/inactive assets:** **None.** Searched entire codebase for `showSold`, `showInactive`, `sold.*filter`, `inactive.*toggle` — zero matches. There is no way to view deactivated assets in the current UI.

**StatementPage (AssetTimeline entry):** `src/pages/StatementPage.jsx:19`:
```js
const account = accounts.find(a => a.id === id);
if (!account) {
  return <div>Account not found.</div>  // ← rendered if is_active=false
}
```
Once `is_active = false`, the AssetTimeline page shows "Account not found" for that asset's `/accounts/:id/statement` URL.

---

## 5. Existing Sell Asset Ledger

Cannot run SQL directly (no Supabase MCP/CLI). Query to run:

```sql
SELECT id, tx_date, tx_type, amount, amount_idr,
       from_id, from_type, to_id, to_type, description, notes
FROM ledger
WHERE user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND tx_type IN ('sell_asset', 'asset_sale', 'asset_disposal')
ORDER BY tx_date DESC
LIMIT 10;
```

**Interpretation:**
- If **0 rows:** user triggered the Delete button (Path A) — no ledger entry was ever created. The sale is completely unrecorded.
- If **1+ rows:** user used TxVerticalBig Sell Asset flow (Path B) — the sale is recorded in the ledger, but the asset account is `is_active = false` so the record is invisible without DB access.

---

## 6. Sold Assets in DB (deactivated / hidden)

Query to check if BYD Seal (and other assets) are soft-deleted vs truly gone:

```sql
SELECT id, name, type, subtype, is_active, current_value, purchase_price,
       purchase_date, end_date, deposit_status, updated_at, created_at
FROM accounts
WHERE user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND type = 'asset'
ORDER BY updated_at DESC
LIMIT 20;
```

**Expected findings:**
- BYD Seal row exists with `is_active = false` (soft delete — data preserved in DB)
- `current_value = 0` (zeroed by sell_asset side effect at api.js:347, or by manual delete)
- `purchase_price` still set (cost basis preserved)
- `updated_at` reflects when `is_active` was flipped

The row is NOT gone from the database. It's hidden by the `.neq("is_active", false)` filter.

---

## 7. Recent Commits

```sh
git log --oneline -30 | grep -iE "asset|sell"
# → only: b9a7d24 audit: buy asset transaction flow
```

**No code change has recently touched sell asset logic.** This is a design gap present since the feature was written — not a regression.

---

## 8. Root Cause Hypothesis

### Primary: The Delete button (Path A) is being used as a "Sell Asset" action

The asset card on the Accounts page shows only `✏️ Edit` and `🗑 Delete` action buttons for regular (non-Deposito) assets. There is no "💰 Sell" button. Users naturally click 🗑 to "remove" a sold asset. `accountsApi.delete` sets `is_active = false` — no ledger entry, no sale price, no date. The asset disappears from history entirely.

The ConfirmModal message says "This will hide it from view. Existing transactions are preserved." — but for an asset that was never sold via TxVerticalBig, there ARE no existing sell_asset transactions to preserve.

### Secondary: Even when Path B (TxVerticalBig) is used correctly, sold assets are invisible

After a proper `sell_asset` ledger entry is created, `ledgerApi.create` calls `accountsApi.update({ is_active: false, current_value: 0 })` (api.js:347). This is correct behavior for balance tracking, but it also removes the asset from the `accounts` state entirely. There is no UI to view sold assets or their history afterward:
- Accounts page: filtered out
- AssetTimeline: "Account not found" (StatementPage:23 guard)
- No "Sold Assets" archive section exists

The sell_asset ledger entry IS preserved in `ledger` table — it will appear in the Transactions page filter with `tx_type = sell_asset`. But the asset name can't be resolved from `from_id` since the account is hidden. Any transaction display resolving `from_id → accountName` will show a blank or `undefined` for the sold asset.

### Summary table

| Scenario | Ledger entry | Asset in DB | Asset visible in UI | Sale reconstructible |
|---|---|---|---|---|
| Path A (🗑 Delete) | ❌ None | ✓ `is_active=false` | ❌ Hidden | ❌ No |
| Path B (Sell Asset via TxVerticalBig) | ✓ `sell_asset` row | ✓ `is_active=false` | ❌ Hidden | ⚠️ Ledger exists but account name gone |

---

## 9. Suggested Fix (NOT IMPLEMENTED)

### F1 — Add "💰 Sell" button to asset card (highest impact)

`Accounts.jsx:1386-1410` — add a dedicated "💰 Sell" button for non-Deposito, non-PT-Investment assets (similar to Deposito's "💰 Cair" button). This button opens a sell modal (price + destination bank + date) and calls `ledgerApi.create` with `tx_type: "sell_asset"` before deactivating. Mirrors the existing Deposito `saveWithdraw` (L353) pattern.

### F2 — Show sold/archived assets in a separate "Archived" section

`Accounts.jsx` (asset subtab) — add a collapsible "Sold / Archived" section that shows accounts with `is_active = false AND type = 'asset'`. Requires fetching these separately since `accountsApi.getAll` filters them out:

```js
const { data: soldAssets } = await supabase.from("accounts")
  .select("*").eq("user_id", userId).eq("type", "asset").eq("is_active", false);
```

Show them with a "SOLD" badge and a link to their statement (AssetTimeline).

### F3 — Fix StatementPage guard to not block sold assets

`StatementPage.jsx:19-29` — current guard: `if (!account) return <div>Account not found</div>`. If a sold asset's URL is navigated to, it returns "not found." Change to also search `soldAssets` (or fetch directly from DB by id regardless of `is_active`). Then AssetTimeline can display the full history of a sold asset (including the sell_asset ledger entry).

### F4 — Preserve account name on ledger entries at insert time

`api.js:312` (ledgerApi.create) — at insert, copy `from_name: fromAcc?.name` into the ledger row. This way even after the account is deactivated, the sell_asset entry in Transactions can still display "Sold: BYD Seal" without needing to resolve `from_id`.

### Minimal combined fix order:
1. **F1** (add "Sell" button to asset card) — prevents silent data loss from users clicking 🗑
2. **F2** (show archived section) — makes existing hidden sold assets discoverable
3. **F3** (StatementPage fix) — allows viewing full history of sold assets
