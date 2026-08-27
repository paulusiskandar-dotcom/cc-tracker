const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:h}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,category_name,description,notes').eq('user_id',uid)
  .gte('tx_date','2026-02-01').lte('tx_date','2026-02-05').gte('amount_idr',10000000).order('tx_date');
console.log('rangkaian Oakley 2–3 Februari:');
let net=0;
for(const r of h||[]){const masuk=r.tx_type==='income';net+=(masuk?-1:1)* +r.amount_idr;
  console.log(`  ${r.tx_date} ${(masuk?'+':'-')+rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(8)} | ${(r.description||'').slice(0,44)}${r.notes?' · '+r.notes.slice(0,30):''}`);}
console.log(`\n  netto yang benar-benar keluar: ${rp(net)} — satu kacamata, bukan dua`);
process.exit(0);})();
