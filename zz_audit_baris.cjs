// AUDIT BARIS-PER-BARIS: ledger vs statement (via ledger_staging) untuk SEMUA akun bank,
// periode 1 Jan–31 Mar 2026. Menangkap kasus "dua kesalahan saling menutup" yang lolos
// dari uji saldo (contoh nyata: OCBC 5jt & BCA R/BCA IDR 50jt).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const d=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let stAll=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,description,status').eq('user_id',uid).gte('tx_date','2026-01-01').lt('tx_date','2026-04-01').neq('status','rejected').order('id').range(off,off+999);
  stAll=stAll.concat(c||[]);if(!c||c.length<1000)break;}
let ledAll=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('id,tx_date,amount,tx_type,from_id,from_type,to_id,to_type,description').eq('user_id',uid).gte('tx_date','2026-01-01').lt('tx_date','2026-04-01').order('id').range(off,off+999);
  ledAll=ledAll.concat(c||[]);if(!c||c.length<1000)break;}
console.log('staging Jan–Mar (non-rejected):',stAll.length,'| ledger Jan–Mar:',ledAll.length,'\n');
let totalExtra=0,totalMiss=0;
for(const A of accounts.filter(a=>a.type==='bank')){
  const st=stAll.filter(r=>r.account_id===A.id);
  if(!st.length)continue;
  // baris ledger yang MENYENTUH akun ini (sebagai account)
  const led=ledAll.filter(r=>(r.from_id===A.id&&r.from_type==='account')||(r.to_id===A.id&&r.to_type==='account'))
    .map(r=>({...r,out:r.from_id===A.id&&r.from_type==='account'}));
  const usedL=new Set();const miss=[];
  for(const s of st){
    const i=led.findIndex((l,idx)=>!usedL.has(idx)&&l.out===(s.direction==='out')&&Math.abs(Number(l.amount)-Number(s.amount))<=0.02&&d(l.tx_date,s.tx_date)<=3);
    if(i>=0)usedL.add(i);else miss.push(s);
  }
  const extra=led.filter((l,i)=>!usedL.has(i));
  if(!miss.length&&!extra.length)continue;
  console.log('══',A.name,'| statement',st.length,'baris · ledger',led.length,'baris');
  if(miss.length){console.log('   HILANG dari ledger:',miss.length);
    for(const s of miss.slice(0,8))console.log('     ',s.tx_date,(s.direction==='in'?'+':'-')+rp(s.amount).padStart(13),'|',(s.description||'').slice(0,55));}
  if(extra.length){console.log('   EKSTRA di ledger (tak ada di statement):',extra.length);
    for(const l of extra.slice(0,8))console.log('     ',l.tx_date,(l.out?'-':'+')+rp(l.amount).padStart(13),(l.tx_type||'').padEnd(10),nm(l.from_id),'→',nm(l.to_id),'|',(l.description||'').slice(0,45));}
  console.log();
  totalMiss+=miss.length;totalExtra+=extra.length;
}
console.log('TOTAL: hilang',totalMiss,'| ekstra',totalExtra);
process.exit(0);
})();
