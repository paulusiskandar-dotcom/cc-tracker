const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const PIUTANG='f282ac7e-a908-4e5d-adb0-144473e9f126', SETTLE='014ccdfa-5837-4e32-a9ef-c6ce6fae8142';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const before=Object.fromEntries(accounts.filter(a=>a.type==='credit_card').map(a=>[a.name,Number(a.outstanding_amount||0)]));
const NOTE={2678847:'listrik PLN Jopie Djohari — reimburse Hamasa (Paulus)',9693415:'Tokopedia 19 Jan — reimburse Hamasa (Paulus)',7731514:'Tokopedia 19 Jan (posting 20) — reimburse Hamasa (Paulus)'};
const{data:led}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).eq('tx_type','expense').gte('tx_date','2026-01-01').lte('tx_date','2026-01-31').ilike('description','%tokopedia%');
const pick=(led||[]).filter(r=>Object.keys(NOTE).some(a=>Math.abs(+a- +r.amount_idr)<1));
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/tahan3_${Date.now()}.json`,JSON.stringify(pick,null,1));
for(const r of pick){
  const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,
    entity:'Hamasa',reimburse_settlement_id:SETTLE,category_id:null,category_name:null,notes:NOTE[Math.round(r.amount_idr)]}).eq('id',r.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`ok ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id)} → reimburse_out Hamasa`);
}
const after=await accountsApi.getAll(uid);
let beda=0;for(const a of after.filter(a=>a.type==='credit_card'))if(Math.abs(before[a.name]-Number(a.outstanding_amount||0))>0.5){console.log(`⚠ ${a.name} berubah`);beda++;}
console.log(beda?'⚠ ada saldo kartu berubah':'✓ saldo kartu tidak berubah');
console.log('\n=== DAFTAR TOKOPEDIA FEBRUARI (utk agen) ===');
const{data:feb}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,description').eq('user_id',uid).eq('tx_type','expense').gte('tx_date','2026-02-01').lte('tx_date','2026-02-28').ilike('description','%tokopedia%').order('tx_date');
console.log((feb||[]).map(r=>`${r.tx_date.slice(8)}-02 ${rp(r.amount_idr)} ${nm(r.from_id)}${/CCL|\d+\/\d+/i.test(r.description||'')?' [CICILAN]':''}`).join(' · '));
console.log('jumlah:',(feb||[]).length);
process.exit(0);})();
