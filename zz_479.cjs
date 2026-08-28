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
console.log('=== semua yang bernilai 79jt / 100jt / 200jt (rangkaian dividen 479jt) ===');
for(const r of led.filter(r=>[79000000,100000000,200000000].some(a=>Math.abs(+r.amount_idr-a)<1)))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(13)} ${r.tx_type==='income'?'src='+sname(r.from_id):nm(r.from_id)}→${nm(r.to_id)}\n       ${(r.description||'').slice(0,60)}`);
console.log('\n=== BCA IDR Maret: SEMUA arus ≥ 5 juta ===');
const b=accounts.find(a=>/^BCA IDR/.test(a.name));
const MASUK=['income','reimburse_in','collect_loan','sell_asset'];
for(const r of led.filter(r=>(r.from_id===b?.id||r.to_id===b?.id)&&r.tx_date>='2026-03-01'&&r.tx_date<='2026-03-31'&&+r.amount_idr>=5000000)){
  const arah=r.to_id===b?.id?'+':'−';
  console.log(`  ${r.tx_date} ${arah}${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} | ${(r.description||'').slice(0,52)}`);
}
console.log('\n=== semua "IDR Cash" / kas rupiah — arusnya ===');
const kas=accounts.find(a=>/IDR Cash|Kas/i.test(a.name));
console.log('  akun kas rupiah:',kas?kas.name+' saldo '+rp(kas.current_balance):'TIDAK ADA');
if(kas)for(const r of led.filter(r=>r.from_id===kas.id||r.to_id===kas.id))
  console.log(`  ${r.tx_date} ${(r.to_id===kas.id?'+':'−')+rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} | ${(r.description||'').slice(0,46)}`);
process.exit(0);})();
