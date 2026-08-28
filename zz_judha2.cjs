const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== BCA IDR, 10–15 Maret: seluruh arus ===');
const bcaidr=accounts.find(a=>/^BCA IDR/.test(a.name));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description,notes,source').eq('user_id',uid).gte('tx_date','2026-03-10').lte('tx_date','2026-03-15').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const MASUK=['income','reimburse_in','collect_loan','sell_asset'];
for(const r of led.filter(r=>r.from_id===bcaidr?.id||r.to_id===bcaidr?.id)){
  const arah=r.to_id===bcaidr?.id?'+':'−';
  console.log(`  ${r.tx_date} ${arah}${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} src=${(r.source||'-').padEnd(14)}`);
  console.log(`       ${(r.description||'').slice(0,62)}${r.notes?'\n       catatan: '+r.notes.slice(0,54):''}`);
}
console.log('\n=== dua baris 59.812.500 tanggal 13 Maret — apakah dobel? ===');
const{data:d}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('amount_idr',59812500);
for(const r of d||[]){
  console.log(` ${r.tx_date} ${r.tx_type} ${nm(r.from_id)}→${nm(r.to_id)} entity=${r.entity||'-'} source=${r.source||'-'}`);
  console.log(`   desc: ${(r.description||'').slice(0,64)}`);
  console.log(`   notes: ${(r.notes||'-').slice(0,64)}`);
}
console.log('\n=== apakah 59.812.500 muncul di staging (statement) berapa kali? ===');
const{data:s}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,description,status').eq('user_id',uid).eq('amount',59812500);
for(const r of s||[])console.log(`  ${r.tx_date} ${rp(r.amount)} ${r.direction} [${r.status}] ${nm(r.account_id)} | ${(r.description||'').slice(0,46)}`);
process.exit(0);})();
