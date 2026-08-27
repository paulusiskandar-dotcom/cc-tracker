// CONNECT tahap 2 (generik): OCBC IDR & BCA R.
// - auto-shift initial akun lawan (bank/asset: −amt saat menerima; CC: +amt saat menerima pembayaran)
// - dukungan reimburse_in/out, give_loan, collect_loan, split (hint & SPLIT35)
// - mirror: baris pasangan di staging akun lawan ditandai connected
// - guard: lawan TIDAK boleh akun yang sudah connected
// node zz_connect2.cjs [apply] <ocbc|bcar>
const fs=require('fs');
const crypto=require('crypto');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const TARGET=process.argv.includes('bcar')?'BCA R':'OCBC IDR';
const CONNECTED=['Neobank','BLU','Danamon','OCBC IDR','bluDeposit 15','bluDeposit 32','bluDeposit 24'];

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const byId=id=>accounts.find(a=>a.id===id);
const nm=id=>byId(id)?.name||'?';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const src=n=>srcs.find(s=>s.name===n)?.id;
const srcIds=new Set(srcs.map(s=>s.id));
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const catName=id=>cats.find(c=>c.id===id)?.name||null;
// Piutang per entitas: ambil dari baris reimburse_out terbaru
const PIUTANG={};
for(const ent of['Hamasa','SDC','Personal']){
  const{data:r}=await supabase.from('ledger').select('to_id').eq('user_id',uid).eq('tx_type','reimburse_out').eq('entity',ent).not('to_id','is',null).order('created_at',{ascending:false}).limit(1);
  PIUTANG[ent]=r&&r[0]?r[0].to_id:null;
}
if(!PIUTANG.Personal)PIUTANG.Personal=(accounts.find(a=>a.type==='receivable'&&/Piutang Personal/i.test(a.name))||{}).id||null;
console.log('Piutang:',Object.fromEntries(Object.entries(PIUTANG).map(([k,v])=>[k,nm(v)])));

const A=acc(TARGET);
const PLAN=TARGET==='OCBC IDR'
  ?{initialNew:186644855.63,expectedDelta:0}
  :{initialNew:29514510.81,expectedDelta:-1.28}; // koreksi "beda Rp1" anchor lama (statement yang benar)
let expected=Number(A.current_balance)+PLAN.expectedDelta; // di-refresh lagi setelah normalisasi (apply)

// staged rows
let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('*').eq('user_id',uid).eq('account_id',A.id).eq('status','staged').order('tx_date').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}
const dup=st.filter(r=>/≡LEDGER/.test(r.description||''));
st=st.filter(r=>!dup.includes(r));

// SPLIT35 expansion (khusus OCBC)
const expanded=[];
for(const r of st){
  if(r.tx_type==='SPLIT35'){
    const gid=crypto.randomUUID();
    if(r.tx_date==='2025-12-03'){
      expanded.push({...r,_gid:gid,tx_type:'income',category_id:src('Salary'),entity:'Personal',amount:26521987,description:'SETORAN TUNAI 35jt (bagian 1/2): gaji Hamasa Des — setoran gaji Mandiri bulan ini memang absen',counter_account_id:null});
      expanded.push({...r,_gid:gid,_noStaging:true,tx_type:'transfer',amount:8478013,counter_account_id:acc('IDR Cash').id,category_id:null,entity:null,description:'SETORAN TUNAI 35jt (bagian 2/2): tambahan dari tabungan/cash (Paulus: "tambah2in dari yg lain2")'});
    }else{
      expanded.push({...r,_gid:gid,tx_type:'transfer',amount:10000000,counter_account_id:acc('BCA R').id,category_id:null,entity:null,description:'SETORAN TUNAI 35jt (bagian 1/2): 10jt dari BCA R via Riko'});
      expanded.push({...r,_gid:gid,_noStaging:true,tx_type:'income',category_id:src('Salary'),entity:'Personal',amount:25000000,counter_account_id:null,description:'SETORAN TUNAI 35jt (bagian 2/2): gaji Hamasa Jan (dibulatkan; setoran gaji Mandiri bulan ini absen)'});
    }
  } else expanded.push(r);
}
// split hint (Hang Tuah dkk): hint sama → gid sama
const hintGid={};
for(const r of expanded)if(r.split_group_hint){hintGid[r.split_group_hint]=hintGid[r.split_group_hint]||crypto.randomUUID();r._gid=hintGid[r.split_group_hint];}

