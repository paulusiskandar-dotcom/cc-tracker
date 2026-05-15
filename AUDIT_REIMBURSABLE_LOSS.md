# Reimbursable Loss Compute — Audit

**Status:** READ-ONLY audit. No code changes.
**Date:** 2026-05-15

---

## 1. UI Location

- **File:** `src/components/Receivables.jsx`
- **Component:** inline render inside the `ReimburseTab` settlement section (the "Settle tab") — no named sub-component, rendered at render-time of the entity card at ~L927.
- **Label render:** L1058 — `<div>Reimbursable Loss</div>`
- **Value source:** local variable `reimbursable` computed at L924:

```js
const reimbursable = totalOutSel - totalInSel;
```

Rendered at L1059-1061:
```jsx
<div style={{ ..., color: reimbursable > 0 ? "#dc2626" : "#9ca3af" }}>
  {fmtIDR(Math.max(0, reimbursable))}
</div>
```

---

## 2. Compute Logic

- **State for selected items:** `selectedOut[r.id]` (Set of ledger IDs), `selectedIn[r.id]` (Set of ledger IDs) — both keyed by receivable account id (`r.id`).
- **Compute location:** inline at L920-924, inside the entity card render loop.

**Full compute snippet (L920-924):**
```js
const selOutEntries = outRows.filter(e => selOut.has(e.id));
const selInEntries  = inRows.filter(e => selIn.has(e.id));
const totalOutSel  = selOutEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
const totalInSel   = selInEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
const reimbursable = totalOutSel - totalInSel;          // ← signed difference
```

**Display formula (L1060):**
```js
{fmtIDR(Math.max(0, reimbursable))}
```
This clamps `reimbursable` to `≥ 0`. If `reimbursable < 0` (i.e. In > Out), displays **Rp 0**.

**Formula in words:**
- `reimbursable = Out − In` (can be negative)
- Displayed value = `max(0, Out − In)` → always ≥ 0, never shows a negative difference

**Hypothesis: The formula is semantically correct for the LOSS case but the UI never shows the SURPLUS case.** The label "Reimbursable Loss" is only meaningful when Out > In. When In > Out the display is 0 — which is correct for "loss" — but there is **no corresponding display line for the SURPLUS** (In > Out case) in the settlement preview panel.

---

## 3. Settle Handler

- **File:** `Receivables.jsx:568` — `handleSettleEntity(entity, acc)`
- **Called by:** "Settle →" button at L1064

**Full settle handler compute (L578-628):**

```js
const outEntries = ledger.filter(e => outIds.includes(e.id));
const inEntries  = ledger.filter(e => inIds.includes(e.id));
const totalOut   = outEntries.reduce((s, e) => s + Number(e.amount || 0), 0);
const totalIn    = inEntries.reduce((s, e)  => s + Number(e.amount || 0), 0);
const reimbursable = Math.max(0, totalOut - totalIn);   // loss case: Out > In
```

```js
// Loss entry (only if Out > In)
if (reimbursable > 0) {
  INSERT ledger { tx_type: "expense", category_id: REIMBURSABLE_LOSS_CATEGORY_ID, amount: reimbursable }
}

// Surplus entry (only if In > Out)
const surplus = Math.max(0, totalIn - totalOut);
if (surplus > 0) {
  INSERT ledger { tx_type: "income", from_id: REIMBURSABLE_SURPLUS_SRC_ID, amount: surplus }
}
```

**The settle handler correctly handles BOTH cases:**
- Out > In → creates an expense "Reimbursable Loss" entry ✓
- In > Out → creates an income "Reimbursable Surplus" entry ✓

**For the user's test scenario (totalIn > totalOut):**
- `reimbursable = Math.max(0, 2274400 − 5289200) = 0` → no loss entry created ✓
- `surplus = Math.max(0, 5289200 − 2274400) = 3014800` → surplus income entry created ✓

The settle handler itself is NOT buggy. The 0 shown in the UI is semantically correct for "loss" when In > Out. **The bug is exclusively in the UI display layer — the settlement preview panel shows only "Reimbursable Loss" and has no display row for "Reimbursable Surplus".**

---

## 4. Recent Commits

```
c5bbe8e feat(reimburse): auto-create surplus income entry on settlement + fix status:settled bug + complete loss entry fields
4ab3bef feat(receivables): Activity subtab with all-time summary KPIs + pending banner + settlement history + expandable drill-down
92a9faf fix(receivables): settlement detail RE display use computed net (total_in - total_out)
```

**Commit `c5bbe8e` is directly relevant:**
> "Add surplus branch: when totalIn > totalOut, create income ledger entry 'Reimbursable Surplus' linked via reimburse_settlement_id. Loss entry already had all required fields; no change needed. Toast now shows '· RE loss: Rp X' or '· RE surplus: Rp X' as appropriate."

This commit added the HANDLER for surplus but the corresponding **UI preview display was NOT added to the settlement panel**. The handler correctly creates the surplus income entry and shows it in the post-settle toast — but the settlement preview row at L1057-1062 still only shows "Reimbursable Loss". This is the gap.

---

## 5. Test Data

SQL cannot be run directly (no Supabase MCP). Queries to run:

