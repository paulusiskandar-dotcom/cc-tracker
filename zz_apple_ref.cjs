const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const oc=accounts.find(a=>a.name==='OCBC 90N');
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const ref=(srcs||[]).find(s=>s.name==='Refund');
const{data:r}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('tx_date','2026-03-02').eq('amount_idr',239000).eq('tx_type','reimburse_in').single();
await supabase.from('ledger').update({tx_type:'income',from_type:'income_source',from_id:ref.id,reimburse_settlement_id:null,
  description:'APPLE.COM/BILL — refund langganan'}).eq('id',r.id);
console.log('- refund Apple 239.000 jadi income/Refund (bukan penggantian)');
let led=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(x||[]);if(!x||x.length<1000)break;}
for(const[label,f]of[['SELURUHNYA',()=>true],['BERJALAN (belum dicap)',q=>!q.reimburse_settlement_id]]){
  const e={};for(const q of led.filter(f)){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
  console.log(`\n=== piutang ${label} ===`);
  for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
}
process.exit(0);})();
