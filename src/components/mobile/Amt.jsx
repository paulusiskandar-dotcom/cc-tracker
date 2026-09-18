// One way to show a transaction's amount on every phone list: colour only, no sign or icon
// (Paulus, 19 Sep 2026 — simpler to read):
//   income green · expense and loan payments red · reimburse (out or in) orange ·
//   transfers, card payments, FX, asset and loan moves blue (money changing pockets).
import { fmtIDR } from "../../utils";

const KIND = { income: "in", expense: "out", pay_liability: "out", reimburse_out: "re", reimburse_in: "re" };
export const kindOf = e => KIND[e.tx_type] || "move";

// `text` lets a caller supply an already formatted amount (a foreign-currency statement).
export default function Amt({ e, value, text }) {
  return <span className={`mw-row-amt mw-amt-${kindOf(e)}`}>{text ?? fmtIDR(value ?? (e.amount_idr || e.amount))}</span>;
}
