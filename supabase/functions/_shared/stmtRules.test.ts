// Real statement lines, one block per bank. Run: deno test supabase/functions/_shared/stmtRules.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { parseInstalment, isMonthlyFee, isConversionCredit, findWashPairs, gapIsRounding, findMerchant, merchantStat, canAutoBook } from "./stmtRules.ts";

Deno.test("instalment markers, every bank", () => {
  const yes: [string, number, number][] = [
    ["TOKOPEDIA_CYBS_CCL06 : 3/6", 3, 6],                          // BRI
    ["99_TOKOPEDIA_CYBS_CCL12_2 : 10/12", 10, 12],                 // BRI, digits in the merchant code
    ["TOKOPEDIA_CYBS_CCL12 : 12/12", 12, 12],                      // BRI last leg
    ["WHOP*TOMTRADES Newar 10/ 12", 10, 12],                       // CIMB
    ["(0.00% 12BLN) 7/ 12", 7, 12],                                // CIMB, no merchant name
    ["SURUGAYA UMEDACHIYAYAM OSAKA 3/ 12", 3, 12],                 // CIMB
    ["WWW.BLIBLI.COM 1/ 12", 1, 12],                               // CIMB
    ["ERASPACE.COM Jakar 012/024", 12, 24],                        // Mandiri, zero padded
    ["ERASPACE.COM Jakar 007/024", 7, 24],
    ["SAMSUNGESTOREGDN JAKAR :001/003", 1, 3],                     // Maybank
    ["CICILAN BCA KE 02 DARI 03, TRIP.COM NON", 2, 3],             // BCA, in words
    ["TOKOPEDIA_CYBS_CCL06 : 0/6", 0, 6],                          // BRI conversion credit
  ];
  for (const [d, n, tot] of yes) assertEquals(parseInstalment(d), { n, tot }, d);
  const no = [
    "DIGITALOCEAN.COM AMSTERDAM NL (USD 62,16 X 1", "SHOPEE.CO.ID 0%*AP1260624 JAKARTA BARAT ID",
    "ANTHROPIC +14152360599 USCA (USD 15.00) (USD", "GoPayID DKI Jakarta ID", "BIAYA E-STATEMENT July 2026",
    "LEGO Store, FS Berlin Berlin DEU BILLED AS EUR 259.98(1 EUR = 20015.49 IDR)",
    "PEMBAYARAN - MYBCA 12/09", "Grab* A-9JKXRLIWWND8AV South Jakarta ID", "TRIP.COM NON 3DS JAKARTA SELATID",
    "SURUGAYA UMEDACHIYAYAM OSAKA JPN - JPY 80909 @ 113.68",
  ];
  for (const d of no) assertEquals(parseInstalment(d), null, d);
});

Deno.test("monthly fees, every bank", () => {
  const yes: [string, number][] = [
    ["BEA METERAI LUNAS BULAN LALU", 10000], ["XA BIAYA NOTIFIKASI", 10000], ["XA BIAYA E-BILLING STATEMENT", 2500],   // Maybank
    ["TRX NOTIFICATION CHARGE", 7500], ["E-BILLING STATEMENT CHRGE", 5000],                                          // Mandiri
    ["BIAYA E-STATEMENT July 2026", 5000], ["BIAYA NOTIFIKASI SMS", 10000], ["BIAYA PEMBAYARAN BANK LAIN", 9000],      // Skorcard
    ["BIAYA LAYANAN NOTIFIKASI", 10000], ["STAMP DUTY FEE", 10000],                                                  // Jenius
    ["E-STATEMENT FEE", 5000], ["BIAYA NOTIFIKASI", 7500], ["BIAYA EMAIL STATEMENT", 7500],                                                           // UOB, BRI
  ];
  for (const [d, a] of yes) assertEquals(isMonthlyFee(d, a), true, d);
  assertEquals(isMonthlyFee("BIAYA NOTIFIKASI", 250000), false, "over the cap");
  assertEquals(isMonthlyFee("GoPayID DKI Jakarta ID", 5000), false, "small purchase is not a fee");
  assertEquals(isMonthlyFee("Grab* bef8324e42a17e9c South Jakarta ID", 9000), false);
});

