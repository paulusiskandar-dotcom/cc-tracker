const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const NOISE=/^(backfill|statement |imported from|migrated|auto|ipl\/internet)/i;
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,category_name,notes,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const guna=r=>{const n=(r.notes||'').trim();return n&&!NOISE.test(n);};
for(const[lab,re]of [['TOKOPEDIA',/tokopedia/i],['LAZADA',/lazada/i],['SHOPEE',/shopee/i]]){
  const k=led.filter(r=>re.test(r.description||'')&&!guna(r));
  console.log(`\n=== ${lab}: ${k.length} baris tanpa deskripsi = ${rp(k.reduce((s,r)=>s+ +r.amount_idr,0))} ===`);
  const g={};k.forEach(r=>{g[r.tx_type]=g[r.tx_type]||{n:0,t:0};g[r.tx_type].n++;g[r.tx_type].t+= +r.amount_idr;});
  for(const[t,v]of Object.entries(g))console.log(`  ${t.padEnd(14)} ${String(v.n).padStart(3)} baris ${rp(v.t).padStart(13)}`);
  for(const r of k.slice(0,18))console.log(`    ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(13)}`);
  if(k.length>18)console.log(`    … dan ${k.length-18} lagi`);
}
process.exit(0);})();
