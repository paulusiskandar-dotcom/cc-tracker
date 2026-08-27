// OPSI A (disetujui Paulus 27/8): betulkan struktur Superbank.
// Superbank(bank) = TABUNGAN UTAMA saja (saldo 1 Jan 400.784,70) — anchor lama 150.526.501,68
// adalah penambal karena pencairan deposito 161jt tak pernah dicatat.
// Deposito lama dipisah per nomor rekening: 050008849064 (104.061.023,08) & 050006975358
// (53.885.569,36) → tumbuh bunga Jan–Apr → cair 12 Mei ke tabungan → 15 Mei 30jt ke deposito baru.
// Semua angka diverifikasi lawan statement sampai sen.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');

// bunga/pajak deposito per rekening
const DEP_B={no:'050008849064',open:104061023.08,cair:106146319.82,day:21,rows:[
  ['2026-01-21',662854.46,132570.89],['2026-02-21',666232.30,133246.46],
  ['2026-03-21',604824.70,120964.94],['2026-04-21',672709.46,134541.89]]};
const DEP_A={no:'050006975358',open:53885569.36,cair:54965391.55,day:16,rows:[
  ['2026-01-16',343243.70,68648.74],['2026-02-16',344992.83,68998.57],
  ['2026-03-16',313194.34,62638.87],['2026-04-16',348346.88,69669.38]]};
// tabungan: [tanggal, bunga, pajak] + hadiah
const TAB=[['2026-01-28',1701.96,340.39],['2026-02-28',1707.75,341.55],
  ['2026-03-28',1547.72,309.54],['2026-04-28',1718.83,343.77],
  ['2026-05-28',6434.44,1286.89],['2026-06-28',2220.95,444.19],['2026-07-28',2156.61,431.32]];
const HADIAH=['2026-03-06','2026-04-15','2026-04-29','2026-05-23','2026-06-13'];

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const S=acc('Superbank'), depBaru=acc('Deposito Superbank 1 Bulan');
{const{data:l}=await supabase.from('accounts').select('*').eq('user_id',uid).eq('name','Deposito Superbank').limit(1);var lama=l&&l[0];}
if(!lama){console.log('!! akun lama Deposito Superbank tidak ketemu');process.exit(1);}
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const src=n=>srcs.find(s=>s.name===n)?.id;
const INT=src('Bank Interest'), OTH=src('Other Income'), BC=cat('Bank Charges');

// proyeksi tabungan (validasi sebelum menulis)
let bal=400784.70;
const chk=[['1 Jan',400784.70]];
for(const[d,b,p]of TAB.filter(t=>t[0]<'2026-05-01'))bal+=b-p;
for(const h of HADIAH.filter(x=>x<'2026-05-01'))bal+=3;
chk.push(['30 Apr',bal]);
bal+=DEP_A.cair+DEP_B.cair-150000000+19000000-30000000+3+6434.44-1286.89;
chk.push(['31 Mei',bal]);
bal+=3+2220.95-444.19; chk.push(['30 Jun',bal]);
bal+=2156.61-431.32;   chk.push(['31 Jul',bal]);
bal+=50000000-50526501; chk.push(['hari ini',bal]);
const TARGET={'30 Apr':406134.71,'31 Mei':522996.63,'30 Jun':524776.39,'31 Jul':526501.68,'hari ini':0.68};
console.log('VALIDASI TABUNGAN:');
let bad=false;
for(const[k,v]of chk){const t=TARGET[k];const ok=t==null||Math.abs(v-t)<=0.02;if(!ok)bad=true;
  console.log('  ',(ok?'✓':'✗'),k.padEnd(9),rp(v).padStart(14),t!=null?('(statement '+rp(t)+')'):'');}
if(bad){console.log('!! validasi gagal — BATAL');process.exit(1);}
console.log('deposito A',DEP_A.no,':',rp(DEP_A.open),'+ bunga bersih =',rp(DEP_A.open+DEP_A.rows.reduce((s,r)=>s+r[1]-r[2],0)),'| pencairan',rp(DEP_A.cair));
console.log('deposito B',DEP_B.no,':',rp(DEP_B.open),'+ bunga bersih =',rp(DEP_B.open+DEP_B.rows.reduce((s,r)=>s+r[1]-r[2],0)),'| pencairan',rp(DEP_B.cair));
if(!APPLY){console.log('(dry-run)');process.exit(0);}

fs.writeFileSync('.backups/zz_superbank_'+Date.now()+'.json',JSON.stringify({S,depBaru,lama}));
// akun deposito lama: pakai ulang yang nonaktif utk B, buat baru utk A
await supabase.from('accounts').update({name:'Deposito Superbank '+DEP_B.no,account_no:DEP_B.no,subtype:'deposit',bank_name:'Superbank',
  initial_balance:DEP_B.open,current_value:DEP_B.open,is_active:true,include_networth:true,
  notes:'Deposito 1 Bulan; cair penuh 12 Mei 2026'}).eq('id',lama.id);
