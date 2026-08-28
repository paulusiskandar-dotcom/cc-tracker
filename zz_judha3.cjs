const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== transfer 50.000.000 tanggal 12 Maret — ke mana? ===');
const{data:a}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-03-12').eq('amount_idr',50000000);
for(const r of a||[])console.log(`  ${r.tx_type} ${nm(r.from_id)}[${r.from_type}] → ${nm(r.to_id)}[${r.to_type}] | ${r.description}\n    catatan: ${r.notes||'-'}`);
console.log('\n=== arus MANDIRI 11–20 Maret ===');
const man=accounts.find(a=>a.name==='Mandiri');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description').eq('user_id',uid).gte('tx_date','2026-03-10').lte('tx_date','2026-03-22').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const r of led.filter(r=>r.from_id===man?.id||r.to_id===man?.id)){
  const arah=r.to_id===man?.id?'+':'−';
  console.log(`  ${r.tx_date} ${arah}${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.category_name||'-').padEnd(18)} | ${(r.description||'').slice(0,46)}`);
}
console.log('\n=== saldo berjalan piutang Personal (dampak Judha) ===');
let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).eq('entity','Personal').order('tx_date').range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
let s=0;for(const r of all){s+=(r.tx_type==='reimburse_out'?1:-1)* +r.amount_idr;
  console.log(`  ${r.tx_date} ${(r.tx_type==='reimburse_out'?'+':'−')+rp(r.amount_idr).padStart(12)} saldo ${rp(s).padStart(13)} | ${(r.description||'').slice(0,40)}`);}
process.exit(0);})();
