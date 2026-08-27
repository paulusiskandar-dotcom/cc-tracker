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
// pajak Henny: 2.385.938 (Apr) + 2.368.679 (Mei, Jun, Jul, Agu)
const T=[['2026-04-14',2385938],['2026-05-11',2368679],['2026-06-11',2368679],['2026-07-09',2368679],['2026-08-11',2368679]];
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,entity,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[];
console.log('=== pajak Henny Djohari ===');
for(const[d,a]of T){
  const h=led.filter(r=>Math.abs(+r.amount_idr-a)<1&&Math.abs(new Date(r.tx_date)-new Date(d))/864e5<=4&&/tokopedia/i.test(r.description||''));
  if(!h.length){console.log(`  ${d} ${rp(a).padStart(11)} → TIDAK ADA di ledger`);continue;}
  for(const r of h){
    if(r.tx_type==='reimburse_out'){console.log(`  ${r.tx_date} ${rp(a).padStart(11)} ✓ sudah reimburse_out ${r.entity}`);continue;}
    console.log(`  ${r.tx_date} ${rp(a).padStart(11)} ${r.tx_type} ${nm(r.from_id)} → akan jadi reimburse_out Hamasa`);jobs.push(r);
  }
}
console.log(`\nperlu diubah: ${jobs.length} baris = ${rp(jobs.reduce((s,r)=>s+ +r.amount_idr,0))}`);
if(!APPLY){console.log('[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/henny_${Date.now()}.json`,JSON.stringify(jobs,null,1));
let ok=0;
for(const r of jobs){const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,entity:'Hamasa',
  reimburse_settlement_id:SETTLE,category_id:null,category_name:null,
  notes:'pajak DJP a.n. HENNY DJOHARI dibayar via Tokopedia — reimburse Hamasa (Paulus)'}).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${jobs.length}`);
const after=await accountsApi.getAll(uid);
let beda=0;for(const a of after.filter(a=>a.type==='credit_card'))if(Math.abs(before[a.name]-Number(a.outstanding_amount||0))>0.5){console.log(`⚠ ${a.name} berubah`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
