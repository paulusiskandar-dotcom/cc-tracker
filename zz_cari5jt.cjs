const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(tanpa source)';
console.log('=== SEMUA uang MASUK bernilai 4–6 juta di bulan Juni 2026 ===');
const{data:h}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description,notes')
  .eq('user_id',uid).gte('tx_date','2026-06-01').lte('tx_date','2026-06-30').gte('amount_idr',4000000).lte('amount_idr',6500000).order('tx_date');
const MASUK=['income','reimburse_in','collect_loan','sell_asset'];
for(const r of h||[]){
  const m=MASUK.includes(r.tx_type);
  if(!m)continue;
  console.log(`  ${r.tx_date} +${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${r.tx_type==='income'?'src='+sname(r.from_id):'dari '+nm(r.from_id)} → ${nm(r.to_id)} entity=${r.entity||'-'}`);
  console.log(`       ${(r.description||'').slice(0,70)}`);
  if(r.notes)console.log(`       catatan: ${(r.notes||'').slice(0,60)}`);
}
console.log('\n=== dan yang KELUAR 4–6jt Juni (pembanding) ===');
for(const r of (h||[]).filter(r=>!MASUK.includes(r.tx_type)))
  console.log(`  ${r.tx_date} -${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${nm(r.from_id)} ${r.entity||'-'} | ${(r.description||'').slice(0,45)}`);
console.log('\n=== total reimburse_out Hamasa yg belum berpasangan di Juni ===');
const{data:ro}=await supabase.from('ledger').select('tx_date,amount_idr,description').eq('user_id',uid).eq('tx_type','reimburse_out').gte('tx_date','2026-06-01').lte('tx_date','2026-06-30');
console.log(`  ${(ro||[]).length} baris = ${rp((ro||[]).reduce((s,r)=>s+ +r.amount_idr,0))}`);
process.exit(0);})();
