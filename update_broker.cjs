/**
 * Selaraskan nilai portofolio Ajaib & Mirae dengan laporan bulanan broker.
 * Dry run: node update_broker.cjs   ·   Terapkan: --apply
 */
require('dotenv').config({path:'.env.local'});require('dotenv').config({path:'.secrets.local'});
const {createClient}=require('@supabase/supabase-js');
const rp=n=>Number(n||0).toLocaleString('id-ID');

// Dibaca dari laporan 31 Jul 2026. Modal = Stock Value, nilai = Market Value.
// Kas RDN TIDAK dimasukkan di sini — ia sudah berdiri sendiri sebagai rekening
// bank BCA RDN, jadi menambahkannya lagi berarti menghitung dua kali.
const LAPORAN=[
  {akun:'Ajaib', tgl:'2026-07-31', modal:73098100, nilai:48567100,
   isi:'BBRI 8.000 @4.692 · CTRA 18.100 @865 · PNLF 60.700 @328'},
  {akun:'Mirae Aset Sekuritas', tgl:'2026-07-31', modal:9695000, nilai:5594500,
   isi:'BBCA 500 @9.750 · BBRI 800 @6.025'},
];

(async()=>{
const apply=process.argv.includes('--apply');
const sb=createClient(process.env.REACT_APP_SUPABASE_URL,process.env.REACT_APP_SUPABASE_ANON_KEY);
const {data:auth}=await sb.auth.signInWithPassword({email:process.env.APP_EMAIL,password:process.env.APP_PASSWORD});
const {data:acc}=await sb.from('accounts').select('*').in('name',LAPORAN.map(x=>x.akun));
let geser=0;
for(const L of LAPORAN){
  const a=acc.find(x=>x.name===L.akun);
  if(!a){console.log('TIDAK KETEMU',L.akun);continue;}
  const lamaNilai=Number(a.current_value||0), lamaModal=Number(a.purchase_price||0);
  geser+=L.nilai-lamaNilai;
  console.log(`\n=== ${L.akun} (${L.tgl}) ===`);
  console.log(`  nilai pasar  ${rp(lamaNilai)} → ${rp(L.nilai)}`);
  console.log(`  modal di app ${rp(lamaModal)} · modal saham dipegang menurut broker ${rp(L.modal)} (TIDAK diubah)`);
  console.log(`  untung/rugi  ${rp(lamaNilai-lamaModal)} → ${rp(L.nilai-lamaModal)}`);
  console.log(`  isi          ${L.isi}`);
  if(!apply) continue;
  // Hanya nilai pasar yang disentuh. "Stock Value" di laporan broker adalah
  // modal saham yang MASIH dipegang, bukan total uang yang pernah disetor —
  // menimpanya akan menghapus jejak rugi yang sudah terealisasi.
  const {error}=await sb.from('accounts').update({
    current_value:L.nilai,
    notes:`Portofolio per ${L.tgl}: ${L.isi}. Kas RDN dicatat terpisah di rekening BCA RDN.`,
  }).eq('id',a.id);
  if(error){console.log('  GAGAL',error.message);continue;}
  const {error:e2}=await sb.from('asset_value_history').insert([{
    user_id:auth.user.id, account_id:a.id, old_value:lamaNilai, new_value:L.nilai,
    date:L.tgl, notes:`Laporan broker ${L.tgl} — ${L.isi}`}]);
  if(e2) console.log('  riwayat gagal:',e2.message);
}
console.log(`\ndampak ke kekayaan bersih: ${geser>=0?'+':''}${rp(geser)}`);
console.log(apply?'selesai':'dry run — tambahkan --apply');
})();
