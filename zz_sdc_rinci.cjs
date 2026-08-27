const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).eq('entity','SDC').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const outs=led.filter(r=>r.tx_type==='reimburse_out').map(r=>({...r,pakai:false}));
const ins =led.filter(r=>r.tx_type==='reimburse_in');
console.log('=== pemasukan SDC dan pasangannya (cocok nominal, jarak <= 45 hari) ===');
let takBerpasangan=0;
for(const i of ins){
  let m=outs.find(o=>!o.pakai&&Math.abs(+o.amount_idr - +i.amount_idr)<1&&Math.abs(new Date(o.tx_date)-new Date(i.tx_date))/864e5<=45);
  if(m)m.pakai=true;else takBerpasangan+= +i.amount_idr;
  console.log(`  ${i.tx_date} masuk ${rp(i.amount_idr).padStart(12)}  ${m?'← '+m.tx_date+' '+(m.description||'').slice(0,34):'>>> TANPA PASANGAN'}`);
  console.log(`      ${(i.description||'').slice(0,74)}`);
}
console.log(`\n  pemasukan tanpa pasangan: ${rp(takBerpasangan)}`);
const sisaOut=outs.filter(o=>!o.pakai);
console.log(`\n=== pengeluaran SDC yang belum terpakai (${sisaOut.length}) ===`);
let so=0;for(const o of sisaOut){so+= +o.amount_idr;console.log(`  ${o.tx_date} ${rp(o.amount_idr).padStart(12)} ${nm(o.from_id).padEnd(14)} | ${(o.description||'').slice(0,52)}`);}
console.log(`  jumlah: ${rp(so)}`);
console.log(`\n  SELISIH BERSIH: masuk tanpa pasangan ${rp(takBerpasangan)} − keluar sisa ${rp(so)} = ${rp(takBerpasangan-so)}`);
process.exit(0);})();
