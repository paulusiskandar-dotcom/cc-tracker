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
const fd=(cats||[]).find(c=>c.name==='Food & Dining');
const{data:h}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,category_name,description')
  .eq('user_id',uid).or('description.ilike.%KIKO%,description.ilike.%KIKOSARI%,description.ilike.%KIKO SARI%').order('tx_date');
console.log('baris cocok:',(h||[]).length);
for(const r of h||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.tx_type.padEnd(9)} ${nm(r.from_id).padEnd(11)} kat=${(r.category_name||'-').padEnd(22)} | ${(r.description||'').slice(0,44)}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
const perlu=(h||[]).filter(r=>['expense','pay_liability'].includes(r.tx_type)&&r.category_name!=='Food & Dining');
if(!perlu.length){console.log('tidak ada yang perlu diubah');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/kiko_${Date.now()}.json`,JSON.stringify(perlu,null,1));
let ok=0;
for(const r of perlu){const{error}=await supabase.from('ledger').update({category_id:fd.id,category_name:fd.name,notes:'Kiko Sari'}).eq('id',r.id).eq('user_id',uid);
  if(!error){ok++;console.log(`ok ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.category_name} → Food & Dining`);}else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${perlu.length}`);
process.exit(0);})();
