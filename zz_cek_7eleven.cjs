const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const bca=accounts.filter(a=>/^BCA/.test(a.name));
console.log('cari di STAGING: debit ~178.612 atau baris 7-Eleven, 1–20 Jan');
for(const A of bca){
  let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,status').eq('user_id',uid).eq('account_id',A.id).gte('tx_date','2026-01-01').lte('tx_date','2026-01-20').order('tx_date').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
  const hit=st.filter(s=>Math.abs(+s.amount-178612)<5000||/ELEVEN|KOR|MCD/i.test(s.description||''));
  if(hit.length)console.log(`\n ${A.name}:`);
  for(const s of hit)console.log(`   ${s.tx_date} ${rp(s.amount).padStart(10)} ${s.direction} [${s.status}] | ${(s.description||'').slice(0,60)}`);
}
process.exit(0);})();
