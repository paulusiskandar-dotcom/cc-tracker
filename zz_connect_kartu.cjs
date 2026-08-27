// CONNECT semua kartu kredit (Jan–Mar 2026).
// Aturan: baris pay_cc di SISI KARTU tidak diinsert (event-nya baris bank yang sudah connect).
// initial_new = initial_lama − insNet(efek outstanding) supaya OUTSTANDING HARI INI tidak berubah;
// nilai initial_new = outstanding pada titik awal buku (1 Jan) — ditampilkan utk diperiksa.
// Baris pra-genesis di ledger app (source≠backfill, tx_date<1 Apr) dicek dulu agar tidak dobel.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const byId=id=>accounts.find(a=>a.id===id);
const nm=id=>byId(id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const catName=id=>cats.find(c=>c.id===id)?.name||null;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const srcIds=new Set(srcs.map(s=>s.id));
const PIUT={};for(const e of['Hamasa','SDC','Personal']){
  const{data:r}=await supabase.from('ledger').select('to_id').eq('user_id',uid).eq('tx_type','reimburse_out').eq('entity',e).not('to_id','is',null).limit(1);
  PIUT[e]=r&&r[0]?r[0].to_id:null;}

// baris pra-genesis di ledger app (bukan backfill) yang menyentuh kartu → kandidat duplikat
let pre=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('id,tx_date,amount,tx_type,from_id,to_id,description').eq('user_id',uid).lt('tx_date','2026-04-01').neq('source','backfill').range(off,off+999);
  pre=pre.concat(c||[]);if(!c||c.length<1000)break;}
const preCard=pre.filter(r=>byId(r.from_id)?.type==='credit_card'||byId(r.to_id)?.type==='credit_card');
console.log('baris pra-genesis app yang menyentuh kartu:',preCard.length);
for(const r of preCard)console.log('   ',r.tx_date,rp(r.amount).padStart(11),r.tx_type,nm(r.from_id),'→',nm(r.to_id),'|',(r.description||'').slice(0,40));

let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('*').eq('user_id',uid).eq('status','staged').order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}
const cards=st.filter(r=>byId(r.account_id)?.type==='credit_card');
// tandai duplikat vs baris pra-genesis (nominal ±2, tanggal ±3 hari, kartu sama)
const dupIds=new Set();
for(const p of preCard){
  const cid=byId(p.from_id)?.type==='credit_card'?p.from_id:p.to_id;
  const hit=cards.find(r=>!dupIds.has(r.id)&&r.account_id===cid&&Math.abs(Number(r.amount)-Number(p.amount))<=2&&
    Math.abs(new Date(r.tx_date)-new Date(p.tx_date))<=3*864e5);
  if(hit){dupIds.add(hit.id);console.log('   DUPLIKAT staging ditandai:',nm(cid),hit.tx_date,rp(hit.amount));}
}

