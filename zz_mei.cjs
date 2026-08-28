const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,to_type,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}

console.log('=== 1) SEMUA uang masuk 5–20 Mei (cari penggantian Henny utk tagihan 11 Mei 2.368.679) ===');
for(const r of led.filter(r=>r.tx_date>='2026-05-05'&&r.tx_date<='2026-05-20'&&r.to_type==='account'&&+r.amount_idr>=1000000))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} → ${nm(r.to_id).padEnd(9)} | ${(r.description||'').slice(0,52)}`);

console.log('\n=== 2) tiga nominal SDC — toleransi longgar (+-60.000) di SELURUH ledger ===');
for(const[a,label]of[[3215930,'Alice Dental'],[1950000,'Microsoft 365'],[5147838,'Internet Maret']]){
  const h=led.filter(r=>Math.abs(+r.amount_idr-a)<=60000&&r.tx_type!=='reimburse_in');
  console.log(`\n  ${label} ${rp(a)} — ${h.length} kandidat (selisih ditampilkan)`);
  for(const r of h)console.log(`     ${r.tx_date} ${rp(r.amount_idr).padStart(11)} (${(+r.amount_idr-a>0?'+':'')}${rp(+r.amount_idr-a)}) ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(14)} | ${(r.description||'').slice(0,40)}`);
}
console.log('\n=== 3) tagihan kartu 5–20 Jan / 5–20 Feb / 1–10 Mar antara 1,5jt dan 5,5jt ===');
for(const r of led.filter(r=>r.tx_type==='expense'&&+r.amount_idr>=1500000&&+r.amount_idr<=5500000&&accounts.find(a=>a.id===r.from_id)?.type==='credit_card'&&((r.tx_date>='2026-01-05'&&r.tx_date<='2026-01-20')||(r.tx_date>='2026-02-05'&&r.tx_date<='2026-02-20')||(r.tx_date>='2026-03-01'&&r.tx_date<='2026-03-10'))))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(14)} kat=${(r.category_name||'-').padEnd(22)} | ${(r.description||'').slice(0,40)}`);
process.exit(0);})();
