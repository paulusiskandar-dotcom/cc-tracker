const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:h}=await supabase.from('ledger').select('id,tx_date,notes').eq('user_id',uid).ilike('notes','PLN ·%');
console.log('baris PLN:',(h||[]).length);
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/notespln2_${Date.now()}.json`,JSON.stringify(h,null,1));
let ok=0;
for(const r of h||[]){
  const baru=r.notes.replace(/\s*·\s*[RBI]\d\/[\d.]+\s*VA/,'');
  if(baru===r.notes)continue;
  const{error}=await supabase.from('ledger').update({notes:baru}).eq('id',r.id).eq('user_id',uid);
  if(!error){ok++;if(ok<=3)console.log(`  ${r.notes}\n  → ${baru}`);}
}
console.log(`diperbarui ${ok}`);
process.exit(0);})();
