const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const SC='/private/tmp/claude-501/-Users-paulusiskandar-Downloads/ddf30272-814e-499f-a44c-2cb4d7264aff/scratchpad';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const R=JSON.parse(fs.readFileSync(SC+'/pln_receipts.json','utf8'));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).eq('entity','Hamasa').gte('tx_date','2026-01-01').lte('tx_date','2026-03-31').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const outs=led.filter(r=>r.tx_type==='reimburse_out'),ins=led.filter(r=>r.tx_type==='reimburse_in');
// pilah keluar
const plnMap={};for(const r of R.filter(r=>r.biller==='PLN'&&r.tgl<'2026-04-01'))plnMap[r.total]=r.nama;
const telkomsel=new Set(R.filter(r=>/Telkomsel/i.test(r.biller)&&r.tgl<'2026-04-01').map(r=>r.total));
const grp=r=>{const d=r.description||'',a=+r.amount_idr;
  if(/GLOBAL DIGITAL|BLIBLI|PAPER/i.test(d))return'Paper/Blibli';
  if(/LAZADA/i.test(d)){
    const nmn=plnMap[a];
    if(nmn==='PT HAMASA STEEL CENTRE')return'PLN pabrik Hamasa';
    if(/SURYANTO|PAULUS/.test(nmn||''))return'PLN Suryanto+Paulus';
    if(nmn)return'PLN rumah lain (Jopie/Syafar/Agung/Lekhray)';
    if(telkomsel.has(a))return'Telkomsel';
    return'Lazada lain';}
  if(/TOKOPEDIA|Tokopedia/i.test(d))return'Tokopedia';
  if(/ASURANSI/i.test(d))return'Asuransi';
  if(/AIRBNB/i.test(d))return'Airbnb';
  return'lain-lain';};
const gin=r=>{const d=r.description||'';
  if(/LLG-MANDIRI/.test(d)&&+r.amount_idr>60000000)return'LLG (ganti PLN pabrik)';
  if(/LLG-MANDIRI/.test(d))return'LLG 36jt (ganti Airbnb)';
  if(/ASURANSI/i.test(d))return'Setoran asuransi';
  if(/Tokped\+Lazada/i.test(d))return'Setoran Tokped+Lazada';
  if(/SITI SARNAH/i.test(d))return'Siti Sarnah';
  if(/Tokopedia.*CR|refund/i.test(d))return'Refund kartu';
  return'Setoran tunai lainnya';};
const O={},I={};
for(const r of outs){const k=grp(r);O[k]=O[k]||{n:0,v:0};O[k].n++;O[k].v+= +r.amount_idr;}
for(const r of ins){const k=gin(r);I[k]=I[k]||{n:0,v:0};I[k].n++;I[k].v+= +r.amount_idr;}
console.log('=== KELUAR Jan–Mar per kelompok ===');
for(const[k,v]of Object.entries(O).sort((a,b)=>b[1].v-a[1].v))console.log(`  ${rp(v.v).padStart(14)}  ${String(v.n).padStart(3)}×  ${k}`);
console.log(`  ${rp(Object.values(O).reduce((s,v)=>s+v.v,0)).padStart(14)}  JUMLAH`);
console.log('\n=== MASUK Jan–Mar per kelompok ===');
for(const[k,v]of Object.entries(I).sort((a,b)=>b[1].v-a[1].v))console.log(`  ${rp(v.v).padStart(14)}  ${String(v.n).padStart(3)}×  ${k}`);
console.log(`  ${rp(Object.values(I).reduce((s,v)=>s+v.v,0)).padStart(14)}  JUMLAH`);
// pasangan yang bisa diadu langsung
console.log('\n=== adu langsung ===');
const adu=[['PLN pabrik Hamasa','LLG (ganti PLN pabrik)'],['Asuransi','Setoran asuransi'],['Airbnb','LLG 36jt (ganti Airbnb)'],['Tokopedia','Setoran Tokped+Lazada']];
for(const[o,i]of adu){const vo=O[o]?.v||0,vi=I[i]?.v||0;
  console.log(`  ${o.padEnd(22)} keluar ${rp(vo).padStart(13)}  vs ${i.padEnd(24)} ${rp(vi).padStart(13)}  selisih ${rp(vo-vi).padStart(12)}`);}
process.exit(0);})();
