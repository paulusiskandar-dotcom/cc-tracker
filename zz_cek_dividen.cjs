const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const div=(srcs||[]).find(s=>s.name==='Dividend');
const{data:d}=await supabase.from('ledger').select('tx_date,amount_idr,to_id,description').eq('user_id',uid).eq('tx_type','income').eq('from_id',div.id).order('tx_date');
let ham=0,lain=0;
console.log('=== semua baris Dividend ===');
for(const r of d||[]){const isHam=!/Hang Tuah|Crystal/i.test(r.description||'');isHam?ham+= +r.amount_idr:lain+= +r.amount_idr;
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${(isHam?'Hamasa':'lain  ')} → ${nm(r.to_id).padEnd(8)} | ${(r.description||'').slice(0,52)}`);}
console.log(`\n  DIVIDEN HAMASA : ${rp(ham)}   (sheet 479.000.000, selisih ${rp(ham-479000000)})`);
console.log(`  dividen lain   : ${rp(lain)}`);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const ent={};for(const r of led){const e=r.entity||'(kosong)';ent[e]=ent[e]||{out:0,in:0};ent[e][r.tx_type==='reimburse_out'?'out':'in']+= +r.amount_idr;}
console.log('\n=== piutang per entitas SESUDAH perbaikan ===');
for(const[e,v]of Object.entries(ent).sort((a,b)=>b[1].in-a[1].in))
  console.log(`  ${e.padEnd(10)} keluar ${rp(v.out).padStart(15)}  masuk ${rp(v.in).padStart(15)}  selisih ${rp(v.out-v.in).padStart(14)}`);
console.log('\n=== piutang berjalan (belum dilunasi) ===');
const{data:live}=await supabase.from('accounts').select('name,current_balance').in('name',['Piutang Hamasa','Piutang Personal','Piutang SDC']);
for(const a of live||[])console.log(`  ${a.name.padEnd(17)} ${rp(a.current_balance).padStart(13)}`);
console.log('\n=== saldo bank tersentuh ===');
for(const n of['BCA R','BCA IDR']){const a=accounts.find(x=>x.name===n);const{data:f}=await supabase.from('accounts').select('current_balance').eq('id',a.id).single();
  console.log(`  ${n.padEnd(8)} ${rp(f.current_balance).padStart(14)}  (sebelum ${rp(a.current_balance)})`);}
process.exit(0);})();
