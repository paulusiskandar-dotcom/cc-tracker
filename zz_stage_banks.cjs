// STAGE bank lain (Des 2025–Mar/Apr 2026) → ledger_staging.
// Parse mentah semua akun, klasifikasi ringan (biaya/bunga/pola pasti),
// pairing transfer GLOBAL antar semua rekening (termasuk BCA R yang sudah staged).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const{execSync}=require('child_process');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
const H=f=>`${process.env.HOME}/Downloads/${f}`;
const numID=s=>Number(String(s).replace(/\./g,'').replace(',','.'));

// parser2 tervalidasi
delete require.cache[require.resolve('./zz_mandiri_parse.cjs')];
const{parseMandiri}=require('./zz_mandiri_parse.cjs');
const{parseJenius}=require('./zz_jenius_parse.cjs');
const{parseNeo}=require('./zz_neobank_parse.cjs');

// BCA multi-valuta (copy ringkas dari zz_bca_parse)
const numUS=s=>Number(s.replace(/,/g,''));
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
      last={date:m[1],desc:rest.slice(0,rest.indexOf(a0[0])).replace(/\s+/g,' ').trim(),amt:numUS(a0[1]),db:!!a0[2]};
      sec.rows.push(last);continue;}
    if(last&&/^\s{28,}/.test(raw)&&raw.trim()){
      const t=raw.trim();
      if(/SALDO|HALAMAN|PERIODE|TANGGAL|KETERANGAN|Bersambung|MUTASI (CR|DB)/i.test(t))continue;
      if(/^[\d,\.]+( DB)?$/.test(t)){if(last.amt==null){const mm=t.match(/^([\d,]+\.\d{2})( DB)?$/);if(mm){last.amt=numUS(mm[1]);last.db=!!mm[2];}}}
      else last.desc+=' | '+t;}
  }
  for(const c of Object.keys(sections))sections[c].rows=sections[c].rows.filter(r=>r.amt!=null);
  return sections;
}
// Superbank (Tabungan Utama)
function parseSuper(path){
  const txt=execSync(`pdftotext -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');const rows=[];let inSec=false;let pend=null;
  const year=(path.match(/(\d{4})-(\d{2})/)||[])[1];
  for(const raw of lines){
    const l=raw.replace(/\s+$/,'');
    if(/Tabungan Utama - 000014687990/.test(l)){inSec=true;continue;}
    if(!inSec)continue;
    if(/Deposito - |Saku by/.test(l))break;
    const ma=l.match(/([+-])Rp([\d\.,]+)\s+(?:Rp[\d\.,]+)?\s*$/);
    if(ma){pend={sign:ma[1],amt:numID(ma[2].replace(/,(\d{2})$/,'#$1').replace(/\./g,'').replace('#',','))};continue;}
    const md=l.match(/^\s*(\d{1,2}) (\w{3})(?: (\d{4}))?\s+(.+)$/);
    if(md&&pend){
      const MON={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Dec:'12',Des:'12'};
      const y=md[3]||((path.includes('2025-12'))?'2025':'2026');
      rows.push({date:`${y}-${MON[md[2]]||'00'}-${String(md[1]).padStart(2,'0')}`,desc:md[4].trim(),amt:pend.amt,db:pend.sign==='-'});
      pend=null;
    }
  }
  return rows;
}

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const A=n=>accounts.find(a=>a.name===n&&(a.type==='bank'));
const acc={bcaR:A('BCA R'),bcaIdr:A('BCA IDR'),mandiri:A('Mandiri'),jenius:A('Jenius IDR'),superbank:A('Superbank'),neobank:A('Neobank'),
  bcaJpy:A('BCA JPY'),bcaSgd:A('BCA SGD'),bcaEur:A('BCA EUR'),bcaChf:A('BCA CHF'),bcaHkd:A('BCA HKD'),bcaMyr:A('BCA MYR')};
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const srcInterest=srcs.find(s=>s.name==='Bank Interest')?.id;

const all=[]; // {account_id,tx_date,amount,currency,direction,description,source_file,statement_month,...}
const push=(a,r,extra={})=>all.push({user_id:uid,account_id:a.id,tx_date:r.date,amount:Math.round(r.amt*100)/100,
  currency:extra.currency||'IDR',direction:r.db?'out':'in',description:r.desc.slice(0,300),
  source_file:extra.file,statement_month:r.date.slice(0,7),tx_type:null,category_id:null,entity:null,
  counter_account_id:null,needs_review:true,...extra.set});

// BCA IDR + valas (Des–Mar)
const isoB=(dm,f)=>{const[d,mo]=dm.split('/');return `${f.includes('DEC_2025')?'2025':'2026'}-${mo}-${d}`;};
for(const f of ['0831361688_DEC_2025.pdf','0831361688_JAN_2026.pdf','0831361688_FEB_2026.pdf','0831361688_MAR_2026.pdf']){
  const s=parseBCA(H(f));
  const map={IDR:acc.bcaIdr,JPY:acc.bcaJpy,SGD:acc.bcaSgd,EUR:acc.bcaEur,CHF:acc.bcaChf,HKD:acc.bcaHkd,MYR:acc.bcaMyr};
  for(const[curName,a]of Object.entries(map)){
    for(const r of (s[curName]?.rows||[]))push(a,{...r,date:isoB(r.date,f)},{file:f,currency:curName==='IDR'?'IDR':curName});
  }
}
// Mandiri (Des–Mar)
const MONm={Dec:'12',Jan:'01',Feb:'02',Mar:'03'};
for(const f of ['e-Statement_XXXXXXXXX8868_01 Des 2025-31 Des 2025.pdf','e-Statement_XXXXXXXXX8868_01 Jan 2026-31 Jan 2026.pdf','e-Statement_XXXXXXXXX8868_01 Feb 2026-28 Feb 2026.pdf','e-Statement_XXXXXXXXX8868_01 Mar 2026-31 Mar 2026.pdf']){
  const{rows}=parseMandiri(H(f));
  for(const r of rows){const dm=r.date&&r.date.match(/(\d{2}) (\w{3}) (\d{4})/);if(!dm)continue;
    push(acc.mandiri,{date:`${dm[3]}-${MONm[dm[2]]}-${dm[1]}`,desc:r.desc,amt:Math.abs(r.amt),db:r.amt<0},{file:f.slice(0,40)});}
}
// Jenius (Des–Mar)
const MONj={Des:'12',Jan:'01',Feb:'02',Mar:'03'};
for(const f of ['Jenius_eStatement_DES_2025.pdf','Jenius_eStatement_JAN_2026.pdf','Jenius_eStatement_FEB_2026.pdf','Jenius_eStatement_MAR_2026.pdf']){
  const{rows}=parseJenius(H(f));
  for(const r of rows){const dm=r.date.match(/(\d{2}) (\w{3}) (\d{4})/);if(!dm)continue;
    push(acc.jenius,{date:`${dm[3]}-${MONj[dm[2]]}-${dm[1]}`,desc:r.desc,amt:Math.abs(r.amt),db:r.amt<0},{file:f});}
}
// Superbank (Des–Apr; genesis Mei)
for(const f of ['000014687990-2025-12-statement.pdf','000014687990-2026-01-statement.pdf','000014687990-2026-02-statement.pdf','000014687990-2026-03-statement.pdf','000014687990-2026-04-statement.pdf']){
  for(const r of parseSuper(H(f)))push(acc.superbank,r,{file:f});
}
// Neobank (Des–Apr; genesis tak ada)
for(const f of ['e-statement_Dec_2025_8168.pdf','e-statement_Jan_2026_8168.pdf','e-statement_Feb_2026_8168.pdf','e-statement_Mar_2026_8168.pdf','e-statement_Apr_2026_8168.pdf']){
  const{rows}=parseNeo(H(f));
  for(const r of rows)push(acc.neobank,r,{file:f});
}

// ── klasifikasi ringan ──
for(const r of all){
  const D=r.description.toUpperCase();
  if(/BUNGA|INTEREST/.test(D)&&!/PAJAK|TAX/.test(D)&&r.direction==='in'){r.tx_type='income';r.category_id=srcInterest;r.entity='Personal';r.needs_review=false;}
  else if(/PAJAK|TAX ON|BIAYA ADM|ADMIN|BIAYA TRANSFER|BIAYA TXN|FEE/.test(D)&&r.amount<100000){r.tx_type='expense';r.category_id=cat('Bank Charges');r.entity='Personal';r.needs_review=false;}
  else if(/PEMBAYARAN KARTU KREDIT|KARTU KREDIT/.test(D)&&r.direction==='out'){r.tx_type='pay_cc';}
  else if(r.direction==='out'&&/MEGAIDJA|DBSBIDJA|BNINIDJA|BDINIDJA|IBBKIDJA|CENAIDJA|NOBUIDJA|\b4\d{15}\b|\b5\d{15}\b/.test(D)){r.tx_type='pay_cc';}
  else if(/LAZADA/.test(D)){r.tx_type='reimburse_out';r.entity='Hamasa';r.needs_review=false;}
}
// ── pairing transfer global (semua akun + BCA R yang sudah staged) ──
const{data:staged}=await supabase.from('ledger_staging').select('id,account_id,tx_date,amount,direction').eq('user_id',uid);
const pool=[...all.map((r,i)=>({idx:i,acc:r.account_id,date:r.tx_date,amt:Math.round(r.amount),dir:r.direction,src:'new'})),
  ...(staged||[]).map(s=>({id:s.id,acc:s.account_id,date:s.tx_date,amt:Math.round(s.amount),dir:s.direction,src:'db'}))];
let paired=0;
for(const r of all){
  if(r.counter_account_id||!/PAULUS|TRANSFER|BI ?FAST|LLG|KEKAYAAN|SMBC/i.test(r.description))continue;
  const amt=Math.round(r.amount);
  const p=pool.find(x=>x.acc!==r.account_id&&x.amt===amt&&x.dir!==r.direction&&Math.abs(new Date(x.date)-new Date(r.tx_date))<=86400000);
  if(p){r.tx_type='transfer';r.counter_account_id=p.acc;r.needs_review=false;paired++;}
}
const stats={};for(const r of all){const k=(r.tx_type||'??')+(r.needs_review?' (review)':'');stats[k]=(stats[k]||0)+1;}
console.log('total baris:',all.length,'| paired transfer:',paired);
for(const[k,v]of Object.entries(stats).sort((a,b)=>b[1]-a[1]))console.log(' ',String(v).padStart(4),k);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
// hapus staging lama utk akun-akun yang di-stage ulang — BCA R TIDAK ikut
const wipeIds=[...new Set(all.map(r=>r.account_id))];
for(const id of wipeIds)await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',id);
for(let i=0;i<all.length;i+=100){
  const{error}=await supabase.from('ledger_staging').insert(all.slice(i,i+100));
  if(error){console.log('ERR',error.message,'batch',i);process.exit(1);}
}
console.log('STAGED',all.length,'baris (BCA R tetap utuh)');
process.exit(0);
})();
