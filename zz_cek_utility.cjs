const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
console.log('income source yang ada:',(srcs||[]).map(s=>s.name).join(' · '));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('\n=== semua expense berkategori Housing & Utilities (kandidat listrik yg belum jadi piutang) ===');
const hu=led.filter(r=>r.tx_type==='expense'&&r.category_name==='Housing & Utilities');
console.log(`${hu.length} baris = ${rp(hu.reduce((s,r)=>s+ +r.amount_idr,0))}`);
for(const r of hu)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(14)} | ${(r.description||'').slice(0,44)} ${r.notes?'· '+r.notes.slice(0,34):''}`);
console.log('\n=== setoran tunai ke BCA R (pola penggantian gelondongan) ===');
const bcar=accounts.find(a=>a.name==='BCA R');
for(const r of led.filter(r=>r.to_id===bcar?.id&&['income','reimburse_in'].includes(r.tx_type)&&/SETORAN|TUNAI/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} entity=${(r.entity||'-').padEnd(8)} | ${(r.description||'').slice(0,52)}`);
process.exit(0);})();
