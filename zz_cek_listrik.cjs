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
console.log('=== SEMUA kredit "SAHABAT DENTAL CEM" (SDC) di ledger ===');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const r of led.filter(r=>/SAHABAT DENTAL|SDC/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${r.tx_type==='income'?'src='+sname(r.from_id):''} entity=${(r.entity||'-').padEnd(8)} | ${(r.description||'').slice(0,52)}`);
console.log('\n=== pengeluaran listrik ~5,0–5,4jt (kandidat pasangan) ===');
for(const r of led.filter(r=>['expense','reimburse_out'].includes(r.tx_type)&&+r.amount_idr>=5000000&&+r.amount_idr<=5400000))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(14)} ${(r.entity||'-').padEnd(8)} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== income bersumber Dividend — cek apakah ada yg sebenarnya bukan dividen ===');
const div=(srcs||[]).find(s=>s.name==='Dividend');
for(const r of led.filter(r=>r.tx_type==='income'&&r.from_id===div?.id))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} → ${nm(r.to_id).padEnd(9)} ${(r.entity||'-').padEnd(8)} | ${(r.description||'').slice(0,54)}`);
process.exit(0);})();
