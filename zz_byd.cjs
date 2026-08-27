const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const aset=accounts.find(a=>a.name==='BYD Seal'&&a.type==='asset');
const hut=accounts.find(a=>a.name==='BYD Seal (Maybank Finance)');
console.log('=== 1. DP BYD 300 juta ===');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const dp=led.filter(r=>r.to_id===aset?.id);
for(const r of dp)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(10)} dari ${nm(r.from_id).padEnd(24)} kategori: ${r.category_name||'TIDAK ADA'}`);
console.log(`  jumlah masuk ke aset: ${rp(dp.reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log(`\n  akun ASET "BYD Seal": nilai sekarang ${rp(aset?.current_value)} · purchase_price tercatat ${rp(aset?.purchase_price)}`);
console.log(`  akun HUTANG "${hut?.name}": sisa ${rp(hut?.outstanding_amount)}`);
console.log(`  kekayaan bersih dari mobil = ${rp(Number(aset?.current_value||0)-Number(hut?.outstanding_amount||0))}`);
console.log('\n=== 2. pembayaran ke Akbarsyah ===');
const ak=led.filter(r=>/AKBARSYAH/i.test(r.description||''));
for(const r of ak)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(9)} ${nm(r.from_id).padEnd(9)} kategori: ${r.category_name||'-'}`);
console.log(`  total ${rp(ak.reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log('\n=== 3. isi kategori Vehicle sekarang ===');
const v=led.filter(r=>r.category_name==='Vehicle');
console.log(`  ${v.length} baris = ${rp(v.reduce((s,r)=>s+ +r.amount_idr,0))}`);
for(const r of v)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(11)} | ${(r.description||'').slice(0,42)}`);
process.exit(0);})();
