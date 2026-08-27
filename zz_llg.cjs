const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const bcar=accounts.find(a=>a.name==='BCA R');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,category_name,reimburse_settlement_id,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== semua baris LLG (mana pun akunnya) ===');
for(const r of led.filter(r=>/LLG/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)} ${r.reimburse_settlement_id?'lunas':'BUKA '}\n      ${(r.description||'').slice(0,86)}`);
console.log('\n=== semua baris 34–38 juta di SELURUH akun ===');
for(const r of led.filter(r=>+r.amount_idr>=34000000&&+r.amount_idr<=38000000))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)} ${r.reimburse_settlement_id?'lunas':'BUKA '}\n      ${(r.description||'').slice(0,86)}`);
process.exit(0);})();
