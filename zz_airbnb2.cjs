const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== cari 35.550.000 (nilai penggantian menurut sheet) di LEDGER ===');
const{data:a}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,description').eq('user_id',uid).gte('amount_idr',35400000).lte('amount_idr',35700000);
if(!a||!a.length)console.log('  TIDAK ADA');
for(const r of a||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,46)}`);
console.log('\n=== cari juga di STAGING (termasuk Desember yg ditolak) ===');
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,description,status').eq('user_id',uid).gte('amount',35400000).lte('amount',35700000).range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
if(!st.length)console.log('  TIDAK ADA');
for(const r of st)console.log(`  ${r.tx_date} ${rp(r.amount).padStart(12)} ${r.direction} [${r.status}] ${nm(r.account_id)} | ${(r.description||'').slice(0,46)}`);
console.log('\n=== semua tagihan Airbnb & apakah ada tagihan kedua ===');
const{data:b}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,entity,category_name,description').eq('user_id',uid).ilike('description','%AIRBNB%').order('tx_date');
for(const r of b||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(8)} ${(r.entity||'-').padEnd(8)} | ${(r.description||'').slice(0,40)}`);
console.log('\n=== kredit masuk 1–31 Maret (mencari penggantiannya) ===');
const MASUK=['income','reimburse_in','collect_loan','sell_asset'];
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,to_id,entity,description').eq('user_id',uid).gte('tx_date','2026-03-01').lte('tx_date','2026-03-31').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const r of led.filter(r=>MASUK.includes(r.tx_type)&&+r.amount_idr>=5000000))
  console.log(`  ${r.tx_date} +${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} → ${nm(r.to_id).padEnd(9)} | ${(r.description||'').slice(0,44)}`);
process.exit(0);})();
