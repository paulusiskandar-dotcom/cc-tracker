const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:fxr}=await supabase.from('ledger').select('tx_date,tx_type,amount,currency,amount_idr,fx_rate_used,from_id,to_id,description').eq('user_id',uid).eq('tx_type','fx_exchange').order('tx_date');
console.log('=== semua fx_exchange di ledger ===',(fxr||[]).length);
for(const r of fxr||[])console.log(` ${r.tx_date} ${r.amount} ${r.currency||''} rate=${r.fx_rate_used} ${nm(r.from_id)} → ${nm(r.to_id)} | ${(r.description||'').slice(0,40)}`);
// adakah rate JPY tersimpan di app (fx_rates table)?
for(const t of ['fx_rates','exchange_rates','rates']){
  const{data,error}=await supabase.from(t).select('*').limit(4);
  if(!error)console.log(`\ntabel ${t}:`,JSON.stringify(data).slice(0,300));
}
process.exit(0);})();