const B=lama.id;
const{data:newA,error:eA}=await supabase.from('accounts').insert([{user_id:uid,name:'Deposito Superbank '+DEP_A.no,type:'asset',subtype:'deposit',
  bank_name:'Superbank',account_no:DEP_A.no,currency:'IDR',initial_balance:DEP_A.open,current_value:DEP_A.open,current_balance:0,
  is_active:true,include_networth:true,notes:'Deposito 1 Bulan; cair penuh 12 Mei 2026'}]).select().single();
if(eA){console.log('ERR akun A',eA.message);process.exit(1);}
const A=newA.id;
console.log('+ akun deposito A',A,'| akun B dipakai ulang',B);

const rows=[];
const mk=o=>({user_id:uid,currency:'IDR',source:'backfill',notes:'perbaikan struktur Superbank (opsi A)',
  from_type:null,from_id:null,to_type:null,to_id:null,category_id:null,category_name:null,entity:null,...o});
for(const[dep,id]of[[DEP_A,A],[DEP_B,B]]){
  for(const[d,b,p]of dep.rows){
    rows.push(mk({tx_date:d,tx_type:'income',amount:b,amount_idr:b,description:'Bunga Deposito '+dep.no,
      from_type:'income_source',from_id:INT,to_type:'account',to_id:id,entity:'Personal'}));
    rows.push(mk({tx_date:d,tx_type:'expense',amount:p,amount_idr:p,description:'Pajak Bunga Deposito '+dep.no,
      from_type:'account',from_id:id,to_type:'expense',category_id:BC,category_name:'Bank Charges',entity:'Personal'}));
  }
  rows.push(mk({tx_date:'2026-05-12',tx_type:'sell_asset',amount:dep.cair,amount_idr:dep.cair,
    description:'Pencairan Deposito '+dep.no+' → Tabungan Superbank',
    from_type:'account',from_id:id,to_type:'account',to_id:S.id}));
}
for(const[d,b,p]of TAB){
  rows.push(mk({tx_date:d,tx_type:'income',amount:b,amount_idr:b,description:'Bunga Didapat (Tabungan Utama)',
    from_type:'income_source',from_id:INT,to_type:'account',to_id:S.id,entity:'Personal'}));
  rows.push(mk({tx_date:d,tx_type:'expense',amount:p,amount_idr:p,description:'Pajak atas Bunga (Tabungan Utama)',
    from_type:'account',from_id:S.id,to_type:'expense',category_id:BC,category_name:'Bank Charges',entity:'Personal'}));
}
for(const d of HADIAH)rows.push(mk({tx_date:d,tx_type:'income',amount:3,amount_idr:3,description:'Hadiah Kartu Untung',
  from_type:'income_source',from_id:OTH,to_type:'account',to_id:S.id,entity:'Personal'}));
rows.push(mk({tx_date:'2026-05-15',tx_type:'buy_asset',amount:30000000,amount_idr:30000000,
  description:'Penempatan Deposito 050026051073',from_type:'account',from_id:S.id,to_type:'account',to_id:depBaru.id}));

const ids=[];
try{
  for(const r of rows){
    const{data,error}=await supabase.from('ledger').insert([r]).select('id').single();
    if(error)throw new Error(error.message+' @ '+r.description);
    ids.push(data.id);
  }
  await supabase.from('accounts').update({initial_balance:400784.70}).eq('id',S.id);
  await supabase.from('accounts').update({initial_balance:0}).eq('id',depBaru.id); // 30jt kini dari baris buy_asset
  const{data:sst}=await supabase.from('ledger_staging').select('id').eq('user_id',uid).eq('account_id',S.id).eq('status','staged');
  for(const x of sst||[])await supabase.from('ledger_staging').update({status:'connected'}).eq('id',x.id);
  for(const id of[S.id,A,B,depBaru.id])await recalculateBalance(id,uid);
  const{data:after}=await supabase.from('accounts').select('id,name,type,current_balance,current_value').in('id',[S.id,A,B,depBaru.id]);
  const want={[S.id]:0.68,[A]:0,[B]:0,[depBaru.id]:30301575.83};
  let fail=null;
  for(const a of after){
    const v=a.type==='asset'?Number(a.current_value):Number(a.current_balance);
    const ok=Math.abs(v-want[a.id])<=0.02;
    console.log((ok?'  ✓':'  ✗'),a.name.padEnd(34),rp(v).padStart(14),'(target',rp(want[a.id])+')');
    if(!ok)fail=a.name;
  }
  if(fail)throw new Error('VERIFIKASI GAGAL: '+fail);
  console.log('SELESAI —',ids.length,'baris; staging Superbank ditandai connected:',(sst||[]).length);
}catch(e){
  console.log('!! ROLLBACK:',e.message);
  for(const id of ids)await supabase.from('ledger').delete().eq('id',id);
  await supabase.from('accounts').update({initial_balance:S.initial_balance}).eq('id',S.id);
  await supabase.from('accounts').update({initial_balance:depBaru.initial_balance}).eq('id',depBaru.id);
  await supabase.from('accounts').update({name:lama.name,initial_balance:lama.initial_balance,is_active:false}).eq('id',B);
  await supabase.from('accounts').delete().eq('id',A);
  for(const id of[S.id,B,depBaru.id])await recalculateBalance(id,uid);
  process.exit(1);
}
process.exit(0);
})();
