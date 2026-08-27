const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,category_name,description').eq('user_id',uid).in('tx_type',['expense','pay_liability']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const os=led.filter(r=>r.category_name==='Online Shopping');
console.log('Online Shopping sekarang:',os.length,'baris =',rp(os.reduce((s,r)=>s+ +r.amount_idr,0)));
const m={};os.forEach(r=>{const k=r.tx_date.slice(0,7);m[k]=m[k]||{n:0,t:0};m[k].n++;m[k].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(m).sort())console.log(`  ${k}: ${String(v.n).padStart(3)} baris ${rp(v.t).padStart(13)}`);
const jan=led.filter(r=>r.tx_date.slice(0,7)==='2026-01');
console.log('\ntotal expense Januari sekarang:',rp(jan.reduce((s,r)=>s+ +r.amount_idr,0)));
process.exit(0);})();
