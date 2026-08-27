const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(tanpa source)';
console.log('=== kandidat pasangan PLN Suryanto 1.034.675 (25 Jun) ===');
console.log('cari kredit masuk 20 Jun – 31 Jul, nilai 1.034.675 s/d 1.300.000:\n');
const{data:h}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description')
  .eq('user_id',uid).gte('tx_date','2026-06-20').lte('tx_date','2026-07-31').gte('amount_idr',1034000).lte('amount_idr',1300000).order('tx_date');
for(const r of h||[]){
  const masuk=['income','reimburse_in','collect_loan','sell_asset'].includes(r.tx_type);
  console.log(`  ${r.tx_date} ${(masuk?'+':'-')+rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${r.tx_type==='income'?'src='+sname(r.from_id):nm(r.from_id)}→${nm(r.to_id)} ${r.entity||'-'}`);
  console.log(`       ${(r.description||'').slice(0,66)}`);
}
console.log('\n=== semua PLN / listrik di ledger yg masih expense (kandidat aturan sama) ===');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,entity,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const r of led.filter(r=>r.tx_type==='expense'&&/PLN|LISTRIK/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} kat=${r.category_name} | ${(r.description||'').slice(0,50)}`);
console.log('\n=== pola umum: reimburse_in yang nilainya SEDIKIT DI ATAS sebuah reimburse_out ===');
const out=led.filter(r=>r.tx_type==='reimburse_out'), inn=led.filter(r=>r.tx_type==='reimburse_in');
let n=0;
for(const i of inn){
  const c=out.filter(o=>Math.abs(new Date(i.tx_date)-new Date(o.tx_date))/864e5<=10&&+i.amount_idr>+o.amount_idr&&(+i.amount_idr-+o.amount_idr)/+o.amount_idr<0.02);
  if(c.length===1&&n<8){console.log(`  in ${i.tx_date} ${rp(i.amount_idr).padStart(11)}  ←→  out ${c[0].tx_date} ${rp(c[0].amount_idr).padStart(11)}  selisih +${rp(+i.amount_idr-+c[0].amount_idr)}`);n++;}
}
console.log(n?`  (${n} contoh pola pembulatan ke atas)`:'  tidak ada pola serupa');
process.exit(0);})();
