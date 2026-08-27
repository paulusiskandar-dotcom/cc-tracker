const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,currency,fx_rate_used,from_id,from_type,to_id,to_type,description,notes,created_at').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const bad=led.filter(r=>/5260512048836488\/N/.test(r.description||'')&&+r.amount_idr<1000);
console.log('=== 9 baris bermasalah: ada di akun mana, dibuat kapan ===');
for(const r of bad)console.log(` ${r.tx_date} amt=${String(r.amount).padStart(6)} idr=${String(Math.round(r.amount_idr)).padStart(6)} cur=${r.currency||'-'} fx=${r.fx_rate_used||'-'} akun=${nm(r.from_id)} dibuat=${(r.created_at||'').slice(0,10)} | ${(r.description||'').slice(0,45)}`);

console.log('\n=== baris LAIN dari kartu yg sama (yg nominalnya wajar) ===');
const good=led.filter(r=>/5260512048836488\/N/.test(r.description||'')&&+r.amount_idr>=1000);
console.log('jumlah:',good.length);
for(const r of good.slice(0,6))console.log(` ${r.tx_date} idr=${rp(r.amount_idr).padStart(11)} akun=${nm(r.from_id)} | ${(r.description||'').slice(0,50)}`);

const acc=[...new Set(bad.map(r=>r.from_id))];
console.log('\n=== staging: apa yg terbaca dari PDF utk tanggal2 itu ===');
for(const a of acc){
  let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,status').eq('user_id',uid).eq('account_id',a).order('tx_date').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
  console.log(` akun ${nm(a)} — staging ${st.length} baris`);
  const hit=st.filter(s=>/5260512048836488|AEON MALL|7 ELEVEN-T4|S-Bahn Berlin Auto|TJX Europe|OTARU|FJ JWL|BO TOREKA/i.test(s.description||''));
  console.log('  baris staging yg mirip:',hit.length);
  for(const s of hit.slice(0,12))console.log(`   ${s.tx_date} ${String(Math.round(s.amount)).padStart(9)} ${s.direction} [${s.status}] | ${(s.description||'').slice(0,48)}`);
}

console.log('\n=== rekonsiliasi saldo akun terkait (hari ini) ===');
for(const a of acc){
  const A=accounts.find(x=>x.id===a);
  const inn=led.filter(r=>r.to_id===a&&r.to_type==='account').reduce((s,r)=>s+ +r.amount_idr,0);
  const out=led.filter(r=>r.from_id===a&&r.from_type==='account').reduce((s,r)=>s+ +r.amount_idr,0);
  console.log(` ${A.name}: initial ${rp(A.initial_balance)} + masuk ${rp(inn)} − keluar ${rp(out)} = ${rp(+A.initial_balance+inn-out)} | current_balance tersimpan ${rp(A.current_balance)}`);
}
process.exit(0);})();
