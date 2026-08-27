// a) ledger BLU di app (bagaimana DP BYD dicatat?)
// b) baris Neobank staging Feb (cari 30/20/100jt masuk)
// c) BCA R 2 Des & 1 Jan: baris out ≈ Σkartu+10rb (pembayaran gabungan + fee)
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';

const blu=accounts.find(a=>a.name==='BLU');
const{data:bl}=await supabase.from('ledger').select('tx_date,amount,direction,description,tx_type,counter_account_id').eq('user_id',uid).eq('account_id',blu.id).order('tx_date');
console.log('a) ledger BLU:',(bl||[]).length,'baris');
for(const r of bl||[])console.log('  ',r.tx_date,(r.direction==='in'?'+':'-')+rp(r.amount),r.tx_type,'|',(r.description||'').slice(0,60),'| cp:',nm(r.counter_account_id));
// cari BYD/Arista di seluruh ledger
let all=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('account_id,tx_date,amount,direction,description,tx_type').eq('user_id',uid).order('id').range(off,off+999);
  all=all.concat(c||[]);if(!c||c.length<1000)break;}
for(const r of all.filter(x=>/ARISTA|BYD/i.test(x.description||'')))
  console.log('   BYD?',r.tx_date,nm(r.account_id),(r.direction==='in'?'+':'-')+rp(r.amount),r.tx_type,'|',(r.description||'').slice(0,70));

let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('id,account_id,tx_date,amount,direction,description,tx_type,counter_account_id').eq('user_id',uid).order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}
console.log('b) Neobank staging Feb–Mar:');
for(const r of st.filter(x=>nm(x.account_id)==='Neobank'&&x.tx_date>='2026-02-01'&&x.tx_date<'2026-04-01'))
  console.log('  ',r.tx_date,(r.direction==='in'?'+':'-')+rp(r.amount),r.tx_type,'|',(r.description||'').slice(0,70));

console.log('c) kandidat bayar-gabungan BCA R/IDR:');
for(const[d,tot]of[['2025-12-02',14903428],['2026-01-01',4469287]]){
  for(const r of st.filter(x=>['BCA R','BCA IDR'].includes(nm(x.account_id))&&x.direction==='out'&&Math.abs(new Date(x.tx_date)-new Date(d))<=6*864e5&&Math.abs(Number(x.amount)-tot)<=20000))
    console.log('  ',d,'Σ',rp(tot),'→',r.tx_date,nm(r.account_id),rp(r.amount),r.tx_type,'|',(r.description||'').slice(0,60));
}
process.exit(0);
})();
