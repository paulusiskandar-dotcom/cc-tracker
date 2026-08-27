const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const lz=led.filter(r=>/LAZADA/i.test(r.description||''));
console.log('SEMUA baris Lazada di ledger:',lz.length);
for(const r of lz)console.log(`  ${r.tx_date} (tgl ${r.tx_date.slice(8)}) ${rp(r.amount_idr).padStart(10)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(9)}→${nm(r.to_id).padEnd(15)} ${r.entity||'-'} | ${(r.description||'').slice(0,42)}`);
console.log('\nrekap: berapa yg sudah reimburse_out vs expense');
const g={};lz.forEach(r=>{g[r.tx_type]=g[r.tx_type]||{n:0,t:0};g[r.tx_type].n++;g[r.tx_type].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(g))console.log(`  ${k}: ${v.n} baris ${rp(v.t)}`);
console.log('\nyang MASIH expense (kandidat aturan baru):');
for(const r of lz.filter(r=>r.tx_type==='expense'))
  console.log(`  ${r.tx_date} tgl-${r.tx_date.slice(8)} ${rp(r.amount_idr).padStart(10)} kat=${r.category_name} | ${(r.description||'').slice(0,45)}`);
process.exit(0);})();
