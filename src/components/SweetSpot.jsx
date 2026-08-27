import { useMemo, useState } from "react";
import { Plane, CreditCard, TrendingUp, AlertTriangle } from "lucide-react";
import { fmtIDR } from "../utils";
import { CARD_RULES, MILES_VALUE_IDR, txGroup, pickRule, ruleValue, bestCardFor } from "../lib/milesRules";

const FF = "Figtree, system-ui, -apple-system, sans-serif";
const GROUPS = [
  { key: "online",  label: "Online / Marketplace" },
  { key: "general", label: "General (offline & lainnya)" },
  { key: "fx",      label: "Luar Negeri (FX)" },
  { key: "travel",  label: "Travel (tiket & hotel)" },
  { key: "dining",  label: "Dining" },
];
const fmtMiles = (m) => Math.round(m).toLocaleString("id-ID");

export default function SweetSpot({ ledger = [], accounts = [] }) {
  const [months, setMonths] = useState(3);

  const cards = useMemo(() => accounts.filter(a => a.type === "credit_card"), [accounts]);
  const cardById = useMemo(() => Object.fromEntries(cards.map(c => [c.id, c])), [cards]);

  // Card spend rows in the window (expense + reimburse_out — reimbursed spend still earns miles).
  const rows = useMemo(() => {
    const since = new Date(); since.setMonth(since.getMonth() - months);
    const cut = since.toISOString().slice(0, 10);
    return (ledger || []).filter(r =>
      (r.tx_type === "expense" || r.tx_type === "reimburse_out") &&
      cardById[r.from_id] && r.tx_date >= cut);
  }, [ledger, cardById, months]);

  // Actual: miles earned as-is. Optimal: same spend on the best owned card per group.
  const analysis = useMemo(() => {
    const perCard = {}; const perGroup = {};
    let actualValue = 0, optimalValue = 0, actualMiles = 0;
    for (const r of rows) {
      const amt = Number(r.amount_idr || r.amount || 0);
      const cardName = cardById[r.from_id]?.name;
      const g = txGroup(r);
      const rule = pickRule(cardName, g, r.description);
      const v = ruleValue(rule, amt);
      const best = bestCardFor(g, r.description);
      const bv = best ? ruleValue(best.rule, amt) : { valueIdr: 0, miles: 0 };
      actualValue += v.valueIdr; actualMiles += v.miles;
      optimalValue += Math.max(bv.valueIdr, v.valueIdr);
      perCard[cardName] = perCard[cardName] || { spend: 0, miles: 0, cashback: 0, valueIdr: 0, program: rule?.program };
      perCard[cardName].spend += amt; perCard[cardName].miles += v.miles;
      perCard[cardName].cashback += v.cashback; perCard[cardName].valueIdr += v.valueIdr;
      perGroup[g] = perGroup[g] || { spend: 0, actual: 0, optimal: 0, bestCard: best?.card };
      perGroup[g].spend += amt; perGroup[g].actual += v.valueIdr;
      perGroup[g].optimal += Math.max(bv.valueIdr, v.valueIdr);
    }
    return { perCard, perGroup, actualValue, optimalValue, actualMiles };
  }, [rows, cardById]);

  const eff = analysis.optimalValue > 0 ? (analysis.actualValue / analysis.optimalValue) * 100 : 100;
  const missed = analysis.optimalValue - analysis.actualValue;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: FF }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#111827", display: "flex", alignItems: "center", gap: 10 }}>
            <Plane size={22} /> SweetSpot
          </div>
          <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
            Miles engine — kartu mana yang seharusnya dipakai, dan berapa miles yang kamu dapat.
          </div>
        </div>
        <select value={months} onChange={e => setMonths(Number(e.target.value))}
          style={{ height: 38, padding: "0 12px", borderRadius: 8, border: "0.5px solid #e5e7eb", fontSize: 13, fontFamily: FF, background: "#fff" }}>
          <option value={1}>1 bulan</option>
          <option value={3}>3 bulan</option>
          <option value={6}>6 bulan</option>
          <option value={12}>12 bulan</option>
        </select>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
        {[
          { label: "Estimasi miles didapat", value: fmtMiles(analysis.actualMiles), color: "#3b5bdb" },
          { label: "Nilai reward (IDR)", value: fmtIDR(analysis.actualValue), color: "#059669" },
          { label: "Efisiensi vs optimal", value: eff.toFixed(0) + "%", color: eff >= 80 ? "#059669" : "#d97706" },
          { label: "Nilai yang terlewat", value: fmtIDR(missed), color: "#dc2626" },
        ].map(k => (
          <div key={k.label} style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 14, padding: 14, borderTop: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>{k.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#111827", marginTop: 6 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Cheat sheet */}
      <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", display: "flex", alignItems: "center", gap: 8 }}>
          <CreditCard size={16} /> Pakai kartu ini
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2, marginBottom: 10 }}>
          Kartu terbaik milikmu per jenis belanja (KrisFlyer + Accor priority; angka = Rp per 1 mile, makin kecil makin bagus).
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
          {GROUPS.map(g => {
            const best = bestCardFor(g.key);
            const grp = analysis.perGroup[g.key];
            return (
              <div key={g.key} style={{ border: "0.5px solid #e5e7eb", borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>{g.label}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#111827", marginTop: 4 }}>{best?.card || "—"}</div>
                <div style={{ fontSize: 12, color: "#374151", marginTop: 2 }}>
                  {best?.rule?.rpm ? `Rp ${best.rule.rpm.toLocaleString("id-ID")}/mile` : best?.rule?.cashbackPct ? `${best.rule.cashbackPct}% cashback` : ""}
                  {best?.rule?.note ? ` — ${best.rule.note}` : ""}
                </div>
                {grp && <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 6 }}>
                  Belanjamu {months} bln: {fmtIDR(grp.spend)}{grp.bestCard && grp.actual < grp.optimal ? ` · terlewat ${fmtIDR(grp.optimal - grp.actual)}` : ""}
                </div>}
              </div>
            );
          })}
          {/* Corridor khusus */}
          <div style={{ border: "0.5px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#f9fafb" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 }}>Koridor spesial</div>
            <div style={{ fontSize: 12, color: "#374151", marginTop: 6, lineHeight: 1.7 }}>
              <b>SG / MY / TH / VN</b> → UOB (Rp 4.500/mile)<br />
              <b>Jepang / Korea / China / Taiwan</b> → CIMB JCB (4% cashback)<br />
              <b>FX lainnya</b> → Maybank VI (Rp 7.500/mile)
            </div>
          </div>
        </div>
      </div>

      {/* Per-card table */}
      <div style={{ background: "#fff", border: "0.5px solid #e5e7eb", borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <TrendingUp size={16} /> Miles per kartu ({months} bulan terakhir)
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Kartu</th>
                <th style={{ padding: "6px 8px" }}>Program</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Belanja</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Miles</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Cashback</th>
                <th style={{ padding: "6px 8px", textAlign: "right" }}>Nilai (IDR)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(analysis.perCard).sort((a, b) => b[1].spend - a[1].spend).map(([name, v]) => {
                const def = CARD_RULES.find(c => c.card === name);
                return (
                  <tr key={name} style={{ borderTop: "0.5px solid #f3f4f6" }}>
                    <td style={{ padding: "8px", fontWeight: 600, color: "#111827" }}>
                      {name}{def?.unverifiedRate && <AlertTriangle size={12} style={{ marginLeft: 6, verticalAlign: -1, color: "#d97706" }} />}
                    </td>
                    <td style={{ padding: "8px", color: "#6b7280" }}>{def?.program || "—"}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{fmtIDR(v.spend)}</td>
                    <td style={{ padding: "8px", textAlign: "right", fontWeight: 700, color: "#3b5bdb" }}>{fmtMiles(v.miles)}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{v.cashback ? fmtIDR(v.cashback) : "—"}</td>
                    <td style={{ padding: "8px", textAlign: "right" }}>{fmtIDR(v.valueIdr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={12} color="#d97706" />
          CIMB ALL (Accor) & Danamon JCB: rate earn belum terverifikasi — belum dihitung. Aturan per {CARD_RULES[0].asOf}; sumber SweetSpot/MILES PLAYBOOK 2026. Cap bulanan belum disimulasikan penuh.
        </div>
      </div>
    </div>
  );
}
