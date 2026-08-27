const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(tanpa source)';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,currency,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== SAHLUL 71.500 ===');
for(const r of led.filter(r=>/SAHLUL/i.test(r.description||'')))
  console.log(` ${r.tx_date} ${rp(r.amount_idr)} ${r.tx_type} source=${sname(r.from_id)} → ${nm(r.to_id)} kat=${r.category_name||'(null)'} | ${r.description}`);
console.log('\n=== 7-Eleven: koreksi 178.612 & pasangannya ===');
for(const r of led.filter(r=>/7 ELEVEN|ELEVEN-T4/i.test(r.description||'')))
  console.log(` ${r.tx_date} ${String(r.amount).padStart(8)} ${(r.currency||'IDR').padEnd(4)} idr=${rp(r.amount_idr).padStart(10)} ${r.tx_type.padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,52)}`);
console.log('\n--- debit BCA IDR nominal ~178.612 di awal Januari ---');
const bcaidr=accounts.find(a=>a.name==='BCA IDR Family'||/^BCA IDR/.test(a.name));
for(const r of led.filter(r=>r.tx_date>='2026-01-01'&&r.tx_date<='2026-01-20'&&Math.abs(+r.amount_idr-178612)<15000))
  console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.tx_type.padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,52)}`);
process.exit(0);})();
