const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,to_id,from_id,reimburse_settlement_id,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== baris reimburse TANPA cap pelunasan ===');
for(const r of led.filter(r=>!r.reimburse_settlement_id))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,50)}`);
console.log('\n=== cek: kedua baris 11 Maret sekarang ===');
const{data:m}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).eq('tx_date','2026-03-11').in('amount_idr',[52000000,48000000]);
for(const r of m||[])console.log(`  ${rp(r.amount_idr)} → ${r.tx_type} entity=${r.entity} settle=${r.reimburse_settlement_id||'-'}`);
process.exit(0);})();
