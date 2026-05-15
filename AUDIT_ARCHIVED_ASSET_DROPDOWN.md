# Archived Asset Dropdown — Audit

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15

---

## 1. assetAccs Source

**File:** `src/components/shared/TxVerticalBig.jsx`
**Line:** L367

```js
const assetAccs = assets.filter(a => a.is_active !== false);
```

This is a render-time derivation (not inside a useMemo or useEffect). It re-runs on every render from the `assets` prop.

**`assets` prop origin:**

```
App.js L349:
  const assets = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);

App.js L243:
  safe(accountsApi.getAll(user.id), [])  →  setAccounts(data)

accountsApi.getAll (api.js L140-149):
  supabase.from("accounts")
    .select("*")
    .eq("user_id", userId)
    .neq("is_active", false)   ← excludes is_active = false AT THE QUERY LEVEL
    .order(...)
```

**Filter chain:**

```
Supabase DB (accounts WHERE is_active != false)
  → accountsApi.getAll
  → App.js accounts state
  → App.js assets = accounts.filter(type === "asset")   [active only, already]
  → TxVerticalBig assets prop
  → assetAccs = assets.filter(is_active !== false)      [redundant filter, same effect]
```

The `assetAccs` filter at L367 is redundant — `assets` already contains no inactive accounts because `accountsApi.getAll` excludes them server-side. An inactive asset is eliminated at the DB query level, not at the React level.

---

## 2. Data Flow

```
accountsApi.getAll
  .neq("is_active", false)      ← first exclusion point (DB query)
  → App.js [accounts] state     ← never contains inactive assets

App.js useMemo: assets = accounts.filter(a => a.type === "asset")
  → passed as assets={assets} to Transactions.jsx, BankStatement.jsx, etc.
  → passed as assets={assets} to TxVerticalBig in those components

TxVerticalBig (L232): assets = [] default prop
  assetAccs = assets.filter(a => a.is_active !== false)   ← second exclusion (redundant)

buy_asset dropdown (L1079):
  {assetAccs.map(a => <option key={a.id} value={a.id}>...</option>)}
  → NO archived assets in options
```

**Special case — AssetTimeline.jsx:**

```
AssetTimeline (L77):
  const assetAccs = useMemo(() => accounts.filter(a => a.type === "asset"), [accounts]);
  // "accounts" here also comes from accountsApi.getAll via App.js → still no inactive

TxVerticalBig receives: assets={assetAccs}
  → assetAccsWithExtra filter strips again → still no inactive
```

No component in the tree injects inactive accounts into the `assets` prop. An archived asset is simply absent from all account lists in memory.

---

## 3. Edit Mode Detection

**Mode prop:** `mode = "add" | "edit" | "confirm"` (L224)

**Access in the form state setup (L272):**
```js
if ((mode === "edit" || mode === "confirm") && initialData) {
  ...
  asset_id: txType === "buy_asset" ? (initialData.to_id || null) : null,  // L305
}
```

**In the render section for buy_asset (L1044):**
```js
if (type === "buy_asset") {
  const modeVal = form.asset_mode || "existing";           // "existing" or "new"
  const selectedAsset = assetAccs.find(a => a.id === form.asset_id);   // L1046
```

`mode` (the prop) is accessible throughout the component. `initialData` is also accessible at render time — it is a prop, not state. So `mode === "edit"` and `initialData.to_id` can both be read at the point where `assetAccs` is used.

**Key availability for Fix B:**
- `mode` prop ✓ — always available
- `initialData.to_id` ✓ — available when `mode === "edit"`
- `supabase` ✓ — imported at L30 (`import { supabase } from "../../lib/supabase"`)

---

## 4. Affected Entries

Cannot run SQL directly (no Supabase MCP in this session).

**Query to run in Supabase SQL editor:**
```sql
SELECT 
  l.id,
  l.tx_type,
  l.description,
  l.tx_date,
  l.amount_idr,
  l.to_id,
  a.name AS asset_name,
  a.is_active
FROM ledger l
LEFT JOIN accounts a ON a.id = l.to_id
WHERE l.user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND l.tx_type = 'buy_asset'
  AND a.is_active = false
LIMIT 10;
```

