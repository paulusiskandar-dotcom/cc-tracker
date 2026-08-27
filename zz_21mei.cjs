const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const c=(cats||[]).find(x=>x.name==='Home & Furniture');
const{data:h}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).eq('tx_date','2026-05-21')
  .or('description.ilike.%CAHAYA MANDIRI%,description.ilike.%MITRA ADIJAYA%');
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/21mei_${Date.now()}.json`,JSON.stringify(h,null,1));
for(const r of h||[]){
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name}).eq('id',r.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`ok ${r.tx_date} ${rp(r.amount_idr).padStart(9)} ${nm(r.from_id)} ${r.category_name} → Home & Furniture | ${r.description}`);
}
process.exit(0);})();
