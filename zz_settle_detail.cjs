const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:s}=await supabase.from('reimburse_settlements').select('*').eq('user_id',uid).order('created_at');
console.log('kolom:',s&&s[0]?Object.keys(s[0]).join(', '):'-');
console.log('total settlement:',(s||[]).length);
// baris ledger yg distempel tiap settlement (bukan cuma RL)
const{data:led}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,description,reimburse_settlement_id').eq('user_id',uid).not('reimburse_settlement_id','is',null);
const by={};(led||[]).forEach(r=>{(by[r.reimburse_settlement_id]=by[r.reimburse_settlement_id]||[]).push(r);});
console.log('\nsettlement yg RL-nya 665.798 / 732.677 / 154.688 — isi lengkapnya:');
for(const x of (s||[])){
  const rows=by[x.id]||[];
  const rl=rows.filter(r=>/Reimbursable Loss/i.test(r.description||''));
  if(!rl.length||![665798,732677,154688].includes(Math.round(rl[0].amount_idr)))continue;
  const ro=rows.filter(r=>r.tx_type==='reimburse_out');
  console.log(`\n ${String(x.id).slice(0,8)} ${x.entity} ${(x.created_at||'').slice(0,10)} status=${x.status}`);
  for(const[k,v]of Object.entries(x))if(/amount|total|expected|received|count|period/i.test(k)&&v!==null)console.log(`    ${k}: ${v}`);
  console.log(`    baris terstempel: ${rows.length} (reimburse_out ${ro.length}, RL ${rl.length})`);
  for(const r of ro.slice(0,4))console.log(`      out ${r.tx_date} ${rp(r.amount_idr).padStart(9)} | ${(r.description||'').slice(0,42)}`);
}
process.exit(0);})();
