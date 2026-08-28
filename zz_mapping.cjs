const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:m}=await supabase.from('merchant_mappings').select('*').eq('user_id',uid).or('merchant_name.ilike.%GLOBAL%,merchant_name.ilike.%BLIBLI%,merchant_name.ilike.%PAPER%,merchant_name.ilike.%XENDI%');
console.log('=== pemetaan merchant terkait Paper/Blibli ===');
for(const r of m||[])console.log(`  "${r.merchant_name}" [${r.tx_type}] → ${r.category_name||'-'} | entity kolom? ${Object.keys(r).filter(k=>/entity/i.test(k)).join(',')||'TIDAK ADA'}`);
if(!(m||[]).length)console.log('  (tidak ada)');
const{data:one}=await supabase.from('merchant_mappings').select('*').eq('user_id',uid).limit(1).single();
console.log('\nkolom tabel merchant_mappings:',Object.keys(one||{}).join(', '));
console.log('\n=== semua baris Reimbursable Surplus ===');
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sur=(srcs||[]).find(s=>s.name==='Reimbursable Surplus');
const{data:s}=await supabase.from('ledger').select('tx_date,amount_idr,entity,to_id,to_type,description').eq('user_id',uid).eq('from_id',sur.id).order('tx_date');
let t=0;for(const r of s||[]){t+= +r.amount_idr;console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${(r.entity||'-').padEnd(9)} → ${r.to_type} | ${(r.description||'').slice(0,50)}`);}
console.log('  jumlah:',rp(t),'|',(s||[]).length,'baris');
process.exit(0);})();
