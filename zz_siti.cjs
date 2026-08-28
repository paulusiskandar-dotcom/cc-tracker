// Konfirmasi Paulus 2026-08-28: 18jt/bulan ke Siti Sarnah via Paper ("jan 26",
// "Feb 26", "maret 26") = pengeluaran pribadi sungguhan, kategori Family.
// Tiga baris reimburse_out Hamasa → expense Personal/Family; baris fee-nya ikut
// jadi entity Personal. Piutang Hamasa turun 54jt.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const fam=cats.find(c=>c.name==='Family');
const{data:rows}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_type','reimburse_out').eq('amount_idr',18000000).gte('tx_date','2026-01-01').lte('tx_date','2026-03-31');
console.log('baris 18jt:',(rows||[]).length);
for(const r of rows||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr)} ${r.entity} | ${(r.description||'').slice(0,50)}`);
const{data:fees}=await supabase.from('ledger').select('id,tx_date,amount_idr,description').eq('user_id',uid).eq('source','paper-split').in('amount_idr',[280000,271000,279999]).lte('tx_date','2026-03-31');
console.log('baris fee pasangannya:',(fees||[]).length);
if((rows||[]).length!==3){console.log('!! bukan 3 — BATAL');process.exit(1);}
if(!APPLY){console.log('(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/siti-${Date.now()}.json`,JSON.stringify({rows,fees},null,2));
const BLN={'2026-01':'Januari','2026-02':'Februari','2026-03':'Maret'};
for(const r of rows){
  await supabase.from('ledger').update({tx_type:'expense',entity:'Personal',to_type:'expense',to_id:null,
    reimburse_settlement_id:null,category_id:fam.id,category_name:'Family',
    description:`Siti Sarnah — ${BLN[r.tx_date.slice(0,7)]} 2026 (via Paper.id)`}).eq('id',r.id);
  console.log('- ',r.tx_date,'→ expense Personal / Family');
}
for(const f of fees||[])await supabase.from('ledger').update({entity:'Personal'}).eq('id',f.id);
console.log('- fee pasangan → entity Personal');
let led=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(x||[]);if(!x||x.length<1000)break;}
for(const[label,f]of[['SELURUHNYA',()=>true],['BERJALAN',q=>!q.reimburse_settlement_id]]){
  const e={};for(const q of led.filter(f)){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
  console.log(`\n=== piutang ${label} ===`);
  for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
}
process.exit(0);})();
