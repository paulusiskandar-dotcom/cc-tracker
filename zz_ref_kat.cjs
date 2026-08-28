const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n);
for(const[d,amt,kat]of[['2026-03-31',1000000,'Bank & Card Fees'],['2026-03-02',239000,'Subscriptions & Software']]){
  const{data:r}=await supabase.from('ledger').select('id,description').eq('user_id',uid).eq('tx_date',d).eq('amount_idr',amt).eq('tx_type','income').single();
  await supabase.from('ledger').update({category_id:cat(kat).id,category_name:kat}).eq('id',r.id);
  console.log('-',d,amt,'→',kat,'|',(r.description||'').slice(0,40));
}
process.exit(0);})();
