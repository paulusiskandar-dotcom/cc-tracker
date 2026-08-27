// KOREKSI: dua setoran tunai ke BCA R ikut terbawa ke "Utility Income", padahal itu
// penggantian dari Hamasa (pola: talangan listrik diganti lewat setor tunai ke BCA R),
// bukan pendapatan dari SDC. Filter-ku terlalu longgar: menangkap semua income berdeskripsi
// "listrik" tanpa membedakan arah uangnya.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const SETTLE='014ccdfa-5837-4e32-a9ef-c6ce6fae8142';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const bcar=accounts.find(a=>a.name==='BCA R');
const{data:h}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,to_id,description').eq('user_id',uid)
  .eq('tx_type','income').eq('to_id',bcar.id).ilike('description','%listrik%');
console.log('setoran tunai BCA R yang salah masuk Utility Income:');
for(const r of h||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} → ${nm(r.to_id)} | ${(r.description||'').slice(0,54)}`);
console.log('  → seharusnya reimburse_in Hamasa (penggantian talangan listrik)');
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/fixbcar_${Date.now()}.json`,JSON.stringify(h,null,1));
let ok=0;
for(const r of h||[]){const{error}=await supabase.from('ledger').update({tx_type:'reimburse_in',from_type:'expense',from_id:null,
  entity:'Hamasa',reimburse_settlement_id:SETTLE,is_reimburse:true,
  notes:'penggantian talangan listrik dari Hamasa via setor tunai ke BCA R (Paulus)'}).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${(h||[]).length}`);
process.exit(0);})();
