const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,description,notes').eq('user_id',uid).eq('tx_type','expense').ilike('description','%TOKOPEDIA%').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const cic=led.filter(r=>/CCL12|CYBS/i.test(r.description||''));
// kelompokkan per "seri": angsuran x/12 dgn nominal yg mirip (±20)
const seri={};
for(const r of cic){
  const f=(r.description||'').match(/(\d{1,2})\/(\d{1,2})/);
  const kunci=Object.keys(seri).find(k=>Math.abs(Number(k)-+r.amount_idr)<=20);
  const k=kunci||String(Math.round(r.amount_idr));
  seri[k]=seri[k]||[];seri[k].push({...r,ke:f?f[1]:'?'});
}
console.log('seri angsuran Tokopedia (nominal ±20 dianggap sama):\n');
for(const[k,v]of Object.entries(seri).sort((a,b)=>b[1].length-a[1].length)){
  const note=v.map(x=>x.notes).find(n=>n&&!/^backfill|^statement/i.test(n));
  console.log(`${rp(k).padStart(11)} × ${String(v.length).padStart(2)} → ${note?note.slice(0,52):'BELUM ADA DESKRIPSI'}`);
  console.log(`    ${v.map(x=>`${x.tx_date.slice(5)}(${x.ke})`).join(' ')}`);
}
process.exit(0);})();
