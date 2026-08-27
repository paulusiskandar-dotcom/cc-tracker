// CONNECT Jenius IDR (Des2025–Mar2026) + pocket valas via fx_exchange.
// - 7 baris sisa → Electronics & Gadgets (Paulus 27/8)
// - FX: fx_exchange dgn fx_rate_used = amountFrom / amountTo (rumus app: to += from/rate)
// - akun "Jenius CNY" dibuat (initial 867,91 → berakhir 0)
// - baris koreksi −2.330 tgl 1 Apr (celah genesis: statement 1 Apr 16.337.409 vs anchor app 16.335.079)
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const OPEN=19243689, GAP=0; // saldo 1 Jan 2026 Mandiri

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const byId=id=>accounts.find(a=>a.id===id);
const nm=id=>byId(id)?.name||'∅';
const J=acc('Mandiri');
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const catName=id=>cats.find(c=>c.id===id)?.name||null;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const srcIds=new Set(srcs.map(s=>s.id));
const PIUT={};for(const e of['Hamasa','SDC','Personal']){
  const{data:r}=await supabase.from('ledger').select('to_id').eq('user_id',uid).eq('tx_type','reimburse_out').eq('entity',e).not('to_id','is',null).limit(1);
  PIUT[e]=r&&r[0]?r[0].to_id:null;}

// (blok gadget khusus Jenius DIHAPUS — jangan pernah diterapkan lintas akun)

// 2) FX definitions
const FX={
  FX_CNY_IN :{dir:'in', other:'Jenius CNY', amtFrom:867.91,   curFrom:'CNY'}, // CNY 867,91 → IDR 2.034.381
  FX_JPY_OUT:{dir:'out',other:'Jenius JPY', amtTo:20000},                      // IDR 2.144.800 → JPY 20.000
  FX_EUR_OUT:{dir:'out',other:'Jenius EUR'},                                   // IDR x → EUR (150 / 1.000)
};
let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('*').eq('user_id',uid).eq('account_id',J.id).eq('status','staged').order('tx_date').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}

// akun Jenius CNY
let cny=acc('Jenius CNY');
if(!cny&&APPLY){
  const{data,error}=await supabase.from('accounts').insert([{user_id:uid,name:'Jenius CNY',type:'bank',subtype:'pocket',bank_name:'Jenius',
    currency:'CNY',initial_balance:867.91,current_balance:0,is_active:true,include_networth:true,
    notes:'Pocket valas Jenius; saldo 867,91 CNY dijual ke IDR 9 Des 2025'}]).select().single();
  if(error){console.log('ERR akun CNY',error.message);process.exit(1);}
  cny=data;console.log('+ akun Jenius CNY',cny.id);
}

