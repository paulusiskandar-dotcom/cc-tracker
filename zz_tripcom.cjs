// Dua transfer 1.750.000 tanggal 3 Agustus BUKAN baris kembar (dikonfirmasi Paulus +
// tangkapan layar BCA): satu dari HERLINA DJOHARI ("hotel Singapore"), satu dari
// HENNY DJOHARI. Keduanya patungan hotel Singapore yang dibayar lewat Trip.com.
// Pasangannya: TRIPCOM 3.459.324 (3 Ags, Jenius). 1.750.000 x2 = 3.500.000,
// dibulatkan ke atas 40.676.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:rows}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-08-03').eq('amount_idr',1750000).eq('tx_type','reimburse_in');
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/tripcom-${Date.now()}.json`,JSON.stringify(rows,null,2));
for(const r of rows){
  const herlina=/WS95031|HERLINA/i.test(r.description||'');
  await supabase.from('ledger').update({description:(herlina?'HERLINA DJOHARI':'HENNY DJOHARI')+' — patungan hotel Singapore (pasangan TRIPCOM 3.459.324 tgl 3 Ags; 2x1.750.000 = 3.500.000, dibulatkan +40.676)'}).eq('id',r.id);
  console.log('-',herlina?'HERLINA':'HENNY  ',rp(r.amount_idr),'dicatat sbg patungan hotel Singapore');
}
const{data:t}=await supabase.from('ledger').select('id,entity,description').eq('user_id',uid).eq('tx_date','2026-08-03').eq('amount_idr',3459324).single();
await supabase.from('ledger').update({description:'TRIPCOM — hotel Singapore (patungan; diganti Herlina 1.750.000 + Henny 1.750.000 tgl 3 Ags)'}).eq('id',t.id);
console.log('- TRIPCOM 3.459.324 dicatat sbg pasangannya, entitas',t.entity);
console.log('\n=== rekonsiliasi SDC 9.557.680 — utuh sampai rupiah ===');
const pos=[['Alice Dental 15 Jan',3215930],['Microsoft 365 16 Feb',1950000],['Internet 7 Mar',5147838],['Internet 20 Jan (tagihan di staging Des)',387390]];
let s=0;for(const[k,v]of pos){s+=v;console.log(`  + ${k.padEnd(42)} ${rp(v).padStart(11)}`);}
const neg=[['Siti Sarnah (keluar 2jt, masuk baru 1jt)',1000000],['Global Digital vs Ricky Susanto',187000],['pembulatan TRIPCOM',40676],['pembulatan setoran 20 Jul',2846]];
let n=0;for(const[k,v]of neg){n+=v;console.log(`  − ${k.padEnd(42)} ${rp(v).padStart(11)}`);}
console.log(`  ${''.padEnd(44)} ${rp(s-n).padStart(11)}  (piutang SDC tercatat 9.557.680)`);
process.exit(0);})();
