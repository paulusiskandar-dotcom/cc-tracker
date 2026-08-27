const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
console.log('=== Paper 1 Agu 50.775.000 (Ricky Susanto / Lieche) — apakah ada di ledger? ===');
const{data:h}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,entity,description').eq('user_id',uid).gte('tx_date','2026-07-30').lte('tx_date','2026-08-05').gte('amount_idr',500000);
for(const r of (h||[]).filter(r=>/lieche|paper|blibli/i.test(r.description||'')||+r.amount_idr>=50000000))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(11)} ${nm(r.from_id).padEnd(10)} | ${(r.description||'').slice(0,54)}`);
console.log('\n=== rentang tanggal transaksi tiap statement OCBC 90N (siklus tagihan) ===');
const oc=accounts.find(a=>a.name==='OCBC 90N');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr').eq('user_id',uid).eq('from_id',oc.id).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const d=led.map(r=>r.tx_date).sort();
console.log(`  transaksi OCBC paling awal: ${d[0]} · paling akhir: ${d[d.length-1]}`);
console.log(`  lubang: ${d.filter(x=>x>='2026-01-16'&&x<='2026-03-31').length} transaksi antara 16 Jan dan 31 Mar`);
process.exit(0);})();
