const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(x=>x.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,amount,currency,entity,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const RE=/FX TRX|BELI VALAS|VALAS|MONEY CHANGER|SEVEN BANK|TARIK TUNAI|TUNAI ATM|ATM WITHDRAW|CASH WITHDRAW|PENARIKAN|WITHDRAWAL/i;
console.log('=== baris menyinggung valas / tarik tunai ===');
for(const r of led.filter(r=>RE.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(12)} ${(r.category_name||'-').slice(0,16).padEnd(16)} ${nm(r.from_id).padEnd(12)}→${nm(r.to_id)} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== expense yang mungkin BUKAN belanja (pindah uang / beli valas) ===');
const curi=/FX |VALAS|EUR|JPY|USD|SGD|SEVEN BANK|Money Changer/i;
for(const r of led.filter(r=>r.tx_type==='expense'&&+r.amount_idr>=3000000&&curi.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${(r.category_name||'-').slice(0,18).padEnd(18)} ${nm(r.from_id).padEnd(12)} | ${(r.description||'').slice(0,48)}`);
console.log('\n=== fx_exchange yang SUDAH tercatat benar ===');
for(const r of led.filter(r=>r.tx_type==='fx_exchange'))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,44)}`);
process.exit(0);})();
