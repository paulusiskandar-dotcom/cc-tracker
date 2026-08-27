const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== SELURUH arus BCA R & BCA IDR, 10–20 Maret ===');
const bcar=accounts.find(x=>x.name==='BCA R'), bcaidr=accounts.find(x=>/^BCA IDR/.test(x.name));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description').eq('user_id',uid).gte('tx_date','2026-03-10').lte('tx_date','2026-03-20').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const r of led.filter(r=>[bcar?.id,bcaidr?.id].includes(r.from_id)||[bcar?.id,bcaidr?.id].includes(r.to_id))){
  const ak=[bcar?.id,bcaidr?.id].includes(r.to_id)?nm(r.to_id):nm(r.from_id);
  const arah=[bcar?.id,bcaidr?.id].includes(r.to_id)?'+':'−';
  console.log(`  ${r.tx_date} ${ak.padEnd(9)} ${arah}${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} | ${(r.description||'').slice(0,46)}`);
}
console.log('\n=== pengeluaran bernuansa BONUS / THR / staff, Maret ===');
for(const r of led.filter(r=>/BONUS|THR|STAFF|KARYAWAN/i.test((r.description||''))))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,46)}`);
console.log('\n=== transfer 100.000.000 tanggal 13 Maret — detail ===');
const{data:x}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-03-13').eq('amount_idr',100000000);
for(const r of x||[])console.log(` ${r.tx_type} ${nm(r.from_id)}[${r.from_type}]→${nm(r.to_id)}[${r.to_type}] entity=${r.entity||'-'}\n   ${r.description}\n   catatan: ${r.notes||'-'}`);
process.exit(0);})();
