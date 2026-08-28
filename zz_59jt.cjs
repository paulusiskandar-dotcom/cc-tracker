const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== LEDGER: semua baris 59.812.500 ===');
const{data:d}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,from_type,to_id,to_type,entity,description,notes').eq('user_id',uid).eq('amount_idr',59812500);
for(const r of d||[])console.log(`  ${r.tx_date} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(10)}[${r.from_type||'-'}] → ${nm(r.to_id).padEnd(14)}[${r.to_type||'-'}] | ${(r.description||'').slice(0,44)}`);
console.log('\n=== STAGING (statement): berapa kali muncul? ===');
const{data:s}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,description,status').eq('user_id',uid).eq('amount',59812500);
if(!s||!s.length)console.log('  tidak ada di staging');
for(const r of s||[])console.log(`  ${r.tx_date} ${rp(r.amount)} ${r.direction} [${r.status}] ${nm(r.account_id)} | ${(r.description||'').slice(0,50)}`);
console.log('\n=== apakah saldo BCA IDR masih cocok? ===');
const b=accounts.find(a=>/^BCA IDR/.test(a.name));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('amount_idr,from_id,from_type,to_id,to_type').eq('user_id',uid).order('id').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const masuk=led.filter(r=>r.to_id===b.id&&r.to_type==='account').reduce((s,r)=>s+ +r.amount_idr,0);
const keluar=led.filter(r=>r.from_id===b.id&&r.from_type==='account').reduce((s,r)=>s+ +r.amount_idr,0);
console.log(`  initial ${rp(b.initial_balance)} + masuk ${rp(masuk)} − keluar ${rp(keluar)} = ${rp(+b.initial_balance+masuk-keluar)}`);
console.log(`  current_balance tersimpan: ${rp(b.current_balance)}`);
console.log(`  ${Math.abs((+b.initial_balance+masuk-keluar)-+b.current_balance)<1?'✓ cocok':'⚠ TIDAK COCOK'}`);
process.exit(0);})();
