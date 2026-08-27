const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const ccIds=new Set(accounts.filter(a=>a.type==='credit_card').map(a=>a.id));
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(tanpa source)';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_id,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const inc=led.filter(r=>r.tx_type==='income');
const nine=inc.filter(r=>ccIds.has(r.to_id)&&sname(r.from_id)!=='Refund');
console.log('=== 9 baris income ke kartu, source BUKAN Refund ===');
for(const r of nine)console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${nm(r.to_id).padEnd(12)} src=${sname(r.from_id).padEnd(20)} cat=${r.category_name||'(null)'} | ${(r.description||'').slice(0,60)}`);

console.log('\n=== semua income ber-source "Cashback & Rewards" (kemana pun masuknya) ===');
const cb=inc.filter(r=>sname(r.from_id)==='Cashback & Rewards');
console.log('jumlah',cb.length,'=',rp(cb.reduce((s,r)=>s+ +r.amount_idr,0)));
for(const r of cb)console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${nm(r.to_id).padEnd(12)} ${/refund/i.test(r.description||'')?'[DESC BILANG REFUND]':''} ${(r.description||'').slice(0,55)}`);

console.log('\n=== 23 baris ber-source Refund: berapa yg punya kategori? ===');
const rf=inc.filter(r=>sname(r.from_id)==='Refund');
const noCat=rf.filter(r=>!r.category_id);
console.log('total',rf.length,'| tanpa category_id:',noCat.length,'=',rp(noCat.reduce((s,r)=>s+ +r.amount_idr,0)));
for(const r of noCat)console.log('  ',r.tx_date,rp(r.amount_idr),nm(r.to_id),'|',(r.description||'').slice(0,50));

// dampak savings rate: refund-as-income vs expense-reduction
console.log('\n=== dampak dua perlakuan (baris tanpa kategori) pada savings rate ===');
const isExp=r=>r.tx_type==='expense'||r.tx_type==='pay_liability';
for(const m of ['2026-03','2026-06']){
  const t=led.filter(r=>r.tx_date.slice(0,7)===m);
  const orphan=t.filter(r=>r.tx_type==='income'&&ccIds.has(r.to_id)&&!r.category_id);
  const o=orphan.reduce((s,r)=>s+ +r.amount_idr,0); if(!o)continue;
  const E=t.filter(isExp).reduce((s,r)=>s+ +r.amount_idr,0);
  const I=t.filter(r=>r.tx_type==='income').reduce((s,r)=>s+ +r.amount_idr,0);
  const a={I:I,E:E}, b={I:I-o,E:E-o};
  const sr=x=>Math.round((x.I-x.E)/x.I*100);
  console.log(` ${m} orphan ${rp(o)} | sbg income: inc ${rp(a.I)} exp ${rp(a.E)} sav ${sr(a)}% | sbg pengurang: inc ${rp(b.I)} exp ${rp(b.E)} sav ${sr(b)}% | net sama: ${a.I-a.E===b.I-b.E}`);
}
process.exit(0);
})();
