const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,from_id,category_name,reimburse_settlement_id,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,account_id,status').eq('user_id',uid).order('tx_date').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
const RE=/GLOBAL DIGITAL|BLIBLI/i;
console.log('=== PT GLOBAL DIGITAL NIAGA (Blibli) — di ledger ===');
for(const r of led.filter(r=>RE.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id).padEnd(14)} ${r.reimburse_settlement_id?'lunas':'BUKA '} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== di staging ===');
for(const r of st.filter(r=>RE.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount).padStart(12)} ${r.direction} ${nm(r.account_id).padEnd(14)} ${r.status.padEnd(10)} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== RICKY SUSANTO ===');
for(const r of led.filter(r=>/RICKY SUSANTO/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} | ${(r.description||'').slice(0,50)}`);
process.exit(0);})();
