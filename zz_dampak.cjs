const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,reimburse_settlement_id,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const ent={};
for(const r of led){const e=r.entity||'(kosong)';ent[e]=ent[e]||{out:0,in:0};ent[e][r.tx_type==='reimburse_out'?'out':'in']+= +r.amount_idr;}
console.log('=== piutang per entitas (SEMUA baris, termasuk yg sudah dilunasi) ===');
console.log('  entitas    keluar(dibayarkan)   masuk(diganti)      selisih');
for(const[e,v]of Object.entries(ent).sort((a,b)=>b[1].in-a[1].in))
  console.log(`  ${e.padEnd(10)} ${rp(v.out).padStart(15)} ${rp(v.in).padStart(18)} ${rp(v.out-v.in).padStart(15)}`);
const H=ent['Hamasa'],P=ent['Personal'];
console.log('\n=== kalau pasangan 11 Maret dipindah jadi Dividen ===');
console.log(`  Hamasa   : ${rp(H.out-H.in)}  →  ${rp(H.out-H.in+48000000)}   (buang reimburse_in 48jt)`);
console.log(`  Personal : ${rp(P.out-P.in)}  →  ${rp(P.out-P.in+52000000)}   (buang reimburse_in 52jt)`);
console.log(`\n  statement OCBC 90N Feb+Mar yang belum masuk: ${rp(365600000)}`);
console.log(`  sisa Hamasa setelah OCBC masuk           : ${rp(H.out-H.in+48000000+365600000)}`);
process.exit(0);})();
