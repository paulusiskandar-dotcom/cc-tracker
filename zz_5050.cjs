const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,to_type,reimburse_settlement_id,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}

console.log('=== SETORAN HANG TUAH — bagian Paulus vs Agnes ===');
const ht=led.filter(r=>/Hang Tuah|CAKUNG SERAMBI|PURI MITRA/i.test(r.description||'')&&+r.amount_idr>1000000);
const byDate={};
for(const r of ht){const d=r.tx_date;byDate[d]=byDate[d]||{paulus:0,agnes_out:0,agnes_in:0};
  if(r.tx_type==='buy_asset')byDate[d].paulus+= +r.amount_idr;
  if(r.tx_type==='reimburse_out')byDate[d].agnes_out+= +r.amount_idr;}
for(const r of led.filter(r=>r.tx_type==='reimburse_in'&&/AGNES/i.test(r.description||'')))
  if(byDate[r.tx_date])byDate[r.tx_date].agnes_in+= +r.amount_idr;
let tp=0,tao=0,tai=0;
console.log('  tanggal      bagian Paulus   bagian Agnes    masuk dari Agnes   total ke Hang Tuah');
for(const[d,v]of Object.entries(byDate).sort()){tp+=v.paulus;tao+=v.agnes_out;tai+=v.agnes_in;
  console.log(`  ${d}  ${rp(v.paulus).padStart(13)} ${rp(v.agnes_out).padStart(14)} ${rp(v.agnes_in).padStart(18)} ${rp(v.paulus+v.agnes_out).padStart(19)}`);}
console.log(`  ${'JUMLAH'.padEnd(12)}${rp(tp).padStart(13)} ${rp(tao).padStart(14)} ${rp(tai).padStart(18)} ${rp(tp+tao).padStart(19)}`);
console.log(`\n  porsi Paulus ${(tp/(tp+tao)*100).toFixed(2)}% | porsi Agnes ${(tao/(tp+tao)*100).toFixed(2)}%`);
console.log(`  Agnes sudah setor ${rp(tai)} dari kewajiban ${rp(tao)} → selisih ${rp(tao-tai)}`);

console.log('\n=== semua transfer masuk dari AGNES (apa pun keperluannya) ===');
let ta=0;for(const r of led.filter(r=>/AGNES/i.test(r.description||'')&&r.to_type==='account')){ta+= +r.amount_idr;
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} ${r.tx_type.padEnd(13)} ${r.reimburse_settlement_id?'lunas':'BUKA '} | ${(r.description||'').slice(0,58)}`);}
console.log(`  jumlah: ${rp(ta)}`);

console.log('\n=== SEMUA baris reimburse entitas Personal ===');
const rows=led.filter(r=>['reimburse_out','reimburse_in'].includes(r.tx_type)&&r.entity==='Personal');
let o=0,i=0;
for(const r of rows){r.tx_type==='reimburse_out'?o+= +r.amount_idr:i+= +r.amount_idr;
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(12)} ${r.tx_type==='reimburse_out'?'keluar':'masuk '} ${r.reimburse_settlement_id?'lunas':'BUKA '} | ${(r.description||'').slice(0,56)}`);}
console.log(`  --- keluar ${rp(o)} | masuk ${rp(i)} | selisih ${rp(o-i)}`);
process.exit(0);})();
