// ─── PEMECAHAN SATU TRANSAKSI ────────────────────────────────
// Satu tagihan kartu sering memuat beberapa hal berbeda (kategori atau entitas
// yang berlainan). Memecahnya di sini AMAN untuk rekonsiliasi selama tiga syarat
// dijaga — lihat komentar splitLedgerEntry di src/api.js: satu split_group_id,
// jumlah PERSIS sama, akun & tanggal tetap. Layar ini menegakkan syarat kedua;
// dua lainnya dijaga oleh API-nya.
import { useState, useEffect, useMemo } from "react";
import Modal from "./Modal";
import { splitLedgerEntry } from "../../api";
import { fmtIDR } from "../../utils";
import { ENTITIES } from "../../constants";
import { showToast } from "./Card";
import { Plus, Trash2 } from "lucide-react";

const KOTAK = {
  height: 32, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0 8px",
  fontSize: 12, fontFamily: "Figtree, sans-serif", background: "#fff", color: "#374151",
  width: "100%", boxSizing: "border-box",
};
// Arah uang harus sama dengan transaksi aslinya — lihat splitLedgerEntry.
// Satu tagihan boleh separuh biaya pribadi, separuh piutang (kasus Siti Sarnah).
const JENIS = {
  expense:       "Expense",
  reimburse_out: "Reimburse out",
  income:        "Income",
  reimburse_in:  "Reimburse in",
};
const ARAH_KELUAR = ["expense", "reimburse_out"];
const ARAH_MASUK  = ["income", "reimburse_in"];
const isReimburse = (t) => t === "reimburse_out" || t === "reimburse_in";
const ribuan = (v) => {
  const d = String(v ?? "").replace(/[^\d]/g, "");
  return d ? Number(d).toLocaleString("id-ID") : "";
};

const LABEL = {
  fontSize: 9, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.5px",
  textTransform: "uppercase", fontFamily: "Figtree, sans-serif", marginBottom: 3,
};

