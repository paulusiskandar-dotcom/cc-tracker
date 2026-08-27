// CONNECT tahap 1: Neobank + BLU (Danamon menunggu jawaban 2 kredit Mar).
// Per akun: preflight aljabar → insert ledger → geser initial akun lawan →
// recalculateBalance semua akun tersentuh → verifikasi → rollback kalau meleset.
// node zz_connect1.cjs [apply] [neobank] [blu]
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const DO={neobank:process.argv.includes('neobank'),blu:process.argv.includes('blu'),danamon:process.argv.includes('danamon')};

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const srcIds=new Set(srcs.map(s=>s.id));
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const catName=id=>cats.find(c=>c.id===id)?.name||null;

// backup
const bk={ts:new Date().toISOString(),accounts:accounts.map(a=>({id:a.id,name:a.name,initial_balance:a.initial_balance,current_balance:a.current_balance,current_value:a.current_value}))};
fs.writeFileSync('.backups/zz_connect1_backup_'+Date.now()+'.json',JSON.stringify(bk));

async function stagedOf(id){
  let st=[];for(let off=0;;off+=1000){
    const{data:c}=await supabase.from('ledger_staging').select('*').eq('user_id',uid).eq('account_id',id).eq('status','staged').order('tx_date').range(off,off+999);
    st=st.concat(c||[]);if(!c||c.length<1000)break;}
  return st;
}
function mkRow(A,r,extra){ // staging row -> ledger row
  const base={user_id:uid,tx_date:r.tx_date,tx_type:r.tx_type,amount:Number(r.amount),currency:'IDR',amount_idr:Number(r.amount),
    description:(r.description||'').slice(0,290),source:'backfill',notes:'backfill Des2025 ('+(r.source_file||'')+')',
    from_type:null,from_id:null,to_type:null,to_id:null,category_id:null,category_name:null,entity:r.entity||null};
  if(r.tx_type==='income'){base.from_type='income_source';base.from_id=r.category_id;base.to_type='account';base.to_id=A.id;
    if(!srcIds.has(r.category_id))throw new Error('income source invalid: '+r.description);}
  else if(r.tx_type==='expense'){base.from_type='account';base.from_id=A.id;base.to_type='expense';base.to_id=null;base.category_id=r.category_id;base.category_name=catName(r.category_id);}
  else if(r.tx_type==='reimburse_in'){base.from_type='expense';base.from_id=null;base.to_type='account';base.to_id=A.id;base.entity=r.entity||'Personal';}
  else if(['transfer','pay_cc','buy_asset','sell_asset'].includes(r.tx_type)){
    const out=r.direction==='out';
    base.from_type='account';base.to_type='account';
    base.from_id=out?A.id:r.counter_account_id;
    base.to_id=out?r.counter_account_id:A.id;
    if(!base.from_id||!base.to_id)throw new Error('counter kosong: '+r.tx_date+' '+r.description);}
  else throw new Error('tx_type tak dikenal: '+r.tx_type+' '+r.description);
  return Object.assign(base,extra||{});
}

