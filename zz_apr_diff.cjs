const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
// statement 12 April 2026 (periode 13 Mar – 12 Apr), kolom = tanggal transaksi
const ST=[['2026-03-13',2539750],['2026-03-13',1778125],['2026-03-13',47937677],['2026-03-13',10070105],
 ['2026-03-16',67024000],['2026-03-17',5000],['2026-03-20',14500],['2026-03-23',349000],['2026-03-27',89000],
 ['2026-03-30',574000],['2026-03-31',11171500],['2026-04-08',319000],['2026-04-09',2227000],['2026-04-12',10000],['2026-04-12',10000]];
const KREDIT=[['2026-04-08',247677],['2026-03-31',1000000]];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const oc=accounts.find(a=>a.name==='OCBC 90N');
const{data:led}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,description').eq('user_id',uid).eq('from_id',oc.id).gte('tx_date','2026-03-13').lte('tx_date','2026-04-12').order('tx_date');
console.log('=== di ledger (belanja dari kartu), 13 Mar – 12 Apr ===');
for(const r of led||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} | ${(r.description||'').slice(0,44)}`);
console.log('  jumlah:',rp((led||[]).reduce((s,r)=>s+ +r.amount_idr,0)),'| statement: 144.118.657');
const sisa=[...(led||[])];
console.log('\n=== baris statement yang TIDAK ADA di ledger ===');
let hilang=0;
for(const[d,a]of ST){
  const i=sisa.findIndex(r=>Math.abs(+r.amount_idr-a)<1);
  if(i>=0)sisa.splice(i,1);
  else{hilang+=a;console.log(`  ${d} ${rp(a).padStart(12)}  <<< hilang`);}
}
console.log('  jumlah hilang:',rp(hilang),'| selisih rantai: 140.552.657 |',hilang===140552657?'✓ COCOK':'selisih '+rp(hilang-140552657));
console.log('\n=== kredit statement (13 Mar – 12 Apr) ===');
const{data:kr}=await supabase.from('ledger').select('tx_date,amount_idr,tx_type,description').eq('user_id',uid).eq('to_id',oc.id).gte('tx_date','2026-03-13').lte('tx_date','2026-04-12');
for(const[d,a]of KREDIT){const ada=(kr||[]).some(r=>Math.abs(+r.amount_idr-a)<1);console.log(`  ${d} ${rp(a).padStart(12)} ${ada?'ada':'<<< hilang'}`);}
console.log('\n=== baris ledger yang TIDAK ADA di statement (kelebihan) ===');
for(const r of sisa)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} | ${(r.description||'').slice(0,44)}`);
process.exit(0);})();