const dup=st.filter(r=>/≡LEDGER/.test(r.description||''));
const work=st.filter(r=>!dup.includes(r));
console.log('staged',st.length,'| ≡LEDGER skip',dup.length,'| insert kandidat',work.length);
const rows=[];const shift={};
const addShift=(id,d)=>{shift[id]=(shift[id]||0)+d;};
for(const r of work){
  const base={user_id:uid,tx_date:r.tx_date,amount:Number(r.amount),currency:'IDR',amount_idr:Number(r.amount),
    description:(r.description||'').slice(0,290),source:'backfill',notes:'backfill Mandiri',
    from_type:null,from_id:null,to_type:null,to_id:null,category_id:null,category_name:null,entity:r.entity||null,tx_type:r.tx_type};
  const out=r.direction==='out';
  if(r.tx_type==='DEPOSITO_NEO'){
    const dep=acc('Deposito WOW Neobank 1071862732');
    base.tx_type='buy_asset';base.from_type='account';base.from_id=J.id;base.to_type='account';base.to_id=dep.id;
    addShift(dep.id,-Number(r.amount));
    rows.push(base);continue;
  }
  if(r.tx_type==='FX_EUR_BCA'){
    const eurAcc=acc('BCA EUR');const eur=300;
    base.tx_type='fx_exchange';base.from_type='account';base.from_id=J.id;base.to_type='account';base.to_id=eurAcc.id;
    base.amount=Number(r.amount);base.currency='IDR';base.fx_rate_used=Number(r.amount)/eur;
    addShift(eurAcc.id,-eur);
    rows.push(base);continue;
  }
  if(r.tx_type&&r.tx_type.startsWith('FX_')){
    const f=FX[r.tx_type];const other=acc(f.other)||cny;
    if(!other){console.log('!! akun valas belum ada:',f.other);process.exit(1);}
    if(r.tx_type==='FX_CNY_IN'){
      base.tx_type='fx_exchange';base.from_type='account';base.from_id=other.id;base.to_type='account';base.to_id=J.id;
      base.amount=f.amtFrom;base.currency='CNY';base.amount_idr=Number(r.amount);
      base.fx_rate_used=f.amtFrom/Number(r.amount);
      addShift(other.id,+f.amtFrom); // CNY keluar → initial naik agar saldo akhir tetap
    }else{
      const to = r.tx_type==='FX_JPY_OUT' ? 20000 : (Math.round(Number(r.amount))===2931450?150:1000);
      base.tx_type='fx_exchange';base.from_type='account';base.from_id=J.id;base.to_type='account';base.to_id=other.id;
      base.amount=Number(r.amount);base.currency='IDR';base.fx_rate_used=Number(r.amount)/to;
      addShift(other.id,-to); // valas masuk → initial turun agar saldo akhir tetap
    }
    rows.push(base);continue;
  }
  if(r.tx_type==='income'){base.from_type='income_source';base.from_id=r.category_id;base.to_type='account';base.to_id=J.id;
    if(!srcIds.has(r.category_id)){console.log('!! income source invalid',r.tx_date,r.description);process.exit(1);}}
  else if(r.tx_type==='expense'){base.from_type='account';base.from_id=J.id;base.to_type='expense';base.category_id=r.category_id;base.category_name=catName(r.category_id);
    if(!r.category_id){console.log('!! expense tanpa kategori',r.tx_date,r.description);process.exit(1);}}
  else if(r.tx_type==='collect_loan'){base.from_type='employee_loan';base.from_id=null;base.to_type='account';base.to_id=J.id;base.entity=r.entity||'Personal';}
  else if(r.tx_type==='give_loan'){base.from_type='account';base.from_id=J.id;base.to_type='account';base.to_id=null;base.entity=r.entity||'Personal';}
  else if(r.tx_type==='reimburse_in'){base.from_type='expense';base.to_type='account';base.to_id=J.id;base.entity=r.entity||'Hamasa';}
  else if(r.tx_type==='reimburse_out'){base.from_type='account';base.from_id=J.id;base.to_type='account';base.to_id=PIUT[r.entity||'Hamasa'];}
  else if(['transfer','pay_cc','buy_asset','sell_asset'].includes(r.tx_type)){
    base.from_type='account';base.to_type='account';
    base.from_id=out?J.id:r.counter_account_id;base.to_id=out?r.counter_account_id:J.id;
    if(!base.from_id||!base.to_id){console.log('!! counter kosong',r.tx_date,rp(r.amount),r.description);process.exit(1);}
    const o=out?base.to_id:base.from_id;
    const X=byId(o);
    if(X&&X.type!=='receivable'){
      const receives=base.to_id===o;
      addShift(o,X.type==='credit_card'?(receives?+Number(r.amount):-Number(r.amount)):(receives?-Number(r.amount):+Number(r.amount)));
    }
  }
  else{console.log('!! tipe tak dikenal',r.tx_type,r.tx_date,r.description);process.exit(1);}
  rows.push(base);
}
// (tanpa koreksi gap)
if(GAP)rows.push({user_id:uid,tx_date:'2026-04-01',tx_type:'expense',amount:GAP,currency:'IDR',amount_idr:GAP,
  description:'Koreksi celah genesis Jenius: statement 1 Apr 16.337.409 vs anchor app 16.335.079 (2.330 tidak terdokumentasi di statement manapun)',
  source:'backfill',notes:'backfill Mandiri',from_type:'account',from_id:J.id,to_type:'expense',to_id:null,
  category_id:cat('Other'),category_name:'Other',entity:'Personal'});

// aljabar
let exist=0;{
  let all=[];
  for(const col of['from_id','to_id']){
    let off=0;for(;;off+=1000){
      const{data:c}=await supabase.from('ledger').select('id,amount,from_id,from_type,to_id,to_type').eq('user_id',uid).eq(col,J.id).range(off,off+999);
      all=all.concat(c||[]);if(!c||c.length<1000)break;}}
  const seen=new Set();all=all.filter(r=>!seen.has(r.id)&&seen.add(r.id));
  for(const r of all){
    if(r.to_id===J.id&&r.to_type==='account')exist+=Number(r.amount);
    if(r.from_id===J.id&&r.from_type==='account')exist-=Number(r.amount);
  }
}
const insNet=rows.reduce((s,r)=>{
  if(r.tx_type==='fx_exchange')return s+(r.to_id===J.id?Number(r.amount)/Number(r.fx_rate_used):-Number(r.amount));
  return s+(r.to_id===J.id?Number(r.amount):-Number(r.amount));},0);
