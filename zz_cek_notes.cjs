const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:sp}=await supabase.from('ledger').select('tx_date,amount_idr,notes').eq('user_id',uid).eq('source','split-email').lte('tx_date','2026-01-31').order('tx_date');
console.log('catatan sebenarnya pada 6 baris pecahan Januari:');
for(const r of sp||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} → "${r.notes}"`);
process.exit(0);})();
