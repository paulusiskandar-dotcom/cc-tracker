// STAGE CC dari hasil ekstraksi (.backups/cc_jan/*.json) → ledger_staging.
// Mapping akun via card_last4 registry; BCA displit per-baris (9605/3776).
// Aturan Paulus: Lazada@Jenius=reimburse_out Hamasa; Skorcard/Mayapada=Food&Drink;
// paper/GlobalNiaga=reimburse_out Hamasa; fee=Bank Charges; payment-in=sisi kartu (validasi).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');

const FILE2CARD={ // fallback bila card_last4 baris kosong
 'BNI_unlocked':'BNI JCB','BRI _unlocked':'BRI','cimb - 9 Jan_unlocked':'CIMB ALL',
 'cimb2_unlocked':'CIMB JCB','cimb3_unlocked':'CIMB Platinum','dbs_unlocked':'DBS',
 'jenius 13 jan_unlocked':'Jenius','mandiri_unlocked':'Mandiri Signa','mayapada12_unlocked':'Skorcard',
 'maybank 0008_unlocked':'Maybank VP','maybank 6005_unlocked':'Maybank Mini','maybank 8002_unlocked':'Maybank VI',
 'maybank 8003 - 12 jan_unlocked':'Maybank JCB','maybank 8009_unlocked':'Maybank MU',
 'mega_unlocked':'Mega Metro','uob_unlocked':'UOB','bca_unlocked':null,
};

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let accounts=await accountsApi.getAll(uid);
// buat akun DBS bila belum ada
if(!accounts.find(a=>a.name==='DBS'&&a.type==='credit_card')){
  const{data:dbs,error}=await supabase.from('accounts').insert([{user_id:uid,name:'DBS',type:'credit_card',currency:'IDR',
    is_active:true,initial_balance:0,outstanding_amount:0,current_balance:0,card_last4:'1904',
    notes:'digibank Visa Travel Platinum — direkonstruksi penuh dari statement (backfill 2026-08-26)'}]).select().single();
  if(error){console.log('ERR buat DBS',error.message);process.exit(1);}
  console.log('akun DBS dibuat:',dbs.id.slice(0,8));
  await supabase.from('backfill_freeze').upsert([{account_id:dbs.id,user_id:uid,freeze_note:'DBS baru — tanpa anchor, rekonstruksi penuh dari statement',frozen_initial_balance:0,frozen_outstanding:0,frozen_current_balance:0}],{onConflict:'account_id'});
  accounts=await accountsApi.getAll(uid);
}
const byName=n=>accounts.find(a=>a.name===n&&a.type==='credit_card');
const byLast4=l4=>accounts.find(a=>a.type==='credit_card'&&a.card_last4===l4);
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const cat=n=>cats.find(c=>c.name===n)?.id;

const files=fs.readdirSync('.backups/cc_jan').filter(f=>f.endsWith('.json'));
const all=[];const stats={};const bump=k=>stats[k]=(stats[k]||0)+1;
for(const jf of files){
  const d=JSON.parse(fs.readFileSync('.backups/cc_jan/'+jf,'utf8'));
  const base=jf.replace(/\.json$/,'');
  const defAcc=FILE2CARD[base]?byName(FILE2CARD[base]):null;
  for(const t of d.tx){
    const a=(t.card_last4&&byLast4(String(t.card_last4)))||defAcc;
    if(!a){bump('TANPA AKUN ('+base+')');continue;}
    const isIn=t.direction==='in';
    const amt=Math.abs(Number(t.amount||0));
    if(!amt)continue;
    const D=String(t.description||t.merchant||'').toUpperCase();
    let desc=String(t.description||t.merchant||'').slice(0,250);
    if(t.is_installment&&t.installment_current)desc+=` : ${t.installment_current}/${t.installment_total||'?'}`;
    const row={user_id:uid,account_id:a.id,tx_date:t.date,amount:amt,currency:t.currency||'IDR',
      direction:isIn?'in':'out',description:desc,source_file:'cc_jan/'+base,statement_month:String(t.date||'').slice(0,7),
      tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:true};
    if(isIn&&/PEMBAYARAN|PAYMENT|PBYRN|TERIMA KASIH|THANK YOU/.test(D)){row.tx_type='pay_cc';row.needs_review=false;bump('pay_cc (sisi kartu)');}
    else if(isIn){row.tx_type='income';bump('CR/refund (review)');}
    else if(t.is_fee||/BIAYA|METERAI|STAMP|ANNUAL FEE|IURAN|BUNGA|INTEREST|DENDA|LATE CHARGE|ADMIN/.test(D)){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';row.needs_review=false;bump('fee/bunga');}
    else if(/LAZADA/.test(D)&&a.name==='Jenius'){row.tx_type='reimburse_out';row.entity='Hamasa';row.needs_review=false;bump('Lazada@Jenius -> reimb Hamasa');}
    else if(/GLOBAL DIGITAL|XENDI|PAPER\.?ID|PAPER /.test(D)){row.tx_type='reimburse_out';row.entity='Hamasa';row.needs_review=false;bump('paper/GlobalNiaga -> reimb Hamasa');}
    else if(a.name==='Skorcard'){row.tx_type='expense';row.category_id=cat('Food & Drink');row.entity='Personal';row.needs_review=false;bump('Skorcard -> Food & Drink');}
    else if(/GOPAY|GRAB|GOJEK/.test(D)){row.tx_type='expense';row.category_id=cat('Food & Drink');row.entity='Personal';row.needs_review=false;bump('GoPay/Grab -> Food & Drink');}
    else if(/OLYLIFE/.test(D)){row.tx_type='give_loan';row.entity='Personal';bump('Olylife cicilan (review-loan)');}
    else{row.tx_type='expense';row.entity='Personal';bump('expense (kategori review)');}
    all.push(row);
  }
}
console.log('total baris CC:',all.length);
for(const[k,v]of Object.entries(stats).sort((a,b)=>b[1]-a[1]))console.log(' ',String(v).padStart(4),k);
const nr=all.filter(r=>r.needs_review).length;
console.log('needs_review:',nr);
if(!APPLY){console.log('(dry-run)');process.exit(0);}
const wipe=[...new Set(all.map(r=>r.account_id))];
for(const id of wipe)await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',id).like('source_file','cc_jan/%');
for(let i=0;i<all.length;i+=100){
  const{error}=await supabase.from('ledger_staging').insert(all.slice(i,i+100));
  if(error){console.log('ERR',error.message);process.exit(1);}
}
console.log('STAGED',all.length,'baris CC');
process.exit(0);
})();
