const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const refundId=(srcs||[]).filter(s=>s.name==='Refund').map(s=>s.id);
const ccIds=new Set(accounts.filter(a=>a.type==='credit_card').map(a=>a.id));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const isExp=r=>['expense','pay_liability'].includes(r.tx_type);
const isRef=r=>r.tx_type==='income'&&(refundId.includes(r.from_id)||(!r.from_id&&ccIds.has(r.to_id)));
const bruto=led.filter(isExp).reduce((s,r)=>s+ +r.amount_idr,0);
const ref=led.filter(isRef).reduce((s,r)=>s+ +r.amount_idr,0);
console.log('=== total belanja ===');
console.log(`  bruto          ${rp(bruto).padStart(14)}`);
console.log(`  refund         ${rp(ref).padStart(14)}`);
console.log(`  neto           ${rp(bruto-ref).padStart(14)}  ← yang tampil di Reports`);
console.log(`  di layar        927.758.796`);
console.log(`  selisih        ${rp(bruto-ref-927758796).padStart(14)}`);
console.log('\n=== ECI.IDC12 45.871.000 ===');
for(const r of led.filter(r=>/ECI\.IDC/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(9)} ${nm(r.from_id)}→${nm(r.to_id)} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,40)}`);
console.log('\n=== yang MASIH dihitung belanja padahal bukan (menunggu keputusanmu) ===');
let t=0;
for(const r of led.filter(r=>isExp(r)&&/FX TRX|TARIK TUNAI|SEVEN BANK/i.test(r.description||''))){t+= +r.amount_idr;
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} kat=${r.category_name} | ${(r.description||'').slice(0,44)}`);}
console.log(`  total ${rp(t)} — beli valas & tarik tunai, bukan belanja`);
console.log('\n=== Top Merchants: apakah refund ikut dikurangi? ===');
const oak=led.filter(r=>/Retail IDN Jakarta TOKOPEDIA/i.test(r.description||''));
console.log(`  "Retail IDN Jakarta TOKOPEDIA": ${oak.length} baris = ${rp(oak.reduce((s,r)=>s+ +r.amount_idr,0))} (tampil 33.017.816)`);
const kredit=led.filter(r=>/Credit IDN Jakarta TOKOPEDIA/i.test(r.description||''));
console.log(`  kredit/pembalikannya: ${kredit.length} baris = ${rp(kredit.reduce((s,r)=>s+ +r.amount_idr,0))} — TIDAK dikurangkan di Top Merchants`);
process.exit(0);})();
