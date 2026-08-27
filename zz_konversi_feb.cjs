// Februari + koreksi refund Januari yang terlewat.
// KAIDAH: kalau tagihannya jadi piutang, refund-nya HARUS ikut jadi pengurang piutang —
// bukan pengurang belanja. Refund 2.289.545 (Hikvision batal dari pesanan 29 Jan) terlewat
// karena tanggalnya 1 Feb, sementara konversinya kukerjakan per bulan Januari.
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
const C=n=>{const c=(cats||[]).find(x=>x.name===n);if(!c)throw new Error('kategori tak ada: '+n);return c;};
const P=[
 {d:'2026-02-02',a:5763020, p:5763020, cat:null, w:'PLAUD Note Pro + antena TV ×2 + Hikvision ×7 — piutang penuh'},
 {d:'2026-02-04',a:2147993, p:2147993, cat:null, w:'Hikvision Turbo HD 2MP ×7 — piutang penuh'},
 {d:'2026-02-26',a:2513405, p:2513405, cat:null, w:'kabel UTP Belden + flashdisk Lexar — piutang penuh'},
 {d:'2026-02-23',a:1565020, p:1223808, cat:'Clothing & Accessories', w:'PSU+SSD+RAM (piutang) + hanger & cover jas (pribadi)'},
 {d:'2026-02-24',a:461896,  p:344963,  cat:'Health & Personal Care', w:'konektor RJ45 Belden (piutang) + wash gloves (pribadi)'},
 {d:'2026-02-08',a:1300363, p:0, cat:'Health & Personal Care',  w:'Dymatize ISO100 + acrylic display — pribadi'},
 {d:'2026-02-15',a:2515200, p:0, cat:'Health & Personal Care',  w:'Dymatize ISO100 5 lbs — pribadi'},
 {d:'2026-02-18',a:1020829, p:0, cat:'Health & Personal Care',  w:'LunaBloom & MetaBloom kolagen — pribadi'},
 {d:'2026-02-18',a:337620,  p:0, cat:'Groceries & Household',   w:'kaldu hotpot KUWA, sambal Finna, angpao — pribadi'},
 {d:'2026-02-11',a:1254167, p:0, cat:'Taxes',                   w:'pajak DJP, NPWP pribadi Paulus'},
];
const REFUND=[
 {d:'2026-02-01',a:2289545,w:'refund Hikvision batal (pesanan 29 Jan) → mengurangi piutang, bukan belanja'},
 {d:'2026-02-04',a:2387960,w:'refund Hikvision batal (pesanan 2 Feb) → mengurangi piutang'},
];
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[],rjobs=[];
console.log('=== RENCANA FEBRUARI ===');
for(const p of P){
  const hit=led.filter(r=>r.tx_date===p.d&&r.tx_type==='expense'&&Math.abs(+r.amount_idr-p.a)<1&&/tokopedia/i.test(r.description||''));
  if(hit.length!==1){console.log(`  ⚠ LEWAT ${p.d} ${rp(p.a)} — cocok ${hit.length}`);continue;}
  const jenis=p.p===0?'KATEGORI':p.p===p.a?'PIUTANG PENUH':'DIPECAH';
  console.log(`  ${p.d} ${rp(p.a).padStart(11)} ${nm(hit[0].from_id).padEnd(14)} ${jenis.padEnd(14)} piutang ${rp(p.p).padStart(10)} · pribadi ${rp(p.a-p.p).padStart(9)}`);
  jobs.push({r:hit[0],p});
}
console.log('\n=== REFUND yang harus pindah ke sisi piutang ===');
for(const f of REFUND){
  const hit=led.filter(r=>r.tx_date===f.d&&r.tx_type==='income'&&Math.abs(+r.amount_idr-f.a)<1);
  if(hit.length!==1){console.log(`  ⚠ LEWAT ${f.d} ${rp(f.a)} — cocok ${hit.length}`);continue;}
  console.log(`  ${f.d} ${rp(f.a).padStart(11)} ${nm(hit[0].to_id).padEnd(14)} income → reimburse_in Hamasa`);
  rjobs.push({r:hit[0],f});
}
console.log('\nDITAHAN: 21-02 9.591.508 · 1.786.355 · 8.899.432 (tidak ada emailnya) · 1.132.464 (telkomsel piutang?) · 12-02 1.217.700 (set top box?)');
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/feb_${Date.now()}.json`,JSON.stringify([...jobs.map(j=>j.r),...rjobs.map(j=>j.r)],null,1));
let ok=0;
for(const j of jobs){const{r,p}=j;
  if(p.p===0){const c=C(p.cat);
    const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:p.w}).eq('id',r.id).eq('user_id',uid);
    if(!error)ok++;else console.log('GAGAL',error.message);
  } else if(p.p===p.a){
    const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,entity:'Hamasa',
      reimburse_settlement_id:SETTLE,category_id:null,category_name:null,notes:p.w}).eq('id',r.id).eq('user_id',uid);
    if(!error)ok++;else console.log('GAGAL',error.message);
  } else {const c=C(p.cat),sisa=p.a-p.p;
    const{error:e1}=await supabase.from('ledger').update({amount:sisa,amount_idr:sisa,category_id:c.id,category_name:c.name,
      notes:p.w+' — sisi pribadi (dipecah dari '+rp(p.a)+')'}).eq('id',r.id).eq('user_id',uid);
    if(e1){console.log('GAGAL',e1.message);continue;}
    const{error:e2}=await supabase.from('ledger').insert([{user_id:uid,tx_date:r.tx_date,tx_type:'reimburse_out',amount:p.p,currency:'IDR',
      amount_idr:p.p,description:r.description,notes:p.w+' — sisi piutang (dipecah dari '+rp(p.a)+')',source:'split-email',
      from_type:'account',from_id:r.from_id,to_type:'account',to_id:PIUTANG,entity:'Hamasa',reimburse_settlement_id:SETTLE}]);
    if(!e2)ok++;else console.log('GAGAL',e2.message);
  }
}
for(const j of rjobs){
  const{error}=await supabase.from('ledger').update({tx_type:'reimburse_in',from_type:'account',from_id:PIUTANG,
    entity:'Hamasa',reimburse_settlement_id:SETTLE,category_id:null,category_name:null,notes:j.f.w}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL refund',error.message);
}
console.log(`\nditulis ${ok}/${jobs.length+rjobs.length}`);
const after=await accountsApi.getAll(uid);
let beda=0;for(const a of after.filter(a=>a.type==='credit_card'))if(Math.abs(before[a.name]-Number(a.outstanding_amount||0))>0.5){console.log(`⚠ ${a.name}: ${rp(before[a.name])} → ${rp(a.outstanding_amount)}`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
