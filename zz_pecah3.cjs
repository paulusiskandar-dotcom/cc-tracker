// Tagihan Mega Metro 1.092.013 (18 Apr) ternyata GABUNGAN tiga tagihan yang dibayar
// sekaligus. Dipecah mengikuti aturan yang sudah ada:
//   Indosat HiFi 387.390  → internet SDC (Paulus sudah konfirmasi pola ini)
//   Telkomsel     588.623 → ada di sheet Piutang → Hamasa
//   sisanya       116.000 → tidak ada di sheet → pribadi
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const PH='f282ac7e-a908-4e5d-adb0-144473e9f126', SH='014ccdfa-5837-4e32-a9ef-c6ce6fae8142';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const before=Object.fromEntries(accounts.filter(a=>a.type==='credit_card').map(a=>[a.name,Number(a.outstanding_amount||0)]));
const psdc=accounts.find(a=>a.type==='receivable'&&a.entity==='SDC');
const{data:ss}=await supabase.from('reimburse_settlements').select('id,notes').eq('user_id',uid).eq('entity','SDC');
const ssdc=(ss||[]).find(s=>/BACKFILL HISTORIS/i.test(s.notes||''));
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const hu=(cats||[]).find(c=>c.name==='Housing & Utilities');
const{data:h}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-04-18').gte('amount_idr',1092000).lte('amount_idr',1092100);
if(!h||h.length!==1){console.log('cocok',(h||[]).length,'baris — batal');process.exit(1);}
const r=h[0];
console.log(`asal: ${r.tx_date} ${rp(r.amount_idr)} ${nm(r.from_id)}`);
console.log(`  → 116.000 pribadi Housing & Utilities (Telkomsel Halo 0812198168)`);
console.log(`  → 588.623 piutang Hamasa (Telkomsel Halo 0812188168 — cocok sheet)`);
console.log(`  → 387.390 piutang SDC (Indosat HiFi / MNC Play — internet SDC)`);
console.log(`  jumlah cek: ${rp(116000+588623+387390)}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/pecah3_${Date.now()}.json`,JSON.stringify(r,null,1));
const{error:e1}=await supabase.from('ledger').update({amount:116000,amount_idr:116000,category_id:hu.id,category_name:hu.name,
  notes:'Telkomsel Halo 0812198168 · Apr 2026'}).eq('id',r.id).eq('user_id',uid);
if(e1){console.log('GAGAL',e1.message);process.exit(1);}
const baris=[
 {amt:588623,ent:'Hamasa',to:PH,set:SH,n:'Telkomsel Halo 0812188168 · Apr 2026'},
 {amt:387390,ent:'SDC',   to:psdc.id,set:ssdc.id,n:'Indosat HiFi · internet SDC · Apr 2026'},
];
let ok=1;
for(const b of baris){
  const{error}=await supabase.from('ledger').insert([{user_id:uid,tx_date:r.tx_date,tx_type:'reimburse_out',amount:b.amt,currency:'IDR',
    amount_idr:b.amt,description:r.description,notes:b.n,source:'split-email',from_type:'account',from_id:r.from_id,
    to_type:'account',to_id:b.to,entity:b.ent,reimburse_settlement_id:b.set}]);
  if(!error)ok++;else console.log('GAGAL',error.message);
}
console.log(`ditulis ${ok}/3`);
const after=await accountsApi.getAll(uid);
let beda=0;for(const x of after.filter(x=>x.type==='credit_card'))if(Math.abs(before[x.name]-Number(x.outstanding_amount||0))>0.5){console.log(`⚠ ${x.name} berubah`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
