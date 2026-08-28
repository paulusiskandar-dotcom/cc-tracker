const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
console.log('=== akun bertipe bank/kas dengan mata uang IDR ===');
for(const a of accounts.filter(a=>a.type==='bank'&&(!a.currency||a.currency==='IDR')))
  console.log(`  ${a.name.padEnd(22)} saldo ${rp(a.current_balance).padStart(14)}`);
console.log('\n=== adakah akun bernama Cash/Kas/Tunai berdenominasi rupiah? ===');
const kas=accounts.filter(a=>/cash|kas|tunai/i.test(a.name));
for(const a of kas)console.log(`  ${a.name.padEnd(18)} ${a.currency||'IDR'} · saldo ${rp(a.current_balance)}`);
console.log(kas.some(a=>!a.currency||a.currency==='IDR')?'':'  → TIDAK ADA akun kas rupiah sama sekali');
console.log('\n=== dividen Hamasa 479jt: yang sudah tercatat diterima ===');
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const div=(srcs||[]).find(s=>s.name==='Dividend');
const{data:d}=await supabase.from('ledger').select('tx_date,amount_idr,description,to_id').eq('user_id',uid).eq('tx_type','income').eq('from_id',div?.id).order('tx_date');
let t=0;const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
for(const r of d||[]){t+= +r.amount_idr;console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} → ${nm(r.to_id).padEnd(9)} | ${(r.description||'').slice(0,50)}`);}
console.log(`  TOTAL dividen tercatat: ${rp(t)}`);
process.exit(0);})();
