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
const{data:h}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,entity,category_name,reimburse_settlement_id,description')
  .eq('user_id',uid).gte('tx_date','2026-07-05').lte('tx_date','2026-08-05').gte('amount_idr',212000).lte('amount_idr',213200).order('tx_date');
console.log('=== dua UGREEN USB-C hub 212.610 ===');
for(const r of h||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr)} ${r.tx_type.padEnd(13)} ${nm(r.from_id).padEnd(14)} ${r.entity||'-'} stempel=${r.reimburse_settlement_id?'ya':'-'} | ${(r.description||'').slice(0,40)}`);
const exp=(h||[]).filter(r=>r.tx_type==='expense');
console.log(`\nmasih expense: ${exp.length}`);
if(!APPLY){console.log('[DRY-RUN] tambahkan --apply.');process.exit(0);}
if(!exp.length){console.log('tidak ada yang perlu diubah');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/usbhub_${Date.now()}.json`,JSON.stringify(exp,null,1));
// yang PALING AKHIR = yang belum ditagih → reimburse_out TANPA stempel (piutang hidup)
exp.sort((a,b)=>a.tx_date.localeCompare(b.tx_date));
let ok=0;
for(let i=0;i<exp.length;i++){
  const r=exp[i], last=(i===exp.length-1);
  const upd={tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,entity:'Hamasa',category_id:null,category_name:null,
    notes:last?'UGREEN USB-C hub 7in1 — BELUM DITAGIH ke Hamasa (Paulus), sengaja tanpa stempel settlement agar tampil sbg piutang hidup'
              :'UGREEN USB-C hub 7in1 — sudah tercatat di sheet Piutang'};
  if(!last)upd.reimburse_settlement_id=SETTLE;
  const{error}=await supabase.from('ledger').update(upd).eq('id',r.id).eq('user_id',uid);
  if(!error){ok++;console.log(`  ${r.tx_date} → reimburse_out Hamasa ${last?'(TANPA stempel — piutang hidup)':'(distempel historis)'}`);}
  else console.log('GAGAL',error.message);
}
console.log(`ditulis ${ok}/${exp.length}`);
process.exit(0);})();
