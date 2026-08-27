const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:led}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,category_name,entity,installment_id,description').eq('user_id',uid).eq('tx_type','expense').ilike('description','%tokopedia%').gte('tx_date','2026-01-01').lte('tx_date','2026-01-31').order('tx_date');
console.log('baris Tokopedia Januari:',(led||[]).length,'=',rp((led||[]).reduce((s,r)=>s+ +r.amount_idr,0)));
for(const r of led||[])console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(12)} ${(r.entity||'-').padEnd(9)} ${r.installment_id?'CICILAN':'       '} ${r.category_name}`);
process.exit(0);})();
