// Tiru persis kode Reports.jsx untuk periode YTD, lalu bandingkan dgn angka di layar.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,category_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
// --- salinan logika Reports ---
const ccIds=new Set(accounts.filter(a=>a.type==='credit_card').map(a=>a.id));
const refundSrc=new Set((srcs||[]).filter(s=>s.name==='Refund').map(s=>s.id));
console.log('income source bernama "Refund":',refundSrc.size,'·',(srcs||[]).filter(s=>s.name==='Refund').map(s=>s.id.slice(0,8)).join(','));
const R=led.map(r=>r.tx_type==='income'&&(refundSrc.has(r.from_id)||(!r.from_id&&ccIds.has(r.to_id)))?{...r,_ccRefund:true}:r);
const isExpenseRow=t=>t.tx_type==='expense'||t.tx_type==='pay_liability';
const txs=R.filter(r=>r.tx_date>='2026-01-01'&&r.tx_date<='2026-12-31');
console.log('baris bertanda refund:',txs.filter(t=>t._ccRefund).length,'=',rp(txs.filter(t=>t._ccRefund).reduce((s,r)=>s+ +r.amount_idr,0)));
// groupByCategory
const map={};
txs.filter(isExpenseRow).forEach(t=>{
  const isLoan=t.tx_type==='pay_liability';
  const key=t.category_id||t.category_name||(isLoan?'loan_installment':'other');
  const dbHit=t.category_id?(cats||[]).find(c=>c.id===t.category_id):null;
  const name=dbHit?.name||t.category_name||(isLoan?'Loan Installments':'Other');
  if(!map[key])map[key]={name,total:0};
  map[key].total+= +t.amount_idr;
});
const dikurangi=[];
txs.filter(t=>t._ccRefund&&t.category_id&&map[t.category_id]).forEach(t=>{map[t.category_id].total-= +t.amount_idr;dikurangi.push(t);});
const catTotal=Object.values(map).reduce((s,g)=>s+g.total,0);
console.log('\nrefund yang BERHASIL dikurangkan:',dikurangi.length,'=',rp(dikurangi.reduce((s,r)=>s+ +r.amount_idr,0)));
const gagal=txs.filter(t=>t._ccRefund&&!(t.category_id&&map[t.category_id]));
console.log('refund yang TIDAK dikurangkan:',gagal.length,'=',rp(gagal.reduce((s,r)=>s+ +r.amount_idr,0)));
for(const r of gagal.slice(0,8))console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(11)} kat=${r.category_name||'(TANPA KATEGORI)'} | ${(r.description||'').slice(0,40)}`);
console.log(`\nTotal "Expense by Category" hasil simulasi : ${rp(catTotal)}`);
console.log(`Total di layar                            : 927.758.796`);
console.log(`selisih                                   : ${rp(catTotal-927758796)}`);
console.log(`jumlah kategori simulasi: ${Object.keys(map).length} · di layar: 21`);
process.exit(0);})();
