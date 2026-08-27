// CONNECT Maybank tabungan 8771903163 (Consolidated Statement, pw 101089).
// Saldo 1 Jan 2026 = 0 (rekening kosong; saldo awal 1 Mar terbukti 0,00).
// Rantai: Mar 0→980.039 · Apr→960.429 · Mei→940.832 · Jun→921.192 · Jul→901.564 (= saldo app).
// Baris Juli SUDAH ada di ledger app → tidak diinsert.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
// [tanggal, bonus, service charge]
const BULAN=[['2026-03-31',39,20000],['2026-04-30',390,20000],['2026-05-29',403,20000],['2026-06-30',360,20000]];
const MASUK={date:'2026-03-30',amt:1000000,desc:'Transfer masuk a.n. PAULUS ISKANDAR (ref 20260329NISPIDJA010O — bank asal OCBC NISP; sisi pengirim belum teridentifikasi)'};

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const M=accounts.find(a=>a.name==='Maybank'&&a.type==='bank');
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const BC=cats.find(c=>c.name==='Bank Charges').id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const INT=srcs.find(s=>s.name==='Bank Interest').id;

// validasi rantai
let bal=0;const chk=[];
bal+=MASUK.amt;
for(const[d,b,s]of BULAN){bal+=b-s;chk.push([d,bal]);}
const TARGET={'2026-03-31':980039,'2026-04-30':960429,'2026-05-29':940832,'2026-06-30':921192};
console.log('VALIDASI rantai Maybank (initial 1 Jan = 0):');
let bad=false;
for(const[d,v]of chk){const t=TARGET[d];const ok=Math.abs(v-t)<=0.02;if(!ok)bad=true;
  console.log('  ',(ok?'✓':'✗'),d,rp(v).padStart(12),'(statement',rp(t)+')');}
console.log('   + Juli (sudah di ledger app): 921.192 + 372 − 20.000 =',rp(921192+372-20000),'| saldo app',rp(M.current_balance));
if(bad){console.log('!! BATAL');process.exit(1);}
const insNet=MASUK.amt+BULAN.reduce((s,[,b,c])=>s+b-c,0);
console.log('initial',rp(M.initial_balance),'→ 0 | net insert',rp(insNet),'| saldo tetap',rp(M.current_balance));
if(!APPLY){console.log('(dry-run — insert',1+BULAN.length*2,'baris)');process.exit(0);}

const mk=o=>({user_id:uid,currency:'IDR',source:'backfill',notes:'backfill Maybank tabungan 8771903163',
  from_type:null,from_id:null,to_type:null,to_id:null,category_id:null,category_name:null,entity:null,...o});
const rows=[mk({tx_date:MASUK.date,tx_type:'income',amount:MASUK.amt,amount_idr:MASUK.amt,description:MASUK.desc,
  from_type:'income_source',from_id:srcs.find(s=>s.name==='Other Income').id,to_type:'account',to_id:M.id,entity:'Personal'})];
for(const[d,b,s]of BULAN){
  rows.push(mk({tx_date:d,tx_type:'income',amount:b,amount_idr:b,description:'IM HASIL / BONUS',
    from_type:'income_source',from_id:INT,to_type:'account',to_id:M.id,entity:'Personal'}));
  rows.push(mk({tx_date:d,tx_type:'expense',amount:s,amount_idr:s,description:'SERVICE CHARGE',
    from_type:'account',from_id:M.id,to_type:'expense',category_id:BC,category_name:'Bank Charges',entity:'Personal'}));
}
const ids=[];
try{
  for(const r of rows){
    const{data,error}=await supabase.from('ledger').insert([r]).select('id').single();
    if(error)throw new Error(error.message+' @ '+r.description);
    ids.push(data.id);
  }
  await supabase.from('accounts').update({initial_balance:0}).eq('id',M.id);
  await recalculateBalance(M.id,uid);
  const{data:af}=await supabase.from('accounts').select('current_balance').eq('id',M.id).single();
  const ok=Math.abs(Number(af.current_balance)-Number(M.current_balance))<=0.02;
  console.log((ok?'  ✓':'  ✗'),'Maybank',rp(af.current_balance),'(target',rp(M.current_balance)+')');
  if(!ok)throw new Error('VERIFIKASI GAGAL');
  console.log('CONNECTED Maybank —',ids.length,'baris');
}catch(e){
  console.log('!! ROLLBACK:',e.message);
  for(const id of ids)await supabase.from('ledger').delete().eq('id',id);
  await supabase.from('accounts').update({initial_balance:M.initial_balance}).eq('id',M.id);
  await recalculateBalance(M.id,uid);
  process.exit(1);
}
process.exit(0);
})();
