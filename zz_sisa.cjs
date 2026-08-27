const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,description,created_at').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== SDC per bulan ===');
const bl={};for(const r of led.filter(r=>r.entity==='SDC')){const m=r.tx_date.slice(0,7);bl[m]=bl[m]||{o:0,i:0};bl[m][r.tx_type==='reimburse_out'?'o':'i']+= +r.amount_idr;}
let k=0;for(const[m,v]of Object.entries(bl).sort()){k+=v.o-v.i;console.log(`  ${m}  keluar ${rp(v.o).padStart(12)}  masuk ${rp(v.i).padStart(12)}  selisih ${rp(v.o-v.i).padStart(12)}  kumulatif ${rp(k).padStart(12)}`);}
console.log('\n=== baris kembar persis (tanggal + nominal + entitas sama, lebih dari satu) ===');
const key={};for(const r of led){const s=[r.tx_date,r.amount_idr,r.tx_type,r.entity].join('|');(key[s]=key[s]||[]).push(r);}
for(const[s,v]of Object.entries(key))if(v.length>1){
  console.log(`  ${s}  ×${v.length}`);
  for(const r of v)console.log(`      ${r.id.slice(0,8)} dibuat ${r.created_at.slice(0,19)} | ${(r.description||'').slice(0,64)}`);
}
process.exit(0);})();
