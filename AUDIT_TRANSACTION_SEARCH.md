# Transaction Search — Functionality Audit

Generated: 2026-05-12

---

## 1. Component Location

- **File:** `src/components/Transactions.jsx`
- **Search input:** lines 137–148 (plain `<input>`, 🔍 emoji prefix, placeholder `"Search transactions…"`)
- **State variable:** `search` (line 43) — `useState("")`
- **Handler:** `onChange={e => setSearch(e.target.value)}` (line 139) — direct setState, no debounce, no wrapper function
- **Filter side:** **Client-side** — `useMemo` over the `ledger` prop array (line 46)

---

## 2. Fields Currently Matched

| Field | Matched? | Match Type | Notes |
|---|---|---|---|
| `description` | ✅ Yes | `String.includes()` (case-insensitive) | line 59 |
| `merchant_name` | ✅ Yes | `String.includes()` (case-insensitive) | line 60 |
| `category_name` | ✅ Yes | `String.includes()` (case-insensitive) | line 61 — works because `category_name` is denormalised onto each ledger row |
| `amount` / `amount_idr` | ❌ No | — | Numeric search not implemented |
| `notes` | ❌ No | — | Field exists on ledger rows but ignored by filter |
| `entity` | ❌ No | — | Has a separate `filterEntity` dropdown but not text-searchable |
| Account name (from `from_id`/`to_id`) | ❌ No | — | Filter never joins to `accounts` prop. Account is only searchable via `filterAccId` dropdown |
| `tx_date` | ❌ No | — | Filter has `filterMonth` dropdown only; no free-text date match |
| `tx_type` | ❌ No | — | SubTab navigation (`expense`/`income`/`transfer`/`reimburse`/`bills`) only; no text search |
| Currency code | ❌ No | — | Not searchable |
| Tags / labels | ❌ No | — | Not present on ledger schema |

---

## 3. Resolved Fields (Joined Data)

- **Pre-joined before filter:** **No.** The filter runs on raw `ledger` prop rows.
- **`category_name` is denormalised onto each ledger row** (set at insert time), so category-name search works without a join.
- **Account name (bank/CC card) requires a join** — `TxRow` component (line 385) does `accounts.find(a => a.id === e.from_id)` per-row at render time, but this lookup is NOT done inside the filter. So typing `"BCA"` in search will NOT find transactions where the account name contains "BCA".
- **Income source name** — similarly requires join via `from_id` to `accounts` (subtype=income_source) and is not joined inside the filter.

---

## 4. Edge Cases

