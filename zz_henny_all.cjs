const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'-';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const H=led.filter(r=>/HENNY|BU HEN|BU HER/i.test((r.description||'')+' '+(r.notes||'')));
const MASUK=['income','reimburse_in','collect_loan','sell_asset'];
const masuk=H.filter(r=>MASUK.includes(r.tx_type));
console.log(`=== UANG MASUK terkait Henny Djohari: ${masuk.length} transaksi ===\n`);
let tot=0;
for(const r of masuk){tot+= +r.amount_idr;
  const ket=r.tx_type==='income'?`income · ${sname(r.from_id)}`:r.tx_type;
  console.log(`  ${r.tx_date}  ${rp(r.amount_idr).padStart(12)}  ${ket.padEnd(26)} ${(r.entity||'-').padEnd(8)} → ${nm(r.to_id)}`);
  console.log(`              ${(r.description||'').slice(0,70)}`);}
console.log(`\n  TOTAL MASUK: ${rp(tot)}`);
console.log('\n=== rekap per jenis ===');
const g={};masuk.forEach(r=>{const k=r.tx_type==='income'?`income · ${sname(r.from_id)}`:r.tx_type;g[k]=g[k]||{n:0,t:0};g[k].n++;g[k].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(g).sort((a,b)=>b[1].t-a[1].t))console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(2)}× ${rp(v.t).padStart(13)}`);
console.log('\n=== rekap per entity ===');
const e={};masuk.forEach(r=>{const k=r.entity||'-';e[k]=e[k]||{n:0,t:0};e[k].n++;e[k].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(e).sort((a,b)=>b[1].t-a[1].t))console.log(`  ${k.padEnd(10)} ${String(v.n).padStart(2)}× ${rp(v.t).padStart(13)}`);
const keluar=H.filter(r=>!MASUK.includes(r.tx_type));
console.log(`\n=== uang KELUAR terkait Henny: ${keluar.length} transaksi ===`);
let tk=0;for(const r of keluar){tk+= +r.amount_idr;console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} | ${(r.description||r.notes||'').slice(0,50)}`);}
console.log(`  TOTAL KELUAR: ${rp(tk)}`);
console.log(`\n  SELISIH (masuk − keluar): ${rp(tot-tk)}`);
process.exit(0);})();