const rows=[];const skipPay=[];const shift={};
const addShift=(id,d)=>{shift[id]=(shift[id]||0)+d;};
for(const r of cards){
  if(dupIds.has(r.id))continue;
  const C=byId(r.account_id);
  if(r.tx_type==='pay_cc'){skipPay.push(r);continue;} // sisi kartu — event ada di bank
  const base={user_id:uid,tx_date:r.tx_date,tx_type:r.tx_type,amount:Number(r.amount),currency:'IDR',amount_idr:Number(r.amount),
    description:(r.description||'').slice(0,290),source:'backfill',notes:'backfill kartu Jan–Mar 2026',
    from_type:null,from_id:null,to_type:null,to_id:null,category_id:null,category_name:null,entity:r.entity||null};
  if(r.tx_type==='expense'){base.from_type='account';base.from_id=C.id;base.to_type='expense';base.category_id=r.category_id;base.category_name=catName(r.category_id);}
  else if(r.tx_type==='reimburse_out'){base.from_type='account';base.from_id=C.id;base.to_type='account';base.to_id=PIUT[r.entity||'Hamasa'];base.entity=r.entity||'Hamasa';}
  else if(r.tx_type==='income'){base.from_type='income_source';base.from_id=r.category_id;base.to_type='account';base.to_id=C.id;base.entity='Personal';
    if(!srcIds.has(r.category_id)){console.log('!! income source invalid',nm(C.id),r.tx_date,r.description);process.exit(1);}}
  else if(r.tx_type==='give_loan'){base.from_type='account';base.from_id=C.id;base.to_type='account';base.to_id=null;base.entity=r.entity||'Personal';}
  else{console.log('!! tipe tak dikenal',r.tx_type,nm(C.id),r.tx_date);process.exit(1);}
  rows.push({r,row:base});
  // efek outstanding kartu
  addShift(C.id,(base.from_id===C.id)?Number(r.amount):-Number(r.amount));
}
console.log('\nbaris kartu diinsert:',rows.length,'| pay_cc sisi kartu di-skip:',skipPay.length,'| duplikat di-skip:',dupIds.size);
console.log('\nper kartu: initial sekarang → initial baru (= outstanding awal buku), outstanding tetap');
const plan=[];
for(const[id,net]of Object.entries(shift)){
  const C=byId(id);
  const ni=Number(C.initial_balance)-net;
  plan.push({id,name:C.name,old:Number(C.initial_balance),ni,net,out:Number(C.outstanding_amount)});
  console.log('  ',C.name.padEnd(15),rp(C.initial_balance).padStart(14),'→',rp(ni).padStart(14),'| Σcharge−credit',rp(net).padStart(13),'| outstanding',rp(C.outstanding_amount));
}
const neg=plan.filter(p=>p.ni<-1);
if(neg.length)console.log('\n⚠️ initial baru NEGATIF (outstanding awal minus = kelebihan bayar; cek):',neg.map(p=>p.name+' '+rp(p.ni)).join(' · '));
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}

fs.writeFileSync('.backups/zz_kartu_'+Date.now()+'.json',JSON.stringify(plan));
const ids=[];
try{
  for(const x of rows){
    const{data,error}=await supabase.from('ledger').insert([x.row]).select('id').single();
    if(error)throw new Error(error.message+' @ '+nm(x.r.account_id)+' '+x.row.description.slice(0,40));
    ids.push(data.id);
  }
  for(const p of plan)await supabase.from('accounts').update({initial_balance:p.ni}).eq('id',p.id);
  for(const x of rows)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',x.r.id);
  for(const r of skipPay)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',r.id);
  for(const id of dupIds)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',id);
  const touch=[...new Set([...plan.map(p=>p.id),...rows.map(x=>x.row.to_id).filter(Boolean)])];
  for(const id of touch)await recalculateBalance(id,uid);
  const{data:after}=await supabase.from('accounts').select('id,name,type,outstanding_amount,receivable_outstanding').in('id',touch);
  let fail=null;
  for(const p of plan){
    const a=after.find(x=>x.id===p.id);if(!a)continue;
    const ok=Math.abs(Number(a.outstanding_amount)-p.out)<=0.02;
    console.log((ok?'  ✓':'  ✗'),a.name.padEnd(15),rp(a.outstanding_amount).padStart(14),'(target',rp(p.out)+')');
    if(!ok)fail=a.name;
  }
  if(fail)throw new Error('VERIFIKASI GAGAL: '+fail);
  console.log('CONNECTED kartu —',ids.length,'baris');
}catch(e){
  console.log('!! ROLLBACK:',e.message);
  for(const id of ids)await supabase.from('ledger').delete().eq('id',id);
  for(const p of plan)await supabase.from('accounts').update({initial_balance:p.old}).eq('id',p.id);
  for(const x of rows)await supabase.from('ledger_staging').update({status:'staged'}).eq('id',x.r.id);
  for(const r of skipPay)await supabase.from('ledger_staging').update({status:'staged'}).eq('id',r.id);
  for(const id of plan.map(p=>p.id))await recalculateBalance(id,uid);
  process.exit(1);
}
process.exit(0);
})();
