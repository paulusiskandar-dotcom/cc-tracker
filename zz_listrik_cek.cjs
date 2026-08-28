const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,from_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== semua baris menyebut LISTRIK / PLN / token ===');
for(const r of led.filter(r=>/LISTRIK|\bPLN\b/i.test((r.description||'')+' '+(r.category_name||''))))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(9)} ${nm(r.from_id).padEnd(13)} kat=${(r.category_name||'-').slice(0,18).padEnd(18)} | ${(r.description||'').slice(0,40)}`);
console.log('\n=== apakah ada reimburse_out Hamasa berkategori listrik/utilitas? ===');
const ro=led.filter(r=>r.tx_type==='reimburse_out'&&r.entity==='Hamasa'&&/LISTRIK|PLN|Utilit|Housing/i.test((r.description||'')+' '+(r.category_name||'')));
console.log('  ketemu',ro.length,'baris');
for(const r of ro)console.log(`  ${r.tx_date} ${rp(r.amount_idr)} | ${(r.description||'').slice(0,50)}`);
console.log('\n=== 4 surplus besar vs pembayaran listrik terdekat ===');
for(const[d,v]of[['2026-07-03',4737046],['2026-07-03',4716047],['2026-08-03',3031427],['2026-08-18',5121491]]){
  const dekat=led.filter(r=>Math.abs(+r.amount_idr-v)<=600000&&r.tx_type!=='income'&&Math.abs(new Date(r.tx_date)-new Date(d))/864e5<=75);
  console.log(`\n  surplus ${rp(v)} (${d}) — kandidat sepadan ±600rb dalam 75 hari: ${dekat.length}`);
  for(const r of dekat.slice(0,4))console.log(`     ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} | ${(r.description||'').slice(0,44)}`);
}
process.exit(0);})();
