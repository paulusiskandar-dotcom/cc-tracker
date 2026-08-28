// Tiga kelompok pelunasan rusak: isinya baris entitas Personal (penggantian pajak
// Henny yang tadi dipindah dari SDC/Hamasa) tapi kelompoknya masih beratribut
// entitas lama, dan tidak punya sisi Out sama sekali.
// Tindakan: lepas cap dari barisnya → kembali ke kolam terbuka Personal supaya
// Paulus bisa memasangkannya sendiri lewat Finalize. Hapus kelompoknya.
// Sisa baris Reimbursable Surplus 31.321 di salah satunya ikut dihapus.
const fs=require('fs'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require(B+'app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
const TARGET=['1ce6f92c','6a598097','652ce7d4'];
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const{data:sets}=await supabase.from('reimburse_settlements').select('*').eq('user_id',uid);
const pilih=(sets||[]).filter(s=>TARGET.some(t=>s.id.startsWith(t)));
if(pilih.length!==3){console.log('!! ketemu',pilih.length,'kelompok, harus 3 — BATAL');process.exit(1);}
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('*').eq('user_id',uid).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const lepas=[],hapus=[];
for(const s of pilih){
  for(const r of led.filter(x=>x.reimburse_settlement_id===s.id)){
    // baris sisa Reimbursable Surplus dihapus; baris reimburse dilepas capnya
    if(r.tx_type==='income'&&/Reimbursable Surplus/i.test(r.description||''))hapus.push(r);
    else lepas.push(r);
  }
}
console.log('cap dilepas (kembali ke kolam terbuka):');
for(const r of lepas)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type} ent=${r.entity} | ${(r.description||'').slice(0,44)}`);
console.log('\nbaris dihapus (sisa mekanisme lama):');
for(const r of hapus)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} | ${(r.description||'').slice(0,44)}`);
console.log(`\nkelompok dihapus: ${pilih.map(s=>s.id.slice(0,8)).join(', ')}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync(B+'.backups',{recursive:true});
fs.writeFileSync(B+`.backups/bersih3-${Date.now()}.json`,JSON.stringify({pilih,lepas,hapus},null,2));
for(const r of lepas)await supabase.from('ledger').update({reimburse_settlement_id:null}).eq('id',r.id);
for(const r of hapus)await supabase.from('ledger').delete().eq('id',r.id);
for(const s of pilih)await supabase.from('reimburse_settlements').delete().eq('id',s.id);
console.log(`\n- ${lepas.length} cap dilepas, ${hapus.length} baris dihapus, ${pilih.length} kelompok dihapus`);
let l2=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);l2=l2.concat(c||[]);if(!c||c.length<1000)break;}
console.log('\npiutang BERJALAN (belum di-Finalize):');
for(const e of['Hamasa','SDC','Personal']){
  const f=r=>r.entity===e&&!r.reimburse_settlement_id;
  const o=l2.filter(r=>f(r)&&r.tx_type==='reimburse_out').reduce((s,r)=>s+ +r.amount_idr,0);
  const i=l2.filter(r=>f(r)&&r.tx_type==='reimburse_in').reduce((s,r)=>s+ +r.amount_idr,0);
  console.log(`  ${e.padEnd(9)} keluar ${rp(o).padStart(12)} masuk ${rp(i).padStart(12)} = ${rp(o-i)}`);
}
const{count}=await supabase.from('reimburse_settlements').select('id',{count:'exact',head:true}).eq('user_id',uid);
console.log(`\nkelompok Finalized tersisa: ${count}`);
process.exit(0);})();
