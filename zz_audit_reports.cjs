// Audit numerik halaman Reports: bandingkan rumus Overview vs Expense tab,
// cek refund lintas-bulan/kategori, is_reimburse, prev-range.
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
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,amount,from_id,from_type,to_id,to_type,category_id,category_name,is_reimburse,description').eq('user_id',uid).order('id').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('total ledger:',led.length);

// 1. is_reimburse per tx_type
const ir={};led.filter(r=>r.is_reimburse).forEach(r=>ir[r.tx_type]=(ir[r.tx_type]||0)+1);
console.log('\n1. is_reimburse=true per tx_type:',JSON.stringify(ir));
const irExp=led.filter(r=>r.is_reimburse&&(r.tx_type==='expense'||r.tx_type==='pay_liability'));
console.log('   expense/pay_liability dgn is_reimburse:',irExp.length, irExp.length?('total '+rp(irExp.reduce((s,r)=>s+Number(r.amount_idr||0),0))):'');
for(const r of irExp.slice(0,5))console.log('    ',r.tx_date,rp(r.amount_idr),(r.description||'').slice(0,50));

// 2. refund rows (_ccRefund logic): income into CC atau from Refund source
const isRefund=r=>r.tx_type==='income'&&(ccIds.has(r.to_id)||refundSrc.has(r.from_id));
const refunds=led.filter(isRefund);
console.log('\n2. refund rows total:',refunds.length,'=',rp(refunds.reduce((s,r)=>s+Number(r.amount_idr||0),0)));
// per bulan: refund yg TIDAK punya kategori-expense pendamping di bulan yg sama
const isExp=r=>r.tx_type==='expense'||r.tx_type==='pay_liability';
const months=[...new Set(refunds.map(r=>r.tx_date.slice(0,7)))].sort();
for(const m of months){
  const mrefs=refunds.filter(r=>r.tx_date.slice(0,7)===m);
  const expCats=new Set(led.filter(r=>isExp(r)&&r.tx_date.slice(0,7)===m).map(r=>r.category_id||r.category_name||'other'));
  const orphan=mrefs.filter(r=>!r.category_id||!expCats.has(r.category_id));
  const noCat=mrefs.filter(r=>!r.category_id);
  const tot=x=>rp(x.reduce((s,r)=>s+Number(r.amount_idr||0),0));
  console.log(`   ${m}: refund ${mrefs.length} (${tot(mrefs)}) | tanpa category_id: ${noCat.length} (${tot(noCat)}) | category tak match expense bln itu: ${orphan.length} (${tot(orphan)})`);
  for(const r of orphan.slice(0,4))console.log('      ',r.tx_date,rp(r.amount_idr),r.category_name||'(null)','|',(r.description||'').slice(0,45));
}

// 3. Simulasi selisih tab utk Aug 2026 & Jul 2026: Overview KPI vs ExpenseTab
for(const m of ['2026-06','2026-07','2026-08']){
  const txs=led.filter(r=>r.tx_date.slice(0,7)===m);
  const gross=txs.filter(isExp).reduce((s,r)=>s+Number(r.amount_idr||0),0);
  const ref=txs.filter(isRefund).reduce((s,r)=>s+Number(r.amount_idr||0),0);
  const kpi=gross-ref; // Overview "Total Expenses"
  const expTab=txs.filter(r=>isExp(r)&&!r.is_reimburse).reduce((s,r)=>s+Number(r.amount_idr||0),0); // ExpenseTab (tanpa refund, tanpa is_reimburse)
  console.log(`\n3. ${m}: Overview KPI=${rp(kpi)} | ExpenseTab total=${rp(expTab)} | selisih=${rp(expTab-kpi)} (refund ${rp(ref)})`);
}

// 4. duplikat nama kategori dgn key beda (id vs name-only) dlm expense rows
const keyname={};led.filter(isExp).forEach(r=>{const k=r.category_id||r.category_name||'other';const n=r.category_name||'(null)';keyname[n]=keyname[n]||new Set();keyname[n].add(k);});
const dups=Object.entries(keyname).filter(([n,s])=>s.size>1);
console.log('\n4. nama kategori dgn >1 key (grup pecah):',dups.length?dups.map(([n,s])=>`${n}:${s.size}`).join(', '):'tidak ada');
process.exit(0);
})();
