const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const os=(cats||[]).find(c=>c.name==='Online Shopping');
const{data:ins,error}=await supabase.from('installments').select('*').eq('category_id',os.id);
console.log('tanpa filter user — cicilan menunjuk kategori ini:',(ins||[]).length, error?error.message:'');
for(const i of ins||[]){
  console.log(' ',JSON.stringify(Object.fromEntries(Object.entries(i).filter(([k,v])=>v!==null&&!['id','user_id'].includes(k)))).slice(0,220));
}
// semua cicilan milik user, apa pun kategorinya
const{data:all}=await supabase.from('installments').select('id,merchant_name,total_amount,category_id,is_active').eq('user_id',uid);
console.log('\nseluruh cicilan milik user:',(all||[]).length);
const nmc=id=>(cats||[]).find(c=>c.id===id)?.name||'(tanpa kategori)';
for(const i of all||[])console.log(`  ${(i.merchant_name||'?').padEnd(28)} ${rp(i.total_amount).padStart(12)} · ${nmc(i.category_id)} · aktif=${i.is_active}`);
process.exit(0);})();
