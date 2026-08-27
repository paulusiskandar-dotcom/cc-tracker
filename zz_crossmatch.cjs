// CROSS-MATCH staging menyeluruh:
// 1) transfer antar rekening sendiri (broad, nominal persis, ±2 hari)
// 2) pay_cc bank ↔ baris PEMBAYARAN sisi kartu (nominal persis, ±6 hari)
// 3) anotasi setoran 35jt OCBC (split Riko)
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const isBank=id=>accounts.find(a=>a.id===id)?.type==='bank';
const isCard=id=>accounts.find(a=>a.id===id)?.type==='credit_card';

let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('*').eq('user_id',uid).order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}
console.log('staging rows:',st.length);
const day=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;
const updates=[]; // {id, set}

// ── 1. transfer pairing broad ──
const OWN=/PAULUS|TRANSFER|SETORAN|BI ?FAST|LLG|KEKAYAAN|SMBC|KR OTOMATIS|PINDAH/i;
const openRows=st.filter(r=>!r.counter_account_id&&isBank(r.account_id)&&
  (r.tx_type==='transfer'||r.needs_review)&&Number(r.amount)>=100000);
const used=new Set();
let nPair=0;
for(const r of openRows){
  if(used.has(r.id))continue;
  if(!(OWN.test(r.description||'')))continue;
  const amt=Math.round(Number(r.amount));
  const p=openRows.find(x=>x.id!==r.id&&!used.has(x.id)&&x.account_id!==r.account_id&&
    Math.round(Number(x.amount))===amt&&x.direction!==r.direction&&day(x.tx_date,r.tx_date)<=2);
  if(!p)continue;
  used.add(r.id);used.add(p.id);nPair++;
  updates.push({id:r.id,set:{tx_type:'transfer',counter_account_id:p.account_id,needs_review:false,entity:null,category_id:null}});
  updates.push({id:p.id,set:{tx_type:'transfer',counter_account_id:r.account_id,needs_review:false,entity:null,category_id:null}});
  if(!APPLY&&nPair<=20)console.log(' PAIR',r.tx_date,rp(amt).padStart(13),nm(r.account_id),'<->',nm(p.account_id));
}
console.log('1) transfer paired:',nPair);

// ── 2a. koreksi: debit valas BCA salah tertipe pay_cc → expense (belanja trip)
const VALAS=['BCA JPY','BCA SGD','BCA EUR','BCA CHF','BCA HKD','BCA MYR'];
let nValas=0;
for(const r of st.filter(x=>VALAS.includes(nm(x.account_id))&&x.tx_type==='pay_cc')){
  updates.push({id:r.id,set:{tx_type:'expense',entity:'Personal',counter_account_id:null,needs_review:true}});
  r.tx_type='expense';nValas++;
}
console.log('2a) debit valas dikoreksi pay_cc→expense:',nValas);

// ── 2b. pay_cc: dari SISI KARTU cari sumber di SEMUA baris bank keluar ──
const cardPay=st.filter(r=>isCard(r.account_id)&&r.tx_type==='pay_cc'&&r.direction==='in'&&r.tx_date<'2026-04-01');
const bankOut=st.filter(r=>isBank(r.account_id)&&!VALAS.includes(nm(r.account_id))&&r.direction==='out'&&r.tx_type!=='transfer'&&r.tx_type!=='reimburse_out'&&r.tx_type!=='expense'||
  (isBank(r.account_id)&&r.direction==='out'&&r.tx_type==='pay_cc'));
const usedBank=new Set();let nPay=0;const unmatchedCard=[];
for(const c of cardPay.sort((a,b)=>b.amount-a.amount)){
  const amt=Math.round(Number(c.amount));
  const b=bankOut.find(x=>!usedBank.has(x.id)&&Math.abs(Math.round(Number(x.amount))-amt)<=2&&day(x.tx_date,c.tx_date)<=6);
  if(!b){unmatchedCard.push(c);continue;}
  usedBank.add(b.id);nPay++;
  updates.push({id:b.id,set:{tx_type:'pay_cc',counter_account_id:c.account_id,needs_review:false,entity:null,category_id:null}});
  updates.push({id:c.id,set:{counter_account_id:b.account_id,needs_review:false}});
}
console.log('2b) pay_cc kartu↔bank matched:',nPay,'| kartu Des–Mar tanpa sumber bank:',unmatchedCard.length);
for(const c of unmatchedCard.slice(0,12))console.log('    ?',c.tx_date,rp(c.amount).padStart(13),nm(c.account_id));

// ── 3. setoran 35jt OCBC ──
const s35=st.filter(r=>nm(r.account_id)==='OCBC IDR'&&Math.round(Number(r.amount))===35000000&&r.direction==='in');
for(const r of s35){
  updates.push({id:r.id,set:{needs_review:true,description:(r.description||'').slice(0,150)+' — SETORAN 35jt: perlu SPLIT (jika ini yg Jan: 10jt via Riko dari BCA R + 25jt lain; konfirmasi per tanggal)'}});
  console.log('3) setoran 35jt OCBC ditandai:',r.tx_date);
}

if(!APPLY){console.log('(dry-run — total update:',updates.length,')');process.exit(0);}
for(const u of updates)await supabase.from('ledger_staging').update(u.set).eq('id',u.id);
console.log('APPLIED',updates.length,'updates');
process.exit(0);
})();
