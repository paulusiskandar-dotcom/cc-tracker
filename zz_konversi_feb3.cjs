// A. Tiga transaksi 20 Feb → reimburse_out Hamasa (Paulus).
// B. Lima barang cicilan diuji dengan ATURAN SHEET: kalau nominalnya tidak ada di sheet
//    Piutang, berarti pribadi. Hasil pengujian ada di komentar tiap baris.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const PIUTANG='f282ac7e-a908-4e5d-adb0-144473e9f126', SETTLE='014ccdfa-5837-4e32-a9ef-c6ce6fae8142';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const before=Object.fromEntries(accounts.filter(a=>a.type==='credit_card').map(a=>[a.name,Number(a.outstanding_amount||0)]));
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
// A
const A=[9591508,8899432,1786355];
// B — uji sheet. Sheet punya kata kuncinya, TAPI nominalnya barang lain yg lebih murah.
const B={
 131588 :{k:'Electronics & Gadgets',n:'Razer Atlas gaming mouse mat (pokok 1.579.060) — PRIBADI: sheet menulis "Razer 1.432.622", barang & nominal berbeda'},
 151380 :{k:'Electronics & Gadgets',n:'Logitech MX Master 4 for Mac (pokok 1.816.560) — PRIBADI: sheet menulis "logitech 1.049.450", nominal berbeda'},
 357878 :{k:'Electronics & Gadgets',n:'Lenovo V14 Core i3 (pokok 4.294.530) — PRIBADI: "lenovo" tidak ada di sheet'},
 483393 :{k:'Electronics & Gadgets',n:'POCO F7 512GB, dikirim ke Syahnaz (pokok 5.800.710) — PRIBADI: tidak ada di sheet'},
 6738925:{k:'Home & Furniture',     n:'Eufy Robot Vacuum Omni C20 + hair dryer + hanger jas — PRIBADI: sheet menulis "eufy sdc 916.840", barang & nominal berbeda'},
};
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const ja=[],jb=[];
console.log('=== A. 20 Feb → reimburse_out Hamasa ===');
for(const a of A){const h=led.filter(r=>r.tx_type==='expense'&&Math.abs(+r.amount_idr-a)<1&&/tokopedia/i.test(r.description||'')&&r.tx_date>='2026-02-01'&&r.tx_date<='2026-02-28');
  if(h.length!==1){console.log(`  ⚠ ${rp(a)} cocok ${h.length}`);continue;}
  console.log(`  ${h[0].tx_date} ${rp(a).padStart(11)} ${nm(h[0].from_id)}`);ja.push(h[0]);}
console.log('\n=== B. hasil uji sheet — semuanya PRIBADI ===');
for(const[a,v]of Object.entries(B)){const h=led.filter(r=>r.tx_type==='expense'&&Math.abs(+r.amount_idr-Number(a))<1&&/TOKOPEDIA_CYBS|CCL12/i.test(r.description||''));
  console.log(`  ${rp(a).padStart(11)} × ${String(h.length).padStart(2)} baris → ${v.k}`);
  console.log(`      ${v.n.slice(0,96)}`);
  h.forEach(r=>jb.push({r,v}));}
// refund hair dryer ikut kategori Eufy
const rfd=led.find(r=>r.tx_type==='income'&&Math.abs(+r.amount_idr-884400)<1);
console.log(`\nrefund hair dryer 884.400: ${rfd?'ikut pindah ke Home & Furniture agar netonya di kategori yg benar':'tidak ketemu'}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/feb3_${Date.now()}.json`,JSON.stringify([...ja,...jb.map(j=>j.r),rfd].filter(Boolean),null,1));
let ok=0;
for(const r of ja){const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,entity:'Hamasa',
  reimburse_settlement_id:SETTLE,category_id:null,category_name:null,notes:'Tokopedia 20 Feb — reimburse Hamasa (Paulus)'}).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL A',error.message);}
for(const j of jb){const c=C(j.v.k);const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:j.v.n}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL B',error.message);}
if(rfd){const c=C('Home & Furniture');await supabase.from('ledger').update({category_id:c.id,category_name:c.name,
  notes:'refund Gaabor hair dryer (dari pesanan Eufy 19 Feb)'}).eq('id',rfd.id).eq('user_id',uid);ok++;}
console.log(`\nditulis ${ok}/${ja.length+jb.length+(rfd?1:0)}`);
const after=await accountsApi.getAll(uid);
let beda=0;for(const a of after.filter(a=>a.type==='credit_card'))if(Math.abs(before[a.name]-Number(a.outstanding_amount||0))>0.5){console.log(`⚠ ${a.name} berubah`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