export default function SplitModal({ isOpen, onClose, entry, categories = [], tags = [], onDone }) {
  const total = Math.round(Number(entry?.amount_idr ?? entry?.amount ?? 0));
  const [parts, setParts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !entry) return;
    const dasar = {
      description: entry.description || "", tx_type: entry.tx_type,
      category_id: entry.category_id || "", entity: entry.entity || "Personal", tag_id: "",
    };
    setParts([
      { ...dasar, amount: String(total), tag_id: entry.tag_id || "" },
      { ...dasar, amount: "" },
    ]);
  }, [isOpen, entry, total]);

  const angka = (v) => Math.round(Number(String(v).replace(/[^\d-]/g, "")) || 0);
  const jumlah = useMemo(() => parts.reduce((s, p) => s + angka(p.amount), 0), [parts]);
  const sisa   = total - jumlah;
  const bisa   = parts.length >= 2 && sisa === 0 && parts.every(p => angka(p.amount) > 0);

  const ubah = (i, k, v) => setParts(ps => ps.map((p, j) => j === i ? { ...p, [k]: v } : p));
  const tambah = () => setParts(ps => [...ps, {
    amount: String(Math.max(0, sisa)), description: entry?.description || "",
    tx_type: entry?.tx_type, category_id: entry?.category_id || "",
    entity: entry?.entity || "Personal", tag_id: "",
  }]);
  const jenisBoleh = ARAH_KELUAR.includes(entry?.tx_type) ? ARAH_KELUAR
                   : ARAH_MASUK.includes(entry?.tx_type)  ? ARAH_MASUK
                   : [entry?.tx_type];
  const buang = (i) => setParts(ps => ps.length > 2 ? ps.filter((_, j) => j !== i) : ps);

  // Sisa dilempar ke bagian TERAKHIR, bukan dibagi rata: pembagian rata menimbulkan
  // pembulatan yang membuat jumlahnya meleset dari nominal statement.
  const rapikan = () => setParts(ps => {
    if (!ps.length) return ps;
    const lain = ps.slice(0, -1).reduce((s, p) => s + angka(p.amount), 0);
    return ps.map((p, j) => j === ps.length - 1 ? { ...p, amount: String(total - lain) } : p);
  });

  const simpan = async () => {
    setSaving(true);
    try {
      const kat = (id) => categories.find(c => c.id === id);
      const hasil = await splitLedgerEntry(entry.id, parts.map(p => ({
        amount: angka(p.amount),
        description: p.description?.trim() || entry.description,
        tx_type: p.tx_type || entry.tx_type,
        category_id: p.category_id || null,
        category_name: kat(p.category_id)?.name || null,
        entity: p.entity,
        tag_id: p.tag_id || null,
      })));
      showToast(`Split into ${parts.length} parts`);
      onDone?.(hasil);
      onClose();
    } catch (e) {
      showToast(e.message || "Split failed", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!entry) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Split transaction"
      width={720}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, width: "100%" }}>
          <div style={{ fontSize: 12, fontFamily: "Figtree, sans-serif", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "#9ca3af" }}>Remaining </span>
            <span style={{ fontWeight: 800, color: sisa === 0 ? "#059669" : "#dc2626" }}>
              {sisa === 0 ? "Rp 0" : `${sisa > 0 ? "" : "−"}${fmtIDR(Math.abs(sisa))}`}
            </span>
            {sisa !== 0 && (
              <button onClick={rapikan}
                style={{ marginLeft: 10, height: 26, padding: "0 10px", border: "1px solid #e5e7eb",
                         borderRadius: 6, background: "#fff", color: "#374151", fontSize: 11,
                         fontWeight: 600, cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>
                Put remainder in last part
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}
              style={{ height: 34, padding: "0 16px", border: "1px solid #e5e7eb", borderRadius: 8,
                       background: "#fff", color: "#374151", fontSize: 13, fontWeight: 600,
                       cursor: "pointer", fontFamily: "Figtree, sans-serif" }}>Cancel</button>
            <button onClick={simpan} disabled={!bisa || saving}
              style={{ height: 34, padding: "0 18px", border: "none", borderRadius: 8,
                       background: bisa && !saving ? "#3b5bdb" : "#e5e7eb",
                       color: bisa && !saving ? "#fff" : "#9ca3af", fontSize: 13, fontWeight: 700,
                       cursor: bisa && !saving ? "pointer" : "not-allowed", fontFamily: "Figtree, sans-serif" }}>
              {saving ? "Splitting…" : `Split into ${parts.length}`}
            </button>
          </div>
        </div>
      }
    >
      <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "Figtree, sans-serif", marginBottom: 4 }}>
        {entry.description} · {entry.tx_date}
      </div>
      <div style={{ fontSize: 20, fontWeight: 900, color: "#111827", fontFamily: "Figtree, sans-serif", marginBottom: 12 }}>
        {fmtIDR(total)}
      </div>
      {/* Akun dan tanggal SENGAJA tidak bisa diubah: pencocokan statement menjumlahkan
          bagian-bagian ini per akun dan menuntut salah satunya dekat tanggal statement. */}
      <div style={{ fontSize: 11, color: "#9ca3af", fontFamily: "Figtree, sans-serif", marginBottom: 14 }}>
        Account and date stay as they are — statement matching adds the parts back up.
      </div>

      {parts.map((p, i) => (
        <div key={i} style={{ border: "0.5px solid #e5e7eb", borderRadius: 10, padding: 10, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "#374151", fontFamily: "Figtree, sans-serif" }}>
              Part {i + 1}
            </span>
            {parts.length > 2 && (
              <button onClick={() => buang(i)} title="Remove"
                style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer", color: "#9ca3af", display: "flex" }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={LABEL}>Amount</div>
              <input value={ribuan(p.amount)} inputMode="numeric"
                onChange={e => ubah(i, "amount", e.target.value.replace(/[^\d]/g, ""))}
                style={{ ...KOTAK, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
            </div>
            <div>
              <div style={LABEL}>Description</div>
              <input value={p.description} onChange={e => ubah(i, "description", e.target.value)} style={KOTAK} />
            </div>
          </div>
          {/* Entitas hanya bermakna pada baris reimburse — sama seperti form transaksi.
              Selain itu entitasnya selalu Personal, jadi tidak ditawarkan. */}
          <div style={{ display: "grid",
                        gridTemplateColumns: isReimburse(p.tx_type) ? "150px 120px 1fr" : "150px 1fr 1fr",
                        gap: 8 }}>
            <div>
              <div style={LABEL}>Type</div>
              <select value={p.tx_type} disabled={jenisBoleh.length < 2}
                onChange={e => ubah(i, "tx_type", e.target.value)} style={KOTAK}>
                {jenisBoleh.map(t => <option key={t} value={t}>{JENIS[t] || t}</option>)}
              </select>
            </div>
            {isReimburse(p.tx_type) ? (
              <div>
                <div style={LABEL}>Entity</div>
                <select value={p.entity} onChange={e => ubah(i, "entity", e.target.value)} style={KOTAK}>
                  {ENTITIES.map(en => <option key={en} value={en}>{en}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <div style={LABEL}>Category</div>
                <select value={p.category_id} onChange={e => ubah(i, "category_id", e.target.value)} style={KOTAK}>
                  <option value="">—</option>
                  {[...categories].sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <div style={LABEL}>Tag</div>
              <select value={p.tag_id} onChange={e => ubah(i, "tag_id", e.target.value)} style={KOTAK}>
                <option value="">—</option>
                {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      ))}

      <button onClick={tambah}
        style={{ height: 32, padding: "0 12px", border: "1px dashed #d1d5db", borderRadius: 8,
                 background: "#fff", color: "#374151", fontSize: 12, fontWeight: 600, cursor: "pointer",
                 fontFamily: "Figtree, sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
        <Plus size={13} /> Add part
      </button>
    </Modal>
  );
}
