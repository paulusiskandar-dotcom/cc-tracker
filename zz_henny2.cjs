// Seragamkan seluruh pasangan pajak Henny ke entity Personal — kedua sisinya.
// Alasan: uangnya kembali dari Henny sendiri, bukan dari Hamasa.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const pPers=accounts.find(a=>a.type==='receivable'&&a.entity==='Personal');
const{data:ss}=await supabase.from('reimburse_settlements').select('id,entity,notes').eq('user_id',uid).eq('entity','Personal');
const sPers=(ss||[]).find(s=>/BACKFILL HISTORIS/i.test(s.notes||''));
console.log('akun Piutang Personal:',pPers?.id.slice(0,8),'| settlement historis Personal:',sPers?.id.slice(0,8));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,entity,reimburse_settlement_id,description,notes').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
// pajak Henny: nominal khas + deskripsi/catatan menyebut Henny atau Tokopedia pajak
const NOM=[2385938,2386000,2368679,741094,745000];
const rows=led.filter(r=>NOM.some(a=>Math.abs(+r.amount_idr-a)<1)&&
  (/HENNY|pajak/i.test(r.description||'')||/HENNY|pajak/i.test(r.notes||'')||/TOKOPEDIA/i.test(r.description||'')));
console.log('\n=== baris pasangan pajak Henny ===');
for(const r of rows)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.tx_type.padEnd(13)} entity=${(r.entity||'-').padEnd(8)} ${nm(r.from_id)}→${nm(r.to_id)} | ${(r.description||'').slice(0,44)}`);
const perlu=rows.filter(r=>r.entity!=='Personal');
console.log(`\ntotal ${rows.length} baris · perlu diseragamkan ke Personal: ${perlu.length}`);
if(!APPLY){console.log('[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/henny2_${Date.now()}.json`,JSON.stringify(rows,null,1));
let ok=0;
for(const r of rows){
  const upd={entity:'Personal'};
  if(r.reimburse_settlement_id&&sPers)upd.reimburse_settlement_id=sPers.id;
  if(r.tx_type==='reimburse_out'&&pPers)upd.to_id=pPers.id;
  const{error}=await supabase.from('ledger').update(upd).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);
}
console.log(`ditulis ${ok}/${rows.length}`);
process.exit(0);})();
