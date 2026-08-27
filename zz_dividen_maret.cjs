// Tahap dividen Hamasa 11 Maret 2026 = 52jt (transfer Judha Djohari → BCA IDR)
// + 48jt (setoran tunai → BCA R) = 100jt pas. Keduanya dulu salah tercatat sebagai
// reimburse_in (48jt ke Hamasa berdasar tebakan backfill yang tidak pernah terverifikasi;
// 47.205.000 yang dulu kucocokkan ternyata punya setorannya sendiri 16 Maret).
// Konfirmasi Paulus 2026-08-27: 52jt dibagikan tunai sebagai bonus staff, 48jt disetor;
// totalnya melengkapi dividen jadi 479jt sesuai sheet Piutang.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const div=(srcs||[]).find(s=>s.name==='Dividend');
if(!div)throw new Error('sumber pendapatan Dividend tidak ada');

const{data:rows}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-03-11').eq('tx_type','reimburse_in').in('amount_idr',[52000000,48000000]);
if((rows||[]).length!==2){console.log('!! ketemu',(rows||[]).length,'baris, harus 2 — BATAL');process.exit(1);}
const tot=rows.reduce((s,r)=>s+ +r.amount_idr,0);
if(tot!==100000000){console.log('!! jumlah',rp(tot),'bukan 100jt — BATAL');process.exit(1);}
console.log('sebelum:');
for(const r of rows)console.log(`  ${rp(r.amount_idr).padStart(12)} ${r.tx_type} entity=${r.entity} → ${nm(r.to_id)} | settle=${r.reimburse_settlement_id?r.reimburse_settlement_id.slice(0,8):'-'}`);

const CAT={52000000:'Dividen Hamasa tahap Maret — transfer Judha Djohari (52jt, dibagikan tunai sbg bonus staff)',
           48000000:'Dividen Hamasa tahap Maret — setoran tunai (48jt); 52jt + 48jt = tahap 100jt'};
if(!APPLY){console.log('\n(dry-run — 2 baris jadi income/Dividend/Personal, settlement dilepas)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/dividen-maret-${Date.now()}.json`,JSON.stringify(rows,null,2));
const touch=new Set();
for(const r of rows){
  const{error}=await supabase.from('ledger').update({tx_type:'income',from_type:'income_source',from_id:div.id,
    entity:'Personal',reimburse_settlement_id:null,description:CAT[+r.amount_idr]}).eq('id',r.id);
  if(error)throw new Error(error.message);
  touch.add(r.to_id);
}
for(const id of touch)await recalculateBalance(id,uid);
const{data:after}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,description').eq('user_id',uid).eq('tx_date','2026-03-11').in('amount_idr',[52000000,48000000]);
console.log('\nsesudah:');
for(const r of after||[])console.log(`  ${rp(r.amount_idr).padStart(12)} ${r.tx_type} entity=${r.entity} | ${r.description.slice(0,58)}`);
const{data:d}=await supabase.from('ledger').select('amount_idr').eq('user_id',uid).eq('tx_type','income').eq('from_id',div.id).gte('amount_idr',50000000);
console.log('\ntotal dividen Hamasa:',rp((d||[]).reduce((s,r)=>s+ +r.amount_idr,0)),'(sheet: 479.000.000)');
for(const id of touch)console.log('  saldo',nm(id),rp(accounts.find(a=>a.id===id)?.current_balance),'→ dihitung ulang');
process.exit(0);})();