// bentuk ledger row
function mkRow(r){
  const base={user_id:uid,tx_date:r.tx_date,tx_type:r.tx_type,amount:Number(r.amount),currency:'IDR',amount_idr:Number(r.amount),
    description:(r.description||'').slice(0,290),source:'backfill',notes:'backfill Des2025 ('+(r.source_file||'')+')',
    from_type:null,from_id:null,to_type:null,to_id:null,category_id:null,category_name:null,entity:r.entity||null,
    split_group_id:r._gid||null};
  const out=r.direction==='out';
  if(r.tx_type==='income'){base.from_type='income_source';base.from_id=r.category_id;base.to_type='account';base.to_id=A.id;
    if(!srcIds.has(r.category_id))throw new Error('income source invalid: '+r.description);}
  else if(r.tx_type==='expense'){base.from_type='account';base.from_id=A.id;base.to_type='expense';base.category_id=r.category_id;base.category_name=catName(r.category_id);
    if(!r.category_id)throw new Error('expense tanpa kategori: '+r.tx_date+' '+r.description);}
  else if(r.tx_type==='reimburse_in'){base.from_type='expense';base.to_type='account';base.to_id=A.id;base.entity=r.entity||'Hamasa';}
  else if(r.tx_type==='reimburse_out'){base.from_type='account';base.from_id=A.id;base.to_type='account';base.to_id=PIUTANG[r.entity||'Hamasa'];base.entity=r.entity||'Hamasa';}
  else if(r.tx_type==='give_loan'){base.from_type='account';base.from_id=A.id;base.to_type='account';base.to_id=null;base.entity=r.entity||'Personal';}
  else if(r.tx_type==='collect_loan'){base.from_type='employee_loan';base.from_id=r.employee_loan_id||null;base.to_type='account';base.to_id=A.id;base.entity=r.entity||'Personal';}
  else if(['transfer','pay_cc','buy_asset','sell_asset'].includes(r.tx_type)){
    base.from_type='account';base.to_type='account';
    base.from_id=out?A.id:r.counter_account_id;base.to_id=out?r.counter_account_id:A.id;
    if(!base.from_id||!base.to_id)throw new Error('counter kosong: '+r.tx_date+' '+rp(r.amount)+' '+r.description);}
  else throw new Error('tx_type tak dikenal: '+r.tx_type+' @ '+r.tx_date+' '+(r.description||'').slice(0,50));
  return base;
}
const inserts=[];
for(const r of expanded){
  if(!r.tx_type)throw new Error('NULL type: '+r.tx_date+' '+rp(r.amount)+' '+(r.description||'').slice(0,60));
  inserts.push({staging:r._noStaging?null:r.id,r,row:mkRow(r)});
}

// aljabar
let exist=0;
for(const col of['from_id','to_id']){
  let off=0;for(;;off+=1000){
    const{data:c}=await supabase.from('ledger').select('amount').eq('user_id',uid).eq(col,A.id).range(off,off+999);
    for(const x of c||[])exist+=(col==='to_id'?1:-1)*Number(x.amount);
    if(!c||c.length<1000)break;}
}
const insNet=inserts.reduce((s,i)=>s+((i.row.to_id===A.id)?1:-1)*Number(i.row.amount),0);
const proj=PLAN.initialNew+exist+insNet;
console.log('══',TARGET,'══ staged',st.length,'(≡skip',dup.length,') → insert',inserts.length,'baris');
console.log('aljabar:',rp(PLAN.initialNew),'+',rp(exist),'+',rp(insNet),'=',rp(proj),'| target',rp(expected),'| delta',rp(proj-expected));
if(Math.abs(proj-expected)>0.02){console.log('!! MELESET — BATAL');process.exit(1);}

// auto-shift lawan (akun sisi lain dari baris yg diinsert)
const shift={}; // accId -> delta initial
for(const i of inserts){
  if(i.row.from_type!=='account'||i.row.to_type!=='account')continue;
  const other=i.row.from_id===A.id?i.row.to_id:(i.row.to_id===A.id?i.row.from_id:null);
  if(!other||other===A.id)continue;
  const X=byId(other);if(!X)throw new Error('akun lawan tak dikenal '+other);
  if(CONNECTED.includes(X.name))throw new Error('lawan sudah connected: '+X.name+' @ '+i.row.tx_date+' '+rp(i.row.amount));
  if(X.type==='receivable')continue; // piutang: saldo akun dorman, kalkulasi pakai ledger+settlement
  const receives=i.row.to_id===other;
  let d;
  if(X.type==='credit_card')d=receives?+Number(i.row.amount):-Number(i.row.amount); // pembayaran masuk kartu ↓outstanding → initial naik
  else d=receives?-Number(i.row.amount):+Number(i.row.amount); // bank/asset: jaga saldo tetap
  shift[other]=(shift[other]||0)+d;
}
for(const[id,d]of Object.entries(shift))console.log('shift:',nm(id).padEnd(22),rp(byId(id).initial_balance).padStart(14),'→',rp(Number(byId(id).initial_balance)+d).padStart(14));
if(!APPLY){console.log('(dry-run)');process.exit(0);}

