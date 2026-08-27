// STAGE BLU Des 2025–Jul 2026 + beres-beres yatim Feb:
//  - pair: BLU↔OCBC 100jt (4 Feb), BLU↔Jenius 100jt (12 Jan), BCA R↔OCBC 100jt (23 Feb)
//  - BCA IDR 28 Feb −100jt = top-up Deposito WOW Neobank (aset) → needs_review + nota
//  - BCA R 23 Feb 20jt = transfer sesama-BCA → BCA D (tanpa statement) → nota
//  - BCA R 19 Feb 30jt = tetap yatim, nota kandidat
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const{parseBlu}=require('./zz_blu_parse.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const H=f=>`${process.env.HOME}/Downloads/${f}`;

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const blu=acc('BLU');
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const srcInterest=srcs.find(s=>s.name==='Bank Interest')?.id;

const files=['bluAccount_001374751933_Desember2025.pdf','bluAccount_001374751933_Januari2026.pdf','bluAccount_001374751933_Februari2026.pdf','bluAccount_001374751933_Maret2026.pdf','bluAccount_001374751933_April2026.pdf','bluAccount_001374751933_Mei2026.pdf','bluAccount_001374751933_Juni2026.pdf','bluAccount_001374751933_Juli2026.pdf'];
const rows=[];
for(const f of files){
  const{rows:rs}=parseBlu(H(f));
  for(const r of rs){
    const row={user_id:uid,account_id:blu.id,tx_date:r.date,amount:Math.round(r.amt*100)/100,currency:'IDR',
      direction:r.db?'out':'in',description:r.desc.slice(0,300),source_file:f.slice(0,60),statement_month:r.date.slice(0,7),
      tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:true,status:'staged'};
    const D=r.desc;
    if(/^Bunga/.test(D)&&!r.db){row.tx_type='income';row.category_id=srcInterest;row.entity='Personal';row.needs_review=false;}
    else if(/Pajak Bunga/.test(D)){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';row.needs_review=false;}
    else if(/bluDay Reward/.test(D)){row.tx_type='income';row.category_id=srcInterest;row.entity='Personal';row.needs_review=false;}
    else if(/Pencairan bluDeposit/.test(D)){row.description+=' — PENCAIRAN dari aset bluDeposit (mekanisme aset diputus saat connect)';}
    else if(/Penempatan bluDeposit/.test(D)){row.description+=' — PENEMPATAN ke aset bluDeposit (mekanisme aset diputus saat connect)';}
    else if(/Transfer ke PAULUSISKANDAR \| BANK SMBC/.test(D)){row.tx_type='transfer';row.counter_account_id=acc('Jenius IDR').id;row.needs_review=false;}
    else if(/Dana Masuk dari PAULUS ISKANDAR \| OCBC/.test(D)){row.tx_type='transfer';row.counter_account_id=acc('OCBC IDR').id;row.needs_review=false;}
    else if(/Transfer ke ARISTA ELEKTRIKA/.test(D)){row.description+=' — DP mobil BYD 140jt';}
    else if(/Transfer ke Paulus Iskandar \| SUPERBANK/.test(D)){row.tx_type='transfer';row.counter_account_id=acc('Superbank').id;row.description+=' — sisi Superbank masuk jendela Mei (belum di-stage)';row.needs_review=false;}
    rows.push(row);
  }
}
console.log('BLU rows:',rows.length);
for(const r of rows)console.log(' ',r.tx_date,(r.direction==='in'?'+':'-')+rp(r.amount).padStart(14),(r.tx_type||'REVIEW').padEnd(8),'|',r.description.slice(0,80));

// ── beres-beres yatim + pairing lintas akun ──
let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('id,account_id,tx_date,amount,direction,description,tx_type,counter_account_id').eq('user_id',uid).order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}
const updates=[];
const find=(name,date,amt,dir)=>st.find(x=>nm(x.account_id)===name&&x.tx_date===date&&Math.round(Number(x.amount))===amt&&x.direction===dir);

// a) BCA R 23 Feb 100jt ↔ OCBC 23 Feb +100jt
const bo=find('BCA R','2026-02-23',100000000,'out'),oi=find('OCBC IDR','2026-02-23',100000000,'in');
if(bo&&oi){updates.push({id:bo.id,set:{tx_type:'transfer',counter_account_id:oi.account_id,needs_review:false,entity:null,category_id:null}});
  updates.push({id:oi.id,set:{tx_type:'transfer',counter_account_id:bo.account_id,needs_review:false,entity:null,category_id:null}});
  console.log('a) pair BCA R ↔ OCBC 100jt 23 Feb OK');}
else console.log('a) !! tidak ketemu',!!bo,!!oi);
// b) BCA IDR 28 Feb −100jt → deposito WOW Neobank
const nb=find('BCA IDR','2026-02-28',100000000,'out');
if(nb)updates.push({id:nb.id,set:{needs_review:true,description:(nb.description||'').slice(0,180)+' — TOP-UP Deposito WOW Neobank 50jt→150jt (via pocket Now Savings; aset "Neobank 150jt"; mekanisme aset diputus saat connect)'}});
console.log('b) BCA IDR→WOW ditandai:',!!nb);
// c) BCA R 23 Feb 20jt → BCA D
const b20=find('BCA R','2026-02-23',20000000,'out');
if(b20)updates.push({id:b20.id,set:{tx_type:'transfer',counter_account_id:acc('BCA D').id,needs_review:true,description:(b20.description||'').slice(0,180)+' — E-BANKING sesama BCA a.n. sendiri → BCA D (tanpa statement; terserap initial BCA D)'}});
console.log('c) 20jt→BCA D ditandai:',!!b20);
// d) BCA R 19 Feb 30jt tetap yatim
const b30=find('BCA R','2026-02-19',30000000,'out');
if(b30)updates.push({id:b30.id,set:{needs_review:true,description:(b30.description||'').slice(0,180)+' — YATIM: BI-FAST antarbank a.n. sendiri; kandidat Maybank/Danamon/BCA D? perlu konfirmasi'}});
console.log('d) 30jt yatim dinota:',!!b30);
// e) pair Jenius 12 Jan +100jt (dari BLU) bila ada & belum berpasangan
const j=find('Jenius IDR','2026-01-12',100000000,'in');
console.log('e) Jenius +100jt 12 Jan:',j?('ada, cp='+nm(j.counter_account_id)):'TIDAK ADA');
if(j&&!j.counter_account_id)updates.push({id:j.id,set:{tx_type:'transfer',counter_account_id:blu.id,needs_review:false,entity:null,category_id:null}});
// f) OCBC 4 Feb −100jt → BLU
const o4=find('OCBC IDR','2026-02-04',100000000,'out');
console.log('f) OCBC −100jt 4 Feb:',o4?('ada, cp='+nm(o4.counter_account_id)):'TIDAK ADA');
if(o4&&!o4.counter_account_id)updates.push({id:o4.id,set:{tx_type:'transfer',counter_account_id:blu.id,needs_review:false,entity:null,category_id:null}});

if(!APPLY){console.log('(dry-run — insert',rows.length,'+ update',updates.length,')');process.exit(0);}
await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',blu.id);
for(let i=0;i<rows.length;i+=100){const{error}=await supabase.from('ledger_staging').insert(rows.slice(i,i+100));if(error){console.log('ERR',error.message);process.exit(1);}}
for(const u of updates)await supabase.from('ledger_staging').update(u.set).eq('id',u.id);
console.log('STAGED',rows.length,'BLU +',updates.length,'updates');
process.exit(0);
})();
