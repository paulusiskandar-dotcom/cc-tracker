// One way to show a transaction's amount on every phone list, by what kind of movement it is:
//   income            + green        expense / loan payment   − red
//   transfer, pay card, FX, asset and loan moves   ⇄ blue   (money changing pockets, not spent)
//   reimburse out     ↻ amber  (fronted for someone)         reimburse in   ↺ teal (paid back)
import { ArrowLeftRight, RotateCw, RotateCcw } from "lucide-react";
import { fmtIDR } from "../../utils";

const KIND = {
  income: "in", expense: "out", pay_liability: "out",
  reimburse_out: "rout", reimburse_in: "rin",
};
export const kindOf = e => KIND[e.tx_type] || "move";

export default function Amt({ e, value }) {
  const k = kindOf(e); const v = fmtIDR(value ?? (e.amount_idr || e.amount));
  return (
    <span className={`mw-row-amt mw-amt-${k}`}>
      {k === "move" && <ArrowLeftRight size={14} strokeWidth={2} aria-label="Transfer" />}
      {k === "rout" && <RotateCw size={14} strokeWidth={2} aria-label="Reimburse out" />}
      {k === "rin" && <RotateCcw size={14} strokeWidth={2} aria-label="Reimburse in" />}
      {k === "in" ? "+" : k === "out" ? "−" : ""}{v}
    </span>
  );
}