async function connect(name,plan){
  console.log('\n══ CONNECT',name,'══');
  const A=acc(name);
  let st=await stagedOf(A.id);
  // pisahkan ≡LEDGER (sudah ada di app)
  const dup=st.filter(r=>/≡LEDGER|DP mobil BYD/.test(r.description||''));
  st=st.filter(r=>!dup.includes(r));
  // klasifikasi khusus BLU (deposit legs)
  const inserts=[];const newAccounts=[];const shifts=plan.shifts||[];const extraRows=[];
  for(const r of st){
    let rr={...r};
    if(plan.mapRow){const m=plan.mapRow(rr);if(m===null)continue;rr=m;}
    if(!rr.tx_type){console.log('!! tanpa tx_type:',rr.tx_date,rp(rr.amount),(rr.description||'').slice(0,60));return false;}
    inserts.push({stagingId:r.id,row:rr});
  }
  // aljabar: initial_new + existing_net + Σinserts(efek ke A) = expected
  let exist=0;
  for(const col of['from_id','to_id']){
    let off=0;for(;;off+=1000){
      const{data:c}=await supabase.from('ledger').select('amount').eq('user_id',uid).eq(col,A.id).range(off,off+999);
      for(const x of c||[])exist+=(col==='to_id'?1:-1)*Number(x.amount);
      if(!c||c.length<1000)break;}
  }
  const insNet=inserts.reduce((s,i)=>s+(i.row.direction==='in'?1:-1)*Number(i.row.amount),0);
  const proj=plan.initialNew+exist+insNet;
  console.log('rows staged:',st.length,'(skip ≡ledger:',dup.length,') | initial',rp(A.initial_balance),'→',rp(plan.initialNew));
  console.log('proyeksi: initial_new',rp(plan.initialNew),'+ existing',rp(exist),'+ inserts',rp(insNet),'=',rp(proj),'| target',rp(plan.expected));
  if(Math.abs(proj-plan.expected)>0.02){console.log('!! ALJABAR MELESET',rp(proj-plan.expected),'— BATAL');return false;}
  for(const s of shifts)console.log('shift:',s.name,rp(acc(s.name).initial_balance),'→',rp(Number(acc(s.name).initial_balance)+s.delta));
  for(const na of plan.newAccounts||[])console.log('akun baru:',na.name,na.type,'init',rp(na.initial_balance));
  if(!APPLY){console.log('(dry-run',name,')');return true;}

  // eksekusi
  const createdAcc={};
  for(const na of plan.newAccounts||[]){
    const{data,error}=await supabase.from('accounts').insert([{user_id:uid,name:na.name,type:na.type,currency:'IDR',initial_balance:na.initial_balance,current_balance:0,is_active:true,include_networth:true}]).select().single();
    if(error){console.log('ERR akun',na.name,error.message);return false;}
    createdAcc[na.key]=data.id;console.log('  + akun',na.name,data.id);
  }
  const rowsFinal=[];
  for(const i of inserts){
    if(i.row.counter_account_id&&typeof i.row.counter_account_id==='string'&&i.row.counter_account_id.startsWith('NEW:'))
      i.row.counter_account_id=createdAcc[i.row.counter_account_id.slice(4)];
    rowsFinal.push({stagingId:i.stagingId,row:mkRow(A,i.row)});
  }
  for(const ex of plan.extraRows?plan.extraRows(createdAcc):[])rowsFinal.push({stagingId:null,row:ex});
  const insertedIds=[];
  try{
    for(const rf of rowsFinal){
      const{data,error}=await supabase.from('ledger').insert([rf.row]).select('id').single();
      if(error)throw new Error(error.message+' @ '+rf.row.description);
      insertedIds.push(data.id);
      if(rf.stagingId)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',rf.stagingId);
    }
    for(const d of dup)await supabase.from('ledger_staging').update({status:'connected'}).eq('id',d.id);
    await supabase.from('accounts').update({initial_balance:plan.initialNew}).eq('id',A.id);
    for(const s of shifts)await supabase.from('accounts').update({initial_balance:Number(acc(s.name).initial_balance)+s.delta}).eq('id',acc(s.name).id);
    // recalc semua akun tersentuh
    const touched=new Set([A.id]);
    for(const rf of rowsFinal){if(rf.row.from_type==='account')touched.add(rf.row.from_id);if(rf.row.to_type==='account')touched.add(rf.row.to_id);}
    for(const s of shifts)touched.add(acc(s.name).id);
    for(const id of touched)await recalculateBalance(id,uid);
    // verifikasi
    const{data:after}=await supabase.from('accounts').select('id,name,current_balance,current_value,type').in('id',[...touched]);
    let fail=null;
    for(const a of after){
      const bal=a.type==='asset'?Number(a.current_value):Number(a.current_balance);
      const want=plan.verify[a.name];
      if(want!=null&&Math.abs(bal-want)>0.02)fail=a.name+' '+rp(bal)+' ≠ '+rp(want);
      console.log('  ✓cek',a.name.padEnd(24),rp(bal).padStart(15),want!=null?('(target '+rp(want)+')'):'(tanpa target)');
    }
    if(fail)throw new Error('VERIFIKASI GAGAL: '+fail);
    console.log('CONNECTED',name,'—',rowsFinal.length,'baris masuk ledger');
    return true;
  }catch(e){
    console.log('!! ROLLBACK',name,':',e.message);
    for(const id of insertedIds)await supabase.from('ledger').delete().eq('id',id);
    await supabase.from('accounts').update({initial_balance:A.initial_balance}).eq('id',A.id);
    for(const s of shifts)await supabase.from('accounts').update({initial_balance:acc(s.name).initial_balance}).eq('id',acc(s.name).id);
    for(const rf of rowsFinal)if(rf.stagingId)await supabase.from('ledger_staging').update({status:'staged'}).eq('id',rf.stagingId);
    for(const d of dup)await supabase.from('ledger_staging').update({status:'staged'}).eq('id',d.id);
    const touched=new Set([A.id]);for(const rf of rowsFinal){if(rf.row.from_type==='account')touched.add(rf.row.from_id);if(rf.row.to_type==='account')touched.add(rf.row.to_id);}
    for(const id of touched)if(id)await recalculateBalance(id,uid);
    return false;
  }
}

