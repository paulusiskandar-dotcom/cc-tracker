const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,category_name,description').eq('user_id',uid).lt('amount_idr',1000).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('baris dgn amount_idr < 1.000:',led.length,'| total',Math.round(led.reduce((s,r)=>s+ +r.amount_idr,0)).toLocaleString('id-ID'));
const junk=led.filter(r=>/\d{16}\/N|REKENING TAHAPAN/i.test(r.description||''));
console.log('yg berpola "nomor kartu/N" atau "REKENING TAHAPAN":',junk.length);
for(const r of junk.slice(0,12))console.log(` ${r.tx_date} ${String(Math.round(r.amount_idr)).padStart(5)} ${r.tx_type.padEnd(9)} ${(r.category_name||'-').padEnd(22)} | ${(r.description||'').slice(0,52)}`);
const lain=led.filter(r=>!junk.includes(r));
console.log('\nsisanya (nominal kecil wajar):',lain.length);
for(const r of lain.slice(0,6))console.log(` ${r.tx_date} ${String(Math.round(r.amount_idr)).padStart(5)} ${r.tx_type.padEnd(9)} | ${(r.description||'').slice(0,45)}`);
process.exit(0);})();
