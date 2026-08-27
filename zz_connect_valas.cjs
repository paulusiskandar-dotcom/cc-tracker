// CONNECT valas BCA (JPY/SGD/EUR) — belanja trip Sapporo/Otaru (Jan) & Berlin (Mar).
// Semua baris = expense dalam mata uang asing (recalculateBalance pakai `amount` utk akun valas).
// EUR: baris +300 (14 Mar) sudah ada di ledger (fx dari BCA IDR) → skip;
//      baris −405,56 (18 Jun) dipasangkan ke baris ledger "8.300.000 transfer dari rekening
//      sendiri" yang menggantung → diubah jadi fx_exchange BCA EUR → BCA IDR.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const OPEN={'BCA JPY':181507,'BCA SGD':300,'BCA EUR':154.33}; // saldo 1 Jan 2026 (statement)
const TARGET={'BCA JPY':2614.56,'BCA SGD':264.93,'BCA EUR':5.08};
const KAT=[
 [/GYOZANO|SAIZERIYA|ICHIRAN|KITANORYOBA|MIFFUIOYATSUDO|BO TOREKA|OTARU POROKARA|FJ JWL|7 ELEVEN/i,'Food & Drink'],
 [/BIC CAMERA/i,'Electronics & Gadgets'],
 [/DAIKOKU DRUG/i,'Personal Care'],
 [/SAPPOROEKISOGOKAIH|CHITOSE AIRPORT|MYOUJYOUJIDOUSHA|S-Bahn/i,'Transport'],
 [/AEON MALL|SURUGAYA|MOYUK|DAISO|MUJIRUSHI|MEGADONQUIJOTE|HOTSUKAIDOUMIYAGE|TJX/i,'Shopping'],
];

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const bcaidr=acc('BCA IDR');
const plan=[];const skip=[];let fxRow=null;
for(const[name,open]of Object.entries(OPEN)){
  const A=acc(name);
  const{data:st}=await supabase.from('ledger_staging').select('*').eq('user_id',uid).eq('account_id',A.id).eq('status','staged').order('tx_date');
  let net=0;const ins=[];
  for(const r of st){
    const amt=Number(r.amount), out=r.direction==='out';
    // baris yang sudah ada di ledger TIDAK dihitung di net (sudah masuk `exist`)
    if(name==='BCA EUR'&&!out&&Math.round(amt)===300){skip.push({r,why:'sudah ada di ledger (fx dari BCA IDR)'});continue;}
    net+=(out?-1:1)*amt;
    if(name==='BCA EUR'&&out&&Math.abs(amt-405.56)<0.01){fxRow={r,A};continue;}
    const k=(KAT.find(([re])=>re.test(r.description||''))||[null,'Shopping'])[1];
    ins.push({r,A,cur:A.currency,kat:k});
  }
  // baris ledger app yang sudah ada (Mei–Jun trip berikutnya) — cek *_type
  let exist=0;{
    let all=[];
    for(const col of['from_id','to_id']){
      const{data:c}=await supabase.from('ledger').select('id,amount,from_id,from_type,to_id,to_type,fx_rate_used,tx_type').eq('user_id',uid).eq(col,A.id);
      all=all.concat(c||[]);}
    const seen=new Set();all=all.filter(r=>!seen.has(r.id)&&seen.add(r.id));
    for(const r of all){
      if(r.to_id===A.id&&r.to_type==='account')exist+=r.tx_type==='fx_exchange'?Number(r.amount)/Number(r.fx_rate_used||1):Number(r.amount);
      if(r.from_id===A.id&&r.from_type==='account')exist-=Number(r.amount);
    }
  }
  const proj=open+net+exist;
  const ok=Math.abs(proj-TARGET[name])<=0.02;
  console.log((ok?'✓':'✗'),name.padEnd(8),'open',rp(open).padStart(10),'+ net',rp(net).padStart(11),'+ ledger',rp(exist).padStart(11),'=',rp(proj).padStart(10),'| target',rp(TARGET[name]),'| insert',ins.length);
  if(!ok){console.log('!! MELESET — BATAL');process.exit(1);}
  plan.push(...ins);
}
console.log('skip (sudah di ledger):',skip.length,'| fx EUR→IDR:',fxRow?'ada':'TIDAK ADA');
const byKat={};for(const p of plan)byKat[p.kat]=(byKat[p.kat]||0)+1;
console.log('kategori:',JSON.stringify(byKat));
if(!APPLY){console.log('(dry-run — insert',plan.length,')');process.exit(0);}