**Expected results based on known history:**
- BLU (sold) — buy_asset entry pointing to the archived BLU account
- Possibly Deposito Superbank May 2026 if it was closed/sold

Any `buy_asset` ledger entry whose `to_id` points to an archived account (`is_active = false`) will show a blank dropdown when the user opens the edit modal. The number of affected entries grows over time as more assets are sold.

---

## 5. Fix Implementation

**Chosen approach:** In-component fetch of the referenced archived asset when edit modal opens for a buy_asset with `to_id` not in `assetAccs`.

This is the cleanest option because:
- No change to App.js, accountsApi, or the accounts state
- Scoped to the edit-mode case only — no impact on add flow
- Supabase is already imported in TxVerticalBig

**Proposed code change — `src/components/shared/TxVerticalBig.jsx`:**

```js
// ── Add new state (near L248 alongside other useState declarations)
const [extraAsset, setExtraAsset] = useState(null);

// ── Add new useEffect (after the "Reset on open" useEffect at L341)
useEffect(() => {
  // Only fetch when: edit mode, buy_asset type, and to_id is not already in dropdown
  if (mode !== "edit") return;
  if (!initialData?.to_id) return;
  if (form.tx_type !== "buy_asset") return;
  if (assetAccs.find(a => a.id === initialData.to_id)) return;  // already visible
  // Referenced asset not in dropdown — it may be archived. Fetch it.
  setExtraAsset(null);
  supabase
    .from("accounts")
    .select("*")
    .eq("id", initialData.to_id)
    .maybeSingle()
    .then(({ data }) => { if (data) setExtraAsset(data); });
}, [mode, initialData?.to_id, form.tx_type]);  // eslint-disable-line react-hooks/exhaustive-deps

// ── Modify assetAccs derivation at L367
// Before:
const assetAccs = assets.filter(a => a.is_active !== false);
// After:
const assetAccs = assets.filter(a => a.is_active !== false);
const assetAccsForDropdown = extraAsset && !assetAccs.find(a => a.id === extraAsset.id)
  ? [...assetAccs, { ...extraAsset, name: `${extraAsset.name} (Archived)` }]
  : assetAccs;
```

Then in the buy_asset render section:
- L1046: change `assetAccs.find(a => a.id === form.asset_id)` → `assetAccsForDropdown.find(...)`
- L1075: change `assetAccs.find(x => x.id === id)` → `assetAccsForDropdown.find(...)`
- L1079: change `{assetAccs.map(a => ...)}` → `{assetAccsForDropdown.map(a => ...)}`

**Files changed:** 1 (`src/components/shared/TxVerticalBig.jsx`)
**Lines changed:** ~10 (1 useState, 1 useEffect, 1 derived const, 3 usage substitutions)

**Behavior after fix:**
- Edit modal opens for buy_asset entry pointing to archived asset
- useEffect detects: `mode === "edit"`, `initialData.to_id = "0bed28ba..."`, not in `assetAccs`
- Fetches archived account from Supabase → `extraAsset = { id: "0bed28ba...", name: "Deposito Superbank (May 2026)", is_active: false, ... }`
- Dropdown now includes `<option value="0bed28ba...">Deposito Superbank (May 2026) (Archived)</option>`
- `<select value="0bed28ba...">` finds matching option → shows "Deposito Superbank (May 2026) (Archived)" ✓

---

## 6. Alternatives Considered

### (a) Change accountsApi.getAll to include inactive accounts

```js
// api.js — remove the .neq("is_active", false) filter
// Consumer components would filter themselves
const activeAccounts = accounts.filter(a => a.is_active !== false);
const allAssets = accounts.filter(a => a.type === "asset"); // includes inactive
```

