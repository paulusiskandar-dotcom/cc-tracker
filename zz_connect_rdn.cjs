// CONNECT "BCA RDN Ajaib" (4996395715) Des2025–Jul2026 + koreksi placeholder 20jt.
// Model: RDN = rekening bank; baris ke/dari "AJAIB SEKURITAS" = buy/sell aset Ajaib;
// baris a.n. PAULUS ISKANDAR = transfer antar rekening sendiri.
// Aset Ajaib: initial digeser supaya current_value HARI INI tetap 8.098.100 (MTM terverifikasi).
// Baris 65jt 16 Jun yang sudah ada di ledger (sell_asset Ajaib→BCA IDR) DIKOREKSI jadi
// transfer RDN→BCA IDR (statement RDN membuktikan uangnya lewat RDN).
const fs=require('fs');
const{execSync}=require('child_process');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const DIR='/private/tmp/claude-501/-Users-paulusiskandar-Downloads/ddf30272-814e-499f-a44c-2cb4d7264aff/scratchpad/rdn';
const MONTHS=['122025','012026','022026','032026','042026','052026','062026','072026'];
const num=s=>Number(s.replace(/,/g,''));

function parseRDN(path){
  const txt=execSync(`pdftotext -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const per=txt.match(/PERIODE\s*:\s*(\d{2})-(\d{2})-(\d{4})/);
  const yr=per?per[3]:null, mo=per?per[2]:null;
  const rows=[];let open=null,cur=null;
  for(const raw of txt.split('\n')){
    const m=raw.match(/^\s{3,12}(\d{2}\/\d{2})\s+(.+)$/);
    if(m){
      const rest=m[2];
      if(/SALDO AWAL/.test(rest)){const a=rest.match(/([\d,]+\.\d{2})/);if(a&&open==null)open=num(a[1]);cur=null;continue;}
      const amts=[...rest.matchAll(/([\d,]+\.\d{2})( DB)?/g)];
      if(!amts.length){cur=null;continue;}
      const a0=amts[0];
      const desc=rest.slice(0,rest.indexOf(a0[0])).replace(/\s+/g,' ').trim();
      const[dd,mm]=m[1].split('/');
      cur={date:`${yr}-${mm}-${dd}`,desc,amt:num(a0[1]),db:!!a0[2],saldo:amts[1]?num(amts[1][1]):null};
      rows.push(cur);continue;
    }
    if(cur&&/^\s{25,}\S/.test(raw)){
      const t=raw.trim();
      if(!/^[\d,\.]+( DB)?$/.test(t)&&!/SALDO|MUTASI|HALAMAN|PERIODE/.test(t))cur.desc+=' | '+t;
    }
  }
  const close=rows.length?rows[rows.length-1].saldo:open;
  return{rows,open,close,yr,mo};
}

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const ajaib=acc('Ajaib'),bcar=acc('BCA R'),bcaidr=acc('BCA IDR'),ph=acc('BCA ? (belum teridentifikasi)');
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const src=n=>srcs.find(s=>s.name===n)?.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n)?.id;

// parse + validasi rantai
let prev=null,open0=null,all=[];
for(const m of MONTHS){
  const{rows,open,close}=parseRDN(`${DIR}/RDN_4996395715_${m}.pdf`);
  let s=open;for(const r of rows)s+=(r.db?-1:1)*r.amt;
  const ok=Math.abs(s-close)<0.011?'BALANCE':'SELISIH '+rp(s-close);
  const chain=prev==null?'—':(Math.abs(prev-open)<0.011?'NYAMBUNG':'PUTUS '+rp(prev-open));
  console.log(m,'rows',String(rows.length).padStart(2),'| awal',rp(open).padStart(14),'| akhir',rp(close).padStart(14),'|',ok,'|',chain);
  if(open0==null)open0=open;prev=close;all=all.concat(rows);
}
const target=prev;
console.log('RDN total baris:',all.length,'| initial 1 Des',rp(open0),'| saldo akhir Jul',rp(target));

// baris 65jt yang sudah ada di ledger
const{data:sixty}=await supabase.from('ledger').select('id,tx_date,amount,tx_type,from_id,to_id,description').eq('user_id',uid)
  .eq('tx_type','sell_asset').eq('from_id',ajaib.id).eq('amount',65000000);
console.log('baris 65jt di ledger:',sixty&&sixty[0]?sixty[0].tx_date+' '+nm(sixty[0].from_id)+'→'+nm(sixty[0].to_id):'TIDAK ADA');

// klasifikasi
const AJ=/AJAIB SEKURITAS/i;
const plan=[];
for(const r of all){
  if(/^BUNGA/.test(r.desc))plan.push({...r,kind:'income',src:src('Bank Interest')});
  else if(/PAJAK BUNGA/.test(r.desc))plan.push({...r,kind:'expense',cat:cat('Bank Charges')});
  else if(AJ.test(r.desc))plan.push({...r,kind:r.db?'buy_asset':'sell_asset',other:ajaib.id});
  else if(/PAULUS ISKANDAR/.test(r.desc)){
    if(!r.db&&Math.round(r.amt)===20000000&&r.date==='2026-02-23')plan.push({...r,kind:'transfer',other:bcar.id,existing:'placeholder'});
    else if(r.db&&Math.round(r.amt)===65000000)plan.push({...r,kind:'transfer',other:bcaidr.id,existing:'sixty'});
    else plan.push({...r,kind:'?',other:null});
  }
  else plan.push({...r,kind:'?',other:null});
}
const unknown=plan.filter(p=>p.kind==='?');
console.log('baris tak terklasifikasi:',unknown.length);
for(const u of unknown)console.log('  ?',u.date,(u.db?'-':'+')+rp(u.amt),'|',u.desc.slice(0,70));
if(unknown.length){console.log('BATAL — ada baris tak dikenal');process.exit(1);}

const buys=plan.filter(p=>p.kind==='buy_asset').reduce((s,p)=>s+p.amt,0);
const sells=plan.filter(p=>p.kind==='sell_asset').reduce((s,p)=>s+p.amt,0);
console.log('beli saham Σ',rp(buys),'| jual saham Σ',rp(sells));
// aset Ajaib: current_value harus tetap. Efek baris baru: +buys −sells. Efek koreksi 65jt: +65jt (tidak lagi dikurangi).
const ajaibNow=Number(ajaib.current_value);
const ajaibInitNew=Number(ajaib.initial_balance)-buys+sells-(sixty&&sixty[0]?65000000:0);
console.log('Ajaib: initial',rp(ajaib.initial_balance),'→',rp(ajaibInitNew),'| current_value tetap',rp(ajaibNow));
// RDN: baris "existing" TIDAK diinsert (sudah ada / akan dikoreksi)
const toInsert=plan.filter(p=>!p.existing);
const insNet=toInsert.reduce((s,p)=>s+(p.db?-1:1)*p.amt,0);
const existNet=plan.filter(p=>p.existing).reduce((s,p)=>s+(p.db?-1:1)*p.amt,0);
console.log('RDN aljabar: initial',rp(open0),'+ insert',rp(insNet),'+ existing(2 baris koreksi)',rp(existNet),'=',rp(open0+insNet+existNet),'| target',rp(target));
if(Math.abs(open0+insNet+existNet-target)>0.02){console.log('!! MELESET');process.exit(1);}
if(!APPLY){console.log('(dry-run — insert',toInsert.length,'baris)');process.exit(0);}

fs.writeFileSync('.backups/zz_rdn_'+Date.now()+'.json',JSON.stringify({ajaib:{id:ajaib.id,initial:ajaib.initial_balance},sixty:sixty&&sixty[0],ph:ph&&ph.id}));
// akun RDN
let rdn=acc('BCA RDN Ajaib');
if(!rdn){
  const{data,error}=await supabase.from('accounts').insert([{user_id:uid,name:'BCA RDN Ajaib',type:'bank',currency:'IDR',
    initial_balance:open0,current_balance:0,is_active:true,include_networth:true}]).select().single();
  if(error){console.log('ERR akun',error.message);process.exit(1);}
  rdn=data;console.log('+ akun BCA RDN Ajaib',rdn.id);
}else await supabase.from('accounts').update({initial_balance:open0}).eq('id',rdn.id);

const ids=[];
for(const p of toInsert){
  const row={user_id:uid,tx_date:p.date,amount:p.amt,currency:'IDR',amount_idr:p.amt,
    description:p.desc.slice(0,290),source:'backfill',notes:'backfill RDN Ajaib 4996395715',
    from_type:null,from_id:null,to_type:null,to_id:null,category_id:null,category_name:null,entity:null,tx_type:p.kind};
  if(p.kind==='income'){row.from_type='income_source';row.from_id=p.src;row.to_type='account';row.to_id=rdn.id;row.entity='Personal';}
  else if(p.kind==='expense'){row.from_type='account';row.from_id=rdn.id;row.to_type='expense';row.category_id=p.cat;row.category_name='Bank Charges';row.entity='Personal';}
  else{row.from_type='account';row.to_type='account';row.from_id=p.db?rdn.id:p.other;row.to_id=p.db?p.other:rdn.id;}
  const{data,error}=await supabase.from('ledger').insert([row]).select('id').single();
  if(error){console.log('ERR insert',error.message,p.date,p.desc.slice(0,40));process.exit(1);}
  ids.push(data.id);
}
console.log('insert',ids.length,'baris RDN');
// koreksi placeholder 20jt → RDN
const{data:phRow}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('to_id',ph.id).eq('amount',20000000);
for(const r of phRow||[]){
  await supabase.from('ledger').update({to_id:rdn.id,
    description:'TRSF E-BANKING DB 2302/FTSCY/WS95271 | PAULUS ISKANDAR — setoran ke RDN Ajaib (terbukti: RDN 4996395715 menerima 20jt tgl 23/02, ref SAMA 2302/FTSCY/WS95271)'}).eq('id',r.id);
  console.log('20jt dialihkan placeholder → RDN Ajaib');
}
// koreksi 65jt
if(sixty&&sixty[0]){
  await supabase.from('ledger').update({tx_type:'transfer',from_id:rdn.id,
    description:'Penarikan RDN Ajaib → BCA IDR (dulu tercatat sell_asset langsung dari aset Ajaib; statement RDN 16/06 membuktikan lewat RDN)'}).eq('id',sixty[0].id);
  console.log('65jt Juni dikoreksi → transfer RDN → BCA IDR');
}
await supabase.from('accounts').update({initial_balance:ajaibInitNew}).eq('id',ajaib.id);
for(const id of[rdn.id,ajaib.id,bcar.id,bcaidr.id,ph.id])await recalculateBalance(id,uid);
const{data:after}=await supabase.from('accounts').select('id,name,type,current_balance,current_value').in('id',[rdn.id,ajaib.id,bcar.id,bcaidr.id,ph.id]);
const want={[rdn.id]:target,[ajaib.id]:ajaibNow,[bcar.id]:Number(bcar.current_balance),[bcaidr.id]:Number(bcaidr.current_balance),[ph.id]:0};
let fail=null;
for(const a of after){
  const v=a.type==='asset'?Number(a.current_value):Number(a.current_balance);
  const ok=Math.abs(v-want[a.id])<=0.02;
  console.log((ok?'  ✓':'  ✗'),a.name.padEnd(30),rp(v).padStart(15),'(target',rp(want[a.id])+')');
  if(!ok)fail=a.name;
}
if(fail){console.log('!! VERIFIKASI GAGAL:',fail,'— periksa manual (backup di .backups)');process.exit(1);}
// placeholder kosong → nonaktifkan
await supabase.from('accounts').update({is_active:false,include_networth:false}).eq('id',ph.id);
console.log('CONNECTED BCA RDN Ajaib; placeholder dinonaktifkan');
process.exit(0);
})();
