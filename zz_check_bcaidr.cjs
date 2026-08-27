// 1) Saldo app BCA IDR (initial + net ledger) vs saldo riil myBCA 23.949.839,16
// 2) Akun BLU di app + anchor
// 3) Deskripsi 2 transfer yatim BCA R (19 & 23 Feb)
// 4) Uji pembayaran CC gabungan: bank row = Σ (Krisflyer + BCA Card + fee) hari sama
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';

// 1) BCA IDR live app balance
const bca=accounts.find(a=>a.name==='BCA IDR'&&a.type==='bank');
let led=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('tx_date,amount,direction').eq('user_id',uid).eq('account_id',bca.id).order('id').range(off,off+999);
  led=led.concat(c||[]);if(!c||c.length<1000)break;}
const net=led.reduce((s,r)=>s+(r.direction==='in'?1:-1)*Number(r.amount),0);
const appBal=Number(bca.initial_balance)+net;
const REAL=23949839.16;
console.log('1) BCA IDR: initial',rp(bca.initial_balance),'+ net ledger',rp(net),'= saldo app',rp(appBal));
console.log('   saldo riil myBCA 27/8 09:40 =',rp(REAL),'| delta app-riil =',rp(appBal-REAL));
console.log('   (delta anchor MERAH sebelumnya = 3.349.998,12)');
// baris ledger Agustus utk cek kelengkapan vs screenshot
const aug=led.filter(r=>r.tx_date>='2026-08-01');
const augNet=aug.reduce((s,r)=>s+(r.direction==='in'?1:-1)*Number(r.amount),0);
console.log('   ledger Agustus:',aug.length,'baris, net',rp(augNet));

// 2) BLU
const blu=accounts.filter(a=>/blu/i.test(a.name));
for(const a of blu){
  const{data:f}=await supabase.from('backfill_freeze').select('*').eq('account_id',a.id);
  console.log('2) akun',a.type,JSON.stringify(a.name),'initial',rp(a.initial_balance),'| frozen',f&&f[0]?rp(f[0].frozen_initial_balance):'—');
}
if(!blu.length)console.log('2) tidak ada akun BLU di app');

// 3) dua transfer yatim
let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('id,account_id,tx_date,amount,direction,description,tx_type,counter_account_id,needs_review').eq('user_id',uid).order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}
for(const r of st.filter(x=>nm(x.account_id)==='BCA R'&&x.direction==='out'&&['2026-02-19','2026-02-23'].includes(x.tx_date)&&Number(x.amount)>=10000000))
  console.log('3)',r.tx_date,rp(r.amount),'|',(r.description||'').slice(0,120));

// 4) pembayaran gabungan: kartu pay_cc in tanpa counter, coba Σ kombinasi hari-sama vs bank out
const isCard=id=>accounts.find(a=>a.id===id)?.type==='credit_card';
const isBank=id=>accounts.find(a=>a.id===id)?.type==='bank';
const un=st.filter(r=>isCard(r.account_id)&&r.tx_type==='pay_cc'&&r.direction==='in'&&!r.counter_account_id&&r.tx_date<'2026-04-01');
console.log('4) kartu pay-in tanpa sumber:',un.length);
const bankOut=st.filter(r=>isBank(r.account_id)&&r.direction==='out');
const byDate={};for(const r of un)(byDate[r.tx_date]=byDate[r.tx_date]||[]).push(r);
for(const[d,rows]of Object.entries(byDate).sort()){
  const tot=rows.reduce((s,r)=>s+Number(r.amount),0);
  const day=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;
  const hit=bankOut.find(b=>Math.abs(Number(b.amount)-tot)<=2&&day(b.tx_date,d)<=6);
  console.log('  ',d,rows.map(r=>nm(r.account_id)+' '+rp(r.amount)).join(' + '),'= Σ',rp(tot),
    hit?('→ MATCH '+nm(hit.account_id)+' '+hit.tx_date+' '+rp(hit.amount)+' ['+(hit.tx_type||'?')+(hit.counter_account_id?' sudah-terpakai':'')+']'):'→ (tidak ada)');
}
process.exit(0);
})();
