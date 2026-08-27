const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
fs.mkdirSync('.backups',{recursive:true});
// SOIA-HO → Food · semua MVA Close → Hobbies (tiket bioskop)
const{data:soia}=await supabase.from('ledger').select('id,tx_date,amount_idr,category_name,description').eq('user_id',uid).ilike('description','%SOIA%');
const{data:mva}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).ilike('description','%MVA Close%');
fs.writeFileSync(`.backups/soiamva_${Date.now()}.json`,JSON.stringify([...(soia||[]),...(mva||[])],null,1));
let ok=0;
for(const r of soia||[]){const c=C('Food & Dining');
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:'SOIA-HO'}).eq('id',r.id).eq('user_id',uid);
  if(!error){ok++;console.log(`ok ${r.tx_date} ${rp(r.amount_idr).padStart(9)} SOIA-HO → Food & Dining`);}}
for(const r of mva||[]){const c=C('Hobbies & Entertainment');
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:'tiket bioskop'}).eq('id',r.id).eq('user_id',uid);
  if(!error){ok++;console.log(`ok ${r.tx_date} ${rp(r.amount_idr).padStart(9)} ${nm(r.from_id).padEnd(14)} MVA Close (${r.category_name}) → Hobbies & Entertainment`);}}
console.log(`\nditulis ${ok}`);
console.log('\n=== DETAIL Tokopedia 1.092.013 ===');
const{data:tk}=await supabase.from('ledger').select('*').eq('user_id',uid).gte('amount_idr',1092000).lte('amount_idr',1092100);
for(const r of tk||[]){
  console.log(`  tanggal      : ${r.tx_date}`);
  console.log(`  nominal      : ${rp(r.amount_idr)}`);
  console.log(`  kartu        : ${nm(r.from_id)}`);
  console.log(`  deskripsi    : ${r.description}`);
  console.log(`  sumber data  : ${r.source||'-'} · catatan: ${r.notes||'-'}`);
  console.log(`  tipe         : ${r.tx_type} · entity ${r.entity||'-'} · kategori ${r.category_name||'-'}`);
}
console.log('\n=== DETAIL 5 transfer badan usaha ===');
for(const n of ['PGDP PLUIT','6863GUARD','REV STORE','CAHAYA MANDIRI','MITRA ADIJAYA']){
  const{data:d}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).ilike('description',`%${n}%`).order('tx_date');
  for(const r of d||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(9)} ${nm(r.from_id).padEnd(9)} ${(r.category_name||'-').padEnd(16)} | ${r.description}`);
}
process.exit(0);})();
