// STAGE BCA R Des 2025 – Mar 2026 → ledger_staging (BUKAN ledger).
// Klasifikasi hanya untuk pola yang PASTI; sisanya needs_review.
// Transfer antar rekening sendiri dipasangkan lintas-statement (BCA IDR & Mandiri).
const fs=require('fs');
const{execSync}=require('child_process');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');

// ── parser BCA (sama dgn zz_bca_parse, ringkas) ──
const num=s=>Number(s.replace(/,/g,''));
function parseBCA(path){
  const txt=execSync(`pdftotext -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');const sections={};let cur=null,sec=null,last=null;
  for(const raw of lines){
    const line=raw.replace(/\s+$/,'');
    const mc=line.replace(/\s+/g,'').match(/MATAUANG:([A-Z]{3})/);
    if(mc){cur=mc[1];sec=sections[cur]=sections[cur]||{rows:[]};last=null;continue;}
    if(!sec)continue;
    const m=line.match(/^\s{3,14}(\d{2}\/\d{2})\s+(.*)$/);
    if(m){const rest=m[2];
      if(/SALDO AWAL/.test(rest)){last=null;continue;}
      const a0=[...rest.matchAll(/([\d,]+\.\d{2})( DB)?/g)][0];
      if(!a0){last={date:m[1],desc:rest.trim(),amt:null,db:false};sec.rows.push(last);continue;}
      last={date:m[1],desc:rest.slice(0,rest.indexOf(a0[0])).replace(/\s+/g,' ').trim(),amt:num(a0[1]),db:!!a0[2]};
      sec.rows.push(last);continue;}
    if(last&&/^\s{28,}/.test(raw)&&raw.trim()){
      const t=raw.trim();
      if(/SALDO|HALAMAN|PERIODE|TANGGAL|KETERANGAN|Bersambung|MUTASI (CR|DB)/i.test(t))continue;
      if(/^[\d,\.]+( DB)?$/.test(t)){if(last.amt==null){const mm=t.match(/^([\d,]+\.\d{2})( DB)?$/);if(mm){last.amt=num(mm[1]);last.db=!!mm[2];}}}
      else last.desc+=' | '+t;}
  }
  for(const c of Object.keys(sections))sections[c].rows=sections[c].rows.filter(r=>r.amt!=null);
  return sections;
}
const iso=(dm,file)=>{const[y]=file.match(/(\d{4})/)?[file.match(/DEC_2025|_2025/)?'2025':'2026']:['2026'];
  const[d,mo]=dm.split('/');const yr=(file.includes('DEC_2025'))?'2025':'2026';return `${yr}-${mo}-${d}`;};

// tanda tangan reimburse Hamasa yang sudah TERBUKTI (pola berlanjut / sheet Piutang)
const HAMASA_SIG=new Set([47205000,9915417,42890250,21723000,11225000,11000000,
  5717100,7562000,14949000,17063500,13206300,10147000]);
// jawaban Paulus 2026-08-26: 479jt = dividen Hamasa (79jt 23 Feb + 100jt 25 Feb);
// 6,45jt-an awal bulan = kumpulan cicilan karyawan (Olylife x2, Vero, Daniel, Lauren, Jajang)
const DIVIDEND_SIG=new Set([100000000,79000000]);
const COLLECT_BATCH=new Set([6450000,6475000]);
// masih menunggu: 31-32jt tengah bulan + one-off lain
const PENDING_Q=new Set([31715600,31846650,32335000,66000000,48000000,35730000,17387500,14760000,8375000]);

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const bcaR=acc('BCA R'),bcaIdr=acc('BCA IDR'),mandiri=acc('Mandiri'),jenius=acc('Jenius IDR');
const bcaCard=accounts.find(a=>a.name==='BCA Card');
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const cat=n=>cats.find(c=>c.name===n)?.id||null;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);

const H=f=>`${process.env.HOME}/Downloads/${f}`;
const filesR=['0830267743_DEC_2025.pdf','0830267743_JAN_2026.pdf','0830267743_FEB_2026.pdf','0830267743_MAR_2026.pdf'];
const filesI=['0831361688_DEC_2025.pdf','0831361688_JAN_2026.pdf','0831361688_FEB_2026.pdf','0831361688_MAR_2026.pdf'];

// kumpulkan baris BCA IDR + Mandiri (utk pairing transfer)
const idrRows=[];
for(const f of filesI){const s=parseBCA(H(f));for(const r of (s.IDR?.rows||[]))idrRows.push({...r,date:iso(r.date,f),bank:'BCA IDR'});}
const{parseMandiri}=require('./zz_mandiri_parse.cjs');
const filesM=['e-Statement_XXXXXXXXX8868_01 Des 2025-31 Des 2025.pdf','e-Statement_XXXXXXXXX8868_01 Jan 2026-31 Jan 2026.pdf','e-Statement_XXXXXXXXX8868_01 Feb 2026-28 Feb 2026.pdf','e-Statement_XXXXXXXXX8868_01 Mar 2026-31 Mar 2026.pdf'];
const MON={Dec:'12',Jan:'01',Feb:'02',Mar:'03'};
for(const f of filesM){const{rows}=parseMandiri(H(f));
  for(const r of rows){const dm=r.date&&r.date.match(/(\d{2}) (\w{3}) (\d{4})/);if(!dm)continue;
    idrRows.push({amt:Math.abs(r.amt),db:r.amt<0,date:`${dm[3]}-${MON[dm[2]]||'00'}-${dm[1]}`,bank:'Mandiri',desc:r.desc});}}
const{parseJenius}=require('./zz_jenius_parse.cjs');
const MON2={Des:'12',Jan:'01',Feb:'02',Mar:'03',Apr:'04'};
for(const f of ['Jenius_eStatement_DES_2025.pdf','Jenius_eStatement_JAN_2026.pdf','Jenius_eStatement_FEB_2026.pdf','Jenius_eStatement_MAR_2026.pdf']){
  const{rows}=parseJenius(H(f));
  for(const r of rows){const dm=r.date.match(/(\d{2}) (\w{3}) (\d{4})/);if(!dm)continue;
    idrRows.push({amt:Math.abs(r.amt),db:r.amt<0,date:`${dm[3]}-${MON2[dm[2]]||'00'}-${dm[1]}`,bank:'Jenius IDR',desc:r.desc});}}

const out=[];const stats={};
const bump=k=>stats[k]=(stats[k]||0)+1;
for(const f of filesR){
  const s=parseBCA(H(f));
  const month=f.includes('DEC')?'2025-12':'2026-0'+({JAN:1,FEB:2,MAR:3})[f.match(/JAN|FEB|MAR/)[0]];
  for(const r of (s.IDR?.rows||[])){
    const d=iso(r.date,f);const amt=Math.round(r.amt);const desc=r.desc.replace(/\s*\|\s*REKENING TAHAPAN.*$/,'');
    const row={user_id:uid,account_id:bcaR.id,tx_date:d,amount:amt,currency:'IDR',
      direction:r.db?'out':'in',description:desc,source_file:f,statement_month:month,
      tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:false};
    const D=desc.toUpperCase();
    if(/SETORAN TUNAI/.test(D)){
      if(HAMASA_SIG.has(amt)){row.tx_type='reimburse_in';row.entity='Hamasa';bump('reimburse_in Hamasa (pasti)');}
      else if(DIVIDEND_SIG.has(amt)){row.tx_type='income';row.category_id=srcs.find(x=>x.name==='Dividend')?.id||null;row.entity='Personal';row.description+=' — Dividen Hamasa (bagian dari 479jt)';bump('income Dividend Hamasa');}
      else if(COLLECT_BATCH.has(amt)){row.tx_type='collect_loan';row.entity='Personal';row.description+=' — kumpulan cicilan karyawan (Olylife x2, Vero, Daniel, Lauren, Jajang)';bump('collect_loan batch karyawan');}
      else if(PENDING_Q.has(amt)){row.needs_review=true;row.tx_type='income';bump('NEEDS_REVIEW setoran (menunggu jawaban)');}
      else{row.needs_review=true;row.tx_type='income';bump('NEEDS_REVIEW setoran lain');}
    }else if(/SAHABAT DENTAL/.test(D)&&!r.db){row.tx_type='reimburse_in';row.entity='SDC';bump('reimburse_in SDC');}
    else if(/KARTU KREDIT/.test(D)){row.tx_type='pay_cc';row.counter_account_id=/BCA CARD/.test(D)?bcaCard?.id:null;
      if(!row.counter_account_id)row.needs_review=true;bump('pay_cc');}
    else if(/DESY PRISKILLA/.test(D)){row.tx_type=r.db?'give_loan':'collect_loan';row.entity='Personal';bump(r.db?'give_loan Desy':'collect_loan Desy');}
    else if(/BIAYA (ADM|TXN)|BIAYA LAYANAN|ADM\b/.test(D)){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';bump('expense Bank Charges');}
    else if(/^BUNGA/.test(D)){row.tx_type='income';row.entity='Personal';bump('income Bunga');}
    else if(/PAJAK BUNGA/.test(D)){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';bump('expense Pajak Bunga');}
    else if(/PAULUSISKANDAR|PAULUS ISKANDAR|KR OTOMATIS/.test(D)&&/BI-?FAST|TRSF|LLG|KR OTOMATIS/.test(D)){
      // transfer antar rekening sendiri: pasangkan dgn BCA IDR (nominal sama, tanggal ±1)
      const pair=idrRows.find(x=>Math.round(x.amt)===amt&&x.db!==r.db&&Math.abs(new Date(x.date)-new Date(d))<=86400000*1);
      row.tx_type='transfer';
      row.counter_account_id=pair?(pair.bank==='Mandiri'?mandiri.id:pair.bank==='Jenius IDR'?jenius.id:bcaIdr.id):null;
      if(!pair){row.needs_review=true;bump('transfer TANPA pasangan (Jenius/lain?)');}else bump('transfer paired -> '+pair.bank);
    }
    else if(/TRANSAKSI DEBIT|QR \d/.test(D)){row.tx_type='expense';row.entity='Personal';row.needs_review=true;bump('expense QR (kategori menyusul)');}
    else{row.needs_review=true;row.tx_type=r.db?'expense':'income';row.entity='Personal';bump('NEEDS_REVIEW lain2');}
    out.push(row);
  }
}
console.log('total baris staged BCA R:',out.length);
for(const[k,v]of Object.entries(stats).sort((a,b)=>b[1]-a[1]))console.log(' ',String(v).padStart(3),k);
const nr=out.filter(r=>r.needs_review);
console.log('needs_review:',nr.length,'baris | nilai total',rp(nr.reduce((s,r)=>s+r.amount,0)));
if(!APPLY){console.log('\n(dry-run — jalankan dgn "apply" utk tulis ke ledger_staging)');process.exit(0);}
// wipe staging BCA R lalu insert
await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',bcaR.id);
for(let i=0;i<out.length;i+=100){
  const{error}=await supabase.from('ledger_staging').insert(out.slice(i,i+100));
  if(error){console.log('ERR insert',error.message);process.exit(1);}
}
console.log('STAGED ->',out.length,'baris ke ledger_staging (ledger asli tak tersentuh)');
process.exit(0);
})();
