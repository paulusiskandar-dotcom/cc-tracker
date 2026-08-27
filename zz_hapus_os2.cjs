const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const os=(cats||[]).find(c=>c.name==='Online Shopping');
const eg=(cats||[]).find(c=>c.name==='Electronics & Gadgets');
const{data:ins}=await supabase.from('installments').select('id,description,total_amount,monthly_amount,status,expense_category_id').eq('user_id',uid).eq('expense_category_id',os.id);
console.log('cicilan menunjuk Online Shopping:',(ins||[]).length);
for(const i of ins||[])console.log(`  ${(i.description||'?').slice(0,44).padEnd(46)} ${rp(i.total_amount).padStart(12)} · ${rp(i.monthly_amount)}/bln · ${i.status}`);
if(!APPLY){console.log('\n[DRY-RUN] --apply untuk alihkan ke Electronics & Gadgets lalu hapus kategori.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/os_final_${Date.now()}.json`,JSON.stringify({kategori:os,cicilan:ins},null,1));
for(const i of ins||[]){
  const{error}=await supabase.from('installments').update({expense_category_id:eg.id}).eq('id',i.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`  → ${(i.description||'').slice(0,40)} dialihkan ke Electronics & Gadgets`);
}
const{error}=await supabase.from('expense_categories').delete().eq('id',os.id).eq('user_id',uid);
console.log(error?('GAGAL hapus: '+error.message):'\n✓ kategori "Online Shopping" DIHAPUS');
const{data:sisa}=await supabase.from('expense_categories').select('name').eq('user_id',uid).order('name');
console.log(`\nkategori sekarang (${(sisa||[]).length}):`);
console.log('  '+(sisa||[]).map(c=>c.name).join(' · '));
process.exit(0);})();
