/**
 * Pasang ulang empat kelompok Finalize listrik.
 *
 * Tiap setoran listrik semestinya melawan tagihan PLN Suryanto+Paulus BULAN
 * SEBELUMNYA (itu yang tertulis di deskripsi setorannya sendiri), bukan bulan
 * berjalan. Bentuk sekarang bahkan memasangkan setoran dengan tagihan yang
 * baru dibayar berminggu-minggu SESUDAH setorannya masuk.
 *
 * Baris Telkomsel ikut terserap padahal punya tagihan sendiri — dilepas.
 * Dry run: node rebuild_listrik.cjs   ·   Terapkan: --apply
 */
require('dotenv').config({path:'.env.local'});require('dotenv').config({path:'.secrets.local'});
const {createClient}=require('@supabase/supabase-js');
const rp=n=>Number(n||0).toLocaleString('id-ID');
const nil=r=>Number(r.amount_idr||r.amount||0);

// setoran → tagihan PLN yang semestinya dilawankan (bulan sebelumnya)
const RENCANA=[
  {grup:'000975cb', setoran:'2026-04-15', label:'Penggantian PLN MAR', tagihan:'2026-03'},
  {grup:'41a8abbf', setoran:'2026-05-13', label:'Penggantian PLN APR', tagihan:'2026-04'},
  {grup:'e3c97cca', setoran:'2026-06-22', label:'Penggantian PLN MEI', tagihan:'2026-05'},
  {grup:'31509073', setoran:'2026-07-02', label:'Penggantian PLN JUN', tagihan:'2026-06'},
];

(async()=>{
const apply=process.argv.includes('--apply');
const sb=createClient(process.env.REACT_APP_SUPABASE_URL,process.env.REACT_APP_SUPABASE_ANON_KEY);
await sb.auth.signInWithPassword({email:process.env.APP_EMAIL,password:process.env.APP_PASSWORD});

let led=[],from=0;
for(;;){const r=await sb.from('ledger').select('id,tx_date,description,amount,amount_idr,tx_type,entity,reimburse_settlement_id').range(from,from+999);
  if(r.error) return console.log('ERR',r.error.message);
  led=led.concat(r.data); if(r.data.length<1000)break; from+=1000;}
const {data:sets}=await sb.from('reimburse_settlements').select('*');
const cari=p=>sets.find(s=>s.id.startsWith(p));
const anggota=id=>led.filter(l=>l.reimburse_settlement_id===id);
const plnBulan=ym=>led.filter(l=>/PLN (Suryanto Salim|Paulus Iskandar)/i.test(l.description||'') && (l.tx_date||'').startsWith(ym));

const lepas=[],pindah=[],marginBaru=[];
for(const R of RENCANA){
  const s=cari(R.grup); const mem=anggota(s.id);
  const setoran=mem.find(m=>m.tx_type==='reimburse_in');
  const margin=mem.find(m=>m.tx_type==='income');
  const benar=plnBulan(R.tagihan);
  const salah=mem.filter(m=>m.tx_type==='reimburse_out');
  const totalBenar=benar.reduce((t,x)=>t+nil(x),0);
  const marginSeharusnya=nil(setoran)-totalBenar;

  console.log(`\n=== ${R.grup}  setoran ${R.setoran}  "${R.label}" ===`);
  console.log('  SEKARANG berisi:');
  salah.forEach(m=>console.log('   -',m.tx_date,String(rp(nil(m))).padStart(10),(m.description||'').slice(0,46)));
  console.log('   margin dibukukan',rp(nil(margin)));
  console.log('  SEMESTINYA berisi:');
  benar.forEach(m=>console.log('   +',m.tx_date,String(rp(nil(m))).padStart(10),(m.description||'').slice(0,46),
    m.reimburse_settlement_id===s.id?'(sudah di sini)':`(pindah dari ${(m.reimburse_settlement_id||'lepas').slice(0,8)})`));
  console.log('   margin jadi     ',rp(marginSeharusnya),' selisih',rp(marginSeharusnya-nil(margin)));

  salah.filter(m=>!benar.some(b=>b.id===m.id)).forEach(m=>lepas.push({...m,dari:R.grup}));
  benar.filter(m=>m.reimburse_settlement_id!==s.id).forEach(m=>pindah.push({...m,ke:s.id,keP:R.grup}));
  marginBaru.push({id:margin?.id,grup:R.grup,lama:nil(margin),baru:marginSeharusnya,setoran:nil(setoran),tagihan:totalBenar});
}

console.log('\n\n=== BARIS YANG DILEPAS (kembali ke daftar terbuka) ===');
lepas.forEach(m=>console.log('  ',m.tx_date,String(rp(nil(m))).padStart(10),'dari',m.dari,'|',(m.description||'').slice(0,50)));
console.log('   total',rp(lepas.reduce((t,x)=>t+nil(x),0)),`· ${lepas.length} baris`);

console.log('\n=== MARGIN ===');
let dl=0,db=0;
marginBaru.forEach(m=>{dl+=m.lama;db+=m.baru;console.log(`   ${m.grup}  ${String(rp(m.lama)).padStart(10)} → ${String(rp(m.baru)).padStart(10)}   (setoran ${rp(m.setoran)} − tagihan ${rp(m.tagihan)})`);});
console.log(`   jumlah ${rp(dl)} → ${rp(db)}   naik ${rp(db-dl)}`);

console.log('\n=== EFEK RAMBATAN ===');
const kena={};
pindah.forEach(m=>{const k=(m.reimburse_settlement_id||'').slice(0,8)||'lepas'; (kena[k]=kena[k]||[]).push(m);});
for(const [k,v] of Object.entries(kena)){
  if(RENCANA.some(R=>R.grup===k)) continue;
  const s=cari(k); const mem=s?anggota(s.id):[];
  const out=mem.filter(m=>['expense','reimburse_out'].includes(m.tx_type)).reduce((t,x)=>t+nil(x),0);
  const hil=v.reduce((t,x)=>t+nil(x),0);
  console.log(`   kelompok ${k} kehilangan ${rp(hil)} sisi Out (${rp(out)} → ${rp(out-hil)}) — kelompok ini jadi tidak seimbang`);
  v.forEach(m=>console.log('      ',m.tx_date,rp(nil(m)),(m.description||'').slice(0,45)));
}
console.log(`\n${pindah.length} baris pindah · ${lepas.length} dilepas · ${marginBaru.length} margin diperbarui`);
if(!apply) return console.log('\ndry run — belum ada yang diubah');
})();
