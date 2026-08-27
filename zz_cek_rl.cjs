const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:rl}=await supabase.from('ledger').select('id,tx_date,amount_idr,description,notes,entity,category_name,created_at,reimburse_settlement_id').eq('user_id',uid).ilike('description','%Reimbursable Loss%').order('created_at');
console.log('=== semua baris Reimbursable Loss ===',(rl||[]).length,'| total',rp((rl||[]).reduce((s,r)=>s+ +r.amount_idr,0)));
for(const r of rl||[])console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${(r.entity||'-').padEnd(8)} settle=${r.reimburse_settlement_id?'ya':'-'} dibuat ${r.created_at} | ${(r.notes||'').slice(0,40)}`);
// apakah tiap RL punya pasangan reimburse_out yg tak terbayar?
const{data:ro}=await supabase.from('ledger').select('amount_idr,tx_date,description,entity').eq('user_id',uid).eq('tx_type','reimburse_out').order('tx_date');
console.log('\ncocokkan nominal RL dgn reimburse_out yg pernah ada:');
const uniq=[...new Set((rl||[]).map(r=>Math.round(r.amount_idr)))];
for(const a of uniq){
  const n=(rl||[]).filter(r=>Math.round(r.amount_idr)===a).length;
  const m=(ro||[]).filter(r=>Math.abs(+r.amount_idr-a)<1);
  console.log(`  ${rp(a).padStart(10)}: ${n}× sbg RL | reimburse_out dgn nominal sama: ${m.length}  ${n>m.length?'⚠ RL LEBIH BANYAK':''}`);
  for(const x of m.slice(0,3))console.log(`      ${x.tx_date} ${x.entity} | ${(x.description||'').slice(0,45)}`);
}
process.exit(0);})();
