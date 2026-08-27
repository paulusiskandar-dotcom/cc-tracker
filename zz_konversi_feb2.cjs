// Sisa Februari, mengikuti aturan Paulus: "ikutin piutang Google Sheets".
// Tagihan 1.132.464 (20 Feb) = 2 Telkomsel Halo 745.074 + Indosat HiFi 387.390.
//   - Indosat 387.390 = internet SDC (Paulus konfirmasi; cocok 5× reimburse_in bulanan SDC)
//   - Telkomsel 745.074 → TIDAK ADA di sheet (sheet menulis 989.480 utk 12 Feb, beda tanggal
//     & nominal) → pribadi.
// Tagihan 1.217.700 (12 Feb) = Spigen 399.000 + Set Top Box 327.000 + Dymatize 550.000.
//   Tak satu pun ada di batch Feb sheet (pajak mama, onedrive klinik, listrik, telkomsel,
//   software, biznet, dvr pak herman, ac) → seluruhnya pribadi.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const PIUTANG_SDC='aa2247ae', SETTLE_SDC='9f3fe893';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const psdc=accounts.find(a=>a.type==='receivable'&&a.entity==='SDC');
const{data:ss}=await supabase.from('reimburse_settlements').select('id,entity,notes').eq('user_id',uid).eq('entity','SDC');
const sset=(ss||[]).find(s=>/BACKFILL HISTORIS/i.test(s.notes||''));
console.log('akun piutang SDC:',psdc?psdc.id.slice(0,8):'TIDAK ADA','| settlement historis SDC:',sset?sset.id.slice(0,8):'TIDAK ADA');
if(!psdc||!sset){console.log('FATAL: prasyarat tidak lengkap');process.exit(1);}
const before=Object.fromEntries(accounts.filter(a=>a.type==='credit_card').map(a=>[a.name,Number(a.outstanding_amount||0)]));
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
const{data:led}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,description,category_name').eq('user_id',uid).eq('tx_type','expense').gte('tx_date','2026-02-01').lte('tx_date','2026-02-28').ilike('description','%tokopedia%');
const r1=(led||[]).find(r=>Math.abs(+r.amount_idr-1132464)<1);
const r2=(led||[]).find(r=>Math.abs(+r.amount_idr-1217700)<1);
console.log('\n1.132.464 →', r1?`${r1.tx_date} ${nm(r1.from_id)} : DIPECAH 387.390 piutang SDC (internet) + 745.074 pribadi Housing & Utilities`:'TIDAK KETEMU');
console.log('1.217.700 →', r2?`${r2.tx_date} ${nm(r2.from_id)} : seluruhnya PRIBADI → Electronics & Gadgets (tak ada di sheet)`:'TIDAK KETEMU');
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/feb2_${Date.now()}.json`,JSON.stringify([r1,r2],null,1));
if(r1){
  const c=C('Housing & Utilities');
  const{error:e1}=await supabase.from('ledger').update({amount:745074,amount_idr:745074,category_id:c.id,category_name:c.name,
    notes:'Telkomsel Halo 2 nomor — pribadi (tidak ada di sheet Piutang); dipecah dari tagihan 1.132.464'}).eq('id',r1.id).eq('user_id',uid);
  const{error:e2}=await supabase.from('ledger').insert([{user_id:uid,tx_date:r1.tx_date,tx_type:'reimburse_out',amount:387390,currency:'IDR',
    amount_idr:387390,description:r1.description,notes:'Indosat HiFi = internet SDC (Paulus) — sisi piutang, dipecah dari tagihan 1.132.464',
    source:'split-email',from_type:'account',from_id:r1.from_id,to_type:'account',to_id:psdc.id,entity:'SDC',reimburse_settlement_id:sset.id}]);
  console.log(e1||e2?('GAGAL '+((e1||e2).message)):'ok 1.132.464 dipecah: 745.074 pribadi + 387.390 piutang SDC');
}
if(r2){
  const c=C('Electronics & Gadgets');
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,
    notes:'Spigen tempered privacy + Set Top Box DVB-T2 ×2 + Dymatize ISO100 — pribadi (tak satu pun ada di sheet Piutang)'}).eq('id',r2.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):'ok 1.217.700 → Electronics & Gadgets (pribadi)');
}
const after=await accountsApi.getAll(uid);
let beda=0;for(const a of after.filter(a=>a.type==='credit_card'))if(Math.abs(before[a.name]-Number(a.outstanding_amount||0))>0.5){console.log(`⚠ ${a.name} berubah`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