// ── NEOBANK: semua income/expense, tanpa lawan ──
if(DO.neobank){
  const ok=await connect('Neobank',{
    initialNew:1389230.91,
    expected:2905943.27,
    verify:{'Neobank':2905943.27},
  });
  if(!ok)process.exit(1);
}

// ── BLU ──
if(DO.blu){
  const srcInterest=srcs.find(s=>s.name==='Bank Interest').id;
  const ok=await connect('BLU',{
    initialNew:935607.08,
    expected:61274.03,
    newAccounts:[
      {key:'dep15',name:'bluDeposit 15',type:'asset',initial_balance:102824302.02},
      {key:'dep32',name:'bluDeposit 32',type:'asset',initial_balance:0},
      {key:'dep24',name:'bluDeposit 24',type:'asset',initial_balance:54205604.61},
    ],
    mapRow(r){
      const D=r.description||'';
      if(/Pencairan bluDeposit \| bluDeposit bluDeposit 15/.test(D)){r.tx_type='sell_asset';r.counter_account_id='NEW:dep15';r.needs_review=false;}
      else if(/Penempatan bluDeposit/.test(D)){r.tx_type='buy_asset';r.counter_account_id='NEW:dep32';}
      else if(/bluDeposit 32 — PENCAIRAN/.test(D)){r.tx_type='sell_asset';r.counter_account_id='NEW:dep32';}
      else if(/bluDeposit 24 — PENCAIRAN/.test(D)){r.tx_type='sell_asset';r.counter_account_id='NEW:dep24';}
      return r;
    },
    extraRows(created){ // bunga terkapitalisasi dep32 (selisih 103jt vs 103.805.772,35), tepat sebelum cair
      return[{user_id:uid,tx_date:'2026-05-12',tx_type:'income',amount:805772.35,currency:'IDR',amount_idr:805772.35,
        description:'Bunga terkapitalisasi bluDeposit 32 (103.000.000 → 103.805.772,35)',source:'backfill',notes:'backfill Des2025 (derivasi statement BLU)',
        from_type:'income_source',from_id:srcInterest,to_type:'account',to_id:created.dep32,category_id:null,category_name:null,entity:'Personal'}];
    },
    shifts:[
      {name:'Jenius IDR',delta:-100000000}, // menerima 100jt 12 Jan
      {name:'OCBC IDR',delta:+100000000},   // mengirim 100jt 4 Feb
      {name:'Superbank',delta:-19000000},   // menerima 19jt 15 Mei
    ],
    verify:{'BLU':61274.03,'bluDeposit 15':0,'bluDeposit 32':0,'bluDeposit 24':0,
      'Jenius IDR':Number(acc('Jenius IDR').current_balance),
      'OCBC IDR':Number(acc('OCBC IDR').current_balance),
      'Superbank':Number(acc('Superbank').current_balance)},
  });
  if(!ok)process.exit(1);
  // tandai baris pasangan di staging akun lawan sbg connected (mirror)
  if(APPLY){
    const pairs=[['Jenius IDR','2026-01-12',100000000,'in'],['OCBC IDR','2026-02-04',100000000,'out']];
    for(const[n,d,amt,dir]of pairs){
      const a=acc(n);
      const{data:m}=await supabase.from('ledger_staging').select('id').eq('user_id',uid).eq('account_id',a.id).eq('tx_date',d).eq('direction',dir).eq('status','staged').gte('amount',amt-1).lte('amount',amt+1);
      for(const x of m||[]){await supabase.from('ledger_staging').update({status:'connected'}).eq('id',x.id);console.log('mirror connected:',n,d,rp(amt));}
    }
  }
}
// ── DANAMON ──
if(DO.danamon){
  const rd=accounts.find(a=>a.name.includes('Deposito Berjangka Danamon'));
  const cashback=srcs.find(s=>s.name==='Cashback').id;
  const travel=cats.find(c=>c.name==='Travel').id;
  const dan=acc('Danamon');
  // pre-klasifikasi baris staging (jawaban Paulus 27/8) — idempoten, jalan juga saat dry-run
  {
    const{data:st}=await supabase.from('ledger_staging').select('id,tx_date,amount,description,direction').eq('user_id',uid).eq('account_id',dan.id).eq('status','staged');
    for(const r of st||[]){
      const amt=Math.round(Number(r.amount));const D=r.description||'';
      let set=null;
      if(r.tx_date>='2026-04-01'&&!/≡LEDGER/.test(D))set={description:('≡LEDGER — sudah ada di app | '+D).slice(0,290),needs_review:false,tx_type:null};
      else if(r.tx_date==='2026-03-11'&&amt===2386000)set={tx_type:'reimburse_in',entity:'Personal',needs_review:false,description:(D+' — reimburse pajak Henny (Paulus 27/8)').slice(0,290)};
      else if(r.tx_date==='2026-03-13'&&amt===745000)set={tx_type:'income',category_id:cashback,entity:'Personal',needs_review:false,description:(D+' — cashback/reimburse, detail lupa (Paulus 27/8)').slice(0,290)};
      else if(/RD Drawdown/.test(D))set={tx_type:'buy_asset',counter_account_id:rd.id,needs_review:false};
      else if(/FX TRX IDR-EUR/.test(D))set={tx_type:'expense',category_id:travel,entity:'Personal',needs_review:false};
      if(set)await supabase.from('ledger_staging').update(set).eq('id',r.id);
    }
  }
  const ok=await connect('Danamon',{
    initialNew:3736611.93,
    expected:Number(dan.current_balance), // saldo hari-ini TIDAK berubah
    shifts:[{name:'BCA R',delta:+30000000}], // 30jt 19 Feb dari BCA R
    verify:{'Danamon':Number(dan.current_balance),
      'BCA R':Number(acc('BCA R').current_balance),
      [rd.name]:3500000}, // cost basis benar: 7×500rb − eh: 4 lama + 3 baru = 3,5jt s/d Jul
  });
  if(!ok)process.exit(1);
  if(APPLY){ // mirror: baris BCA R 30jt 19 Feb
    const{data:m}=await supabase.from('ledger_staging').select('id').eq('user_id',uid).eq('account_id',acc('BCA R').id).eq('tx_date','2026-02-19').eq('direction','out').eq('status','staged').gte('amount',29999999).lte('amount',30000001);
    for(const x of m||[]){await supabase.from('ledger_staging').update({status:'connected'}).eq('id',x.id);console.log('mirror connected: BCA R 30jt 19 Feb');}
  }
}
process.exit(0);
})();
