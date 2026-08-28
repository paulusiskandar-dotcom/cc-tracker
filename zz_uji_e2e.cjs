// UJI UJUNG-KE-UJUNG: panggil ledgerApi.create ASLI dengan _paper_split seperti yang
// akan datang dari email sync, buktikan ia membuat DUA baris dengan nominal benar dan
// saldo kartu bergerak persis sebesar tagihan penuh — lalu BATALKAN semuanya.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,ledgerApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const kartu=accounts.find(a=>a.name==='OCBC 90N');
const piutang=accounts.find(a=>a.name==='Piutang Hamasa');
const saldoKartu=async()=>{let s=0;
  for(const col of['from_id','to_id']){let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('amount_idr').eq('user_id',uid).eq(col,kartu.id).range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
    for(const r of all)s+=(col==='from_id'?1:-1)*+r.amount_idr;}return s;};
const piut=async()=>{let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr').eq('user_id',uid).eq('entity','Hamasa').in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
  return led.reduce((s,r)=>s+(r.tx_type==='reimburse_out'?1:-1)*+r.amount_idr,0);};
const s0=await saldoKartu(), p0=await piut();
console.log('sebelum:  saldo kartu',rp(s0),'| piutang Hamasa',rp(p0));
// tiruan persis keluaran parser utk transaksi Paper nyata 14 Agu
const split={kirim:47205000,fee:732677,total:47937677,ke:'Sah**** Den*** Ceme*****',ref:'UJI-E2E'};
const entry={tx_date:'2026-08-28',description:'UJI E2E — PT. GLOBAL DIGITAL NIA',
  amount:47937677,amount_idr:47937677,currency:'IDR',tx_type:'reimburse_out',
  from_type:'account',from_id:kartu.id,to_type:'account',to_id:piutang.id,
  entity:'Hamasa',is_reimburse:true,category_id:null,category_name:null,
  notes:'',source:'uji-e2e',_paper_split:split};
const created=await ledgerApi.create(uid,entry,accounts);
console.log('\nbaris pokok dibuat:',rp(created.amount_idr),created.tx_type,created.entity);
const{data:feeRow}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('source','paper-split').eq('tx_date','2026-08-28').maybeSingle();
console.log('baris fee dibuat  :',feeRow?rp(feeRow.amount_idr)+' '+feeRow.tx_type+' '+feeRow.entity+' kat='+feeRow.category_name:'TIDAK ADA');
const s1=await saldoKartu(), p1=await piut();
console.log('\nsesudah:  saldo kartu',rp(s1),'| piutang Hamasa',rp(p1));
const ujiPokok=+created.amount_idr===split.kirim;
const ujiFee=feeRow&&+feeRow.amount_idr===split.fee&&feeRow.entity==='Personal'&&feeRow.from_id===kartu.id;
const ujiKartu=Math.abs((s1-s0)-split.total)<1;
const ujiPiutang=Math.abs((p1-p0)-split.kirim)<1;
console.log('\n=== HASIL UJI ===');
console.log(` ${ujiPokok?'✓':'✗'} baris pokok = Jumlah Terkirim (${rp(split.kirim)})`);
console.log(` ${ujiFee?'✓':'✗'} baris fee = ${rp(split.fee)}, entity Personal, di kartu yang sama`);
console.log(` ${ujiKartu?'✓':'✗'} saldo kartu naik tagihan PENUH ${rp(split.total)} (naik ${rp(s1-s0)})`);
console.log(` ${ujiPiutang?'✓':'✗'} piutang naik HANYA ${rp(split.kirim)} (naik ${rp(p1-p0)})`);
// bersihkan
await supabase.from('ledger').delete().eq('id',created.id);
if(feeRow)await supabase.from('ledger').delete().eq('id',feeRow.id);
const{recalculateBalance}=require('./app.headless.cjs');
await recalculateBalance(kartu.id,uid);
const s2=await saldoKartu(),p2=await piut();
console.log(`\n dibersihkan → saldo kartu ${rp(s2)} ${Math.abs(s2-s0)<1?'✓ kembali':'✗ MELESET'} | piutang ${rp(p2)} ${Math.abs(p2-p0)<1?'✓ kembali':'✗ MELESET'}`);
const semua=ujiPokok&&ujiFee&&ujiKartu&&ujiPiutang&&Math.abs(s2-s0)<1&&Math.abs(p2-p0)<1;
console.log('\n'+(semua?'SEMUA UJI LULUS':'ADA YANG GAGAL'));
process.exit(semua?0:1);})();
