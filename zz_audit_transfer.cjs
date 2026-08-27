// AUDIT ULANG semua transfer/pay_cc antar-akun hasil backfill.
// Pelajaran 27/8: mirror-matching dulu hanya mencocokkan (nominal, arah, ±3 hari) → sempat
// menyambungkan OCBC→BCA IDR 1jt yang sebenarnya ke Maybank, dan menelan baris Devi Chrisdian.
// Di sini tiap transfer diuji: apakah SISI PENERIMA & SISI PENGIRIM benar-benar punya baris
// statement (ledger_staging, status apa pun) dengan nominal itu di tanggal ±3 hari?
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const day=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const byId=id=>accounts.find(a=>a.id===id);
const nm=id=>byId(id)?.name||'∅';
// seluruh staging (semua status) = cerminan statement
let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,description,status').eq('user_id',uid).order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}
const idx={};for(const r of st){(idx[r.account_id]=idx[r.account_id]||[]).push(r);}
const punyaStatement=new Set(Object.keys(idx));
// semua transfer/pay_cc antar-akun dari backfill
let led=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('id,tx_date,amount,tx_type,from_id,from_type,to_id,to_type,description').eq('user_id',uid).eq('source','backfill').in('tx_type',['transfer','pay_cc','buy_asset','sell_asset','fx_exchange']).range(off,off+999);
  led=led.concat(c||[]);if(!c||c.length<1000)break;}
const pairs=led.filter(r=>r.from_type==='account'&&r.to_type==='account'&&r.from_id&&r.to_id);
console.log('transfer/pay_cc antar-akun (backfill):',pairs.length);
const find=(accId,dir,amt,date)=>(idx[accId]||[]).filter(r=>r.direction===dir&&Math.abs(Number(r.amount)-amt)<=2&&day(r.tx_date,date)<=3);
const susp=[];
for(const r of pairs){
  const amt=Number(r.amount);
  const fromHas=!punyaStatement.has(r.from_id)?null:find(r.from_id,'out',amt,r.tx_date);
  const toHas  =!punyaStatement.has(r.to_id)  ?null:find(r.to_id,'in', amt,r.tx_date);
  // fx_exchange: nominal sisi tujuan beda mata uang → hanya periksa sisi asal
  const cekTo = r.tx_type!=='fx_exchange';
  const bad=[];
  if(fromHas&&fromHas.length===0)bad.push('sisi PENGIRIM ('+nm(r.from_id)+') tak punya baris statement');
  if(cekTo&&toHas&&toHas.length===0)bad.push('sisi PENERIMA ('+nm(r.to_id)+') tak punya baris statement');
  if(bad.length)susp.push({r,bad,fromHas,toHas});
}
console.log('MENCURIGAKAN:',susp.length,'\n');
susp.sort((a,b)=>Number(b.r.amount)-Number(a.r.amount));
for(const s of susp){
  const r=s.r;
  console.log(rp(r.amount).padStart(15),r.tx_date,(r.tx_type||'').padEnd(11),nm(r.from_id),'→',nm(r.to_id));
  console.log('   ',(r.description||'').slice(0,80));
  for(const b of s.bad)console.log('    ⚠️',b);
  // tawarkan kandidat: akun lain yang punya baris masuk senilai itu
  const amt=Number(r.amount);
  const kand=[];
  for(const[aid,rows]of Object.entries(idx)){
    if(aid===r.to_id||aid===r.from_id)continue;
    for(const x of rows)if(x.direction==='in'&&Math.abs(Number(x.amount)-amt)<=2&&day(x.tx_date,r.tx_date)<=4)kand.push(nm(aid)+' '+x.tx_date+' «'+(x.description||'').slice(0,40)+'»');
  }
  if(kand.length)console.log('     kandidat penerima lain:',kand.slice(0,4).join(' | '));
  console.log();
}
process.exit(0);
})();
