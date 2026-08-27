const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const c=(cats||[]).find(x=>x.name==='Donations & Gifts');
const{data:rows}=await supabase.from('ledger').select('id,tx_date,amount_idr,category_name,description').eq('user_id',uid).ilike('description','%MAHKOTA BUANA%');
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/mahkota_${Date.now()}.json`,JSON.stringify(rows,null,1));
for(const r of rows||[]){
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name}).eq('id',r.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`ok ${r.tx_date} Rp ${Math.round(r.amount_idr).toLocaleString('id-ID')} : ${r.category_name} → Donations & Gifts`);
}
process.exit(0);})();
