const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:rl}=await supabase.from('ledger').select('id,tx_date,amount_idr,reimburse_settlement_id,created_at,entity').eq('user_id',uid).ilike('description','%Reimbursable Loss%').order('created_at');
const sids=[...new Set((rl||[]).map(r=>r.reimburse_settlement_id).filter(Boolean))];
console.log('baris RL:',(rl||[]).length,'| settlement unik:',sids.length);
const{data:ss}=await supabase.from('reimburse_settlements').select('*').in('id',sids);
console.log('\nsettlement | status | dibuat | jumlah baris RL | total RL');
for(const s of ss||[]){const mine=(rl||[]).filter(r=>r.reimburse_settlement_id===s.id);
  console.log(` ${String(s.id).slice(0,8)} ${(s.entity||'').padEnd(7)} ${(s.status||'').padEnd(9)} ${(s.created_at||'').slice(0,10)} | ${String(mine.length).padStart(2)} baris | ${rp(mine.reduce((a,r)=>a+ +r.amount_idr,0)).padStart(10)}  ${mine.length>1?'← beberapa RL dlm satu settlement':''}`);}
// RL tanpa settlement
const orph=(rl||[]).filter(r=>!r.reimburse_settlement_id);
console.log('\nRL tanpa settlement_id:',orph.length);
// nominal berulang lintas settlement berbeda
const byAmt={};(rl||[]).forEach(r=>{const a=Math.round(r.amount_idr);(byAmt[a]=byAmt[a]||[]).push(r);});
console.log('\nnominal yg muncul di LEBIH DARI SATU settlement (indikasi ditulis ulang):');
let dobel=0;
for(const[a,v]of Object.entries(byAmt)){const s=new Set(v.map(x=>x.reimburse_settlement_id));
  if(v.length>1){console.log(`  ${rp(a).padStart(10)} × ${v.length} di ${s.size} settlement berbeda — tanggal: ${v.map(x=>x.tx_date).join(', ')}`);dobel+=(v.length-1)*Number(a);}}
console.log('\nnilai yang berpotensi dihitung berulang: Rp',rp(dobel),'dari total RL Rp',rp((rl||[]).reduce((a,r)=>a+ +r.amount_idr,0)));
process.exit(0);})();
