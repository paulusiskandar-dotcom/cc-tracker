// STAGE CC dari .backups/cc_{jan,jan2,feb,des}/*.json → ledger_staging.
// Dedup varian kembar (akun+open+close sama), mapping filename+card_last4.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');

function mapName(base){
  const b=base.toLowerCase();
  if(/x?8002/.test(b))return'Maybank VI';
  if(/8003/.test(b))return'Maybank JCB';
  if(/0008/.test(b))return'Maybank VP';
  if(/6005/.test(b))return'Maybank Mini';
  if(/8009/.test(b))return'Maybank MU';
  if(/cimb ?-? ?9|cimb1/.test(b))return'CIMB ALL';
  if(/cimb2/.test(b))return'CIMB JCB';
  if(/cimb3/.test(b))return'CIMB Platinum';
  if(/mayapada|skorcard/.test(b))return'Skorcard';
  if(/jenius/.test(b))return'Jenius';
  if(/mandiri2/.test(b))return'Mandiri Bonvoy';
  if(/mandiri/.test(b))return'Mandiri Signa';
  if(/90north|ocbc/.test(b))return'OCBC 90N';
  if(/dbs/.test(b))return'DBS';
  if(/danamon/.test(b))return'Danamon JCB';
  if(/bri/.test(b))return'BRI';
  if(/bni/.test(b))return'BNI JCB';
  if(/uob/.test(b))return'UOB';
  if(/mega/.test(b))return'Mega Metro';
  if(/hsbc/.test(b))return'HSBC';
  if(/bca/.test(b))return null; // split per-baris
  return null;
}

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const byName=n=>accounts.find(a=>a.name===n&&a.type==='credit_card');
const byLast4=l4=>accounts.find(a=>a.type==='credit_card'&&String(a.card_last4)===String(l4));
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const cat=n=>cats.find(c=>c.name===n)?.id;

const all=[];const stats={};const bump=k=>stats[k]=(stats[k]||0)+1;
const seen=new Set(); // dedup: acct|open|close
for(const label of ['jan','jan2','feb','des','mar','apr']){
  const dir='.backups/cc_'+label;
  if(!fs.existsSync(dir))continue;
  for(const jf of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){
    const d=JSON.parse(fs.readFileSync(dir+'/'+jf,'utf8'));
    const base=jf.replace(/\.json$/,'').replace(/_unlocked$/,'');
    const mapped=mapName(base);
    const defAcc=mapped?byName(mapped):null;
    // dedup varian kembar per file (kunci: akun-atau-nama + open + close)
    const key=(mapped||'bca')+'|'+Math.round(d.open||0)+'|'+Math.round(d.close||0);
    if(seen.has(key)){bump('skip duplikat varian');continue;}
    seen.add(key);
    for(const t of d.tx){
      const a=(t.card_last4&&byLast4(t.card_last4))||defAcc;
      if(!a){bump('TANPA AKUN '+base);continue;}
      const isIn=t.direction==='in';
      const amt=Math.abs(Number(t.amount||0));if(!amt)continue;
      const D=String(t.description||t.merchant||'').toUpperCase();
      let desc=String(t.description||t.merchant||'').slice(0,250);
      if(t.is_installment&&t.installment_current)desc+=` : ${t.installment_current}/${t.installment_total||'?'}`;
      const row={user_id:uid,account_id:a.id,tx_date:t.date,amount:amt,currency:t.currency||'IDR',
        direction:isIn?'in':'out',description:desc,source_file:'cc/'+label+'/'+base,statement_month:String(t.date||'').slice(0,7),
        tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:true};
      if(isIn&&/PEMBAYARAN|PAYMENT|PBYRN|TERIMA KASIH|THANK YOU|TRANSFER KREDIT/.test(D)){row.tx_type='pay_cc';row.needs_review=false;bump('pay_cc sisi kartu');}
      else if(isIn){row.tx_type='income';bump('CR/refund review');}
      else if(t.is_fee||/BIAYA|METERAI|STAMP|ANNUAL|IURAN|BUNGA|INTEREST|DENDA|LATE|ADMIN/.test(D)){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';row.needs_review=false;bump('fee/bunga');}
      else if(/LAZADA/.test(D)&&a.name==='Jenius'){row.tx_type='reimburse_out';row.entity='Hamasa';row.needs_review=false;bump('Lazada@Jenius');}
      else if(/GLOBAL DIGITAL|XENDI|PAPER/.test(D)){row.tx_type='reimburse_out';row.entity='Hamasa';row.needs_review=false;bump('paper/GDN');}
      else if(a.name==='Skorcard'||/GOPAY|GRAB|GOJEK/.test(D)){row.tx_type='expense';row.category_id=cat('Food & Drink');row.entity='Personal';row.needs_review=false;bump('Food (Skor/GoPay/Grab)');}
      else if(/OLYLIFE/.test(D)){row.tx_type='give_loan';row.entity='Personal';bump('Olylife (loan review)');}
      else{row.tx_type='expense';row.entity='Personal';bump('expense review');}
      all.push(row);
    }
  }
}
console.log('total baris CC:',all.length);
for(const[k,v]of Object.entries(stats).sort((a,b)=>b[1]-a[1]))console.log(' ',String(v).padStart(4),k);
if(!APPLY){console.log('(dry-run)');process.exit(0);}
// wipe semua staging CC lama (source cc_jan/... & cc/...)
const ccIds=[...new Set(all.map(r=>r.account_id))];
for(const id of ccIds){
  await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',id).like('source_file','cc%');
}
for(let i=0;i<all.length;i+=100){
  const{error}=await supabase.from('ledger_staging').insert(all.slice(i,i+100));
  if(error){console.log('ERR',error.message);process.exit(1);}
}
console.log('STAGED',all.length,'baris CC (3 bulan beruntun + OCBC)');
process.exit(0);
})();
