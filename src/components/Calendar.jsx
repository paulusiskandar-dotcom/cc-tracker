import { useMemo, useState, useRef, useEffect } from "react";
import { recurringApi } from "../api";
import { fmtIDR, todayStr } from "../utils";
import { showToast } from "./shared/index";
import { LIGHT, DARK } from "../theme";

const DOT_COLORS = {
  income:      "#059669",
  expense:     "#dc2626",
  transfer:    "#3b5bdb",
  pay_cc:      "#7c3aed",
  reimburse:   "#d97706",
  reminder:    "#f59e0b",
};

const TX_COLOR = (tx_type) => {
  if (tx_type === "income" || tx_type === "bank_interest" || tx_type === "cashback") return "#059669";
  if (tx_type === "transfer" || tx_type === "fx_exchange") return "#3b5bdb";
  if (tx_type === "pay_cc") return "#7c3aed";
  if (tx_type?.includes("reimburse")) return "#d97706";
  return "#dc2626";
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function Calendar({
  user, ledger, reminders, accounts,
  setReminders, dark,
}) {
  const T = dark ? DARK : LIGHT;
  const today = todayStr();

  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState(today);
  const listRefs = useRef({});

  const { year, month } = viewMonth;
  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;

  const prevMonth = () => setViewMonth(({ year, month }) =>
    month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
  );
  const nextMonth = () => setViewMonth(({ year, month }) =>
    month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
  );

  // ── Grid construction ──────────────────────────────────────
  const { daysInMonth, firstDOW } = useMemo(() => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDOW    = new Date(year, month, 1).getDay();
    return { daysInMonth, firstDOW };
  }, [year, month]);

  // ── Ledger entries for this month ──────────────────────────
  const monthEntries = useMemo(() =>
    ledger.filter(e => e.tx_date?.startsWith(monthStr))
  , [ledger, monthStr]);

  const byDate = useMemo(() => {
    const m = {};
    monthEntries.forEach(e => {
      if (!m[e.tx_date]) m[e.tx_date] = [];
      m[e.tx_date].push(e);
    });
    return m;
  }, [monthEntries]);

  // ── Reminders for this month ───────────────────────────────
  const remindersByDate = useMemo(() => {
    const m = {};
    reminders.forEach(r => {
      if (!r.due_date?.startsWith(monthStr)) return;
      if (!m[r.due_date]) m[r.due_date] = [];
      m[r.due_date].push(r);
    });
    return m;
  }, [reminders, monthStr]);

  // ── Sorted list of all days with content ───────────────────
  const listDays = useMemo(() => {
    const days = new Set([
      ...Object.keys(byDate),
      ...Object.keys(remindersByDate),
    ]);
    return [...days].sort();
  }, [byDate, remindersByDate]);

  // ── Scroll to selected date ────────────────────────────────
  useEffect(() => {
    if (selectedDate && listRefs.current[selectedDate]) {
      listRefs.current[selectedDate].scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedDate]);

  // ── Dot summary per day ────────────────────────────────────
  const dotsFor = (dateStr) => {
    const entries  = byDate[dateStr]   || [];
    const rems     = remindersByDate[dateStr] || [];
    const dots = [];
    if (entries.some(e => e.tx_type === "income"))     dots.push(DOT_COLORS.income);
    if (entries.some(e => e.tx_type === "expense" || e.tx_type === "bank_charges" || e.tx_type === "materai" || e.tx_type === "tax")) dots.push(DOT_COLORS.expense);
    if (entries.some(e => ["transfer","pay_cc","fx_exchange"].includes(e.tx_type))) dots.push(DOT_COLORS.transfer);
    if (entries.some(e => e.tx_type?.includes("reimburse"))) dots.push(DOT_COLORS.reimburse);
    if (rems.length > 0) dots.push(DOT_COLORS.reminder);
    return dots.slice(0, 4);
  };

  // ── Reminder actions ───────────────────────────────────────
  const confirmReminder = async (r) => {
    try {
      await recurringApi.confirmReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      showToast(`✓ ${r.recurring_templates?.name || "Reminder"} confirmed`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const skipReminder = async (r) => {
    try {
      await recurringApi.skipReminder(r.id);
      setReminders?.(p => p.filter(x => x.id !== r.id));
      showToast("Skipped");
    } catch (e) { showToast(e.message, "error"); }
  };

  const isFuture = (d) => d > today;
  const isToday  = (d) => d === today;

  // ── Render ─────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* ── MONTH NAVIGATION ──────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: "10px 16px",
      }}>
        <button onClick={prevMonth} style={NAV_BTN}>‹</button>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.text, fontFamily: "Figtree, sans-serif" }}>
          {MONTHS[month]} {year}
        </div>
        <button onClick={nextMonth} style={NAV_BTN}>›</button>
      </div>

      {/* ── MONTHLY GRID ──────────────────────────────────── */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14, padding: "12px",
      }}>
        {/* Day of week headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 6 }}>
          {DAYS.map(d => (
            <div key={d} style={{
              fontSize: 9, fontWeight: 700, color: T.text3,
              textAlign: "center", fontFamily: "Figtree, sans-serif",
              textTransform: "uppercase",
            }}>{d}</div>
          ))}
        </div>

        {/* Calendar cells */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
          {/* Empty cells for first week */}
          {Array.from({ length: firstDOW }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day     = i + 1;
            const dateStr = `${monthStr}-${String(day).padStart(2, "0")}`;
            const dots    = dotsFor(dateStr);
            const sel     = selectedDate === dateStr;
            const tod     = isToday(dateStr);
            const fut     = isFuture(dateStr);

            return (
              <div
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                style={{
                  borderRadius: 8,
                  padding: "4px 2px",
                  textAlign: "center",
                  cursor: dots.length > 0 || tod ? "pointer" : "default",
                  background: sel ? "#111827" : tod ? "#f3f4f6" : "transparent",
                  transition: "background 0.1s",
                  minHeight: 38,
                  display: "flex", flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div style={{
                  fontSize: 12, fontWeight: tod || sel ? 800 : 500,
                  color: sel ? "#fff" : tod ? "#111827" : fut ? T.text3 : T.text,
                  fontFamily: "Figtree, sans-serif",
                  lineHeight: 1.4,
                }}>
                  {day}
                </div>
                {/* Dots */}
                <div style={{ display: "flex", gap: 2, marginTop: 2, justifyContent: "center" }}>
                  {dots.map((color, di) => (
                    <div key={di} style={{
                      width: 4, height: 4, borderRadius: "50%",
                      background: fut ? color + "80" : color,
                    }} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── LEGEND ────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {[
          { color: DOT_COLORS.income, label: "Income" },
          { color: DOT_COLORS.expense, label: "Expense" },
          { color: DOT_COLORS.transfer, label: "Transfer" },
          { color: DOT_COLORS.reimburse, label: "Reimburse" },
          { color: DOT_COLORS.reminder, label: "Upcoming" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            <span style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif" }}>{label}</span>
          </div>
        ))}
      </div>

      {/* ── TRANSACTION LIST ──────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {listDays.length === 0 ? (
          <div style={{ fontSize: 13, color: T.text3, textAlign: "center", padding: 24, fontFamily: "Figtree, sans-serif" }}>
            No transactions this month
          </div>
        ) : listDays.map(dateStr => {
          const entries = byDate[dateStr]   || [];
          const rems    = remindersByDate[dateStr] || [];
          const fut     = isFuture(dateStr);
          const tod     = isToday(dateStr);

          const dayLabel = (() => {
            if (tod) return "Today";
            const d = new Date(dateStr + "T00:00:00");
            return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
          })();

          return (
            <div
              key={dateStr}
              ref={el => { if (el) listRefs.current[dateStr] = el; }}
            >
              {/* Date header */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, color: tod ? "#3b5bdb" : T.text3,
                  fontFamily: "Figtree, sans-serif", textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}>
                  {dayLabel}
                </div>
                {fut && (
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: "#f59e0b",
                    background: "#fef3c7", borderRadius: 4, padding: "1px 5px",
                    fontFamily: "Figtree, sans-serif",
                  }}>
                    UPCOMING
                  </div>
                )}
                <div style={{ flex: 1, height: 1, background: T.border }} />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {/* Past/today: ledger entries */}
                {entries.map(e => {
                  const fromAcc = accounts.find(a => a.id === e.from_id);
                  const toAcc   = accounts.find(a => a.id === e.to_id);
                  const color   = TX_COLOR(e.tx_type);
                  const isIncome = e.tx_type === "income" || e.tx_type === "bank_interest" || e.tx_type === "cashback";
                  return (
                    <div key={e.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px",
                      background: T.surface, border: `1px solid ${T.border}`,
                      borderRadius: 10,
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: color, flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: T.text,
                          fontFamily: "Figtree, sans-serif",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {e.description || "—"}
                        </div>
                        {(fromAcc || toAcc) && (
                          <div style={{ fontSize: 10, color: T.text3, fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
                            {[fromAcc?.name, toAcc?.name].filter(Boolean).join(" → ")}
                          </div>
                        )}
                      </div>
                      <div style={{
                        fontSize: 12, fontWeight: 700, color: isIncome ? "#059669" : "#dc2626",
                        fontFamily: "Figtree, sans-serif", flexShrink: 0,
                      }}>
                        {isIncome ? "+" : "−"}{fmtIDR(Number(e.amount_idr || e.amount || 0), true)}
                      </div>
                    </div>
                  );
                })}

                {/* Future: upcoming reminders */}
                {rems.map(r => {
                  const tmpl = r.recurring_templates || {};
                  const isIncome = tmpl.tx_type === "income";
                  return (
                    <div key={r.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px",
                      background: "#fffbeb", border: "1px solid #fde68a",
                      borderRadius: 10, opacity: 0.9,
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#f59e0b", flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, fontWeight: 600, color: "#92400e",
                          fontFamily: "Figtree, sans-serif",
                          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                        }}>
                          {tmpl.name || "Reminder"}
                        </div>
                        <div style={{ fontSize: 10, color: "#b45309", fontFamily: "Figtree, sans-serif", marginTop: 1 }}>
                          {tmpl.frequency || "Recurring"} · {fmtIDR(Number(tmpl.amount || 0), true)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => confirmReminder(r)}
                          style={{
                            width: 26, height: 26, borderRadius: 7, border: "none",
                            background: "#dcfce7", color: "#059669", cursor: "pointer",
                            fontSize: 11, fontWeight: 700, fontFamily: "Figtree, sans-serif",
                          }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => skipReminder(r)}
                          style={{
                            width: 26, height: 26, borderRadius: 7,
                            border: "1px solid #e5e7eb", background: "#f9fafb",
                            color: "#9ca3af", cursor: "pointer", fontSize: 11,
                            fontFamily: "Figtree, sans-serif",
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────
const NAV_BTN = {
  background: "none", border: "1px solid #e5e7eb", borderRadius: 8,
  width: 32, height: 32, cursor: "pointer", fontSize: 16,
  fontFamily: "Figtree, sans-serif", color: "#6b7280",
  display: "flex", alignItems: "center", justifyContent: "center",
};
