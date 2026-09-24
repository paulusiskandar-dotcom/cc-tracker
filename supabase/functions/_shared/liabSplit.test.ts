import { findLiabSplit } from "./liabSplit.ts";
const L = [{ id: "byd", name: "BYD Seal", monthly_installment: 11093000, pay_from_id: "bca", pay_via: "blibli" }];
Deno.test("BYD via Blibli: instalment + fee", () => {
  const r = findLiabSplit({ amount: 11102500, merchant_name: "Blibli", from_account_id: "bca" }, L);
  if (!r || r.pokok !== 11093000 || r.fee !== 9500) throw new Error(JSON.stringify(r));
  if (findLiabSplit({ amount: 11102500, merchant_name: "Tokopedia", from_account_id: "bca" }, L)) throw new Error("wrong merchant matched");
  if (findLiabSplit({ amount: 11102500, merchant_name: "Blibli", from_account_id: "jenius" }, L)) throw new Error("wrong bank matched");
  if (findLiabSplit({ amount: 11200000, merchant_name: "Blibli", from_account_id: "bca" }, L)) throw new Error("fee too large matched");
  if (findLiabSplit({ amount: 11093000, merchant_name: "Blibli", from_account_id: "bca" }, L)?.fee !== 0) throw new Error("exact instalment should split with fee 0");
});