// baris ledger 8.300.000 yang menggantung → fx_exchange BCA EUR → BCA IDR
const{data:hang}=await supabase.from('ledger').select('id,amount,description').eq('user_id',uid).eq('amount',8300000).eq('to_id',bcaidr.id).is('from_id',null).limit(1);
const ids=[];
try{
  for(const p of plan){
    const amt=Number(p.r.amount);
    const{data,error}=await supabase.from('ledger').insert([{user_id:uid,tx_date:p.r.tx_date,tx_type:'expense',
      amount:amt,currency:p.cur,amount_idr:amt,description:(p.r.description||'').replace(/DB INTERCHANGE TRN MASTERCARD DBT \| ?/,'').slice(0,290),
      source:'backfill',notes:'backfill valas BCA (trip)',from_type:'account',from_id:p.A.id,to_type:'expense',to_id:null,
      category_id:cat(p.kat),category_name:p.kat,entity:'Personal'}]).select('id').single();
    if(error)throw new Error(error.message+' @ '+p.r.description);
    ids.push(data.id);
  }
  if(fxRow&&hang&&hang[0]){
    await supabase.from('ledger').update({tx_type:'fx_exchange',from_type:'account',from_id:fxRow.A.id,
      amount:405.56,currency:'EUR',amount_idr:8300000,fx_rate_used:405.56/8300000,
      description:'Jual EUR 405,56 → IDR 8.300.000 (kurs 20.465,53) — dulu tercatat "transfer dari rekening sendiri" tanpa asal'}).eq('id',hang[0].id);
    console.log('baris 8.300.000 dijadikan fx_exchange BCA EUR → BCA IDR');
  }else if(fxRow){console.log('!! baris 8.300.000 tidak ketemu — EUR akan meleset');}
  for(const[name]of Object.entries(OPEN))await supabase.from('accounts').update({initial_balance:OPEN[name]}).eq('id',acc(name).id);
  for(const p of plan)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',p.r.id);
  for(const s of skip)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',s.r.id);
  if(fxRow)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',fxRow.r.id);
  const touch=[...Object.keys(OPEN).map(n=>acc(n).id),bcaidr.id];
  for(const id of touch)await recalculateBalance(id,uid);
  const{data:after}=await supabase.from('accounts').select('id,name,current_balance').in('id',touch);
  let fail=null;
  const want={...TARGET,'BCA IDR':Number(bcaidr.current_balance)};
  for(const a of after){
    const ok=Math.abs(Number(a.current_balance)-want[a.name])<=0.02;
    console.log((ok?'  ✓':'  ✗'),a.name.padEnd(9),rp(a.current_balance).padStart(14),'(target',rp(want[a.name])+')');
    if(!ok)fail=a.name;
  }
  if(fail)throw new Error('VERIFIKASI GAGAL: '+fail);
  console.log('CONNECTED valas —',ids.length,'baris');
}catch(e){
  console.log('!! ROLLBACK:',e.message);
  for(const id of ids)await supabase.from('ledger').delete().eq('id',id);
  for(const[name,v]of Object.entries(OPEN)){const A=acc(name);await supabase.from('accounts').update({initial_balance:A.initial_balance}).eq('id',A.id);}
  process.exit(1);
}
process.exit(0);
})();
