// 1) Tiga transaksi Tokopedia 12–13 Mar tanpa email → reimburse_out Hamasa (aturan Paulus:
//    "tanpa email Tokopedia padahal muncul di statement = pasti reimburse out").
// 2) Pajak Henny 741.094 (13 Mar) → reimburse_out, dipasangkan dengan kredit 745.000 (13 Mar)
//    yang tadinya salah tercatat sebagai cashback.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const PIUTANG='f282ac7e-a908-4e5d-adb0-144473e9f126', SETTLE='014ccdfa-5837-4e32-a9ef-c6ce6fae8142';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const before=Object.fromEntries(accounts.filter(a=>a.type==='credit_card').map(a=>[a.name,Number(a.outstanding_amount||0)]));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const OUT=[
 {d:'2026-03-12',a:9453925,n:'Tokopedia 12 Mar tanpa email — reimburse Hamasa (aturan Paulus)'},
 {d:'2026-03-13',a:9605942,n:'Tokopedia 12 Mar (posting 13) tanpa email — reimburse Hamasa (aturan Paulus)'},
 {d:'2026-03-13',a:1478497,n:'Tokopedia 12 Mar (posting 13) tanpa email — reimburse Hamasa (aturan Paulus)'},
 {d:'2026-03-13',a:741094, n:'pajak DJP Henny Djohari via Tokopedia — reimburse Hamasa; diganti 745.000 tgl 13 Mar'},
];
const jo=[];
console.log('=== jadi reimburse_out ===');
for(const o of OUT){
  const h=led.filter(r=>r.tx_date===o.d&&r.tx_type==='expense'&&Math.abs(+r.amount_idr-o.a)<1&&/tokopedia/i.test(r.description||''));
  if(h.length!==1){console.log(`  ⚠ ${o.d} ${rp(o.a)} cocok ${h.length}`);continue;}
  console.log(`  ${o.d} ${rp(o.a).padStart(11)} ${nm(h[0].from_id)}`);jo.push({r:h[0],o});
}
const inn=led.find(r=>r.tx_date==='2026-03-13'&&r.tx_type==='income'&&Math.abs(+r.amount_idr-745000)<1);
console.log('\n=== jadi reimburse_in (pasangan pajak Henny) ===');
console.log(inn?`  2026-03-13 ${rp(inn.amount_idr)} masuk ${nm(inn.to_id)} — dari cashback → reimburse_in Hamasa`:'  TIDAK KETEMU');
if(inn)console.log(`  selisih terhadap 741.094 = ${rp(745000-741094)} (dibulatkan ke atas oleh Henny)`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/pasangan745_${Date.now()}.json`,JSON.stringify([...jo.map(j=>j.r),inn].filter(Boolean),null,1));
let ok=0;
for(const j of jo){const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,entity:'Hamasa',
  reimburse_settlement_id:SETTLE,category_id:null,category_name:null,notes:j.o.n}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL out',error.message);}
if(inn){const{error}=await supabase.from('ledger').update({tx_type:'reimburse_in',from_type:'expense',from_id:null,entity:'Hamasa',
  reimburse_settlement_id:SETTLE,category_id:null,category_name:null,is_reimburse:true,
  description:'HENNY DJOHARI — penggantian pajak (pasangan tagihan 741.094 tgl 13 Mar)',
  notes:'sebelumnya tercatat sebagai cashback; pasangan sebenarnya adalah pembayaran pajak Henny 741.094'}).eq('id',inn.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL in',error.message);}
console.log(`\nditulis ${ok}/${jo.length+(inn?1:0)}`);
const after=await accountsApi.getAll(uid);
let beda=0;for(const a of after.filter(a=>a.type==='credit_card'))if(Math.abs(before[a.name]-Number(a.outstanding_amount||0))>0.5){console.log(`⚠ ${a.name} berubah`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
