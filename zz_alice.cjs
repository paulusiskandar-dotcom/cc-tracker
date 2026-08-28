const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const cards=accounts.filter(a=>a.type==='credit_card');
const D0='2025-12-10',D1='2026-01-20';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,from_id,description').eq('user_id',uid).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,account_id,status').eq('user_id',uid).range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}

console.log('=== nilai PERSIS 3.215.930 sebagai uang keluar, di mana pun, kapan pun ===');
const a1=led.filter(r=>+r.amount_idr===3215930&&r.tx_type!=='reimburse_in');
const a2=st.filter(r=>+r.amount===3215930&&r.direction==='out');
console.log(`  ledger: ${a1.length} | staging: ${a2.length}`);
for(const r of a1)console.log(`     LEDGER  ${r.tx_date} ${r.tx_type} ${nm(r.from_id)} | ${(r.description||'').slice(0,50)}`);
for(const r of a2)console.log(`     STAGING ${r.tx_date} ${nm(r.account_id)} ${r.status} | ${(r.description||'').slice(0,50)}`);

console.log(`\n=== SEMUA tagihan kartu kredit 3,0–3,4jt, ${D0} s/d ${D1} (ledger + staging) ===`);
const rows=[];
for(const r of led.filter(r=>cards.some(c=>c.id===r.from_id)&&+r.amount_idr>=3000000&&+r.amount_idr<=3400000&&r.tx_date>=D0&&r.tx_date<=D1))
  rows.push({d:r.tx_date,a:+r.amount_idr,k:nm(r.from_id),s:'ledger',x:r.description});
for(const r of st.filter(r=>cards.some(c=>c.id===r.account_id)&&r.direction==='out'&&+r.amount>=3000000&&+r.amount<=3400000&&r.tx_date>=D0&&r.tx_date<=D1))
  rows.push({d:r.tx_date,a:+r.amount,k:nm(r.account_id),s:r.status,x:r.description});
rows.sort((p,q)=>p.d<q.d?-1:1);
for(const r of rows)console.log(`  ${r.d} ${rp(r.a).padStart(11)} (${r.a-3215930>0?'+':''}${rp(r.a-3215930)}) ${r.k.padEnd(14)} ${r.s.padEnd(10)} | ${(r.x||'').slice(0,40)}`);

console.log(`\n=== cakupan tiap kartu di jendela ${D0}–${D1} ===`);
for(const c of cards){
  const nl=led.filter(r=>r.from_id===c.id&&r.tx_date>=D0&&r.tx_date<=D1).length;
  const ns=st.filter(r=>r.account_id===c.id&&r.tx_date>=D0&&r.tx_date<=D1).length;
  const tot=nl+ns;
  console.log(`  ${c.name.padEnd(16)} ledger ${String(nl).padStart(3)}  staging ${String(ns).padStart(3)}  ${tot===0?'<<< KOSONG — statement belum ada':''}`);
}
process.exit(0);})();
