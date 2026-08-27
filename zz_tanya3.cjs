const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== SOIA-HO & MVA Close ===');
const{data:a}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,description').eq('user_id',uid).or('description.ilike.%SOIA%,description.ilike.%MVA Close%');
for(const r of a||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.tx_type} dari ${nm(r.from_id)} | ${r.description}`);
console.log('\n=== Tokopedia 1.092.013 (18 Apr, Mega Metro) — adakah reimburse_in pasangannya? ===');
const{data:b}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,to_id,from_id,description').eq('user_id',uid)
  .gte('tx_date','2026-04-15').lte('tx_date','2026-06-15').gte('amount_idr',1000000).lte('amount_idr',1300000).order('tx_date');
const MASUK=['income','reimburse_in'];
for(const r of (b||[]).filter(r=>MASUK.includes(r.tx_type)))
  console.log(`  ${r.tx_date} +${rp(r.amount_idr).padStart(10)} ${r.tx_type.padEnd(13)} entity=${r.entity||'-'} → ${nm(r.to_id)} | ${(r.description||'').slice(0,50)}`);
console.log('  (kalau kosong: tidak ada kredit senilai ~1,09jt di rentang itu)');
console.log('\n=== reimburse_in SDC sepanjang tahun (cari yang belum berpasangan) ===');
const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,description').eq('user_id',uid).eq('tx_type','reimburse_in').eq('entity','SDC').order('tx_date');
for(const r of c||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} | ${(r.description||'').slice(0,48)}`);
console.log('\n=== sisa transfer kecil yg belum diketahui ===');
const NAMA=['DENNIS FERDIYANTO','PGDP PLUIT','REV STORE','AHMAD MUSTOFA','PUTRI DWIYANI','WIYANTO','6863GUARD','CAHAYA MANDIRI','MITRA ADIJAYA','MOCH YUSUF','GALUH PUTRA'];
let tot=0;
for(const n of NAMA){const{data:d}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,description').eq('user_id',uid).eq('category_name','Online Shopping').ilike('description',`%${n}%`);
  for(const r of d||[]){tot+= +r.amount_idr;console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(9)} ${nm(r.from_id).padEnd(9)} | ${(r.description||'').slice(0,44)}`);}}
console.log(`  TOTAL ${rp(tot)}`);
process.exit(0);})();
