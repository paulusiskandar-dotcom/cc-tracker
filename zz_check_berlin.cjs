const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,category_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const exp=led.filter(r=>r.tx_type==='expense');
console.log('=== belanja trip Eropa Maret 2026 (semua baris, per kategori) ===');
const trip=exp.filter(r=>r.tx_date>='2026-03-10'&&r.tx_date<='2026-03-31'&&/BERLIN|STOCKHOLM|\bDE\b|\bSE\b|SWE|EUR|SEK|GERMANY/i.test(r.description||''));
const by={};trip.forEach(r=>{(by[r.category_name||'(null)']=by[r.category_name||'(null)']||[]).push(r);});
for(const[c,rows]of Object.entries(by).sort((a,b)=>b[1].reduce((s,r)=>s+ +r.amount_idr,0)-a[1].reduce((s,r)=>s+ +r.amount_idr,0))){
  console.log(`\n ${c} — ${rp(rows.reduce((s,r)=>s+ +r.amount_idr,0))} (${rows.length} baris)`);
  for(const r of rows.sort((a,b)=>b.amount_idr-a.amount_idr).slice(0,8))console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(10)} | ${(r.description||'').slice(0,58)}`);
}
console.log('\n=== cari tagihan asal refund 7-Eleven/MCD 178.612 (15 Jan) ===');
const cand=exp.filter(r=>r.tx_date>='2025-12-25'&&r.tx_date<='2026-01-20'&&/7.?ELEVEN|MCD|MCDONALD/i.test(r.description||''));
console.log('kandidat:',cand.length);
for(const r of cand)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.category_name} | ${(r.description||'').slice(0,55)}`);
const near=exp.filter(r=>r.tx_date>='2026-01-01'&&r.tx_date<='2026-01-16'&&Math.abs(+r.amount_idr-178612)<50000);
console.log(' nominal mirip 178.612 di Jan:',near.length);
for(const r of near)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.category_name} | ${(r.description||'').slice(0,55)}`);
process.exit(0);
})();
