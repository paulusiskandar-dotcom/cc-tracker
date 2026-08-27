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
console.log('=== refund yg ditemukan agen: apakah ada di ledger & bagaimana tercatat? ===');
for(const a of [2289545,2387960,884400,10328301]){
  const{data:h}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).gte('amount_idr',a-3000).lte('amount_idr',a+3000);
  console.log(`\n ${rp(a)}:`);
  if(!h||!h.length){console.log('   TIDAK ADA di ledger');continue;}
  for(const r of h)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${r.tx_type==='income'?'src='+sname(r.from_id):nm(r.from_id)}→${nm(r.to_id)} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,44)}`);
}
console.log('\n=== baris 29 Jan yg sudah kuubah jadi piutang (Hikvision-nya ternyata dibatalkan) ===');
const{data:j29}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,notes,description').eq('user_id',uid).eq('tx_date','2026-01-29');
for(const r of j29||[])console.log(`   ${r.tx_type.padEnd(13)} ${rp(r.amount_idr).padStart(11)} ${r.entity||'-'} | ${(r.notes||r.description||'').slice(0,60)}`);
console.log('\n=== semua income/refund Feb dari kartu (cari pembalikan) ===');
const cc=new Set(accounts.filter(a=>a.type==='credit_card').map(a=>a.id));
const{data:fi}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).eq('tx_type','income').gte('tx_date','2026-01-28').lte('tx_date','2026-03-05').order('tx_date');
for(const r of (fi||[]).filter(r=>cc.has(r.to_id)))
  console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(11)} src=${sname(r.from_id).padEnd(20)} ${nm(r.to_id).padEnd(13)} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,40)}`);
process.exit(0);})();
