const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(?)';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== semua Airbnb ===');
for(const r of led.filter(r=>/AIRBNB/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(9)} ${(r.entity||'-').padEnd(8)} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,36)}`);
console.log('\n=== kredit 35–36 juta di seluruh tahun ===');
const MASUK=['income','reimburse_in','collect_loan','sell_asset'];
for(const r of led.filter(r=>MASUK.includes(r.tx_type)&&+r.amount_idr>=34500000&&+r.amount_idr<=36500000))
  console.log(`  ${r.tx_date} +${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${r.tx_type==='income'?'src='+sname(r.from_id):'entity='+(r.entity||'-')} → ${nm(r.to_id)}\n       ${(r.description||'').slice(0,66)}`);
console.log('\n=== SEMUA uang masuk dari HENNY DJOHARI ===');
for(const r of led.filter(r=>MASUK.includes(r.tx_type)&&/HENNY/i.test(r.description||'')))
  console.log(`  ${r.tx_date} +${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} entity=${(r.entity||'-').padEnd(8)} → ${nm(r.to_id).padEnd(9)} | ${(r.description||'').slice(0,50)}`);
console.log('\n=== uang KELUAR ke Henny (pembanding) ===');
for(const r of led.filter(r=>!MASUK.includes(r.tx_type)&&/HENNY/i.test(r.description||'')))
  console.log(`  ${r.tx_date} -${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} | ${(r.description||'').slice(0,50)}`);
process.exit(0);})();
