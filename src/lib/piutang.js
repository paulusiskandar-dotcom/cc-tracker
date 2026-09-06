// Satu rumus piutang untuk seluruh app (audit 6 Sep 2026).
//
// Sebelumnya ada empat rumus yang hidup berdampingan dan angkanya beda:
// halaman Receivables & calcNetWorth (out lepas − in lepas), Telegram /reimburse
// (out lepas saja), konteks AI (semua out − semua in tanpa finalize). Sekarang
// semuanya lewat sini.
//
// Dua angka per entitas:
//   saldo   = Σ reimburse_out − Σ reimburse_in − Σ kurang (expense Finalize) + Σ lebih
//             (income Finalize) — ini SALDO AKUNTANSI piutang, boleh negatif
//             (= entitas kelebihan bayar / Paulus berutang).
//   openOut / openIn = baris yang belum di-Match (open item) — untuk daftar kerja,
//             bukan untuk saldo. Setelah semua ter-Match, saldo == openOut − openIn.
//
// Baris Finalize dikenali dari reimburse_settlement_id + tx_type income/expense.

const nilai = (e) => Number(e.amount_idr ?? e.amount ?? 0);

export const hitungPiutang = (ledger = []) => {
  const per = {};
  const ent = (e) => {
    const k = e.entity || "?";
    if (!per[k]) per[k] = { out: 0, in: 0, kurang: 0, lebih: 0, openOut: 0, openIn: 0, saldo: 0, openNet: 0 };
    return per[k];
  };
  for (const e of ledger) {
    if (e.tx_type === "reimburse_out") {
      const p = ent(e); p.out += nilai(e);
      if (!e.reimburse_settlement_id) p.openOut += nilai(e);
    } else if (e.tx_type === "reimburse_in") {
      const p = ent(e); p.in += nilai(e);
      if (!e.reimburse_settlement_id) p.openIn += nilai(e);
    } else if (e.reimburse_settlement_id && e.tx_type === "expense") {
      ent(e).kurang += nilai(e);
    } else if (e.reimburse_settlement_id && e.tx_type === "income") {
      ent(e).lebih += nilai(e);
    }
  }
  let saldoTotal = 0, openTotal = 0;
  for (const p of Object.values(per)) {
    p.saldo = p.out - p.in - p.kurang + p.lebih;
    p.openNet = p.openOut - p.openIn;
    saldoTotal += p.saldo;
    openTotal += p.openNet;
  }
  return { perEntity: per, saldoTotal, openTotal };
};
