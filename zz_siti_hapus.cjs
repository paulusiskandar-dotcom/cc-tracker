// Paulus: hapus baris Siti Sarnah 1jt (26 Agu) yang tadi kubuat sebagai penghapusan
// piutang berkategori Family. Konsekuensinya: sisa 1jt kembali jadi piutang TERBUKA
// terhadap SDC, bukan dihapuskan.
// Barisnya terkunci di Finalize 6d74ce12 → kelompoknya dibuka dulu (aturan baru:
// tidak ada perubahan pada baris ber-Finalize).
const fs=require('fs'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require(B+'app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
const{data:baris}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-08-26').eq('amount_idr',1000000).eq('category_name','Family').single();
console.log('baris target:',baris.id.slice(0,8),baris.tx_date,rp(baris.amount_idr),'|',(baris.description||'').slice(0,52));
console.log('  sumber:',nm(baris.from_id),'| cap:',baris.reimburse_settlement_id?baris.reimburse_settlement_id.slice(0,8):'terbuka');
const capId=baris.reimburse_settlement_id;
let anggota=[];
if(capId){
  const{data:r}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('reimburse_settlement_id',capId);
  anggota=r||[];
  console.log(`\nkelompok ${capId.slice(0,8)} berisi ${anggota.length} baris — semuanya akan dibuka:`);
  for(const r2 of anggota)console.log(`  ${r2.tx_date} ${rp(r2.amount_idr).padStart(11)} ${r2.tx_type.padEnd(13)} ent=${r2.entity} | ${(r2.description||'').slice(0,42)}`);
}
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync(B+'.backups',{recursive:true});
fs.writeFileSync(B+`.backups/siti-hapus-${Date.now()}.json`,JSON.stringify({baris,anggota},null,2));
if(capId){
  await supabase.from('ledger').update({reimburse_settlement_id:null}).eq('reimburse_settlement_id',capId);
  await supabase.from('reimburse_settlements').delete().eq('id',capId);
  console.log(`\n- Finalize ${capId.slice(0,8)} dibuka, ${anggota.length} baris kembali terbuka`);
}
await supabase.from('ledger').delete().eq('id',baris.id);
if(baris.from_id)await recalculateBalance(baris.from_id,uid);
console.log('- baris Siti Sarnah 1jt dihapus');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('\npiutang terbuka:');
for(const e of['Hamasa','SDC','Personal']){
  const f=r=>r.entity===e&&!r.reimburse_settlement_id;
  const o=led.filter(r=>f(r)&&r.tx_type==='reimburse_out').reduce((s,r)=>s+ +r.amount_idr,0);
  const i=led.filter(r=>f(r)&&r.tx_type==='reimburse_in').reduce((s,r)=>s+ +r.amount_idr,0);
  console.log(`  ${e.padEnd(9)} out ${rp(o).padStart(12)} in ${rp(i).padStart(12)} = ${rp(o-i)}`);
}
const{count}=await supabase.from('reimburse_settlements').select('id',{count:'exact',head:true}).eq('user_id',uid);
console.log(`\nkelompok Finalize tersisa: ${count}`);
process.exit(0);})();