Deno.test("conversion wash pairs", () => {
  assertEquals(isConversionCredit("TOKOPEDIA_CYBS_CCL06 : 0/6"), true);
  assertEquals(isConversionCredit("REVERSAL CICILAN BCA TRIP.COM NON 3DS"), true);
  assertEquals(isConversionCredit("XM SAMSUNGESTOREGDN JAKAR"), true);
  assertEquals(isConversionCredit("TRIP.COM NON 3DS JAKARTA SELATID (refund/CR)"), false, "a real refund is not a conversion");
  const rows = [
    { _id: "a", date: "2026-09-10", description: "Retail IDN Jakarta TOKOPEDIA_CYBS_CCL06", amount: 3930423, direction: "out" },
    { _id: "b", date: "2026-09-10", description: "TOKOPEDIA_CYBS_CCL06 : 0/6", amount: 3930423, direction: "in" },
    { _id: "c", date: "2026-09-10", description: "TOKOPEDIA_CYBS_CCL06 : 1/6", amount: 655071, direction: "out" },
    { _id: "d", date: "2026-06-24", description: "TRIP.COM NON 3DS JAKARTA SELATAN ID", amount: 12621680, direction: "out" },
    { _id: "e", date: "2026-07-07", description: "REVERSAL CICILAN BCA TRIP.COM NON 3DS", amount: 12621680, direction: "in" },
    { _id: "f", date: "2026-07-23", description: "SAMSUNGESTOREGDN Jakarta PusatID", amount: 24999000, direction: "out" },
    { _id: "g", date: "2026-07-29", description: "XM SAMSUNGESTOREGDN JAKAR", amount: 24999000, direction: "in" },
    { _id: "h", date: "2026-08-07", description: "TRIP.COM NON 3DS JAKARTA SELATID", amount: 3747559, direction: "out" },
    { _id: "i", date: "2026-08-30", description: "TRIP.COM NON 3DS JAKARTA SELATID (refund/CR)", amount: 3747559, direction: "in" },
  ];
  const pairs = findWashPairs(rows).map((p) => p.retail._id + p.credit._id).sort();
  assertEquals(pairs, ["ab", "de", "fg"], "BRI, BCA and Maybank pairs; the real Trip.com refund (h,i) is NOT a wash");
});

Deno.test("finalize tolerance", () => {
  assertEquals(gapIsRounding(1), true); assertEquals(gapIsRounding(-5), true); assertEquals(gapIsRounding(6), false);
});

Deno.test("auto-book only unambiguous merchants", () => {
  const names = ["gopay", "grab", "tokopedia", "gojek", "bca", "xxi nsr"];
  assertEquals(findMerchant("GoPayID DKI Jakarta ID", names), "gopay");
  assertEquals(findMerchant("Grab* A-9JKXRLIWWND8AV South Jakarta ID", names), "grab");
  assertEquals(findMerchant("GOJEK RECURRING NON3DS JAKARTA SELATAN ID", names), "gojek");
  assertEquals(findMerchant("SURUGAYA UMEDACHIYAYAM OSAKA", names), null);
  const hist = (text: string, n: number, tx_type = "expense", cat = "food", is_reimburse = false) => Array.from({ length: n }, () => ({ text, tx_type, is_reimburse, category_id: cat, category_name: cat }));
  const gopay = merchantStat("gopay", hist("GoPayID DKI Jakarta ID", 20));
  assertEquals(canAutoBook(gopay, 84700), true, "20 plain food expenses");
  assertEquals(canAutoBook(gopay, 2_500_000), false, "over the cap");
  const few = merchantStat("grab", hist("Grab* x", 3));
  assertEquals(canAutoBook(few, 50000), false, "fewer than 5 earlier rows");
  const mixed = merchantStat("xxi nsr", [...hist("XXI NSR", 5, "expense", "fun"), ...hist("XXI NSR", 5, "expense", "food")]);
  assertEquals(canAutoBook(mixed, 50000), false, "no dominant category");
  const reimb = merchantStat("tokopedia", [...hist("Tokopedia", 10), ...hist("Tokopedia", 10, "reimburse_out", "", true)]);
  assertEquals(canAutoBook(reimb, 50000), false, "marketplace, and half of it is reimburse");
  const cleanTokped = merchantStat("tokopedia", hist("Tokopedia", 30));
  assertEquals(canAutoBook(cleanTokped, 50000), false, "a marketplace is never auto-booked, whatever its history");
});
