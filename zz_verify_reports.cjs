// Verifikasi pasca-perbaikan: replikasi rumus Reports yg baru, cek konsistensi
// Overview vs Expense tab, cashback kembali jadi income, dan prev-range kalender.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const ccIds=new Set(accounts.filter(a=>a.type==='credit_card').map(a=>a.id));
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const refundSrc=new Set((srcs||[]).filter(s=>s.name==='Refund').map(s=>s.id));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_id,category_name,description').eq('user_id',uid).order('id').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
// flag baru
led.forEach(r=>{r._ccRefund=r.tx_type==='income'&&(refundSrc.has(r.from_id)||(!r.from_id&&ccIds.has(r.to_id)));});
const isExp=r=>r.tx_type==='expense'||r.tx_type==='pay_liability';
const isInc=r=>r.tx_type==='income'&&!r._ccRefund;
const sumExp=t=>t.filter(isExp).reduce((s,r)=>s+ +r.amount_idr,0)-t.filter(r=>r._ccRefund).reduce((s,r)=>s+ +r.amount_idr,0);
const sumInc=t=>t.filter(isInc).reduce((s,r)=>s+ +r.amount_idr,0);
// groupByCategory baru
const grp=t=>{const m={};t.filter(isExp).forEach(r=>{const k=r.category_id||r.category_name||'other';m[k]=(m[k]||0)+ +r.amount_idr;});
  t.filter(r=>r._ccRefund&&r.category_id&&m[r.category_id]!==undefined).forEach(r=>{m[r.category_id]-= +r.amount_idr;});return m;};
console.log('refund rows (baru):',led.filter(r=>r._ccRefund).length,'=',rp(led.filter(r=>r._ccRefund).reduce((s,r)=>s+ +r.amount_idr,0)));
console.log('cashback ke CC yg kembali jadi income:',led.filter(r=>r.tx_type==='income'&&ccIds.has(r.to_id)&&!r._ccRefund).length,'=',rp(led.filter(r=>r.tx_type==='income'&&ccIds.has(r.to_id)&&!r._ccRefund).reduce((s,r)=>s+ +r.amount_idr,0)));
console.log('\nbulan | Overview KPI | ExpenseTab total | selisih | catBreak total | selisih | income');
let bad=0;
for(const m of ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08']){
  const t=led.filter(r=>r.tx_date.slice(0,7)===m);
  const kpi=sumExp(t), tab=sumExp(t), cat=Object.values(grp(t)).reduce((s,v)=>s+v,0);
  const d1=tab-kpi, d2=cat-kpi; if(Math.abs(d1)>1||Math.abs(d2)>1)bad++;
  console.log(`${m} | ${rp(kpi).padStart(12)} | ${rp(tab).padStart(12)} | ${rp(d1).padStart(6)} | ${rp(cat).padStart(12)} | ${rp(d2).padStart(9)} | ${rp(sumInc(t))}`);
}
console.log(bad?`\n⚠ ${bad} bulan masih tidak konsisten`:'\n✓ semua bulan konsisten (KPI = tab Expense = breakdown kategori)');
// prev-range kalender
const monthSpan=(y,m,n)=>({from:new Date(y,m-n+1,1),to:new Date(y,m+1,0),prev:{from:new Date(y,m-2*n+1,1),to:new Date(y,m-n+1,0)}});
const f=d=>d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
console.log('\nprev-range (kalender):');
for(const[y,m,n,lab]of[[2026,8,1,'Sep 2026'],[2026,2,1,'Mar 2026'],[2026,1,1,'Feb 2026'],[2026,7,3,'3M s/d Agu']]){
  const r=monthSpan(y,m,n);console.log(` ${lab.padEnd(12)} ${f(r.from)} – ${f(r.to)}  ← prev ${f(r.prev.from)} – ${f(r.prev.to)}`);}
process.exit(0);
})();
