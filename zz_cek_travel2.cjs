const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:x}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,currency,from_id,to_id,category_name,description,notes,source').eq('user_id',uid).or('description.ilike.%FX TRX%,description.ilike.%SEVEN BANK%,description.ilike.%TARIK TUNAI%,description.ilike.%TARIK%');
console.log('=== baris "beli valas" / "tarik tunai" yang tercatat sbg expense ===');
for(const r of (x||[]).filter(r=>r.tx_type==='expense'))
  console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(12)} kat=${(r.category_name||'-').padEnd(12)} ${nm(r.from_id)}→${nm(r.to_id)} src=${r.source} | ${(r.description||'').slice(0,55)}`);
console.log('\n(pembanding) baris serupa yg TIDAK expense:');
for(const r of (x||[]).filter(r=>r.tx_type!=='expense'))
  console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(12)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,50)}`);
// semua penarikan tunai tercatat sbg expense
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,category_name,description').eq('user_id',uid).eq('tx_type','expense').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const tunai=led.filter(r=>/TARIK TUNAI|ATM|CASH WITHDRAW|SEVEN BANK|PENARIKAN/i.test(r.description||''));
console.log('\npenarikan tunai tercatat sbg expense:',tunai.length,'=',rp(tunai.reduce((s,r)=>s+ +r.amount_idr,0)));
for(const r of tunai.slice(0,8))console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.category_name} | ${(r.description||'').slice(0,45)}`);
const fxb=led.filter(r=>/FX TRX|FOR FX|BELI (EUR|USD|JPY|SGD)|EXCHANGE/i.test(r.description||''));
console.log('\npembelian valas tercatat sbg expense:',fxb.length,'=',rp(fxb.reduce((s,r)=>s+ +r.amount_idr,0)));
for(const r of fxb)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.category_name} | ${(r.description||'').slice(0,50)}`);
process.exit(0);})();