```sql
-- Lazada reimburse_out
SELECT id, tx_date, tx_type, amount, amount_idr, description, entity, reimburse_settlement_id
FROM ledger
WHERE user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND tx_type = 'reimburse_out'
  AND tx_date = '2026-05-11'
  AND description ILIKE '%lazada%';

-- Bukti setoran tunai
SELECT id, tx_date, tx_type, amount, amount_idr, description, entity, reimburse_settlement_id
FROM ledger
WHERE user_id = '6ec0c1b3-84aa-482b-a797-ef6e29b7f772'
  AND description ILIKE '%setoran tunai%'
  AND tx_date = '2026-05-13'
ORDER BY tx_date DESC LIMIT 3;
```

**Expected from user's report:**
- Lazada #1: `amount = 1419760`, `amount_idr = 1419760`, `tx_type = reimburse_out`
- Lazada #2: `amount = 854640`, `amount_idr = 854640`, `tx_type = reimburse_out`
- Bukti setoran tunai: `amount = 5289200`, `amount_idr = 5289200`, `tx_type = reimburse_in`

**Key thing to verify:** whether `amount` vs `amount_idr` match. Both display formula (L922-923) and settle handler (L580-581) use `e.amount`, not `e.amount_idr`. If transactions were entered as non-IDR with `amount_idr` as the IDR equivalent, the compute would use the wrong field. However for IDR transactions (typical reimburse), `amount === amount_idr`, so this doesn't matter here.

---

## 6. Manual Trace

**Input:**
```
selectedOut = [Lazada_1 (1419760), Lazada_2 (854640)]
selectedIn  = [Bukti setoran tunai (5289200)]
```

**Step 1 — totalOutSel (L922):**
```
totalOutSel = 1419760 + 854640 = 2274400
```

**Step 2 — totalInSel (L923):**
```
totalInSel = 5289200
```

**Step 3 — reimbursable (L924):**
```
reimbursable = 2274400 − 5289200 = −3014800
```

**Step 4 — Display (L1060):**
```
fmtIDR(Math.max(0, −3014800))
= fmtIDR(Math.max(0, −3014800))
= fmtIDR(0)
= "Rp 0"                              ← DISPLAYED
```

**Step 5 — Surplus (computed in handle, NOT in display):**
```
surplus = Math.max(0, 5289200 − 2274400) = 3014800   ← exists in handler but not shown in UI
```

**Conclusion:** The settle handler WOULD create a `surplus income entry of Rp 3,014,800` if the user clicks "Settle →". But the **pre-settle preview only shows "Reimbursable Loss: Rp 0"** with no "Reimbursable Surplus: Rp 3,014,800" counterpart. The user sees 0 and believes the calculation is broken.

---

## 7. Root Cause Hypothesis

**Root cause: Missing "Reimbursable Surplus" display row in the settlement preview panel.**

Commit `c5bbe8e` correctly added the surplus branch to the settle HANDLER but forgot to add the corresponding UI preview row. The settlement panel at L1057-1062 only has:

```jsx
<div>
  <div>Reimbursable Loss</div>
  <div>{fmtIDR(Math.max(0, reimbursable))}</div>   {/* always 0 when In > Out */}
</div>
```

There is no sibling display for the surplus case. The user selects In > Out → sees "Reimbursable Loss: Rp 0" → thinks formula is wrong → the actual surplus IS correctly computed on settle but the user never sees the preview.

**There is no formula bug.** Both `reimbursable` (Out > In case) and `surplus` (In > Out case) formulas in the handler are correct. The settle handler would create the right income entry. Only the preview UI is missing the surplus display.

Also note: the user's stated formula "IF Total In > Total Out: Reimbursable Loss = Total In − Total Out" appears to conflate "Loss" and "Surplus." In the codebase's terminology, when In > Out it's a SURPLUS (not a loss). The 0 is technically correct for "loss" — but misleads the user because there is no "Reimbursable Surplus" preview row.

---

## 8. Suggested Fix (NOT IMPLEMENTED)

**One-liner fix — add "Reimbursable Surplus" display row next to "Reimbursable Loss":**

At `Receivables.jsx:1047-1062`, the layout is a flex row with `[Settled On date picker] + [Reimbursable Loss display]`. Add a second conditional display item for the surplus case:

```jsx
<div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
  {/* ... Settled On date picker (unchanged) ... */}

  {/* Reimbursable Loss — show when Out ≥ In */}
  {reimbursable >= 0 && (
    <div>
      <div style={{ fontSize: 10, color: "#9ca3af", ... }}>Reimbursable Loss</div>
      <div style={{ fontSize: 16, fontWeight: 900, ..., color: reimbursable > 0 ? "#dc2626" : "#9ca3af" }}>
        {fmtIDR(reimbursable)}
      </div>
    </div>
  )}

  {/* Reimbursable Surplus — show when In > Out (ADD THIS) */}
  {reimbursable < 0 && (
    <div>
      <div style={{ fontSize: 10, color: "#9ca3af", ... }}>Reimbursable Surplus</div>
      <div style={{ fontSize: 16, fontWeight: 900, ..., color: "#059669" }}>
        +{fmtIDR(-reimbursable)}           {/* -reimbursable = totalInSel - totalOutSel */}
      </div>
    </div>
  )}
</div>
```

This requires one new variable alongside `reimbursable`:
```js
const surplus = Math.max(0, totalInSel - totalOutSel);   // ADD at L924
```

Then display `surplus` in the new "Reimbursable Surplus" row when `surplus > 0`.

No changes to the settle handler — it already creates the correct entries. Only the preview panel needs the surplus display.