// NORMALISASI: recalc semua akun tersentuh dulu, reload baseline segar
const touchIds=[A.id,...Object.keys(shift)];
for(const id of touchIds)await recalculateBalance(id,uid);
const{data:fresh}=await supabase.from('accounts').select('id,name,type,initial_balance,current_balance,current_value,outstanding_amount').in('id',touchIds);
const freshBy=id=>fresh.find(x=>x.id===id);
expected=Number(freshBy(A.id).current_balance)+PLAN.expectedDelta;
console.log('baseline ternormalisasi: target',TARGET,'=',rp(expected));
// baseline & target dari nilai ternormalisasi
// backup + eksekusi
fs.writeFileSync('.backups/zz_connect2_'+TARGET.replace(/ /g,'')+'_'+Date.now()+'.json',JSON.stringify({accounts:accounts.map(a=>({id:a.id,name:a.name,initial_balance:a.initial_balance}))}));
const insertedIds=[];const origInit={};
try{
  for(const i of inserts){
    const{data,error}=await supabase.from('ledger').insert([i.row]).select('id').single();
    if(error)throw new Error(error.message+' @ '+i.row.description);
    insertedIds.push(data.id);
    if(i.staging)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',i.staging);
  }
  for(const d of dup)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',d.id);
  origInit[A.id]=freshBy(A.id).initial_balance;
  await supabase.from('accounts').update({initial_balance:PLAN.initialNew}).eq('id',A.id);
  for(const[id,d]of Object.entries(shift)){origInit[id]=freshBy(id).initial_balance;
    await supabase.from('accounts').update({initial_balance:Number(freshBy(id).initial_balance||0)+d}).eq('id',id);}
  // mirror: tandai baris pasangan di staging lawan
  for(const i of inserts){
    if(i.row.from_type!=='account'||i.row.to_type!=='account')continue;
    const other=i.row.from_id===A.id?i.row.to_id:(i.row.to_id===A.id?i.row.from_id:null);
    if(!other)continue;
    if(byId(other)&&['receivable','asset','credit_card'].includes(byId(other).type)&&byId(other).type==='receivable')continue;
    const dir=i.row.to_id===other?'in':'out';
    const{data:m}=await supabase.from('ledger_staging').select('id').eq('user_id',uid).eq('account_id',other).eq('status','staged').eq('direction',dir)
      .gte('amount',Number(i.row.amount)-1).lte('amount',Number(i.row.amount)+1)
      .gte('tx_date',new Date(new Date(i.row.tx_date)-3*864e5).toISOString().slice(0,10))
      .lte('tx_date',new Date(+new Date(i.row.tx_date)+3*864e5).toISOString().slice(0,10)).limit(1);
    if(m&&m[0]){await supabase.from('ledger_staging').update({status:'connected'}).eq('id',m[0].id);console.log('  mirror:',nm(other),i.row.tx_date,rp(i.row.amount));}
  }
  // recalc + verifikasi
  const touched=new Set([A.id,...Object.keys(shift)]);
  for(const id of touched)await recalculateBalance(id,uid);
  const{data:after}=await supabase.from('accounts').select('id,name,type,current_balance,current_value,outstanding_amount').in('id',[...touched]);
  let fail=null;
  for(const a of after){
    const cur=a.type==='credit_card'?Number(a.outstanding_amount):a.type==='asset'?Number(a.current_value):Number(a.current_balance);
    const before=freshBy(a.id);
    const beforeVal=a.type==='credit_card'?Number(before.outstanding_amount):a.type==='asset'?Number(before.current_value):Number(before.current_balance);
    const want=a.id===A.id?expected:beforeVal;
    const ok=Math.abs(cur-want)<=0.02;
    console.log((ok?'  ✓':'  ✗'),a.name.padEnd(22),rp(cur).padStart(15),'(target',rp(want)+')');
    if(!ok)fail=a.name;
  }
  if(fail)throw new Error('VERIFIKASI GAGAL: '+fail);
  console.log('CONNECTED',TARGET,'—',insertedIds.length,'baris');
}catch(e){
  console.log('!! ROLLBACK:',e.message);
  for(const id of insertedIds)await supabase.from('ledger').delete().eq('id',id);
  for(const[id,v]of Object.entries(origInit))await supabase.from('accounts').update({initial_balance:v}).eq('id',id);
  for(const i of inserts)if(i.staging)await supabase.from('ledger_staging').update({status:'staged'}).eq('id',i.staging);
  for(const d of dup)await supabase.from('ledger_staging').update({status:'staged'}).eq('id',d.id);
  const touched=new Set([A.id,...Object.keys(shift)]);for(const id of touched)await recalculateBalance(id,uid);
  process.exit(1);
}
process.exit(0);
})();
