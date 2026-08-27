const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:mar}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,description').eq('user_id',uid).eq('tx_type','expense').gte('tx_date','2026-03-01').lte('tx_date','2026-03-31').ilike('description','%tokopedia%').order('tx_date');
console.log('TOKOPEDIA MARET:');
console.log((mar||[]).map(r=>`${r.tx_date.slice(8)}-03 ${rp(r.amount_idr)} ${nm(r.from_id)}${/CCL|\d+\/\d+/i.test(r.description||'')?' [CICILAN]':''}`).join(' · '));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).eq('tx_type','expense').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('\nSHOPEE / LAZADA / TIKTOK (semua bulan):');
for(const[lab,re]of [['SHOPEE',/SHOPEE/i],['LAZADA',/LAZADA/i],['TIKTOK/TTS',/TTS BY TKPD|TIKTOK/i]]){
  const h=led.filter(r=>re.test(r.description||''));
  console.log(` ${lab}: ${h.length} baris ${rp(h.reduce((s,r)=>s+ +r.amount_idr,0))}`);
  for(const r of h)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${nm(r.from_id).padEnd(14)} kat=${r.category_name} | ${(r.description||'').slice(0,40)}`);
}
process.exit(0);})();
