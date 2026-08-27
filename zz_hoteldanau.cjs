const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const hp=(cats||[]).find(c=>c.name==='Health & Personal Care');
const{data:h}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).ilike('description','%Hotel Danau%');
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/hoteldanau_${Date.now()}.json`,JSON.stringify(h,null,1));
for(const r of h||[]){
  const{error}=await supabase.from('ledger').update({category_id:hp.id,category_name:hp.name,notes:'Hotel Danau'}).eq('id',r.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`ok ${r.tx_date} ${rp(r.amount_idr)} ${nm(r.from_id)} ${r.category_name} → Health & Personal Care`);
}
process.exit(0);})();
