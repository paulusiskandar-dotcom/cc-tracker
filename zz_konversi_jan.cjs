// Konversi Tokopedia Januari: pecah campuran, ubah yg piutang jadi reimburse_out.
// Setiap baris Jan–Mar WAJIB distempel settlement historis supaya piutang hidup tak bergerak.
// DRY-RUN default; --apply utk menulis.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>{const c=(cats||[]).find(x=>x.name===n);if(!c)throw new Error('kategori tak ada: '+n);return c;};
const PIUTANG_HAMASA='f282ac7e-a908-4e5d-adb0-144473e9f126';
const SETTLE_HAMASA='014ccdfa-5837-4e32-a9ef-c6ce6fae8142';

// preseden: reimburse_out listrik/PLN yg sudah ada pakai entity apa?
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,from_id,to_id,entity,category_name,description,reimburse_settlement_id').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const pln=led.filter(r=>r.tx_type==='reimburse_out'&&/PLN|LISTRIK/i.test(r.description||''));
const ge={};pln.forEach(r=>{ge[r.entity||'-']=(ge[r.entity||'-']||0)+1;});
console.log('PRESEDEN entity utk reimburse_out listrik/PLN yg sudah ada:',JSON.stringify(ge),`(${pln.length} baris)`);
for(const r of pln.slice(0,5))console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.entity} | ${(r.description||'').slice(0,45)}`);

// RENCANA. piutang dihitung proporsional dari harga barang di email; sisanya = pribadi.
const P=[
 {d:'2026-01-05',a:395566, piutang:338259, catP:'Hobbies & Entertainment', why:'SanDisk GamePlay (piutang) + PS Vita/3DS (pribadi)'},
 {d:'2026-01-06',a:339900, piutang:339900, catP:null, why:'SanDisk Extreme — piutang penuh'},
 {d:'2026-01-11',a:558154, piutang:558154, catP:null, why:'modem, toner, adaptor CCTV, adaptor DVR — piutang penuh'},
 {d:'2026-01-12',a:1702638,piutang:0,      catP:'Health & Personal Care', why:'kolagen, protein, dust bag — pribadi'},
 {d:'2026-01-18',a:1047640,piutang:806235, catP:'Hobbies & Entertainment', why:'KVM Switch + adaptor DVR (piutang) + Gameboy/3DS (pribadi)'},
 {d:'2026-01-19',a:930300, piutang:673703, catP:'Hobbies & Entertainment', why:'Logitech + NODX (piutang) + case Switch 2 + baterai PSP (pribadi)'},
 {d:'2026-01-19',a:1209500,piutang:883286, catP:'Hobbies & Entertainment', why:'stabilizer ×2 (piutang) + case Spigen (pribadi)'},
 {d:'2026-01-19',a:2678847,piutang:2678847,catP:null, why:'listrik PLN Jopie Djohari — reimburse out (Paulus)'},
 {d:'2026-01-19',a:9693415,piutang:9693415,catP:null, why:'19 Jan — reimburse out (Paulus)'},
 {d:'2026-01-20',a:7731514,piutang:7731514,catP:null, why:'19 Jan (posting 20) — reimburse out (Paulus)'},
 {d:'2026-01-22',a:661162, piutang:0,      catP:'Health & Personal Care', why:'Meguiars, Polywatch, Lion Pair — pribadi'},
 {d:'2026-01-28',a:995604, piutang:649014, catP:'Vehicle', why:'RAM + anti gores HP (piutang) + adapter CarPlay (pribadi)'},
 {d:'2026-01-29',a:4070489,piutang:4036540,catP:'Vehicle', why:'Seagate, Hikvision, adaptor, balun (piutang) + anti gores Innova (pribadi)'},
 {d:'2026-01-29',a:5291000,piutang:0,      catP:'Electronics & Gadgets', why:'ONYX BOOX Palma 2 — pribadi'},
];
console.log('\n=== RENCANA ===');
let tp=0,tb=0,nSplit=0,nFull=0,nCat=0;const jobs=[];
for(const p of P){
  const hit=led.filter(r=>r.tx_date===p.d&&r.tx_type==='expense'&&Math.abs(+r.amount_idr-p.a)<1&&/tokopedia/i.test(r.description||''));
  if(hit.length!==1){console.log(`  ⚠ LEWAT ${p.d} ${rp(p.a)} — cocok ${hit.length} baris`);continue;}
  const r=hit[0], sisa=p.a-p.piutang;
  const jenis=p.piutang===0?'KATEGORI SAJA':p.piutang===p.a?'JADI REIMBURSE PENUH':'DIPECAH';
  if(p.piutang===0)nCat++;else if(p.piutang===p.a)nFull++;else nSplit++;
  tp+=p.piutang;tb+=sisa;
  console.log(`  ${p.d} ${rp(p.a).padStart(11)} ${nm(r.from_id).padEnd(13)} ${jenis.padEnd(21)} piutang ${rp(p.piutang).padStart(10)} · pribadi ${rp(sisa).padStart(9)}${p.catP?' → '+p.catP:''}`);
  console.log(`       ${p.why}`);
  jobs.push({r,p,sisa});
}
console.log(`\nringkasan: ${nFull} jadi reimburse penuh · ${nSplit} dipecah · ${nCat} ubah kategori saja`);
console.log(`total ke piutang: ${rp(tp)} | tetap belanja pribadi: ${rp(tb)} | jumlah ${rp(tp+tb)}`);
// refund 171.000
const rf=led.find(r=>r.tx_date==='2026-01-12'&&r.tx_type==='income'&&Math.abs(+r.amount_idr-171000)<1);
console.log(`\nrefund 171.000 12 Jan: ${rf?'ketemu — akan jadi reimburse_in (mengurangi piutang), bukan cashback':'TIDAK KETEMU'}`);

// TAHAN 3 baris yg entity-nya belum jelas (PLN Jopie + dua transaksi 19 Jan)
const TAHAN=[2678847,9693415,7731514];
const kerja=jobs.filter(j=>!TAHAN.some(a=>Math.abs(a-j.p.a)<1));
console.log(`\nDITAHAN (entity belum jelas): ${jobs.length-kerja.length} baris = ${rp(TAHAN.reduce((a,b)=>a+b,0))}`);
console.log(`AKAN DITULIS: ${kerja.length} baris`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply untuk menulis.');process.exit(0);}

// saldo SEBELUM
const before={};for(const a of accounts.filter(a=>a.type==='credit_card'))before[a.name]=Number(a.outstanding_amount||0);
fs.mkdirSync('.backups',{recursive:true});
const bk=`.backups/konversi_jan_${Date.now()}.json`;
fs.writeFileSync(bk,JSON.stringify(kerja.map(j=>j.r),null,1));console.log('backup:',bk);
let ok=0,ins=0;
for(const j of kerja){
  const{r,p,sisa}=j;
  if(p.piutang===0){ // kategori saja
    const c=C(p.catP);
    const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:p.why}).eq('id',r.id).eq('user_id',uid);
    if(error){console.log('GAGAL kat',error.message);continue;} ok++;
  } else if(p.piutang===p.a){ // jadi reimburse_out penuh
    const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG_HAMASA,
      entity:'Hamasa',reimburse_settlement_id:SETTLE_HAMASA,category_id:null,category_name:null,notes:p.why}).eq('id',r.id).eq('user_id',uid);
    if(error){console.log('GAGAL penuh',error.message);continue;} ok++;
  } else { // dipecah
    const c=C(p.catP);
    const{error:e1}=await supabase.from('ledger').update({amount:sisa,amount_idr:sisa,category_id:c.id,category_name:c.name,
      notes:p.why+' — sisi pribadi (dipecah dari tagihan '+rp(p.a)+')'}).eq('id',r.id).eq('user_id',uid);
    if(e1){console.log('GAGAL pecah-1',e1.message);continue;}
    const{error:e2}=await supabase.from('ledger').insert([{user_id:uid,tx_date:r.tx_date,tx_type:'reimburse_out',
      amount:p.piutang,currency:'IDR',amount_idr:p.piutang,description:r.description,
      notes:p.why+' — sisi piutang (dipecah dari tagihan '+rp(p.a)+')',source:'split-email',
      from_type:'account',from_id:r.from_id,to_type:'account',to_id:PIUTANG_HAMASA,
      entity:'Hamasa',reimburse_settlement_id:SETTLE_HAMASA}]);
    if(e2){console.log('GAGAL pecah-2',e2.message);continue;}
    ok++;ins++;
  }
}
console.log(`ditulis ${ok}/${kerja.length} (${ins} baris piutang baru dibuat)`);
// refund 171.000 → reimburse_in mengurangi piutang
if(rf){
  const{error}=await supabase.from('ledger').update({tx_type:'reimburse_in',from_type:'account',from_id:PIUTANG_HAMASA,
    entity:'Hamasa',reimburse_settlement_id:SETTLE_HAMASA,category_id:null,category_name:null,
    description:'Tokopedia — refund adaptor DVR Hikvision (batal, dari pesanan 11 Jan)',
    notes:'refund barang piutang → mengurangi piutang, bukan cashback'}).eq('id',rf.id).eq('user_id',uid);
  console.log(error?('GAGAL refund '+error.message):'refund 171.000 → reimburse_in (mengurangi piutang Hamasa)');
}
// saldo SESUDAH
const after=await accountsApi.getAll(uid);
console.log('\ncek saldo kartu (harus sama persis):');let beda=0;
for(const a of after.filter(a=>a.type==='credit_card')){
  const b=before[a.name],c=Number(a.outstanding_amount||0);
  if(Math.abs(b-c)>0.5){console.log(`  ⚠ ${a.name}: ${rp(b)} → ${rp(c)}`);beda++;}
}
console.log(beda?`  ⚠ ${beda} kartu berubah`:'  ✓ semua kartu tidak berubah');
process.exit(0);})();
