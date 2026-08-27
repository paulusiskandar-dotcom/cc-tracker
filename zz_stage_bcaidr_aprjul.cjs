// STAGE BCA IDR Apr–Jul 2026 (pasca-genesis!) + EUR Jun.
// Tiap baris statement dicek lawan ledger app (from_id/to_id BCA IDR, nominal sama, ±3 hari):
//   kembar → tandai "≡LEDGER" (connect SKIP baris ini), needs_review=false.
//   tanpa kembar → baris HILANG dari app (kandidat insert saat connect).
// JPY TIDAK di-stage (19 baris trip sudah lengkap di ledger, saldo 2.615 = statement).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const{parseBCA}=require('./zz_bca_parse.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const H=f=>`${process.env.HOME}/Downloads/${f}`;

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const bca=accounts.find(a=>a.name==='BCA IDR'&&a.type==='bank');
const eur=accounts.find(a=>a.name==='BCA EUR'&&a.type==='bank');
const kris=accounts.find(a=>a.name==='BCA Krisflyer');
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const src=n=>srcs.find(s=>s.name===n)?.id;

// ledger rows menyentuh BCA IDR
let led=[];
for(const col of['from_id','to_id']){
  for(let off=0;;off+=1000){
    const{data:c}=await supabase.from('ledger').select('id,tx_date,amount,description,from_id,to_id,tx_type').eq('user_id',uid).eq(col,bca.id).range(off,off+999);
    led=led.concat((c||[]).map(r=>({...r,dirOut:r.from_id===bca.id})));if(!c||c.length<1000)break;}
}
// dedup (baris transfer bisa muncul di kedua query kalau from&to dua2nya bca — tak mungkin, tapi jaga)
const seen=new Set();led=led.filter(r=>!seen.has(r.id)&&seen.add(r.id));
console.log('ledger app menyentuh BCA IDR:',led.length,'baris');

const files=['0831361688_APR_2026 2.pdf','0831361688_MAY_2026.pdf','0831361688_JUN_2026.pdf','0831361688_JUL_2026 2.pdf'];
const rows=[];const usedLed=new Set();
const stats={match:0,missIn:0,missOut:0};
for(const f of files){
  const secs=parseBCA(H(f));
  for(const r of secs.IDR.rows){
    const[dd,mm]=r.date.split('/');r.date=`2026-${mm}-${dd}`;
    const row={user_id:uid,account_id:bca.id,tx_date:r.date,amount:Math.round(r.amt*100)/100,currency:'IDR',
      direction:r.db?'out':'in',description:r.desc.slice(0,300),source_file:f.slice(0,60),statement_month:r.date.slice(0,7),
      tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:true,status:'staged'};
    const twin=led.find(L=>!usedLed.has(L.id)&&L.dirOut===r.db&&Math.abs(Number(L.amount)-r.amt)<=1&&
      Math.abs(new Date(L.tx_date)-new Date(r.date))<=3*864e5);
    if(twin){usedLed.add(twin.id);stats.match++;
      row.needs_review=false;row.description=('≡LEDGER '+twin.id+' — sudah ada di app, SKIP saat connect | '+r.desc).slice(0,300);}
    else{
      const D=r.desc.toUpperCase();
      if(r.db)stats.missOut++;else stats.missIn++;
      if(/SAHABAT DENTAL/.test(D)&&/GAJI/.test(D)&&!r.db){row.tx_type='income';row.category_id=src('Salary');row.entity='Personal';row.needs_review=false;}
      else if(/SAHABAT DENTAL/.test(D)&&/LISTRIK/.test(D)&&!r.db){row.tx_type='income';row.category_id=src('Dividend');row.entity='Personal';row.needs_review=false;}
      else if(/KARTU KREDIT\/PL/.test(D)&&r.db){row.tx_type='pay_cc';row.counter_account_id=kris.id;row.needs_review=false;row.description=(r.desc+' — GABUNGAN Krisflyer+BCA Card').slice(0,300);}
      else if(/^BUNGA$/.test(r.desc.trim())&&!r.db){row.tx_type='income';row.category_id=src('Bank Interest');row.entity='Personal';row.needs_review=false;}
      else if(/PAJAK BUNGA|BIAYA ADM|BIAYA TXN/.test(D)&&r.db&&r.amt<100000){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';row.needs_review=false;}
    }
    rows.push(row);
  }
}
// EUR Jun
const jun=parseBCA(H('0831361688_JUN_2026.pdf'));
for(const r of jun.EUR.rows){
  const[dd,mm]=r.date.split('/');r.date=`2026-${mm}-${dd}`;
  rows.push({user_id:uid,account_id:eur.id,tx_date:r.date,amount:Math.round(r.amt*100)/100,currency:'EUR',
    direction:r.db?'out':'in',description:(r.desc+' — transaksi EUR asli Jun (app dulu koreksi-set 410,64→5,08; saat connect: kembalikan initial 410,64 + baris ini)').slice(0,300),
    source_file:'0831361688_JUN_2026.pdf',statement_month:r.date.slice(0,7),tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:true,status:'staged'});
  console.log('EUR Jun:',r.date,(r.db?'-':'+')+rp(r.amt),'|',r.desc.slice(0,80));
}
// pass 2: grup — satu baris statement = Σ beberapa baris ledger hari berdekatan (mis. cicilan+admin, split Krisflyer+Card)
let grup=0;
for(const row of rows.filter(r=>r.account_id===bca.id&&!/≡LEDGER/.test(r.description))){
  const cand=led.filter(L=>!usedLed.has(L.id)&&L.dirOut===(row.direction==='out')&&Math.abs(new Date(L.tx_date)-new Date(row.tx_date))<=4*864e5);
  let hit=null;
  for(let i=0;i<cand.length&&!hit;i++)for(let j=i+1;j<cand.length&&!hit;j++){
    if(Math.abs(Number(cand[i].amount)+Number(cand[j].amount)-Number(row.amount))<=1)hit=[cand[i],cand[j]];
  }
  if(hit){for(const h of hit)usedLed.add(h.id);grup++;
    row.needs_review=false;row.tx_type=null;row.category_id=null;row.counter_account_id=null;
    row.description=('≡LEDGER-GRUP '+hit.map(h=>h.id).join('+')+' — sudah ada di app sbg '+hit.length+' baris, SKIP saat connect | '+row.description).slice(0,300);}
}
console.log('statement rows:',rows.length,'| ≡ledger match:',stats.match,'| ≡grup:',grup);
console.log('SISA statement TANPA kembar (insert saat connect):');
for(const r of rows.filter(x=>x.account_id===bca.id&&!/≡LEDGER/.test(x.description)))
  console.log('  ',r.tx_date,(r.direction==='in'?'+':'-')+rp(r.amount).padStart(13),(r.tx_type||'REVIEW').padEnd(8),'|',r.description.slice(0,70));
console.log('SISA ledger Apr–Jul tanpa kembar statement (curigai: tanggal/nominal salah):');
for(const L of led.filter(x=>!usedLed.has(x.id)&&x.tx_date<'2026-08-01'))
  console.log('  ',L.tx_date,(L.dirOut?'-':'+')+rp(L.amount).padStart(13),'|',(L.description||'').slice(0,70));

if(!APPLY){console.log('(dry-run — insert',rows.length,')');process.exit(0);}
await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',bca.id).gte('tx_date','2026-04-01');
for(let i=0;i<rows.length;i+=100){const{error}=await supabase.from('ledger_staging').insert(rows.slice(i,i+100));if(error){console.log('ERR',error.message);process.exit(1);}}
console.log('STAGED',rows.length);
process.exit(0);
})();
