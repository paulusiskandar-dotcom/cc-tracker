const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,account_id,status').eq('user_id',uid).order('tx_date').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
console.log('total staging:',st.length);
console.log('\n=== staging Nov–Des: uang keluar 2,8jt–3,6jt ===');
for(const r of st.filter(r=>r.direction==='out'&&+r.amount>=2800000&&+r.amount<=3600000&&r.tx_date<'2026-01-01'))
  console.log(`  ${r.tx_date} ${rp(r.amount).padStart(11)} ${nm(r.account_id).padEnd(14)} ${r.status.padEnd(10)} | ${(r.description||'').slice(0,50)}`);
console.log('\n=== staging Des: SEMUA Tokopedia/Lazada/toco ===');
for(const r of st.filter(r=>/TOKOPEDIA|LAZADA|TOCO|SPRINT/i.test(r.description||'')&&r.tx_date>='2025-12-01'&&r.tx_date<'2026-01-01'))
  console.log(`  ${r.tx_date} ${rp(r.amount).padStart(11)} ${r.direction} ${nm(r.account_id).padEnd(14)} ${r.status.padEnd(10)} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== nilai 3.215.930 di staging mana pun? ===');
const h=st.filter(r=>Math.abs(+r.amount-3215930)<=100000);
console.log('  kandidat ±100.000:',h.length);
for(const r of h)console.log(`     ${r.tx_date} ${rp(r.amount)} ${r.direction} ${nm(r.account_id)} ${r.status} | ${(r.description||'').slice(0,44)}`);
process.exit(0);})();