const proj=OPEN+exist+insNet;
console.log('aljabar:',rp(OPEN),'+ exist',rp(exist),'+ ins',rp(insNet),'= saldo baru',rp(proj));
console.log('saldo app sekarang',rp(J.current_balance),'→ saldo baru',rp(proj),'| selisih',rp(proj-Number(J.current_balance)));
const drift=proj-Number(J.current_balance);
if(Math.abs(drift)>0.02){console.log('CATATAN: saldo Mandiri bergeser',rp(drift),'— pastikan ini koreksi anchor yang benar');}
for(const[id,d]of Object.entries(shift))console.log('shift:',nm(id).padEnd(14),rp(byId(id)?.initial_balance??(cny&&id===cny.id?cny.initial_balance:0)),'→ Δ',rp(d));
if(!APPLY){console.log('(dry-run — insert',rows.length,')');process.exit(0);}

fs.writeFileSync('.backups/zz_jenius_'+Date.now()+'.json',JSON.stringify({accounts:accounts.map(a=>({id:a.id,name:a.name,initial_balance:a.initial_balance}))}));
// normalisasi baseline
const touch=[J.id,...Object.keys(shift)];
for(const id of touch)await recalculateBalance(id,uid);
const{data:fresh}=await supabase.from('accounts').select('id,name,type,initial_balance,current_balance,current_value,outstanding_amount').in('id',touch);
const F=id=>fresh.find(x=>x.id===id);
const want={};for(const a of fresh)want[a.id]=a.type==='credit_card'?Number(a.outstanding_amount):a.type==='asset'?Number(a.current_value):Number(a.current_balance);
want[J.id]=proj; // saldo BCA IDR memang naik (koreksi anchor)
const ids=[];
try{
  for(const r of rows){
    const{data,error}=await supabase.from('ledger').insert([r]).select('id').single();
    if(error)throw new Error(error.message+' @ '+r.description.slice(0,50));
    ids.push(data.id);
  }
  for(const r of st)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',r.id);
  await supabase.from('accounts').update({initial_balance:OPEN}).eq('id',J.id);
  for(const[id,d]of Object.entries(shift))await supabase.from('accounts').update({initial_balance:Number(F(id).initial_balance)+d}).eq('id',id);
  // mirror staging lawan
  for(const r of rows){
    if(r.from_type!=='account'||r.to_type!=='account'||r.tx_type==='fx_exchange')continue;
    const o=r.from_id===J.id?r.to_id:r.from_id;if(!o||o===J.id)continue;
    const dir=r.to_id===o?'in':'out';
    const{data:m}=await supabase.from('ledger_staging').select('id').eq('user_id',uid).eq('account_id',o).eq('status','staged').eq('direction',dir)
      .gte('amount',Number(r.amount)-1).lte('amount',Number(r.amount)+1)
      .gte('tx_date',new Date(+new Date(r.tx_date)-3*864e5).toISOString().slice(0,10))
      .lte('tx_date',new Date(+new Date(r.tx_date)+3*864e5).toISOString().slice(0,10)).limit(1);
    if(m&&m[0])await supabase.from('ledger_staging').update({status:'connected'}).eq('id',m[0].id);
  }
  for(const id of touch)await recalculateBalance(id,uid);
  const{data:after}=await supabase.from('accounts').select('id,name,type,current_balance,current_value,outstanding_amount').in('id',touch);
  let fail=null;
  for(const a of after){
    const v=a.type==='credit_card'?Number(a.outstanding_amount):a.type==='asset'?Number(a.current_value):Number(a.current_balance);
    const ok=Math.abs(v-want[a.id])<=0.02;
    console.log((ok?'  ✓':'  ✗'),a.name.padEnd(16),rp(v).padStart(15),'(target',rp(want[a.id])+')');
    if(!ok)fail=a.name;
  }
  if(fail)throw new Error('VERIFIKASI GAGAL: '+fail);
  console.log('CONNECTED Jenius IDR —',ids.length,'baris');
}catch(e){
  console.log('!! ROLLBACK:',e.message);
  for(const id of ids)await supabase.from('ledger').delete().eq('id',id);
  await supabase.from('accounts').update({initial_balance:F(J.id).initial_balance}).eq('id',J.id);
  for(const[id,d]of Object.entries(shift))await supabase.from('accounts').update({initial_balance:F(id).initial_balance}).eq('id',id);
  for(const r of st)await supabase.from('ledger_staging').update({status:'staged'}).eq('id',r.id);
  for(const id of touch)await recalculateBalance(id,uid);
  process.exit(1);
}
process.exit(0);
})();
