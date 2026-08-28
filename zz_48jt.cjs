const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== setoran tunai 45–52 juta, 11 Mar – 15 Apr ===');
const{data:a}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,to_id,entity,description,notes,reimburse_settlement_id')
  .eq('user_id',uid).gte('tx_date','2026-03-11').lte('tx_date','2026-04-15').gte('amount_idr',45000000).lte('amount_idr',52500000).order('tx_date');
for(const r of a||[]){
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} entity=${(r.entity||'-').padEnd(8)} → ${nm(r.to_id)}`);
  console.log(`       ${(r.description||'').slice(0,68)}`);
  if(r.notes)console.log(`       catatan: ${r.notes.slice(0,60)}`);
}
console.log('\n=== khusus yang 48.000.000 — detail penuh ===');
const{data:b}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('amount_idr',48000000);
for(const r of b||[])console.log(' ',JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k,v])=>v!==null&&!['user_id','id','created_at','updated_at'].includes(k)))));
console.log('\n=== semua SETORAN TUNAI ke BCA R & BCA IDR, Maret ===');
const bcar=accounts.find(x=>x.name==='BCA R'), bcaidr=accounts.find(x=>/^BCA IDR/.test(x.name));
const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,to_id,entity,description').eq('user_id',uid)
  .gte('tx_date','2026-03-01').lte('tx_date','2026-03-31').order('tx_date');
for(const r of (c||[]).filter(r=>[bcar?.id,bcaidr?.id].includes(r.to_id)&&/SETOR/i.test(r.description||'')))
  console.log(`  ${r.tx_date} +${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} → ${nm(r.to_id).padEnd(8)} | ${(r.description||'').slice(0,44)}`);
process.exit(0);})();
