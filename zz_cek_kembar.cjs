const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,description,source,notes,created_at').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const g={};
for(const r of led){const k=[r.tx_date,Math.round(r.amount_idr),r.from_id,r.to_id,(r.description||'').slice(0,40)].join('|');(g[k]=g[k]||[]).push(r);}
const grp=Object.entries(g).filter(([,v])=>v.length>1);
console.log('kelompok kembar:',grp.length,'\n');
let staging=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,description,status').eq('user_id',uid).order('id').range(off,off+999);staging=staging.concat(c||[]);if(!c||c.length<1000)break;}
for(const[k,v]of grp){
  const r=v[0];
  const acc=r.from_id||r.to_id;
  const st=staging.filter(s=>s.account_id===acc&&s.tx_date===r.tx_date&&Math.abs(+s.amount-Math.round(r.amount_idr))<1&&s.status!=='rejected');
  const dampak=['expense','pay_liability','income'].includes(r.tx_type);
  console.log(`${v.length}× ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${nm(r.from_id)}→${nm(r.to_id)}`);
  console.log(`     "${(r.description||'').slice(0,58)}"`);
  console.log(`     statement mendukung ${st.length} baris | ${dampak?'MEMPENGARUHI Reports':'tidak masuk Reports'} | source: ${v.map(x=>x.source||'-').join(',')} | dibuat: ${v.map(x=>(x.created_at||'').slice(0,10)).join(', ')}`);
  console.log(`     ${st.length>=v.length?'✓ statement memang memuat sebanyak itu':st.length===0?'? tidak ada di staging (mungkin input manual/app)':'⚠ statement hanya '+st.length+' — kandidat dobel'}\n`);
}
process.exit(0);})();
