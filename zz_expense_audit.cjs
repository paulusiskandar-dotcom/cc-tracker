const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(x=>x.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,category_name,description,source,notes').eq('user_id',uid).gte('tx_date','2026-01-01').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const exp=led.filter(r=>r.tx_type==='expense');
console.log('=== expense per bulan ===');
const bl={};for(const r of exp)bl[r.tx_date.slice(0,7)]=(bl[r.tx_date.slice(0,7)]||0)+ +r.amount_idr;
for(const[m,v]of Object.entries(bl).sort())console.log(`  ${m}  ${rp(v).padStart(14)}`);
console.log(`  TOTAL ${rp(Object.values(bl).reduce((s,v)=>s+v,0))}`);
console.log('\n=== expense per kategori (10 terbesar) ===');
const kat={};for(const r of exp){const k=r.category_name||'(tanpa kategori)';kat[k]=kat[k]||{n:0,v:0};kat[k].n++;kat[k].v+= +r.amount_idr;}
for(const[k,v]of Object.entries(kat).sort((x,y)=>y[1].v-x[1].v).slice(0,10))console.log(`  ${rp(v.v).padStart(14)} ${String(v.n).padStart(4)}× ${k}`);
console.log('\n=== 15 expense TERBESAR (calon salah klasifikasi) ===');
for(const r of [...exp].sort((x,y)=>+y.amount_idr-+x.amount_idr).slice(0,15))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${nm(r.from_id).padEnd(14)} ${(r.category_name||'-').slice(0,18).padEnd(18)} | ${(r.description||'').slice(0,40)}`);
console.log('\n=== baris bersisi TUNGGAL (tanpa akun sumber) — muncul di Reports tapi tak menyentuh saldo ===');
const tunggal=exp.filter(r=>!r.from_id);
const tk={};for(const r of tunggal)tk[r.category_name||'-']=(tk[r.category_name||'-']||0)+ +r.amount_idr;
console.log(`  ${tunggal.length} baris, ${rp(tunggal.reduce((s,r)=>s+ +r.amount_idr,0))}`);
for(const[k,v]of Object.entries(tk).sort((x,y)=>y[1]-x[1]))console.log(`    ${rp(v).padStart(12)} ${k}`);
process.exit(0);})();
