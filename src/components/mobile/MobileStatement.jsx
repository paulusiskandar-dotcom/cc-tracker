// Mobile statement for one account (phones only): the balance, one month of movements by
// day, tap a row to edit it in the app's own form. Running figures use the same native-amount
// rule as the desktop statement (nativeAmt). Reconcile, PDF and Excel stay on the desktop page,
// reached from the link at the bottom.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { fmtIDR, fmtCurNative } from "../../utils";
import { nativeAmt } from "../BankStatement";
import TxVerticalBig from "../shared/TxVerticalBig";
import "./mobile.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = s => { const d = new Date(`${String(s).slice(0, 10)}T00:00:00`); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const shiftMonth = (m, by) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + by, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export default function MobileStatement({ onFull, ...props }) {
  const { accounts = [], ledger = [], fxRates = {}, dark } = props;
  const { id } = useParams();
  const navigate = useNavigate();
  const acc = accounts.find(a => a.id === id);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [edit, setEdit] = useState(null);

  const isCard = acc?.type === "credit_card";
  const foreign = !!acc?.currency && acc.currency !== "IDR";
  const money = v => (foreign ? fmtCurNative(v, acc.currency) : fmtIDR(v));

  const rows = useMemo(() => !acc ? [] : ledger
    .filter(e => (e.from_id === id && e.from_type === "account") || (e.to_id === id && e.to_type === "account"))
    .map(e => ({ e, into: e.to_id === id && e.to_type === "account", v: nativeAmt(e, id, foreign) })), [ledger, id, acc, foreign]);
  const inMonth = useMemo(() => rows.filter(r => String(r.e.tx_date || "").slice(0, 7) === month)
    .sort((a, b) => String(b.e.tx_date).localeCompare(String(a.e.tx_date)) || String(b.e.created_at || "").localeCompare(String(a.e.created_at || ""))), [rows, month]);
  const moneyIn = inMonth.filter(r => r.into).reduce((s, r) => s + r.v, 0);
  const moneyOut = inMonth.filter(r => !r.into).reduce((s, r) => s + r.v, 0);
  const days = []; inMonth.forEach(r => { const last = days[days.length - 1]; if (last && last.date === r.e.tx_date) last.items.push(r); else days.push({ date: r.e.tx_date, items: [r] }); });

  if (!acc) return <div className={`mw${dark ? " dark" : ""}`}><div className="mw-hdr"><button className="mw-round" onClick={() => navigate(-1)} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button><h2>Statement</h2></div><div className="mw-empty">Account not found.</div></div>;

  const balance = isCard ? Number(acc.outstanding_amount || 0) : Number(acc.current_balance || 0);
  return (
    <div className={`mw${dark ? " dark" : ""}`}>
      <div className="mw-hdr">
        <button className="mw-round" onClick={() => navigate(-1)} aria-label="Back"><ChevronLeft size={22} strokeWidth={1.8} /></button>
        <h2>{acc.name}</h2>
      </div>

      <div className="mw-tile">
        <div className="mw-tile-l">{isCard ? "Balance owed" : "Balance"}</div>
        <div className={`mw-tile-n${!isCard && balance < 0 ? " mw-neg" : ""}`}>{balance < 0 ? "−" : ""}{money(Math.abs(balance))}</div>
        {foreign && fxRates[acc.currency] ? <div className="mw-tile-s">{fmtIDR(balance * fxRates[acc.currency])}</div> : null}
      </div>

      <div className="mw-bar2" style={{ marginTop: 16 }}>
        <div className="mw-month">
          <button onClick={() => setMonth(m => shiftMonth(m, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <span>{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</span>
          <button onClick={() => setMonth(m => shiftMonth(m, 1))} aria-label="Next month"><ChevronRight size={18} /></button>
        </div>
      </div>
      <div className="mw-tiles">
        <div className="mw-tile"><div className="mw-tile-l">{isCard ? "Payments" : "In"}</div><div className="mw-tile-m mw-fit" style={{ color: "var(--good)" }}>{money(moneyIn)}</div></div>
        <div className="mw-tile"><div className="mw-tile-l">{isCard ? "Charges" : "Out"}</div><div className="mw-tile-m mw-fit">{money(moneyOut)}</div></div>
      </div>

      {days.map(d => (
        <div key={d.date}>
          <div className="mw-label">{fmtDay(d.date)}</div>
          <div className="mw-list">
            {d.items.map(({ e, into, v }) => (
              <button key={e.id} className="mw-row mw-tx" onClick={() => setEdit(e)}>
                <span className="mw-row-name">{e.notes && !/^imported from/i.test(e.notes) ? e.notes : (e.description || e.merchant_name || e.tx_type)}</span>
                <span className="mw-row-amt" style={into ? { color: "var(--good)" } : undefined}>{into ? "+" : "−"}{money(v)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {!inMonth.length && <div className="mw-empty">No movements this month.</div>}

      {onFull && <div className="mw-list mw-gap"><button className="mw-row mw-showall" onClick={onFull}>Reconcile, PDF and Excel</button></div>}

      <TxVerticalBig open={!!edit} mode="edit" initialData={edit} onSave={() => { setEdit(null); props.onRefresh && props.onRefresh(); }} onDelete={() => { setEdit(null); props.onRefresh && props.onRefresh(); }} onClose={() => setEdit(null)}
        user={props.user} accounts={accounts} setLedger={props.setLedger} categories={props.categories || []} fxRates={fxRates} allCurrencies={props.CURRENCIES || []}
        bankAccounts={props.bankAccounts} creditCards={props.creditCards} assets={props.assets} liabilities={props.liabilities} receivables={props.receivables}
        incomeSrcs={props.incomeSrcs} employeeLoans={props.employeeLoans} setEmployeeLoans={props.setEmployeeLoans} recurTemplates={props.recurTemplates} setReminders={props.setReminders} onRefresh={props.onRefresh} />
    </div>
  );
}
