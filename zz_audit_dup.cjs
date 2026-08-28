const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('*').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const key={};for(const r of led){const k=[r.tx_date,r.amount_idr,r.tx_type,r.from_id,r.to_id].join('|');(key[k]=key[k]||[]).push(r);}
const dup=Object.values(key).filter(v=>v.length>1).sort((x,y)=>+y[0].amount_idr-+x[0].amount_idr);
console.log(`${dup.length} kelompok duplikat\n`);
for(const v of dup){
  console.log(`${v[0].tx_date} ${rp(v[0].amount_idr).padStart(12)} ×${v.length}  ${v[0].tx_type}  ${nm(v[0].from_id)}→${nm(v[0].to_id)}`);
  for(const r of v)console.log(`    ${r.id.slice(0,8)} src=${(r.source||'-').padEnd(14)} dibuat=${(r.created_at||'').slice(0,16)} kat=${(r.category_name||'-').slice(0,18).padEnd(18)} | ${(r.description||'').slice(0,44)}`);
}
process.exit(0);})();
