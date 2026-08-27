// KOREKSI + CONNECT BCA D (0830278397, Des2025–Jul2026).
// 1) Koreksi kesalahanku: baris BCA R 23 Feb 20jt di-tebak ke BCA D — statement BCA D
//    membuktikan TIDAK menerima. Diubah jadi transfer ke akun placeholder "BCA ? (belum
//    teridentifikasi)" agar uangnya TIDAK dianggap habis (net worth tetap benar) sambil
//    menunggu jawaban Paulus. initial BCA D dikembalikan (batal shift −20jt).
// 2) Connect BCA D: initial → 499.531,57 (awal Des), semua baris Des–Jul masuk,
//    saldo akhir Jul 4.062.167,57 (app sekarang 4.107.167 = akhir April).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const{parseBCA}=require('./zz_bca_parse.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const H=f=>`${process.env.HOME}/Downloads/${f}`;
const FILES=[['0830278397_DEC_2025 (1).pdf',2025],['0830278397_JAN_2026.pdf',2026],['0830278397_FEB_2026.pdf',2026],
 ['0830278397_MAR_2026.pdf',2026],['0830278397_APR_2026.pdf',2026],['0830278397_MAY_2026.pdf',2026],
 ['0830278397_JUN_2026.pdf',2026],['0830278397_JUL_2026.pdf',2026]];

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const D=acc('BCA D'),bcar=acc('BCA R'),bcaidr=acc('BCA IDR');
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n)?.id;

// ── 1. baris 20jt salah ──
const{data:bad}=await supabase.from('ledger').select('id,tx_date,amount,to_id,description').eq('user_id',uid)
  .eq('from_id',bcar.id).eq('to_id',D.id).eq('tx_date','2026-02-23').eq('amount',20000000);
console.log('baris 20jt salah:',bad&&bad[0]?bad[0].id:'TIDAK ADA');

// ── 2. parse BCA D ──
const rows=[];
for(const[f,yr]of FILES){
  const secs=parseBCA(H(f));
  for(const r of secs.IDR.rows){
    const[dd,mm]=r.date.split('/');
    rows.push({date:`${yr}-${mm}-${dd}`,desc:r.desc,amt:r.amt,db:r.db,file:f});
  }
}
console.log('BCA D rows:',rows.length,'| akhir Jul target 4.062.167,57');
const mk=r=>{
  const base={user_id:uid,tx_date:r.date,amount:r.amt,currency:'IDR',amount_idr:r.amt,
    description:r.desc.slice(0,290),source:'backfill',notes:'backfill BCA D ('+r.file+')',
    from_type:null,from_id:null,to_type:null,to_id:null,category_id:null,category_name:null,entity:null,tx_type:null};
  const U=r.desc.toUpperCase();
  if(/BIAYA ADM/.test(U)){base.tx_type='expense';base.from_type='account';base.from_id=D.id;base.to_type='expense';base.category_id=cat('Bank Charges');base.category_name='Bank Charges';base.entity='Personal';}
  else if(!r.db&&/PAULUS ISKANDAR/.test(U)){base.tx_type='transfer';base.from_type='account';base.from_id=bcaidr.id;base.to_type='account';base.to_id=D.id;base.description=(r.desc+' — dari BCA IDR (terbukti: BCA IDR keluar 10jt hari sama)').slice(0,290);}
  else{ // pengeluaran kecil: QR/transfer ke orang → expense
    base.tx_type='expense';base.from_type='account';base.from_id=D.id;base.to_type='expense';base.entity='Personal';
    base.category_id=/QR |ALFAMART|MOYA|IMPERIAL|Dapur|HARUM|Bubur|Toko|SS MARKET|Alfacellul/i.test(r.desc)?cat('Food & Drink'):cat('Other');
    base.category_name=cats.find(c=>c.id===base.category_id)?.name;
  }
  return base;
};
const led=rows.map(mk);
const net=led.reduce((s,x)=>s+(x.to_id===D.id?1:-1)*Number(x.amount),0);
const initialNew=499531.57, target=4062167.57;
// ledger BCA D yang sudah ada (harus 0 selain baris 20jt salah)
let exist=0;
for(const col of['from_id','to_id']){
  const{data:c}=await supabase.from('ledger').select('id,amount').eq('user_id',uid).eq(col,D.id);
  for(const x of c||[]){if(bad&&bad[0]&&x.id===bad[0].id)continue;exist+=(col==='to_id'?1:-1)*Number(x.amount);}
}
console.log('aljabar:',rp(initialNew),'+ exist',rp(exist),'+ inserts',rp(net),'=',rp(initialNew+exist+net),'| target',rp(target));
if(Math.abs(initialNew+exist+net-target)>0.02){console.log('!! MELESET — BATAL');process.exit(1);}
const kecil=led.filter(x=>x.category_name==='Other');
console.log('baris "Other" (perlu review Paulus):',kecil.length);
for(const x of kecil)console.log('   ',x.tx_date,rp(x.amount).padStart(10),'|',x.description.slice(0,55));
if(!APPLY){console.log('(dry-run)');process.exit(0);}

