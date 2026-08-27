const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const ccIds=new Set(accounts.filter(a=>a.type==='credit_card').map(a=>a.id));
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(?)';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).eq('tx_type','income').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
// income masuk ke CC, dikelompokkan per income source
const intoCC=led.filter(r=>ccIds.has(r.to_id));
const bys={};intoCC.forEach(r=>{const s=sname(r.from_id);bys[s]=bys[s]||{n:0,t:0,rows:[]};bys[s].n++;bys[s].t+=Number(r.amount_idr||0);bys[s].rows.push(r);});
console.log('income rows credited INTO a CC, per source:');
for(const[s,v]of Object.entries(bys)){console.log(` ${s}: ${v.n} rows = ${rp(v.t)}`);
  if(s!=='Refund')for(const r of v.rows.slice(0,6))console.log('   ',r.tx_date,rp(r.amount_idr),nm(r.to_id),'|',(r.description||'').slice(0,45));}
// income dari source Refund yang masuk ke BANK (bukan CC)
const refundId=(srcs||[]).find(s=>s.name==='Refund')?.id;
const refBank=led.filter(r=>r.from_id===refundId&&!ccIds.has(r.to_id));
console.log('\nRefund-source rows credited to BANK:',refBank.length);
for(const r of refBank.slice(0,8))console.log('   ',r.tx_date,rp(r.amount_idr),nm(r.to_id),r.category_name||'(null)','|',(r.description||'').slice(0,40));
process.exit(0);
})();
