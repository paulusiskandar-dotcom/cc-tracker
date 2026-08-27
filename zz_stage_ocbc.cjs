// STAGE OCBC tabungan Des–Apr → ledger_staging + pairing transfer global final.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const{parseOCBC}=require('./zz_ocbc_parse.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
const H=f=>`${process.env.HOME}/Downloads/${f}`;

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const ocbc=accounts.find(a=>a.name==='OCBC IDR'&&a.type==='bank');
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const srcInterest=srcs.find(s=>s.name==='Bank Interest')?.id;
const cardBy4=l4=>accounts.find(a=>a.type==='credit_card'&&String(a.card_last4)===String(l4));

const files=['estatement_saving_020810389369_December 2025.pdf','estatement_saving_020810389369_January 2026.pdf','estatement_saving_020810389369_February 2026.pdf','estatement_saving_020810389369_March 2026.pdf'];
const all=[];const stats={};const bump=k=>stats[k]=(stats[k]||0)+1;
for(const f of files){
  const{rows}=parseOCBC(H(f));
  for(const r of rows){
    const row={user_id:uid,account_id:ocbc.id,tx_date:r.date,amount:Math.round(r.amt*100)/100,currency:'IDR',
      direction:r.db?'out':'in',description:r.desc.slice(0,300),source_file:f.slice(0,60),statement_month:r.date.slice(0,7),
      tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:true};
    const D=r.desc.toUpperCase();
    if(/BUNGA|INTEREST/.test(D)&&!/PAJAK/.test(D)&&!r.db){row.tx_type='income';row.category_id=srcInterest;row.entity='Personal';row.needs_review=false;bump('bunga');}
    else if(/PAJAK|BIAYA|ADMIN|FEE|MATERAI/.test(D)&&r.amt<100000){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';row.needs_review=false;bump('fee');}
    else if(/POS SALES DEBIT/.test(D)){row.tx_type='expense';row.entity='Personal';bump('debit-card expense (review kategori)');}
    else{
      // deteksi pembayaran kartu via nomor kartu dlm berita (….0966 = BNI JCB dst)
      const m=D.match(/\b\d{12}(\d{4})\b/);
      const card=m?cardBy4(m[1]):null;
      if(card&&r.db){row.tx_type='pay_cc';row.counter_account_id=card.id;row.needs_review=false;bump('pay_cc -> '+card.name);}
      else bump('lain (review)');
    }
    all.push(row);
  }
}
console.log('OCBC rows:',all.length);
for(const[k,v]of Object.entries(stats).sort((a,b)=>b[1]-a[1]))console.log(' ',String(v).padStart(3),k);
if(!APPLY){console.log('(dry-run)');process.exit(0);}
await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',ocbc.id);
for(let i=0;i<all.length;i+=100){
  const{error}=await supabase.from('ledger_staging').insert(all.slice(i,i+100));
  if(error){console.log('ERR',error.message);process.exit(1);}
}
console.log('STAGED',all.length,'baris OCBC');

// ── pairing global final: transfer belum berpasangan lintas SEMUA staging ──
const{data:st}=await supabase.from('ledger_staging').select('id,account_id,tx_date,amount,direction,description,counter_account_id,tx_type').eq('user_id',uid);
const un=st.filter(r=>!r.counter_account_id&&/PAULUS|TRANSFER|SETORAN TUNAI|BI ?FAST|LLG|KEKAYAAN/i.test(r.description||'')&&(r.tx_type==='transfer'||r.tx_type==null||r.needs_review));
let paired=0;
for(const r of st.filter(x=>x.tx_type==='transfer'&&!x.counter_account_id)){
  const amt=Math.round(Number(r.amount));
  const p=st.find(x=>x.id!==r.id&&x.account_id!==r.account_id&&Math.round(Number(x.amount))===amt&&x.direction!==r.direction&&Math.abs(new Date(x.tx_date)-new Date(r.tx_date))<=2*86400000);
  if(p){
    await supabase.from('ledger_staging').update({counter_account_id:p.account_id,needs_review:false}).eq('id',r.id);
    if(!p.counter_account_id)await supabase.from('ledger_staging').update({counter_account_id:r.account_id,tx_type:'transfer',needs_review:false}).eq('id',p.id);
    paired++;
  }
}
console.log('pairing final:',paired,'transfer berpasangan');
process.exit(0);
})();
