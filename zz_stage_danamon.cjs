// Danamon Lebih PRO (bdi_estatement_903691853372_*.pdf, tanpa pw), seksi IDR saja.
// Validasi: awal + Σ = akhir per bulan + rantai antar bulan + anchor 1 Apr = app initial.
// Stage + pair 30jt 19 Feb dgn yatim BCA R + cek pasangan 2.386.000/745.000 Mar.
const fs=require('fs');
const{execSync}=require('child_process');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const num=s=>Number(s.replace(/\./g,'').replace(',','.'));
const APPLY=process.argv.includes('apply');
const H=f=>`${process.env.HOME}/Downloads/${f}`;
const MON={Des:'12',Dec:'12',Jan:'01',Feb:'02',Mar:'03',Apr:'04',Mei:'05',May:'05'};

function parseDanamonIDR(path){
  const txt=execSync(`pdftotext -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');
  let inIDR=false;const rows=[];let cur=null;
  for(const raw of lines){
    if(/DANAMON LEBIH PRO \(IDR\) - /.test(raw)){inIDR=true;continue;}
    if(inIDR&&/DANAMON LEBIH PRO \((?!IDR)/.test(raw)){inIDR=false;continue;}
    if(!inIDR)continue;
    const m=raw.match(/^\s+(\d{1,2}) (\w{3}) (\d{4})\s+(.+?)\s{2,}(-?[\d\.]+,\d{2})\s+([\d\.]+,\d{2})\s*$/);
    if(m){
      const amt=num(m[5]);
      cur={date:`${m[3]}-${MON[m[2]]}-${String(m[1]).padStart(2,'0')}`,desc:m[4].trim(),amt:Math.abs(amt),db:amt<0,saldo:num(m[6])};
      rows.push(cur);continue;
    }
    const c=raw.match(/^\s{20,}(\S.*\S)\s*$/);
    if(cur&&c&&!/Total|Tanggal|Keterangan|Transaction|Halaman|Page/.test(c[1])&&!/^[\d\.,\s-]+$/.test(c[1]))cur.desc+=' | '+c[1].trim();
  }
  return rows;
}

(async()=>{
const files=['bdi_estatement_903691853372_Des2025.pdf','bdi_estatement_903691853372_Jan2026.pdf','bdi_estatement_903691853372_Feb2026.pdf','bdi_estatement_903691853372_Mar2026.pdf','bdi_estatement_903691853372_Apr2026.pdf'];
let prev=null;const all=[];
for(const f of files){
  const rows=parseDanamonIDR(H(f));
  if(!rows.length){console.log(f,'ROWS 0 !!');continue;}
  // saldo awal implisit = saldo baris pertama dikurangi mutasinya
  const first=rows[0];const open=first.saldo+(first.db?first.amt:-first.amt);
  const close=rows[rows.length-1].saldo;
  let s=open;for(const r of rows)s+=(r.db?-1:1)*r.amt;
  const ok=Math.abs(s-close)<0.011?'BALANCE':'SELISIH '+rp(s-close);
  const chain=prev==null?'—':(Math.abs(prev-open)<0.011?'NYAMBUNG':'PUTUS '+rp(prev-open));
  console.log(`${f.padEnd(44)} rows ${rows.length} | awal ${rp(open)} | akhir ${rp(close)} | ${ok} | ${chain}`);
  prev=close;
  for(const r of rows){all.push({...r,file:f});if(process.env.DUMP)console.log('  ',r.date,(r.db?'-':'+')+rp(r.amt).padStart(14),'|',r.desc.slice(0,70));}
}
console.log('anchor: akhir Mar harus = app initial 5.399.338 →',rp(prev),'(akhir Apr; lihat baris Mar di atas)');

const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const dan=accounts.find(a=>a.name==='Danamon'&&a.type==='bank');
const bcar=accounts.find(a=>a.name==='BCA R'&&a.type==='bank');
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const srcInterest=srcs.find(s=>s.name==='Bank Interest')?.id;
// cek ledger app Danamon (harus kosong)
const{data:led}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('account_id',dan.id);
console.log('ledger app Danamon:',(led||[]).length,'baris');

const rows=all.map(r=>{
  const row={user_id:uid,account_id:dan.id,tx_date:r.date,amount:Math.round(r.amt*100)/100,currency:'IDR',
    direction:r.db?'out':'in',description:r.desc.slice(0,300),source_file:r.file.slice(0,60),statement_month:r.date.slice(0,7),
    tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:true,status:'staged'};
  if(/Credit Interest/.test(r.desc)){row.tx_type='income';row.category_id=srcInterest;row.entity='Personal';row.needs_review=false;}
  else if(/TAX Deducted/.test(r.desc)){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';row.needs_review=false;}
  else if(/RD Drawdown/.test(r.desc)){row.description+=' — autodebet RD (reksa dana) Danamon acct 003704939; AKUN ASET BELUM ADA di app, buat saat connect';}
  else if(/BIFAST CENAIDJA/.test(r.desc)&&!r.db&&Math.round(r.amt)===30000000){row.tx_type='transfer';row.counter_account_id=bcar.id;row.needs_review=false;row.description+=' — dari BCA R 19 Feb (yatim terpecahkan)';}
  else if(/FX TRX IDR-EUR/.test(r.desc)){row.description+=' — FX beli €1.500 → gabung €500 lama → TARIK TUNAI €2.000 (19 Feb, kas trip Berlin; EUR Cash pra-genesis)';}
  return row;
});

// pasangan 2.386.000 (11 Mar) & 745.000 (13 Mar)?
let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('id,account_id,tx_date,amount,direction,description,tx_type,counter_account_id').eq('user_id',uid).order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}
for(const[amt,d]of[[2386000,'2026-03-11'],[745000,'2026-03-13']]){
  const hit=st.filter(x=>Math.round(Number(x.amount))===amt&&x.direction==='out'&&Math.abs(new Date(x.tx_date)-new Date(d))<=2*864e5);
  console.log('pasangan',rp(amt),d,':',hit.length?hit.map(h=>nm(h.account_id)+' '+h.tx_date+' ['+(h.tx_type||'?')+'] '+(h.description||'').slice(0,50)).join(' ;; '):'TIDAK ADA');
  if(hit.length===1){
    const r=rows.find(x=>Math.round(x.amount)===amt&&x.tx_date===d);
    if(r){r.tx_type='transfer';r.counter_account_id=hit[0].account_id;r.needs_review=false;}
  }
}
// update sisi BCA R yatim 30jt
const b30=st.find(x=>nm(x.account_id)==='BCA R'&&x.tx_date==='2026-02-19'&&Math.round(Number(x.amount))===30000000&&x.direction==='out');
console.log('sisi BCA R 30jt:',b30?'ketemu':'??');

if(!APPLY){console.log('(dry-run — insert',rows.length,')');process.exit(0);}
await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',dan.id);
for(let i=0;i<rows.length;i+=100){const{error}=await supabase.from('ledger_staging').insert(rows.slice(i,i+100));if(error){console.log('ERR',error.message);process.exit(1);}}
if(b30)await supabase.from('ledger_staging').update({tx_type:'transfer',counter_account_id:dan.id,needs_review:false,entity:null,category_id:null,
  description:'BI-FAST DB BIF TRANSFER KE | PAULUS ISKANDAR | MyBCA — ke DANAMON (FX €1.500 + tarik tunai €2.000, kas Berlin)'}).eq('id',b30.id);
console.log('STAGED',rows.length,'Danamon + BCA R 30jt paired');
process.exit(0);
})();
