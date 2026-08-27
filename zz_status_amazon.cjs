const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const az=led.filter(r=>/AMAZON/i.test(r.description||''));
console.log('SEMUA baris Amazon di ledger:',az.length,'=',rp(az.reduce((s,r)=>s+ +r.amount_idr,0)),'\n');
for(const r of az){
  const tahu=r.notes&&!/backfill|statement rebuild|Imported from/i.test(r.notes);
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(13)} ${(r.category_name||'-').padEnd(24)} ${tahu?'✓':'✗ belum'} | ${(r.description||'').slice(0,34)}`);
  if(tahu)console.log(`       ${r.notes.slice(0,80)}`);
}
const belum=az.filter(r=>!(r.notes&&!/backfill|statement rebuild|Imported from/i.test(r.notes)));
console.log(`\nsudah teridentifikasi: ${az.length-belum.length} · belum: ${belum.length} (${rp(belum.reduce((s,r)=>s+ +r.amount_idr,0))})`);
for(const r of belum)console.log(`  BELUM: ${r.tx_date} ${rp(r.amount_idr).padStart(11)} | ${(r.description||'').slice(0,52)}`);
process.exit(0);})();
