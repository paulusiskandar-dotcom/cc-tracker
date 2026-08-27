const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,from_type,to_id,to_type,category_name,reimburse_settlement_id,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('total baris ledger:',led.length);

const RE=/AGNES|CAKUNG|HANG ?TUAH|CRYSTAL|MAHLIGAI|SERAMBI/i;
console.log('\n=== SEMUA baris menyinggung Agnes / Cakung Serambi / Hang Tuah / Crystal Mahligai ===');
let masukAgnes=0,keluarCakung=0;
for(const r of led.filter(r=>RE.test((r.description||'')+' '+(r.notes||'')))){
  const arah=r.to_type==='account'?'MASUK':'KELUAR';
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(13)} ${arah.padEnd(6)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)}`);
  console.log(`      ${(r.description||'').slice(0,88)}`);
  if(/AGNES/i.test(r.description||'')&&r.to_type==='account')masukAgnes+= +r.amount_idr;
  if(/CAKUNG|SERAMBI/i.test(r.description||'')&&r.tx_type!=='expense')keluarCakung+= +r.amount_idr;
}
console.log(`\n  jumlah masuk dari Agnes : ${rp(masukAgnes)}`);
console.log(`  jumlah keluar ke Cakung : ${rp(keluarCakung)}  (baris ganda buy_asset+reimburse_out dihitung dua kali)`);

console.log('\n=== aset yang tercatat (buy_asset / sell_asset) ===');
for(const r of led.filter(r=>['buy_asset','sell_asset'].includes(r.tx_type)))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(10)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,54)}`);

for(const E of['SDC','Personal']){
  console.log(`\n=== SEMUA baris reimburse entitas ${E} ===`);
  const rows=led.filter(r=>['reimburse_out','reimburse_in'].includes(r.tx_type)&&r.entity===E);
  let o=0,i=0;
  for(const r of rows){
    r.tx_type==='reimburse_out'?o+= +r.amount_idr:i+= +r.amount_idr;
    console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type==='reimburse_out'?'keluar':'masuk '} ${r.reimburse_settlement_id?'lunas':'BUKA '} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,48)}`);
  }
  console.log(`  --- keluar ${rp(o)} | masuk ${rp(i)} | selisih ${rp(o-i)}`);
}
process.exit(0);})();
