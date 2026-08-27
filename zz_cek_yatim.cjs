const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_id,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== 1. transaksi TANPA kategori, per tipe ===');
const g={};led.filter(r=>!r.category_id).forEach(r=>{g[r.tx_type]=g[r.tx_type]||{n:0,t:0};g[r.tx_type].n++;g[r.tx_type].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(g).sort((a,b)=>b[1].t-a[1].t)){
  const wajib=['expense','pay_liability'].includes(k);
  console.log(`  ${k.padEnd(15)} ${String(v.n).padStart(4)} baris ${rp(v.t).padStart(15)} ${wajib?'← YATIM, perlu kategori':'(wajar tanpa kategori)'}`);
}
const yatim=led.filter(r=>!r.category_id&&['expense','pay_liability'].includes(r.tx_type));
if(yatim.length){console.log('\n  rincian yang yatim:');for(const r of yatim)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id)} | ${(r.description||'').slice(0,44)}`);}
console.log('\n=== 2. kategori Online Shopping — masih dipakai? ===');
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const os=(cats||[]).find(c=>c.name==='Online Shopping');
console.log('  id:',os?.id.slice(0,8),'· baris memakai id ini:',led.filter(r=>r.category_id===os?.id).length);
console.log('\n=== 3. BYD: DP, aset, cicilan ===');
const{data:as}=await supabase.from('accounts').select('name,type,purchase_price,current_value,initial_balance,outstanding_amount,is_active').eq('user_id',uid).or('name.ilike.%BYD%,name.ilike.%seal%');
for(const a of as||[])console.log(`  AKUN ${a.name} · tipe=${a.type} · harga=${rp(a.purchase_price)} · nilai=${rp(a.current_value)} · outstanding=${rp(a.outstanding_amount)} · aktif=${a.is_active}`);
for(const r of led.filter(r=>/BYD|SEAL/i.test((r.description||'')+(r.notes||''))))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} ${nm(r.from_id)}→${nm(r.to_id)} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,42)}`);
console.log('\n=== 4. Akbar / coating / biaya mobil ===');
for(const r of led.filter(r=>/AKBAR|COATING|NANO CERAMIC|SALON MOBIL/i.test((r.description||'')+(r.notes||''))))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(9)} ${nm(r.from_id).padEnd(10)} kat=${(r.category_name||'-').padEnd(22)} | ${(r.description||'').slice(0,40)}`);
console.log('\n=== isi kategori Vehicle ===');
const v=led.filter(r=>r.category_name==='Vehicle');
console.log(`  ${v.length} baris = ${rp(v.reduce((s,r)=>s+ +r.amount_idr,0))}`);
process.exit(0);})();
