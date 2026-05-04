import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ledgerApi, recurringApi } from "../api";
import BankPickerSheet from "./shared/BankPickerSheet";
import { fmtIDR, todayStr } from "../utils";
import { showToast } from "./shared/index";

const FF = "Figtree, sans-serif";

const MONTH_NAMES = [
  "Januari","Februari","Maret","April","Mei","Juni",
  "Juli","Agustus","September","Oktober","November","Desember",
];
const DAY_NAMES = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];

const FILTERS = [
  { key: "all",       label: "Semua",     color: "#374151" },
  { key: "expense",   label: "Expense",   color: "#dc2626" },
  { key: "income",    label: "Income",    color: "#059669" },
  { key: "recurring", label: "Recurring", color: "#d97706" },
  { key: "cc_due",    label: "CC Due",    color: "#f59e0b" },
];

const DOT = {
  expense:       "#dc2626",
  income:        "#059669",
  bank_interest: "#059669",
  cashback:      "#059669",
  transfer:      "#3b5bdb",
  pay_cc:        "#3b5bdb",
  reimburse_in:  "#3b5bdb",
  reimburse_out: "#3b5bdb",
  fx_exchange:   "#3b5bdb",
  collect_loan:  "#059669",
  give_loan:     "#d97706",
  reminder:      "#9333ea",
  recurring:     "#d97706",
  cc_due:        "#f59e0b",
  installment:   "#d97706",
  deposito:      "#6366f1",
};

const INCOME_TYPES = new Set(["income","reimburse_in","collect_loan","sell_asset","bank_interest","cashback"]);

function dimOfMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function ymOf(y, m)       { return `${y}-${String(m + 1).padStart(2, "0")}`; }
function dsOf(y, m, d)    {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const SEC_LABEL = {
  fontSize: 10, fontWeight: 700, color: "#9ca3af",
  textTransform: "uppercase", letterSpacing: "0.6px",
  padding: "2px 0 4px", fontFamily: FF,
};

// ─────────────────────────────────────────────────────────────────────────────

export default function Calendar({
  user,
  ledger          = [],
  accounts        = [],
  recurTemplates  = [],
  installments    = [],
  reminders       = [],
  creditCards     = [],
  bankAccounts    = [],
  assets          = [],
  fxRates         = {},
  setLedger,
  setReminders,
  setRecurTemplates,
}) {
  const todayNow  = new Date();
  const today     = todayStr();

  const [year,       setYear]       = useState(todayNow.getFullYear());
  const [month,      setMonth]      = useState(todayNow.getMonth());
  const [activeDate, setActiveDate] = useState(today);
  const [filter,     setFilter]     = useState("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCtx,  setPickerCtx]  = useState(null); // { template, reminder, isExpense }
  const [busy,       setBusy]       = useState(null);  // busyId string

  const monthStr       = ymOf(year, month);
  const isCurrentMonth = year === todayNow.getFullYear() && month === todayNow.getMonth();

  // ── Navigation ────────────────────────────────────────────────────────────
  const prevMonth = useCallback(() => {
    setYear(y => (month === 0 ? y - 1 : y));
    setMonth(m => (m === 0 ? 11 : m - 1));
  }, [month]);

  const nextMonth = useCallback(() => {
    setYear(y => (month === 11 ? y + 1 : y));
    setMonth(m => (m === 11 ? 0 : m + 1));
  }, [month]);

  const goToday = useCallback(() => {
    const n = new Date();
    setYear(n.getFullYear());
    setMonth(n.getMonth());
    setActiveDate(todayStr());
  }, []);

  // ── Build all items indexed by date ──────────────────────────────────────
  const rawByDate = useMemo(() => {
    const now = todayStr();
    const map = {};
    const add = (ds, item) => { if (!map[ds]) map[ds] = []; map[ds].push(item); };

    // ── Layer 1: Ledger entries ──
    for (const e of ledger) {
      if (!e.tx_date?.startsWith(monthStr)) continue;
      const isInc = INCOME_TYPES.has(e.tx_type);
      add(e.tx_date, {
        kind:        "ledger",
        filterKey:   isInc ? "income" : "expense",
        title:       e.description || e.merchant_name || e.category_name || "—",
        sub:         e.category_name || "",
        amount:      Number(e.amount_idr || e.amount || 0),
        amountColor: isInc ? "#059669" : "#dc2626",
        amountSign:  isInc ? "+" : "−",
        dotColor:    DOT[e.tx_type] || "#dc2626",
        raw:         e,
        actionable:  false,
        busyId:      null,
      });
    }

    // ── Layer 2: Pending reminders ──
    for (const r of reminders) {
      if (r.status !== "pending") continue;
      if (!r.due_date?.startsWith(monthStr)) continue;
      const tmpl = r.recurring_templates
        || recurTemplates.find(t => t.id === r.template_id)
        || {};
      const isInc = tmpl.tx_type === "income";
      add(r.due_date, {
        kind:        "reminder",
        filterKey:   "recurring",
        title:       tmpl.name || "Reminder",
        sub:         "Pending confirmation",
        amount:      Number(tmpl.amount || 0),
        amountColor: isInc ? "#059669" : "#dc2626",
        amountSign:  isInc ? "+" : "−",
        dotColor:    DOT.reminder,
        raw:         { reminder: r, template: tmpl },
        actionable:  true,
        busyId:      `rem-${r.id}`,
      });
    }

    // ── Layer 3: Recurring projection (future only, no pending reminder) ──
    const dim = dimOfMonth(year, month);
    for (const t of recurTemplates) {
      if (!t.is_active || !t.day_of_month) continue;
      const day = Math.min(Number(t.day_of_month), dim);
      const ds  = dsOf(year, month, day);
      if (ds < now) continue;
      if (reminders.some(r => r.template_id === t.id && r.due_date === ds && r.status === "pending")) continue;
      const isInc = t.tx_type === "income";
      add(ds, {
        kind:        "recurring",
        filterKey:   "recurring",
        title:       t.name || "Recurring",
        sub:         t.frequency === "monthly" ? "Monthly" : (t.frequency || "Recurring"),
        amount:      Number(t.amount || 0),
        amountColor: isInc ? "#059669" : "#dc2626",
        amountSign:  isInc ? "+" : "−",
        dotColor:    DOT.recurring,
        raw:         { template: t },
        actionable:  true,
        busyId:      `rec-${t.id}`,
      });
    }

    // ── Layer 4: CC due dates ──
    for (const cc of creditCards) {
      if (!cc.due_day) continue;
      const day  = Math.min(Number(cc.due_day), dim);
      const ds   = dsOf(year, month, day);
      const out  = Number(cc.outstanding_amount || 0);
      if (out <= 0 && ds < now) continue; // skip past zero-balance dates
      add(ds, {
        kind:        "cc_due",
        filterKey:   "cc_due",
        title:       cc.name,
        sub:         out > 0 ? `Tagihan: ${fmtIDR(out)}` : "Tidak ada tagihan",
        amount:      out,
        amountColor: out > 0 ? "#f59e0b" : "#9ca3af",
        amountSign:  out > 0 ? "−" : "",
        dotColor:    DOT.cc_due,
        raw:         cc,
        actionable:  false,
        busyId:      null,
      });
    }

    // ── Layer 5: Installments (pinned to CC's due day) ──
    for (const inst of installments) {
      const paid  = inst.paid_months || 0;
      const total = inst.total_months ?? inst.months ?? 0;
      if (paid >= total) continue;
      const cc = creditCards.find(c => c.id === inst.account_id);
      if (!cc?.due_day) continue;
      const day = Math.min(Number(cc.due_day), dim);
      const ds  = dsOf(year, month, day);
      add(ds, {
        kind:        "installment",
        filterKey:   "cc_due",
        title:       inst.description || "CC Installment",
        sub:         `${cc.name} · Cicilan ${paid + 1}/${total}`,
        amount:      Number(inst.monthly_amount || 0),
        amountColor: "#9ca3af",
        amountSign:  "−",
        dotColor:    DOT.installment,
        raw:         inst,
        actionable:  false,
        busyId:      null,
      });
    }

    // ── Layer 6: Deposito maturity ──
    for (const a of assets) {
      if (a.subtype !== "Deposito" || !a.maturity_date) continue;
      if (!a.maturity_date.startsWith(monthStr)) continue;
      const bankAcc = bankAccounts.find(b => b.id === a.deposit_bank_id);
      add(a.maturity_date, {
        kind:        "deposito",
        filterKey:   "income",
        title:       `${a.name} jatuh tempo`,
        sub:         `Deposito${bankAcc ? ` · ${bankAcc.name}` : ""}`,
        amount:      Number(a.current_value || 0),
        amountColor: "#6366f1",
        amountSign:  "+",
        dotColor:    DOT.deposito,
        raw:         a,
        actionable:  false,
        busyId:      null,
      });
    }

    return map;
  }, [ledger, reminders, recurTemplates, creditCards, installments, assets,
      year, month, monthStr, bankAccounts]);

  // ── Apply filter ─────────────────────────────────────────────────────────
  const byDate = useMemo(() => {
    if (filter === "all") return rawByDate;
    const out = {};
    for (const [ds, items] of Object.entries(rawByDate)) {
      const matched = items.filter(i => i.filterKey === filter);
      if (matched.length) out[ds] = matched;
    }
    return out;
  }, [rawByDate, filter]);

  // ── Grid cells ───────────────────────────────────────────────────────────
  const gridCells = useMemo(() => {
    const dim      = dimOfMonth(year, month);
    const firstDow = new Date(year, month, 1).getDay();
    const cells    = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) {
      const ds   = dsOf(year, month, d);
      const items = byDate[ds] || [];
      const dots = [...new Set(items.map(i => i.dotColor))].slice(0, 4);
      cells.push({ day: d, ds, dots });
    }
    return cells;
  }, [year, month, byDate]);

  // ── Active date items ────────────────────────────────────────────────────
  const activeItems   = byDate[activeDate] || [];
  const pastItems     = activeItems.filter(i => i.kind === "ledger");
  const upcomingItems = activeItems.filter(i => i.kind !== "ledger");
  const totalSpent    = pastItems.filter(i => i.amountSign === "−").reduce((s, i) => s + i.amount, 0);
  const totalIncome   = pastItems.filter(i => i.amountSign === "+").reduce((s, i) => s + i.amount, 0);

  // ── Confirm: mirror Dashboard quickConfirmRecurring ──────────────────────
  const doInsert = useCallback(async (template, reminder, overrideBankId) => {
    if (!user?.id || !template) return;
    const isExpense = template.tx_type !== "income";
    const busyId    = reminder?.id ? `rem-${reminder.id}` : `rec-${template.id}`;
    setBusy(busyId);
    try {
      const created = await ledgerApi.create(user.id, {
        tx_type:        template.tx_type,
        tx_date:        todayStr(),
        amount:         template.amount,
        currency:       template.currency || "IDR",
        amount_idr:     template.amount,
        from_type:      template.from_type || (isExpense ? "account" : "income_source"),
        from_id:        template.from_id   || (isExpense ? overrideBankId : null),
        to_type:        template.to_type   || (!isExpense ? "account" : "expense"),
        to_id:          template.to_id     || (!isExpense ? overrideBankId : null),
        category_id:    template.category_id || null,
        entity:         template.entity || "Personal",
        description:    template.name || template.description || "Recurring",
        merchant_name:  null, attachment_url: null,
        ai_categorized: false, ai_confidence: null,
        installment_id: null, scan_batch_id: null, notes: null,
      }, accounts);
      if (created && setLedger) setLedger(p => [created, ...p]);
      await recurringApi.updateTemplate(template.id, { last_generated_date: todayStr() });
      if (setRecurTemplates) {
        setRecurTemplates(p =>
          p.map(t => t.id === template.id ? { ...t, last_generated_date: todayStr() } : t)
        );
      }
      if (reminder?.id) {
        await recurringApi.confirmReminder(reminder.id);
        if (setReminders) {
          setReminders(p =>
            p.map(r => r.id === reminder.id ? { ...r, status: "confirmed" } : r)
          );
        }
      }
      showToast(`✓ Logged: ${template.name}`);
    } catch (e) {
      showToast("Gagal: " + (e.message || "Error"), "error");
    } finally {
      setBusy(null);
    }
  }, [user, accounts, setLedger, setRecurTemplates, setReminders]);

  const confirmItem = useCallback((item) => {
    const { template, reminder } = item.raw || {};
    if (!template) return;
    const isExpense  = template.tx_type !== "income";
    const needPicker = isExpense ? !template.from_id : !template.to_id;
    if (needPicker) {
      setPickerCtx({ template, reminder, isExpense });
      setPickerOpen(true);
    } else {
      doInsert(template, reminder, null);
    }
  }, [doInsert]);

  const skipItem = useCallback(async (item) => {
    const reminder = item.raw?.reminder;
    if (!reminder?.id) return;
    setBusy(`rem-${reminder.id}`);
    try {
      await recurringApi.skipReminder(reminder.id);
      if (setReminders) {
        setReminders(p => p.map(r => r.id === reminder.id ? { ...r, status: "skipped" } : r));
      }
      showToast("Skipped");
    } catch (e) {
      showToast("Gagal skip: " + (e.message || "Error"), "error");
    } finally {
      setBusy(null);
    }
  }, [setReminders]);

  // ── Active date label ────────────────────────────────────────────────────
  const activeDateLabel = (() => {
    if (activeDate === today) return "Hari ini";
    const d = new Date(activeDate + "T00:00:00");
    return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  })();

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px 80px", fontFamily: FF }}>

      {/* HEADER */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        paddingTop: 8, marginBottom: 16,
      }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#111827" }}>Calendar</h1>
        {!isCurrentMonth && (
          <button
            onClick={goToday}
            style={{
              background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 8,
              padding: "6px 14px", fontSize: 12, fontWeight: 500, color: "#374151",
              cursor: "pointer", fontFamily: FF,
            }}
          >
            Today
          </button>
        )}
      </div>

      {/* MONTH NAVIGATION */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 12,
        padding: "10px 16px", marginBottom: 12,
      }}>
        <button
          onClick={prevMonth}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}
        >
          <ChevronLeft size={18} color="#6b7280" />
        </button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>
            {MONTH_NAMES[month]} {year}
          </div>
          {isCurrentMonth && (
            <div style={{ fontSize: 11, color: "#3b5bdb", marginTop: 1 }}>Bulan ini</div>
          )}
        </div>
        <button
          onClick={nextMonth}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex" }}
        >
          <ChevronRight size={18} color="#6b7280" />
        </button>
      </div>

      {/* FILTER CHIPS */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
        {FILTERS.map(f => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: "5px 14px", borderRadius: 20, fontSize: 12, fontWeight: 500,
                border:      active ? `1px solid ${f.color}` : "0.5px solid #e5e7eb",
                background:  active ? `${f.color}18` : "#fff",
                color:       active ? f.color : "#6b7280",
                cursor: "pointer", whiteSpace: "nowrap", fontFamily: FF,
                flexShrink: 0, transition: "all 0.15s",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* MONTH GRID */}
      <div style={{
        background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16,
        padding: 12, marginBottom: 14,
      }}>
        {/* Day-of-week headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 }}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{
              fontSize: 12, fontWeight: 600, color: "#9ca3af", letterSpacing: 0.5,
              textAlign: "center", textTransform: "uppercase", padding: "2px 0",
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Date cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {gridCells.map((cell, idx) => {
            if (!cell) return <div key={`e-${idx}`} style={{ aspectRatio: "1" }} />;
            const tdy = cell.ds === today;
            const act = cell.ds === activeDate;
            const pst = cell.ds < today;
            return (
              <button
                key={cell.ds}
                onClick={() => setActiveDate(cell.ds)}
                style={{
                  aspectRatio: "1", borderRadius: 8,
                  border:     act ? "2px solid #3b5bdb" : tdy ? "1.5px solid #16a34a" : "1px solid transparent",
                  background: act ? "#eff6ff" : tdy ? "#f0fdf4" : "transparent",
                  cursor: "pointer", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", padding: "2px 0",
                  fontFamily: FF, transition: "background 0.1s",
                }}
              >
                <span style={{
                  fontSize: 15, fontWeight: tdy || act ? 700 : 400,
                  color: act ? "#3b5bdb" : tdy ? "#16a34a" : pst ? "#9ca3af" : "#374151",
                  lineHeight: 1.3,
                }}>
                  {cell.day}
                </span>
                {cell.dots.length > 0 && (
                  <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
                    {cell.dots.map((c, i) => (
                      <div key={i} style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: pst ? c + "88" : c,
                      }} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* LEGEND */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16, paddingLeft: 4 }}>
        {[
          { color: "#dc2626", label: "Expense"  },
          { color: "#059669", label: "Income"   },
          { color: "#3b5bdb", label: "Transfer" },
          { color: "#9333ea", label: "Reminder" },
          { color: "#d97706", label: "Recurring"},
          { color: "#f59e0b", label: "CC Due"   },
          { color: "#6366f1", label: "Deposito" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: color }} />
            <span style={{ fontSize: 10, color: "#9ca3af", fontFamily: FF }}>{label}</span>
          </div>
        ))}
      </div>

      {/* DETAIL PANEL */}
      <div style={{
        background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16,
        padding: "14px 16px",
      }}>
        {/* Panel header */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>
            {activeDateLabel}
          </div>
          {(totalIncome > 0 || totalSpent > 0) && (
            <div style={{ fontSize: 12, marginTop: 3, display: "flex", gap: 8 }}>
              {totalIncome > 0 && (
                <span style={{ color: "#059669" }}>+{fmtIDR(totalIncome)}</span>
              )}
              {totalSpent > 0 && (
                <span style={{ color: "#dc2626" }}>−{fmtIDR(totalSpent)}</span>
              )}
            </div>
          )}
        </div>

        {activeItems.length === 0 ? (
          <div style={{ padding: "28px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
            Tidak ada item pada tanggal ini
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pastItems.length > 0 && (
              <>
                <div style={SEC_LABEL}>Transaksi</div>
                {pastItems.map((item, i) => (
                  <ItemRow key={`p-${i}`} item={item} />
                ))}
              </>
            )}
            {upcomingItems.length > 0 && (
              <>
                <div style={{ ...SEC_LABEL, marginTop: pastItems.length ? 8 : 0 }}>Upcoming</div>
                {upcomingItems.map((item, i) => (
                  <ItemRow
                    key={`u-${i}`}
                    item={item}
                    busy={busy}
                    onConfirm={item.actionable ? () => confirmItem(item) : null}
                    onSkip={item.kind === "reminder" ? () => skipItem(item) : null}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* BANK PICKER */}
      <BankPickerSheet
        isOpen={pickerOpen}
        onClose={() => { setPickerOpen(false); setPickerCtx(null); }}
        bankAccounts={bankAccounts}
        title={pickerCtx ? `Pilih akun · ${pickerCtx.template?.name || "Recurring"}` : "Pilih akun"}
        contextLabel={pickerCtx?.template?.name}
        contextAmount={pickerCtx ? fmtIDR(Number(pickerCtx.template?.amount || 0)) : ""}
        mode={pickerCtx?.isExpense ? "default" : "credit"}
        onSelect={(bank) => {
          const ctx = pickerCtx;
          setPickerOpen(false);
          setPickerCtx(null);
          doInsert(ctx.template, ctx.reminder, bank.id);
        }}
      />
    </div>
  );
}

// ── Item row sub-component ────────────────────────────────────────────────
function ItemRow({ item, busy, onConfirm, onSkip }) {
  const isBusy = busy != null && busy === item.busyId;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
      background: "#f9fafb", borderRadius: 10,
      opacity: isBusy ? 0.55 : 1, transition: "opacity 0.15s",
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: "50%",
        background: item.dotColor, flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: "#111827",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {item.title}
        </div>
        {item.sub && (
          <div style={{
            fontSize: 11, color: "#6b7280", marginTop: 1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {item.sub}
          </div>
        )}
      </div>
      {item.amount > 0 && (
        <div style={{ fontSize: 12, fontWeight: 600, color: item.amountColor, flexShrink: 0 }}>
          {item.amountSign}{fmtIDR(item.amount, true)}
        </div>
      )}
      {(onConfirm || onSkip) && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {onSkip && (
            <button
              onClick={onSkip}
              disabled={isBusy}
              style={{
                padding: "4px 8px", borderRadius: 6, border: "0.5px solid #e5e7eb",
                background: "#fff", fontSize: 11, color: "#6b7280",
                cursor: isBusy ? "default" : "pointer", fontFamily: FF,
              }}
            >
              Skip
            </button>
          )}
          {onConfirm && (
            <button
              onClick={onConfirm}
              disabled={isBusy}
              style={{
                padding: "4px 10px", borderRadius: 6, border: "none",
                background: "#3b5bdb", fontSize: 11, fontWeight: 500, color: "#fff",
                cursor: isBusy ? "default" : "pointer", fontFamily: FF,
              }}
            >
              {isBusy ? "…" : "Confirm"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
