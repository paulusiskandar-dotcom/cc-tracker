const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,entity,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== baris ledger berdeskripsi PAPER / BLIBLI ===');
const pb=led.filter(r=>/PAPER|BLIBLI/i.test(r.description||''));
console.log('jumlah:',pb.length,'=',rp(pb.reduce((s,r)=>s+ +r.amount_idr,0)));
for(const r of pb.slice(0,14))console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(14)} ${r.entity||'-'} | ${(r.description||'').slice(0,40)}`);
console.log('\n=== cek 5 nominal yg katanya hilang, pencarian longgar (±30 hari, ±5.000) ===');
const dd=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;
for(const[d,a,ket]of [['2026-01-21',47936677,'Security Gudang GP'],['2026-01-21',10069105,'Security Gudang Cikarang'],['2026-02-12',43555048,'Security Gd Cakung'],['2026-03-16',67023000,'THR Security'],['2026-08-01',50775000,'Lieche Agustus']]){
  const h=led.filter(r=>Math.abs(+r.amount_idr-a)<=5000&&dd(r.tx_date,d)<=30);
  console.log(`  ${d} ${rp(a).padStart(12)} ${ket}`);
  if(!h.length)console.log('     → BENAR-BENAR TIDAK ADA');
  else for(const r of h)console.log(`     → ${r.tx_date} ${rp(r.amount_idr)} ${r.tx_type} ${nm(r.from_id)} ${r.entity||'-'} | ${(r.description||'').slice(0,40)}`);
}
process.exit(0);})();
