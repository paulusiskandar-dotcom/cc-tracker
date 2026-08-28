const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== reimburse_out 34–38 juta, seluruh tahun ===');
const{data:a}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,entity,description,notes').eq('user_id',uid).eq('tx_type','reimburse_out').gte('amount_idr',34000000).lte('amount_idr',38000000).order('tx_date');
if(!a||!a.length)console.log('  TIDAK ADA satu pun');
for(const r of a||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${nm(r.from_id).padEnd(10)} ${r.entity} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== SEMUA pengeluaran (tipe apa pun) 34–38 juta, seluruh tahun ===');
const{data:b}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description').eq('user_id',uid).gte('amount_idr',34000000).lte('amount_idr',38000000).order('tx_date');
const MASUK=['income','reimburse_in','collect_loan','sell_asset'];
for(const r of (b||[]).filter(r=>!MASUK.includes(r.tx_type)))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(10)} ${(r.entity||'-').padEnd(8)} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,40)}`);
console.log('\n=== dan yang MASUK 34–38 juta (pembanding) ===');
for(const r of (b||[]).filter(r=>MASUK.includes(r.tx_type)))
  console.log(`  ${r.tx_date} +${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} → ${nm(r.to_id).padEnd(9)} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== kredit 5 Maret 36.000.000 — detail ===');
const{data:c}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-03-05').eq('amount_idr',36000000).single();
if(c)console.log(' ',JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k,v])=>v!==null&&!['user_id','id','created_at','updated_at'].includes(k)))));
process.exit(0);})();