**Pros:** No in-component fetch; all data available in memory.
**Cons:** Significant blast radius — every component that consumes `accounts` must now filter explicitly. App.js `assets`, `bankAccounts`, `creditCards` derivations all change. Inactive accounts would appear in unrelated dropdowns. High risk of regressions.
**Verdict:** Not recommended. Too many consumers to audit safely.

---

### (b) Pass `inactiveAssets` prop separately to TxVerticalBig

```js
// App.js: fetch inactive assets separately
const [inactiveAssets, setInactiveAssets] = useState([]);
// accountsApi separate query for is_active = false assets

// Pass down:
<TxVerticalBig inactiveAssets={inactiveAssets} ... />
```

**Pros:** No in-component fetch; clean separation; TxVerticalBig merges for edit mode only.
**Cons:** Requires new App.js state + Supabase query + prop threading through Transactions, BankStatement, AssetTimeline, Dashboard, CCStatement (all render TxVerticalBig). More plumbing than the bug warrants.
**Verdict:** Over-engineered for this use case.

---

### (c) In-component fetch (recommended — Fix B from prior audit)

As described in §5. Lazy one-time fetch scoped to the edit case.

**Pros:** Self-contained; no prop changes; no App.js changes; Supabase already imported.
**Cons:** Slight delay before dropdown shows the archived option (async fetch). The select may flash blank for ~100ms before the fetch resolves. Acceptable for edit flow (user is not in a hurry).
**Verdict:** Best balance of scope and correctness. Chosen approach.

---

### (d) Show all inactive assets in dropdown by default (with "(Archived)" badge)

Fetch all archived assets once on component mount and always include them:

```js
useEffect(() => {
  supabase.from("accounts").select("*").eq("type","asset").eq("is_active",false)
    .eq("user_id", user.id)
    .then(({ data }) => setArchivedAssets(data || []));
}, [user?.id]);
```

**Pros:** No async delay in the dropdown; always shows full history.
**Cons:** Always-on query even in add mode where archived assets are irrelevant. Dropdown becomes cluttered with old assets by default. Makes "Select asset…" list confusing.
**Verdict:** Not recommended for add mode. Acceptable only if archived assets are shown at the bottom with clear styling — but approach (c) is simpler.

---

## 7. Suggested Fix (NOT IMPLEMENTED)

**Apply Fix B (approach c) — in-component fetch.**

The change is entirely contained in `src/components/shared/TxVerticalBig.jsx`:

1. **Add state** `extraAsset` (L248 area) — holds the fetched archived asset, or null.

2. **Add useEffect** (after L341) — triggers on `[mode, initialData?.to_id, form.tx_type]`:
   - Guards: edit mode, buy_asset type, to_id not already in assetAccs
   - Fetches from Supabase by ID using `supabase.from("accounts").select("*").eq("id", ...).maybeSingle()`
   - Sets `extraAsset` if found

3. **New derived const** `assetAccsForDropdown` — replaces `assetAccs` in the buy_asset render section only:
   ```js
   const assetAccsForDropdown = extraAsset && !assetAccs.find(a => a.id === extraAsset.id)
     ? [...assetAccs, { ...extraAsset, name: `${extraAsset.name} (Archived)` }]
     : assetAccs;
   ```

4. **Substitute** `assetAccsForDropdown` at 3 points inside the `if (type === "buy_asset")` block (L1046, L1075, L1079) — no changes outside that block.

**No changes to:** App.js, api.js, accountsApi, StatementPage, Transactions, AssetTimeline, or any other component.

**Reset behavior:** `extraAsset` state is not reset in the "Reset on open" useEffect. It will be re-evaluated on next edit open because the useEffect deps include `initialData?.to_id`. If a different buy_asset with an active `to_id` is edited next, the guard `assetAccs.find(a => a.id === initialData.to_id)` will return truthy → no fetch → `extraAsset` stays from prior edit. This is harmless because `assetAccsForDropdown` won't add it (the asset is already in `assetAccs`). A cleaner version resets `extraAsset` at the top of the useEffect before each fetch check.
