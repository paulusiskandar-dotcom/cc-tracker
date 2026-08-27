const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const os=(cats||[]).find(c=>c.name==='Online Shopping');
const{data:ins}=await supabase.from('installments').select('*').eq('user_id',uid).eq('category_id',os.id);
console.log('cicilan yang masih menunjuk Online Shopping:',(ins||[]).length,'\n');
for(const i of ins||[]){
  const k=Object.entries(i).filter(([k,v])=>v!==null&&!['user_id','id','category_id'].includes(k)&&typeof v!=='object');
  console.log(`  ${k.map(([a,b])=>`${a}=${typeof b==='number'&&b>1000?rp(b):b}`).join(' · ').slice(0,150)}`);
}
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply untuk alihkan ke Electronics & Gadgets lalu hapus kategori.');process.exit(0);}
const eg=(cats||[]).find(c=>c.name==='Electronics & Gadgets');
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/inst_os_${Date.now()}.json`,JSON.stringify(ins,null,1));
for(const i of ins||[]){
  const{error}=await supabase.from('installments').update({category_id:eg.id}).eq('id',i.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`  cicilan ${String(i.id).slice(0,8)} → Electronics & Gadgets`);
}
const{error}=await supabase.from('expense_categories').delete().eq('id',os.id).eq('user_id',uid);
console.log(error?('GAGAL hapus: '+error.message):'\nkategori "Online Shopping" DIHAPUS');
const{data:sisa}=await supabase.from('expense_categories').select('name').eq('user_id',uid).order('name');
console.log(`kategori sekarang (${(sisa||[]).length}): ${(sisa||[]).map(c=>c.name).join(' · ')}`);
process.exit(0);})();
