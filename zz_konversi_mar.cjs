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
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,entity,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== 6 pembelian Maret yg COCOK PERSIS sheet — ada di ledger? ===');
const SHEET=[[5030400,'Printer Epson L8050'],[2573900,'TP-Link Deco X50 mesh 3-pack'],[430300,'TP-Link switch LS1005G + TL-SG108'],[2511250,'Printer Epson L3250'],[2812250,'Printer Epson LX310 dot matrix'],[298660,'NODX Wireless Display Adapter']];
const conv=[];
for(const[a,b]of SHEET){
  const h=led.filter(r=>Math.abs(+r.amount_idr-a)<1);
  if(!h.length){console.log(`  ${rp(a).padStart(11)} ${b.padEnd(34)} → TIDAK ADA di ledger`);continue;}
  for(const r of h){console.log(`  ${rp(a).padStart(11)} ${b.padEnd(34)} → ${r.tx_date} ${r.tx_type} ${nm(r.from_id)} ${r.entity||''}`);
    if(r.tx_type==='expense')conv.push({r,b});}
}
console.log('\n=== baris ledger Maret yang jelas ===');
const JELAS=[[288600,'Electronics & Gadgets','Bracket monitor full rotation — pribadi (tidak ada di sheet)'],
             [1254167,'Taxes','pajak DJP, NPWP pribadi Paulus (11 Mar)']];
const jj=[];
for(const[a,k,n]of JELAS){
  const h=led.filter(r=>r.tx_type==='expense'&&Math.abs(+r.amount_idr-a)<1&&r.tx_date>='2026-03-01'&&r.tx_date<='2026-03-31'&&/tokopedia/i.test(r.description||''));
  if(h.length!==1){console.log(`  ⚠ ${rp(a)} cocok ${h.length}`);continue;}
  console.log(`  ${h[0].tx_date} ${rp(a).padStart(11)} → ${k}`);jj.push({r:h[0],k,n});
}
console.log('\n=== Lazada 114.000 (19 Agu) — pola bulanan Hamasa ===');
const lz=led.find(r=>r.tx_type==='expense'&&Math.abs(+r.amount_idr-114000)<1&&/lazada/i.test(r.description||''));
const lzPrec=led.filter(r=>r.tx_type==='reimburse_out'&&Math.abs(+r.amount_idr-114000)<1&&/lazada/i.test(r.description||''));
console.log(`  preseden: ${lzPrec.length} baris 114.000 sudah reimburse_out Hamasa (${lzPrec.map(r=>r.tx_date).join(', ')})`);
console.log(`  ${lz?lz.tx_date+' → akan jadi reimburse_out Hamasa':'tidak ketemu'}`);
console.log('\nDITAHAN: 12–13 Mar 9.453.925 · 9.605.942 · 1.478.497 (tanpa email, 20.538.364) · 741.094 pajak Henny · Lazada 1.034.675 (25 Jun, di luar rentang 15–20)');
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/mar_${Date.now()}.json`,JSON.stringify([...conv.map(c=>c.r),...jj.map(j=>j.r),lz].filter(Boolean),null,1));
let ok=0;
for(const c of conv){const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,entity:'Hamasa',
  reimburse_settlement_id:SETTLE,category_id:null,category_name:null,notes:c.b+' — cocok persis sheet Piutang'}).eq('id',c.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
for(const j of jj){const c=C(j.k);const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:j.n}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
if(lz){const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,entity:'Hamasa',
  reimburse_settlement_id:SETTLE,category_id:null,category_name:null,notes:'Telkomsel bulanan via Lazada — reimburse Hamasa (pola bulanan, aturan Paulus)'}).eq('id',lz.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL lazada',error.message);}
console.log(`\nditulis ${ok}`);
const after=await accountsApi.getAll(uid);
let beda=0;for(const a of after.filter(a=>a.type==='credit_card'))if(Math.abs(before[a.name]-Number(a.outstanding_amount||0))>0.5){console.log(`⚠ ${a.name} berubah`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
