// 1) Dua struk PLN 11 Agu (Suryanto 1.005.535 + Paulus 1.789.603) belum ada di buku
//    → masukkan sbg reimburse_out Hamasa di Jenius (kartu langganan Lazada), piutang berjalan.
// 2) Empat baris "Reimbursable Surplus" besar = margin kelebihan penggantian listrik
//    Hamasa yang disengaja → jadikan income Utility Income (perintah Paulus 2026-08-28:
//    "sisanya bikin jd utility income juga, utility income dari hamasa").
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const jen=accounts.find(a=>a.name==='Jenius');
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const util=srcs.find(s=>s.name==='Utility Income'), sur=srcs.find(s=>s.name==='Reimbursable Surplus');

// --- cek dulu: apakah tagihan Agu sudah ada (tunggal atau gabungan 2.795.138)?
console.log('=== cek tagihan 11 Agu ===');
for(const a of[1005535,1789603,2795138]){
  const{data:h}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity').eq('user_id',uid).eq('amount_idr',a).gte('tx_date','2026-08-05').lte('tx_date','2026-08-20');
  console.log(`  ${rp(a).padStart(10)}: ${(h||[]).length} baris`);
}
const{data:big}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('from_id',sur.id).gte('amount_idr',2000000);
console.log('\n=== surplus besar yang akan jadi Utility Income ===');
for(const r of big||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.entity} | ${(r.description||'').slice(0,44)}`);
console.log('  jumlah:',rp((big||[]).reduce((s,r)=>s+ +r.amount_idr,0)));
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/utilinc-${Date.now()}.json`,JSON.stringify(big,null,2));
// 1) dua tagihan Agu
for(const[amt,nma,idp]of[[1005535,'SURYANTO SALIM','545101427710'],[1789603,'PAULUS ISKANDAR','545103888558']]){
  const{data:ada}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('amount_idr',amt).gte('tx_date','2026-08-05').lte('tx_date','2026-08-20');
  if((ada||[]).length){console.log('- lewati',rp(amt),'(sudah ada)');continue;}
  const{error}=await supabase.from('ledger').insert([{user_id:uid,tx_date:'2026-08-11',tx_type:'reimburse_out',
    amount:amt,amount_idr:amt,currency:'IDR',entity:'Hamasa',
    from_type:'account',from_id:jen.id,to_type:'reimburse',to_id:null,reimburse_settlement_id:null,
    description:`LAZADA — PLN ${nma} (ID ${idp}, AUG 2026); struk IAK 11 Agu`,
    source:'iak-receipt',notes:'listrik rumah, diganti Hamasa (belum diganti)'}]);
  if(error)throw new Error(error.message);
  console.log('- masuk: PLN',nma,rp(amt),'→ reimburse_out Hamasa (Jenius), piutang berjalan');
}
await recalculateBalance(jen.id,uid);
// 2) surplus besar → Utility Income
for(const r of big||[]){
  await supabase.from('ledger').update({from_id:util.id,
    description:`Utility Income dari Hamasa — kelebihan penggantian listrik (disengaja, "digantikan nilainya lebih")`}).eq('id',r.id);
  console.log('- surplus',r.tx_date,rp(r.amount_idr),'→ Utility Income');
}
const{data:sisa}=await supabase.from('ledger').select('tx_date,amount_idr,entity,description').eq('user_id',uid).eq('from_id',sur.id).order('tx_date');
console.log('\nsisa baris Reimbursable Surplus:',(sisa||[]).length);
for(const r of sisa||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.entity} | ${(r.description||'').slice(0,40)}`);
let led=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(x||[]);if(!x||x.length<1000)break;}
for(const[label,f]of[['SELURUHNYA',()=>true],['BERJALAN',q=>!q.reimburse_settlement_id]]){
  const e={};for(const q of led.filter(f)){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
  console.log(`\n=== piutang ${label} ===`);
  for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
}
process.exit(0);})();
