const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'-';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== semua yang menyebut JUDHA / JUDI ===');
for(const r of led.filter(r=>/JUDHA|JUDI\b/i.test((r.description||'')+' '+(r.notes||''))))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)}\n       ${(r.description||'').slice(0,64)}`);
console.log('\n=== keluar dari BCA IDR 11–20 Maret (mencari lanjutannya ke anak buah) ===');
const bcaidr=accounts.find(a=>/^BCA IDR/.test(a.name));
const MASUK=['income','reimburse_in','collect_loan','sell_asset'];
const kel=led.filter(r=>r.from_id===bcaidr?.id&&!MASUK.includes(r.tx_type)&&r.tx_date>='2026-03-11'&&r.tx_date<='2026-03-25');
let t=0;for(const r of kel){t+= +r.amount_idr;
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${(r.category_name||'-').padEnd(20)} | ${(r.description||'').slice(0,46)}`);}
console.log(`  total keluar BCA IDR periode itu: ${rp(t)}`);
console.log('\n=== transfer ke MANDIRI di Maret ===');
const man=accounts.find(a=>a.name==='Mandiri');
for(const r of led.filter(r=>r.to_id===man?.id&&r.tx_date>='2026-03-01'&&r.tx_date<='2026-03-31'))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} dari ${nm(r.from_id).padEnd(10)} | ${(r.description||'').slice(0,44)}`);
process.exit(0);})();