fs.writeFileSync('.backups/zz_bcad_'+Date.now()+'.json',JSON.stringify({bad:bad&&bad[0],initD:D.initial_balance}));
// akun placeholder
let ph=acc('BCA ? (belum teridentifikasi)');
if(!ph){
  const{data,error}=await supabase.from('accounts').insert([{user_id:uid,name:'BCA ? (belum teridentifikasi)',type:'bank',currency:'IDR',
    initial_balance:0,current_balance:0,is_active:true,include_networth:true}]).select().single();
  if(error){console.log('ERR akun placeholder',error.message);process.exit(1);}
  ph=data;console.log('+ akun placeholder',ph.id);
}
if(bad&&bad[0]){
  await supabase.from('ledger').update({to_id:ph.id,
    description:'TRSF E-BANKING DB 2302/FTSCY/WS95271 | PAULUS ISKANDAR — TUJUAN BELUM DIKETAHUI: transfer sesama BCA a.n. sendiri; statement BCA D Feb membuktikan BCA D TIDAK menerima. Menunggu konfirmasi Paulus.',
    notes:'backfill Des2025 — tebakan awal ke BCA D DIKOREKSI 2026-08-27 setelah statement BCA D tiba'}).eq('id',bad[0].id);
  console.log('baris 20jt dialihkan ke placeholder');
}
await supabase.from('accounts').update({initial_balance:initialNew}).eq('id',D.id);
const ins=[];
try{
  for(const row of led){
    const{data,error}=await supabase.from('ledger').insert([row]).select('id').single();
    if(error)throw new Error(error.message+' @ '+row.description);
    ins.push(data.id);
  }
  // shift BCA IDR: menerima? tidak — BCA IDR mengirim 10jt → initial BCA IDR +10jt supaya saldonya tetap
  const bi=acc('BCA IDR');
  const tenjt=led.filter(x=>x.from_id===bcaidr.id).reduce((s,x)=>s+Number(x.amount),0);
  await supabase.from('accounts').update({initial_balance:Number(bi.initial_balance)+tenjt}).eq('id',bi.id);
  // mirror staging BCA IDR 24 Des
  const{data:m}=await supabase.from('ledger_staging').select('id').eq('user_id',uid).eq('account_id',bcaidr.id).eq('tx_date','2025-12-24').eq('direction','out').eq('amount',10000000).eq('status','staged');
  for(const x of m||[])await supabase.from('ledger_staging').update({status:'connected'}).eq('id',x.id);
  for(const id of[D.id,bcaidr.id,bcar.id,ph.id])await recalculateBalance(id,uid);
  const{data:after}=await supabase.from('accounts').select('id,name,current_balance').in('id',[D.id,bcaidr.id,bcar.id,ph.id]);
  let fail=null;
  const want={[D.id]:target,[bcaidr.id]:Number(bi.current_balance),[bcar.id]:Number(bcar.current_balance),[ph.id]:20000000};
  for(const a of after){
    const ok=Math.abs(Number(a.current_balance)-want[a.id])<=0.02;
    console.log((ok?'  ✓':'  ✗'),a.name.padEnd(30),rp(a.current_balance).padStart(14),'(target',rp(want[a.id])+')');
    if(!ok)fail=a.name;
  }
  if(fail)throw new Error('VERIFIKASI GAGAL: '+fail);
  console.log('CONNECTED BCA D —',ins.length,'baris');
}catch(e){
  console.log('!! ROLLBACK:',e.message);
  for(const id of ins)await supabase.from('ledger').delete().eq('id',id);
  await supabase.from('accounts').update({initial_balance:D.initial_balance}).eq('id',D.id);
  for(const id of[D.id,bcaidr.id,bcar.id])await recalculateBalance(id,uid);
}
process.exit(0);
})();
