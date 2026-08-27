const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
console.log('kategori aktif:',(cats||[]).map(c=>c.name).join(' · '));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,category_name,description,merchant_name').eq('user_id',uid).in('tx_type',['expense','pay_liability']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const K of ['Travel','Transport']){
  const rows=led.filter(r=>r.category_name===K);
  console.log(`\n===== ${K}: ${rows.length} baris, ${rp(rows.reduce((s,r)=>s+ +r.amount_idr,0))} =====`);
  const by={};rows.forEach(r=>{const k=(r.merchant_name||r.description||'?').slice(0,30).toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim().slice(0,22);
    by[k]=by[k]||{n:0,t:0};by[k].n++;by[k].t+= +r.amount_idr;});
  const top=Object.entries(by).sort((a,b)=>b[1].t-a[1].t).slice(0,16);
  for(const[k,v]of top)console.log(`  ${rp(v.t).padStart(12)}  ${String(v.n).padStart(3)}×  ${k}`);
}
// seberapa besar belanja yg terjadi DI LUAR NEGERI, per kategori
console.log('\n===== belanja bertanda luar negeri, per kategori =====');
const fx=led.filter(r=>/BILLED AS|EUR 1 = |1 SGD = |@ 1[01][0-9]\.|JPN|SGP|DEU|SWE| DE\b| SE\b/i.test(r.description||''));
const g={};fx.forEach(r=>{const k=r.category_name||'(null)';g[k]=g[k]||{n:0,t:0};g[k].n++;g[k].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(g).sort((a,b)=>b[1].t-a[1].t))console.log(`  ${rp(v.t).padStart(12)}  ${String(v.n).padStart(3)}×  ${k}`);
console.log('  TOTAL belanja luar negeri:',rp(fx.reduce((s,r)=>s+ +r.amount_idr,0)));
process.exit(0);})();
