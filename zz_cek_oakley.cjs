const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(tanpa source)';
const{data:cr}=await supabase.from('ledger').select('*').eq('user_id',uid).gte('amount_idr',10262000).lte('amount_idr',10263500);
console.log('=== kredit 10.262.701 ===');
for(const r of cr||[])console.log(` ${r.tx_date} ${rp(r.amount_idr)} ${r.tx_type} source=${sname(r.from_id)} → ${nm(r.to_id)} kat=${r.category_name||'(null)'} notes=${r.notes||'-'}\n   desc: ${r.description}`);
console.log('\n=== adakah angsuran bulanan utk 2 Oakley itu? (pokok ÷ 12) ===');
for(const[lab,a]of [['10.328.301',10328301/12],['10.659.590',10659590/12],['6.738.925',6738925/12]]){
  const{data:h}=await supabase.from('ledger').select('tx_date,amount_idr,description').eq('user_id',uid).eq('tx_type','expense').gte('amount_idr',Math.round(a)-2000).lte('amount_idr',Math.round(a)+2000);
  console.log(` ${lab} ÷12 = ${rp(a)} → ketemu ${(h||[]).length} baris ${(h||[]).map(x=>x.tx_date+' '+rp(x.amount_idr)).join(', ')}`);
}
console.log('\n=== SEMUA baris BRI Feb (lihat pola retail/credit) ===');
const bri=accounts.find(a=>a.name==='BRI');
const{data:fb}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,description').eq('user_id',uid).gte('tx_date','2026-02-01').lte('tx_date','2026-02-28').or(`from_id.eq.${bri.id},to_id.eq.${bri.id}`).order('tx_date');
for(const r of fb||[])console.log(`  ${r.tx_date} ${(r.tx_type==='income'?'+':'-')+rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(9)} | ${(r.description||'').slice(0,58)}`);
process.exit(0);})();
