const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,category_name,reimburse_settlement_id,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}

console.log('=== 1) cari tagihan pasangan pemasukan SDC Jan-Mei (nominal sama, +-60 hari) ===');
const target=[['2026-01-15',3215930,'Alice Dental'],['2026-02-16',1950000,'Microsoft 365'],['2026-02-20',387390,'Internet Feb'],['2026-03-07',5147838,'Internet Mar'],['2026-05-12',387390,'Internet Mei']];
for(const[d,amt,label]of target){
  console.log(`\n  -- ${label} ${rp(amt)} (masuk ${d})`);
  const cand=led.filter(r=>Math.abs(+r.amount_idr-amt)<1&&r.tx_type!=='reimburse_in'&&Math.abs(new Date(r.tx_date)-new Date(d))/864e5<=60);
  if(!cand.length)console.log('     tidak ada nominal yang sama sama sekali');
  for(const r of cand)console.log(`     ${r.tx_date} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id).padEnd(14)} kat=${(r.category_name||'-').padEnd(20)} | ${(r.description||'').slice(0,44)}`);
}

console.log('\n=== 2) semua baris bernilai 2.368.679 ===');
for(const r of led.filter(r=>+r.amount_idr===2368679))
  console.log(`  ${r.tx_date} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)} ${r.reimburse_settlement_id?'lunas':'BUKA '} | ${(r.description||'').slice(0,54)}`);

console.log('\n=== 3) dua baris 1.750.000 tanggal 3 Agustus — masuk ke bank mana ===');
for(const r of led.filter(r=>+r.amount_idr===1750000&&r.tx_date>='2026-07-25'&&r.tx_date<='2026-08-10'))
  console.log(`  ${r.id.slice(0,8)} ${r.tx_date} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)} → ${nm(r.to_id)}\n      ${(r.description||'').slice(0,80)}`);
process.exit(0);})();
