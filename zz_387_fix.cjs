// Lazada 387.390 (18 Mar, Jenius) tertulis entitas Hamasa, padahal itu internet SDC:
// nominal identik dengan langganan internet SDC, merchant sama (Lazada 622150820544),
// dan slot bulanannya pas — Des(staging) Feb Mar Apr Mei semuanya internet SDC.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:r}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-03-18').eq('amount_idr',387390).eq('entity','Hamasa').single();
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/387-${Date.now()}.json`,JSON.stringify(r,null,2));
await supabase.from('ledger').update({entity:'SDC',description:'LAZADA — internet SDC Maret (diganti SDC 24 Apr); dulu salah masuk entitas Hamasa'}).eq('id',r.id);
console.log('- 387.390 (18 Mar) dipindah Hamasa → SDC');
let led=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(x||[]);if(!x||x.length<1000)break;}
for(const[label,f]of[['SELURUHNYA',()=>true],['BERJALAN',r=>!r.reimburse_settlement_id]]){
  const e={};for(const q of led.filter(f)){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
  console.log(`\n=== piutang ${label} ===`);
  for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
}
process.exit(0);})();
