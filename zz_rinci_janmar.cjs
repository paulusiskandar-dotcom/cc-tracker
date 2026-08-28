const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).eq('entity','Hamasa').gte('tx_date','2026-01-01').lte('tx_date','2026-03-31').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const outs=led.filter(r=>r.tx_type==='reimburse_out'),ins=led.filter(r=>r.tx_type==='reimburse_in');
const so=outs.reduce((s,r)=>s+ +r.amount_idr,0),si=ins.reduce((s,r)=>s+ +r.amount_idr,0);
console.log(`Jan–Mar Hamasa: keluar ${rp(so)} (${outs.length} baris) | masuk ${rp(si)} (${ins.length} baris) | selisih ${rp(so-si)}`);
const merk=d=>{d=d||'';
  if(/GLOBAL DIGITAL|BLIBLI/i.test(d))return'Blibli/Paper (satpam dll)';
  if(/LAZADA/i.test(d))return'Lazada (PLN dll)';
  if(/TOKOPEDIA|Tokopedia/i.test(d))return'Tokopedia';
  if(/ASURANSI/i.test(d))return'Asuransi';
  if(/AIRBNB/i.test(d))return'Airbnb';
  if(/SHOPEE/i.test(d))return'Shopee';
  return d.slice(0,26);};
console.log('\n=== KELUAR per bulan per kelompok ===');
for(const m of['2026-01','2026-02','2026-03']){
  const g={};for(const r of outs.filter(r=>r.tx_date.startsWith(m))){const k=merk(r.description);g[k]=g[k]||{n:0,v:0};g[k].n++;g[k].v+= +r.amount_idr;}
  const tot=Object.values(g).reduce((s,v)=>s+v.v,0);
  console.log(`\n  -- ${m}  keluar ${rp(tot)}`);
  for(const[k,v]of Object.entries(g).sort((a,b)=>b[1].v-a[1].v))console.log(`     ${rp(v.v).padStart(13)}  ${String(v.n).padStart(3)}×  ${k}`);
}
console.log('\n=== MASUK — semua baris ===');
for(const m of['2026-01','2026-02','2026-03']){
  const rows=ins.filter(r=>r.tx_date.startsWith(m));
  console.log(`\n  -- ${m}  masuk ${rp(rows.reduce((s,r)=>s+ +r.amount_idr,0))}`);
  for(const r of rows)console.log(`     ${r.tx_date} ${rp(r.amount_idr).padStart(13)} → ${nm(r.to_id).padEnd(8)} | ${(r.description||'').slice(0,52)}`);
}
console.log('\n=== per bulan bersih ===');
for(const m of['2026-01','2026-02','2026-03']){
  const o=outs.filter(r=>r.tx_date.startsWith(m)).reduce((s,r)=>s+ +r.amount_idr,0);
  const i=ins.filter(r=>r.tx_date.startsWith(m)).reduce((s,r)=>s+ +r.amount_idr,0);
  console.log(`  ${m}  keluar ${rp(o).padStart(14)}  masuk ${rp(i).padStart(14)}  selisih ${rp(o-i).padStart(13)}`);
}
process.exit(0);})();
