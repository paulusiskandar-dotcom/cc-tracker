const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== transaksi 400–500 juta (mencari yang 480jt) ===');
for(const r of led.filter(r=>+r.amount_idr>=400000000&&+r.amount_idr<=500000000))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(13)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,44)}`);
console.log('\n=== semua pinjaman (give_loan / collect_loan) ===');
for(const r of led.filter(r=>['give_loan','collect_loan'].includes(r.tx_type)))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(13)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,48)}`);
console.log('\n=== tarik tunai / cash keluar besar (≥10jt) ===');
for(const r of led.filter(r=>/TARIK TUNAI|TUNAI|CASH|ATM/i.test(r.description||'')&&+r.amount_idr>=10000000&&!['income','reimburse_in'].includes(r.tx_type)))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(10)} | ${(r.description||'').slice(0,46)}`);
console.log('\n=== setoran tunai MASUK (≥10jt), Maret–Mei ===');
for(const r of led.filter(r=>/SETORAN TUNAI|SETOR/i.test(r.description||'')&&+r.amount_idr>=10000000&&r.tx_date>='2026-03-01'&&r.tx_date<='2026-05-31'))
  console.log(`  ${r.tx_date} +${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} → ${nm(r.to_id).padEnd(9)} | ${(r.description||'').slice(0,42)}`);
console.log('\n=== akun kas (cash) & saldonya ===');
for(const a of accounts.filter(a=>/cash|tunai/i.test(a.name)))
  console.log(`  ${a.name.padEnd(16)} ${a.currency} saldo ${rp(a.current_balance)}`);
process.exit(0);})();
