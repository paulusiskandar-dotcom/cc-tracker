const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,category_id,category_name,description,reimburse_settlement_id,source').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== PIUTANG ===');
const e={};for(const r of led.filter(r=>['reimburse_out','reimburse_in'].includes(r.tx_type))){const k=r.entity||'-';e[k]=e[k]||{o:0,i:0,ob:0,ib:0};
  e[k][r.tx_type==='reimburse_out'?'o':'i']+= +r.amount_idr;
  if(!r.reimburse_settlement_id)e[k][r.tx_type==='reimburse_out'?'ob':'ib']+= +r.amount_idr;}
for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} total ${rp(v.o-v.i).padStart(13)} | berjalan ${rp(v.ob-v.ib).padStart(12)}`);
console.log('\n=== BARIS TANPA KATEGORI (expense/reimburse_out) ===');
const yatim=led.filter(r=>['expense','reimburse_out'].includes(r.tx_type)&&!r.category_id);
const py={};for(const r of yatim)py[r.tx_type]=(py[r.tx_type]||0)+1;
console.log('  ',yatim.length,'baris',JSON.stringify(py),'| nilai',rp(yatim.reduce((s,r)=>s+ +r.amount_idr,0)));
console.log('\n=== Reimbursable Surplus / Loss tersisa ===');
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sur=srcs.find(s=>s.name==='Reimbursable Surplus');
const s1=led.filter(r=>r.from_id===sur.id);
const l1=led.filter(r=>r.category_name==='Reimbursable Loss');
console.log(`  Surplus: ${s1.length} baris, ${rp(s1.reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log(`  Loss   : ${l1.length} baris, ${rp(l1.reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log('\n=== staging belum tersambung ===');
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,status').eq('user_id',uid).neq('status','connected').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
const bl={};for(const r of st)bl[r.tx_date.slice(0,7)]=(bl[r.tx_date.slice(0,7)]||0)+1;
console.log('  ',st.length,'baris |',JSON.stringify(bl));
console.log('\n=== akun kas (uang tunai) ===');
for(const a of accounts.filter(x=>/cash|tunai/i.test(x.name)))
  console.log(`  ${a.name.padEnd(14)} saldo ${rp(a.current_balance).padStart(12)} | dipakai ${led.filter(r=>r.from_id===a.id).length} baris keluar`);
console.log('\n=== antrean email pending ===');
const{count}=await supabase.from('email_sync').select('id',{count:'exact',head:true}).eq('user_id',uid).eq('status','pending');
console.log('  ',count||0,'email menunggu ditinjau');
process.exit(0);})();
