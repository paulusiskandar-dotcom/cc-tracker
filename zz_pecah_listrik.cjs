// PECAH SUNGGUHAN setoran listrik Hamasa (perintah Paulus: "kalau bisa lgsg pecah2
// lbh bagus"). Aturan: tiap setoran datang setelah pasangan tagihan PLN
// Suryanto+Paulus bulan sebelumnya lunas → porsi reimburse_in = pasangan tagihan
// itu; sisanya = income Utility Income ke rekening yang sama (saldo bank utuh).
// Empat marker satu-sisi (bekas Reimbursable Surplus) DIHAPUS — digantikan pecahan.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
// [tgl setoran, nilai setoran, pasangan tagihan bulan sebelumnya (Suryanto+Paulus), label bulan]
const PLAN=[
 ['2026-04-15',5182122, 791256+1227671,'MAR (791.256 + 1.227.671)'],
 ['2026-05-13',5289200, 728893+1178622,'APR (728.893 + 1.178.622)'],
 ['2026-06-22',5095500, 854640+1419760,'MEI (854.640 + 1.419.760)'],
 ['2026-07-02',5892000,1579533+1034675,'JUN (1.579.533 + 1.034.675)'],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const util=srcs.find(s=>s.name==='Utility Income');
const rows=[];
for(const[d,amt,bill,lbl]of PLAN){
  const{data:r}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date',d).eq('amount_idr',amt).eq('tx_type','reimburse_in').single();
  rows.push({r,bill,lbl,margin:amt-bill});
  console.log(`  ${d} setoran ${rp(amt).padStart(10)} → ganti PLN ${lbl.padEnd(28)} margin ${rp(amt-bill).padStart(10)}  ke ${nm(r.to_id)}`);
}
const{data:mark}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('from_id',util.id).is('to_id',null).gte('amount_idr',2000000);
console.log(`\n  marker satu-sisi yang dihapus: ${(mark||[]).length}, ${rp((mark||[]).reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log(`  total margin jadi Utility Income nyata: ${rp(rows.reduce((s,x)=>s+x.margin,0))}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/pecah-listrik-${Date.now()}.json`,JSON.stringify({rows:rows.map(x=>x.r),mark},null,2));
const bank=new Set();
const saldo=async id=>{const{data}=await supabase.from('accounts').select('current_balance').eq('id',id).single();return +data.current_balance;};
const sebelum={};for(const x of rows){bank.add(x.r.to_id);sebelum[x.r.to_id]=await saldo(x.r.to_id);}
for(const x of rows){
  await supabase.from('ledger').update({amount:x.bill,amount_idr:x.bill,
    description:`Setoran tunai — penggantian PLN Suryanto+Paulus ${x.lbl}; margin ${rp(x.margin)} dipecah jadi Utility Income`}).eq('id',x.r.id);
  const{error}=await supabase.from('ledger').insert([{user_id:uid,tx_date:x.r.tx_date,tx_type:'income',
    amount:x.margin,amount_idr:x.margin,currency:'IDR',entity:'Personal',
    from_type:'income_source',from_id:util.id,to_type:'account',to_id:x.r.to_id,
    description:`Utility Income dari Hamasa — kelebihan penggantian listrik ${x.lbl.slice(0,3)} (disengaja)`,
    source:'pecah-listrik',notes:'pecahan margin dari setoran listrik Hamasa'}]);
  if(error)throw new Error(error.message);
}
for(const m of mark||[])await supabase.from('ledger').delete().eq('id',m.id);
for(const id of bank)await recalculateBalance(id,uid);
console.log('\n=== VERIFIKASI saldo bank (harus identik) ===');
for(const id of bank){const s=await saldo(id);console.log(`  ${Math.abs(s-sebelum[id])<1?'✓':'✗'} ${nm(id).padEnd(9)} ${rp(sebelum[id]).padStart(13)} → ${rp(s).padStart(13)}`);}
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const[label,f]of[['SELURUHNYA',()=>true],['BERJALAN',q=>!q.reimburse_settlement_id]]){
  const e={};for(const q of led.filter(f)){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
  console.log(`\n=== piutang ${label} ===`);
  for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
}
process.exit(0);})();
