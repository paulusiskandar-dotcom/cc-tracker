const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== SEMUA baris 387.390 (internet SDC) ===');
for(const r of led.filter(r=>+r.amount_idr===387390))
  console.log(`  ${r.tx_date} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id).padEnd(14)} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== apakah 3.215.930 / 1.950.000 / 5.147.838 muncul di mana pun? ===');
for(const a of[3215930,1950000,5147838]){
  const h=led.filter(r=>+r.amount_idr===a);
  console.log(`  ${rp(a)}: ${h.length} baris`);
  for(const r of h)console.log(`     ${r.tx_date} ${r.tx_type} ${r.entity} ${nm(r.from_id)} | ${(r.description||'').slice(0,50)}`);
}
console.log('\n=== baris staging yang belum tersambung (mungkin tagihannya di sini) ===');
const{data:st}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,status,account_id').eq('user_id',uid).neq('status','connected').order('tx_date');
console.log('  jumlah baris staging belum tersambung:',(st||[]).length);
for(const r of(st||[]).slice(0,25))console.log(`     ${r.tx_date} ${rp(r.amount).padStart(12)} ${r.direction} ${nm(r.account_id).padEnd(14)} | ${(r.description||'').slice(0,44)}`);
process.exit(0);})();
