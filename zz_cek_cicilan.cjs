const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== 3 baris bernominal POKOK PENUH — apakah ada kredit penyeimbang (pola wash BRI)? ===');
for(const a of [6738925,10659590,10328301]){
  const rows=led.filter(r=>Math.abs(+r.amount_idr-a)<1);
  console.log(`\n ${rp(a)}: ${rows.length} baris di ledger`);
  for(const r of rows)console.log(`   ${r.tx_date} ${r.tx_type.padEnd(9)} ${nm(r.from_id)}→${nm(r.to_id)} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,52)}`);
}
console.log('\n=== berapa kali tiap angsuran bulanan muncul (harusnya <= 12) ===');
for(const a of [131588,268349,151380,467931,483393,357878,2706631,723533,273654,260808,529625,957615,735083]){
  const rows=led.filter(r=>Math.abs(+r.amount_idr-a)<1&&r.tx_type==='expense');
  console.log(`  ${rp(a).padStart(11)} × ${String(rows.length).padStart(2)}  ${rows.map(r=>r.tx_date.slice(5)).join(' ')}`);
}
console.log('\n=== Oakley Meta: dibeli 2× — adakah refund/pembatalan? ===');
const ok=led.filter(r=>r.tx_date>='2026-02-01'&&r.tx_date<='2026-03-15'&&(Math.abs(+r.amount_idr-10328301)<1||Math.abs(+r.amount_idr-10659590)<1||(r.tx_type==='income'&&+r.amount_idr>9000000)));
for(const r of ok)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(9)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,50)}`);
console.log('\n=== total nilai angsuran cicilan Tokopedia di ledger ===');
const cic=led.filter(r=>r.tx_type==='expense'&&/CCL12|CCL/i.test(r.description||''));
console.log(`  ${cic.length} baris = ${rp(cic.reduce((s,r)=>s+ +r.amount_idr,0))}`);
process.exit(0);})();