| Case | Behaviour |
|---|---|
| Numeric query (`100000`) | ❌ No match — `amount_idr` is a number, `.includes()` not run on numbers |
| Currency format (`Rp 100.000`) | ❌ No match — even if numeric search existed, dot/space format isn't normalised |
| Partial substring (`blibli` → `BLIBLI.COM`) | ✅ Match — `.toLowerCase().includes()` handles substring + case |
| Multi-word (`tokopedia 100`) | ⚠️ Treated as single literal substring including the space. Only matches if exact phrase `"tokopedia 100"` appears in description/merchant/category. No word-tokenisation or AND/OR splitting. |
| Case sensitivity | Case-**insensitive** — both query and fields are lowercased |
| Accent/diacritic folding | ❌ Not normalised (e.g. searching `"a"` won't match `"á"`) |
| Empty string | Filter skipped entirely (line 56 `if (search)` short-circuits) |

---

## 5. UX

| Aspect | State |
|---|---|
| **Debounce** | ❌ None — filter recomputes on every keystroke via `useMemo` deps |
| **Match count** | ❌ Not displayed near the search bar (totals are computed but not labelled as "search results") |
| **Highlight matched text** | ❌ Not implemented |
| **Clear button** | ⚠️ Indirect — the global "✕ Clear" button at line 167 clears ALL filters (month, entity, account, search) at once. No standalone clear for just the search field. |
| **Icon** | 🔍 emoji prefix inside the input (line 148) |
| **Keyboard shortcut** | None |
| **Search on focus suggestions** | None |

---

## 6. Code Snippet — Current Filter Logic

```js
// src/components/Transactions.jsx lines 43-64
const [search, setSearch] = useState("");

const filtered = useMemo(() => {
  let list = [...ledger];
  if (subTab === "expense")   list = list.filter(e => e.tx_type === "expense");
  else if (subTab === "income")    list = list.filter(e => e.tx_type === "income");
  else if (subTab === "transfer")  list = list.filter(e => ["transfer","pay_cc","fx_exchange"].includes(e.tx_type));
  else if (subTab === "reimburse") list = list.filter(e => e.is_reimburse || e.tx_type === "reimburse_out" || e.tx_type === "reimburse_in");
  else if (subTab === "bills")     list = list.filter(e => !!e.recurring_template_id);
  if (filterMonth)  list = list.filter(e => ym(e.tx_date) === filterMonth);
  if (filterEntity) list = list.filter(e => e.entity === filterEntity);
  if (filterAccId)  list = list.filter(e => e.from_id === filterAccId || e.to_id === filterAccId);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(e =>
      e.description?.toLowerCase().includes(q) ||
      e.merchant_name?.toLowerCase().includes(q) ||
      e.category_name?.toLowerCase().includes(q));
  }
  return list;
}, [ledger, subTab, filterMonth, filterEntity, filterAccId, search]);
```

---

## 7. Gaps & Recommendations

### Fields user likely wants to search but currently can't

| Priority | Field | Why it matters |
|---|---|---|
| **High** | `notes` | Free-text notes are often where context lives (reimbursement details, vendor IDs) |
| **High** | Account name (from `from_id`/`to_id`) | Typing `"BCA Krisflyer"` should find tx from that card without using the dropdown |
| **High** | Amount / amount_idr | Searching `"100000"` should find tx of exactly that amount or containing those digits |
| **Medium** | `entity` (free text) | Currently dropdown-only — typing `"hamasa"` should match without selecting from dropdown |
| **Medium** | `tx_date` (formatted) | Search `"2026-05"` or `"May 2026"` to find tx in a month |
| **Low** | `tx_type` label | Search `"transfer"` to surface transfer rows |
| **Low** | `tx_id` last digits | Power-user debugging |

### Quick wins (1–5 line additions)

1. **Add `notes` and `entity` to the filter** — already on the ledger row, just OR them in:
   ```js
   e.notes?.toLowerCase().includes(q) ||
   e.entity?.toLowerCase().includes(q)
   ```
2. **Add amount numeric match** — handle both bare numbers and formatted strings:
   ```js
   String(e.amount_idr || e.amount || "").includes(q.replace(/[^\d]/g, ""))
   ```
   This makes `"100000"`, `"Rp 100.000"`, and `"100.000"` all match a tx of 100,000.
3. **Add account-name match via the `accounts` prop** — build a lookup map outside the filter:
   ```js
   const accountNameById = useMemo(() =>
     Object.fromEntries(accounts.map(a => [a.id, a.name.toLowerCase()])),
   [accounts]);
   // inside filter:
   accountNameById[e.from_id]?.includes(q) ||
   accountNameById[e.to_id]?.includes(q)
   ```
4. **Standalone clear (✕) inside the search input** — improves UX when search alone is enough.

### Medium refactors

5. **Multi-token AND search** — split query by whitespace and require every token to match at least one field:
   ```js
   const tokens = q.split(/\s+/).filter(Boolean);
   list = list.filter(e => tokens.every(tok => fieldsConcat.includes(tok)));
   ```
   Lets `"tokopedia 100"` match both "Tokopedia" merchant AND amount 100,000.
6. **Debounce input** (~150ms) — improves perf on large ledgers; though current is probably fine for typical sizes.
7. **Show match count** next to the input: `42 of 1,205 transactions`.

### Bigger investments

8. **Server-side search** with PostgreSQL `to_tsvector` full-text index on `description || merchant_name || notes || entity || category_name`. Allows ranked results and scales beyond client-side memory limits. Significant refactor — only justified if the ledger grows past ~10k rows.
9. **Fuzzy/typo tolerance** (e.g., `fuse.js`) — useful but adds a dependency. Lower priority than fixing the missing-field gaps above.
10. **Highlight matched tokens in `TxRow`** — pure UX polish, requires wrapping spans around matches.

### Recommended ordering

1. Quick win #1 (`notes`, `entity`) — instant value, ~2 lines
2. Quick win #3 (account name via lookup map) — addresses the most common user complaint, ~5 lines
3. Quick win #2 (numeric amount) — addresses the second most common complaint, ~3 lines
4. Quick win #4 (clear ✕ button on input) — UX polish, ~5 lines
5. Refactor #5 (multi-token AND) — escalates only after the basics work
