const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,amount_idr,category_name,description,merchant_name,notes,source').eq('user_id',uid).in('tx_type',['expense','pay_liability']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const os=led.filter(r=>r.category_name==='Online Shopping');
console.log(`===== Online Shopping: ${os.length} baris, ${rp(os.reduce((s,r)=>s+ +r.amount_idr,0))} =====`);
const by={};os.forEach(r=>{let k=(r.merchant_name||r.description||'?').toUpperCase();
  k=/TOKOPEDIA|TOKPED/.test(k)?'TOKOPEDIA':/SHOPEE/.test(k)?'SHOPEE':/LAZADA/.test(k)?'LAZADA':/BLIBLI/.test(k)?'BLIBLI':/AMAZON/.test(k)?'AMAZON':/TIKTOK/.test(k)?'TIKTOK':/BUKALAPAK/.test(k)?'BUKALAPAK':k.slice(0,24);
  by[k]=by[k]||{n:0,t:0};by[k].n++;by[k].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(by).sort((a,b)=>b[1].t-a[1].t).slice(0,14))console.log(`  ${rp(v.t).padStart(12)} ${String(v.n).padStart(4)}×  ${k}`);
console.log('\n--- apakah deskripsi menyebut BARANGnya? contoh baris marketplace ---');
for(const r of os.filter(r=>/TOKOPEDIA|SHOPEE|LAZADA|BLIBLI/i.test(r.description||'')).slice(0,8))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} src=${(r.source||'-').padEnd(15)} | ${(r.description||'').slice(0,58)}`);
console.log('\n--- Amazon.co.jp yg ada di Travel ---');
for(const r of led.filter(r=>/AMAZON.*JP|AMAZON CO JP/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} kat=${(r.category_name||'-').padEnd(16)} | ${(r.description||'').slice(0,52)}`);
console.log('\n--- Chitose Airport ---');
for(const r of led.filter(r=>/CHITOSE/i.test(r.description||'')))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} kat=${(r.category_name||'-').padEnd(16)} | ${(r.description||'').slice(0,52)}`);
process.exit(0);})();
