# Asset Detail P&L — Audit

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15

---

## 1. Component Location

- **File:** `src/components/AssetTimeline.jsx`
- **Component:** `AssetTimeline` — default export, L53
- **Rendered via:** `src/pages/StatementPage.jsx:116` when `type === "asset"` (`<AssetTimeline asset={effectiveAccount} ... />`)
- **Metric cards rendered at:** L295-298 (four `<MetricCard>` components in a flex row)

---

## 2. P&L Compute Logic

**Variables (L104-108):**
```js
const currentValue = Number(asset.current_value || 0);    // L104 — zero for sold assets
const unrealizedPL = currentValue - costBasis;             // L105 — ALWAYS uses current_value
const returnPct    = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;  // L106
const plColor      = unrealizedPL >= 0 ? "#059669" : "#dc2626";             // L107
const plBg         = unrealizedPL >= 0 ? "#f0fdf4" : "#fff1f2";             // L108
```

**costBasis compute (L96-102):**
```js
const costBasis = useMemo(() => {
  const base = Number(asset.purchase_price || 0);
  const adds = assetLedger
    .filter(e => e.tx_type === "buy_asset" && e.to_id === asset.id)
    .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
  return base + adds;
}, [asset, assetLedger]);
```

`assetLedger` (L92-94):
```js
const assetLedger = useMemo(() =>
  ledger.filter(e => e.from_id === asset.id || e.to_id === asset.id)
, [ledger, asset.id]);
```

**Sell proceeds factored in:** **NO.** The `unrealizedPL` formula is purely `currentValue - costBasis`. For a sold asset:
- `asset.current_value = 0` (set to 0 by `accountsApi.update({ is_active: false, current_value: 0 })` during sell)
- `unrealizedPL = 0 − 150,000,000 = −150,000,000`
- `returnPct = -100.0%`
- Display: red, -150M — which is completely wrong

`sell_asset` entries ARE in `assetLedger` (the `from_id = asset.id` condition at L93 catches them), but the P&L formula never reads them. They're used only in the event timeline display (L226-232) and export (L228-232).

---

## 3. Sale Proceeds Logic

**Fetch logic:** `sell_asset` ledger entries ARE fetched (they land in `assetLedger` via L93). However they are **never aggregated into a `saleProceeds` variable.** They appear in:
- `allEvents` (event timeline rows, L129-131) — display only
- `exportExcel` (L228-232) — export only
- `eventsWithValue` → `_runValue` column — running value but not P&L metric

**Where it should be added:**
After `costBasis` compute (L102), add:
```js
const saleProceeds = assetLedger
  .filter(e => e.tx_type === "sell_asset" && e.from_id === asset.id)
  .reduce((s, e) => s + Number(e.amount_idr || 0), 0);
```

Then for archived assets:
```js
const realizedPL = isArchived
  ? saleProceeds - costBasis
  : currentValue - costBasis;
```

---

## 4. Value History Chart

**Source data (L111-119):**
```js
const sparkData = useMemo(() => {
  const points = [];
  if (asset.purchase_date && Number(asset.purchase_price || 0) > 0)
    points.push({ date: asset.purchase_date, value: Number(asset.purchase_price) });
  valueHistory.forEach(h => points.push({ date: h.date, value: Number(h.new_value || 0) }));
  if (points.length === 0 || points[points.length - 1].value !== currentValue)
    points.push({ date: todayStr(), value: currentValue });        // ← appends 0 for sold assets
  return points.map(p => ({ date: p.date, label: fmtDateShort(p.date), value: p.value }));
}, [asset, valueHistory, currentValue]);
```

**Chart includes sell_asset entries:** **NO.** The chart only uses:
1. `asset.purchase_date` / `asset.purchase_price` as the initial point
2. `asset_value_history` rows (manual value updates)
3. `currentValue` (= 0 for sold) as the final point

For BLU (sold at Rp 158M), the chart shows: `[cost: 150M, ...valueHistory..., 0]` — drops to 0 at the end, making it look like a 100% loss.

**What the chart should show for archived assets:** the final point should be `saleProceeds` (Rp 158M) at the sell date, not `currentValue` (Rp 0).

**Correct sparkData for archived:**
- Replace the trailing `currentValue` point with the sell_asset ledger entry's `amount_idr` at `tx_date` — this shows the actual exit value, not 0.
- Alternatively show cumulative proceeds if multiple partial sells occurred.

---

## 5. Label Render

**"Unrealized P&L" location:** L297 — hardcoded string in `<MetricCard>` call:
```jsx
<MetricCard label="Unrealized P&L" value={`${unrealizedPL >= 0 ? "+" : ""}${fmtIDR(Math.abs(unrealizedPL))}`} color={plColor} bg={plBg} />
<MetricCard label="Return %"       value={`${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(1)}%`} color={plColor} bg={plBg} />
```

**Conditional check possible:** Yes. The `isArchived` prop is already received by `AssetTimeline` at L56 (added in commit `a916bd9`):
```js
isArchived = false,
```

Simple conditional:
```jsx
<MetricCard label={isArchived ? "Realized P&L" : "Unrealized P&L"} ... />
```

The `isArchived` prop comes from `StatementPage.jsx:118-119`:
```jsx
asset={effectiveAccount}
isArchived={isArchived}
```
where `isArchived = effectiveAccount.is_active === false`.

---

## 6. SQL Data (BLU asset)

Cannot execute SQL directly — no Supabase MCP in this session. Query to run in Supabase SQL editor:

```sql
SELECT
  a.id, a.name, a.is_active,
  a.initial_balance, a.purchase_price, a.current_value,
  COALESCE((
    SELECT SUM(amount_idr) FROM ledger
    WHERE from_id = a.id AND tx_type = 'sell_asset'
      AND user_id = a.user_id
  ), 0) AS total_sale_proceeds,
  COALESCE((
    SELECT SUM(amount_idr) FROM ledger
    WHERE to_id = a.id AND tx_type = 'buy_asset'
      AND user_id = a.user_id
  ), 0) AS total_buy_amount
FROM accounts a
WHERE a.user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND a.id = '31b0bb59-b704-4a83-903f-bef39fb5c96d';
```

**Expected result based on user report:**
- `name = 'BLU'`, `is_active = false`
- `purchase_price = 150000000`, `current_value = 0`
- `total_sale_proceeds = 158011376`
- `total_buy_amount = 0` (or matches purchase_price if bought via app)

The sell_asset ledger entry should be visible in `assetLedger` (it's filtered by `from_id = asset.id` at L93), confirming the data is available client-side — it's just not used in the P&L formula.

---

## 7. Recent Commits

```
eae8a26 fix(assets): port Sell button + Archived section from Accounts to Assets dashboard page
a916bd9 fix(asset): persist to_id + recalculate on buy, add Sell button + archived section + relax StatementPage guard
ce18f3c audit: sell asset flow — history disappearing
b9a7d24 audit: buy asset transaction flow
```

No commit has touched the P&L compute formula in `AssetTimeline.jsx`. The metrics have used `currentValue - costBasis` since the component was written — the sell_asset case was never addressed.

---

## 8. Root Cause

**Three separate bugs, all in `AssetTimeline.jsx`:**

### Bug 1 — P&L formula ignores sale proceeds (L105)

```js
const unrealizedPL = currentValue - costBasis;  // currentValue=0 → always -costBasis for sold
```

`saleProceeds` is never computed. For a sold asset, `currentValue = 0` (zeroed by the sell handler), so `unrealizedPL = 0 - 150M = -150M`. The correct formula for sold assets is `saleProceeds - costBasis = 158M - 150M = +8M`.

### Bug 2 — Chart drops to zero for sold assets (L116-118)

```js
if (points.length === 0 || points[points.length - 1].value !== currentValue)
  points.push({ date: todayStr(), value: currentValue });  // appends 0
```

`currentValue = 0` for sold assets → final sparkline point is 0 → visual cliff dive. The sell_asset transaction date and amount should be the final chart point instead of `currentValue`.

### Bug 3 — Label hardcoded "Unrealized P&L" (L297)

```jsx
<MetricCard label="Unrealized P&L" ... />
```

No conditional on `isArchived`. For sold assets where P&L is realized, this label is semantically wrong. The `isArchived` prop is available but unused in the metric section.

---

## 9. Suggested Fix (NOT IMPLEMENTED)

### Fix A — Compute `saleProceeds` and `realizedPL` (add after L102)

```js
// Sale proceeds from sell_asset ledger entries linked to this asset
const saleProceeds = assetLedger
  .filter(e => e.tx_type === "sell_asset" && e.from_id === asset.id)
  .reduce((s, e) => s + Number(e.amount_idr || 0), 0);

// For active assets: unrealized (currentValue - costBasis)
// For archived/sold assets: realized (saleProceeds - costBasis)
const pnl       = isArchived ? saleProceeds - costBasis : currentValue - costBasis;
const returnPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
const plColor   = pnl >= 0 ? "#059669" : "#dc2626";
const plBg      = pnl >= 0 ? "#f0fdf4" : "#fff1f2";
```

Replace existing L105-108 references to `unrealizedPL` → `pnl`.

For the user's case: `pnl = 158,011,376 − 150,000,000 = +8,011,376` (+5.3%) ✓

### Fix B — Label conditional (L297)

```jsx
<MetricCard label={isArchived ? "Realized P&L" : "Unrealized P&L"}
  value={`${pnl >= 0 ? "+" : ""}${fmtIDR(Math.abs(pnl))}`} color={plColor} bg={plBg} />
```

### Fix C — Chart final point for sold assets (L111-119)

Replace the `currentValue` fallback with sale proceeds when archived:

```js
const sparkData = useMemo(() => {
  const points = [];
  if (asset.purchase_date && Number(asset.purchase_price || 0) > 0)
    points.push({ date: asset.purchase_date, value: Number(asset.purchase_price) });
  valueHistory.forEach(h => points.push({ date: h.date, value: Number(h.new_value || 0) }));

  if (isArchived && saleProceeds > 0) {
    // Find the sell date from the first sell_asset ledger entry
    const sellEntry = assetLedger
      .filter(e => e.tx_type === "sell_asset" && e.from_id === asset.id)
      .sort((a, b) => a.tx_date.localeCompare(b.tx_date))[0];
    const sellDate = sellEntry?.tx_date || todayStr();
    points.push({ date: sellDate, value: saleProceeds });
  } else if (points.length === 0 || points[points.length - 1].value !== currentValue) {
    points.push({ date: todayStr(), value: currentValue });
  }

  return points.map(p => ({ date: p.date, label: fmtDateShort(p.date), value: p.value }));
}, [asset, valueHistory, currentValue, isArchived, saleProceeds, assetLedger]);
```

For BLU: chart ends at `158,011,376` on the sell date instead of `0` — shows the correct upward slope to the exit value.

### Minimal combined change summary

- **3 files untouched** (api.js, StatementPage.jsx, DB schema — no changes needed)
- **1 file changed:** `AssetTimeline.jsx` — adds `saleProceeds` derivation, adjusts `pnl`/`returnPct`/colors, conditionalises chart endpoint and metric label
- **No new imports** required
- **`isArchived` prop already wired** in from StatementPage
