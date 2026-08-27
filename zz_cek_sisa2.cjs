const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:t}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,currency,fx_rate_used,from_id,to_id,description').eq('user_id',uid).ilike('description','%Top-up JPY%');
console.log('=== baris top-up JPY ===');
for(const r of t||[])console.log(` ${r.tx_date} tipe=${r.tx_type} amount=${r.amount} ${r.currency} idr=${rp(r.amount_idr)} fx=${r.fx_rate_used||'-'} ${nm(r.from_id)}→${nm(r.to_id)} | ${r.description}`);
console.log('   → masuk hitungan Reports?', (t||[]).some(r=>['expense','pay_liability','income'].includes(r.tx_type))?'YA':'TIDAK (tipe transfer)');
const{data:g}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,description,source,created_at').eq('user_id',uid).ilike('description','%Mobile Legends%').order('tx_date');
console.log('\n=== Google Play Mobile Legends ===');
for(const r of g||[])console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(8)} ${nm(r.from_id)} src=${r.source} dibuat ${r.created_at.slice(0,19)} | ${(r.description||'').slice(0,45)}`);
const{data:p}=await supabase.from('ledger').select('id,tx_date,amount_idr,description,source,created_at,notes').eq('user_id',uid).eq('tx_type','pay_cc').eq('tx_date','2026-06-01');
console.log('\n=== pay_cc 1 Juni ===');
for(const r of p||[])console.log(` ${rp(r.amount_idr).padStart(11)} src=${r.source} dibuat ${r.created_at.slice(0,19)} | ${(r.description||'').slice(0,40)}`);
process.exit(0);})();
