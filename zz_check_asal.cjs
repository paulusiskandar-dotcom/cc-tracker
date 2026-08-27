const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const exp=led.filter(r=>r.tx_type==='expense');
for(const[lab,re,win]of[['GRAND FRONT OSAKA',/GRAND FRONT OSAKA/i,['2026-05-20','2026-06-30']],['APPLE.COM/BILL',/APPLE\.COM\/BILL/i,['2026-03-01','2026-04-30']],['belanja Eropa (Stockholm/Berlin) Mar',/STOCKHOLM|BERLIN|SWE\b|SEK/i,['2026-03-01','2026-03-31']]]){
  const hit=exp.filter(r=>re.test(r.description||'')&&r.tx_date>=win[0]&&r.tx_date<=win[1]);
  console.log(`\n${lab}: ${hit.length} tagihan expense (${rp(hit.reduce((s,r)=>s+ +r.amount_idr,0))})`);
  const bycat={};hit.forEach(r=>bycat[r.category_name||'(null)']=(bycat[r.category_name||'(null)']||0)+ +r.amount_idr);
  for(const[c,v]of Object.entries(bycat))console.log(`   ${c}: ${rp(v)}`);
  for(const r of hit.slice(0,4))console.log(`    ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.category_name||'(null)'} | ${(r.description||'').slice(0,50)}`);
}
process.exit(0);
})();
