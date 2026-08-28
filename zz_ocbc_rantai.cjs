const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
// tagihan tercetak tiap tanggal 12 (dari PDF statement)
const TAGIHAN={'2026-01-12':139708330,'2026-02-12':92899602,'2026-03-12':133740871,'2026-04-12':137611851,
               '2026-05-12':139898374,'2026-06-12':119398393,'2026-07-12':72583925,'2026-08-12':72343457};
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const oc=accounts.find(a=>a.name==='OCBC 90N');
let rows=[];
for(const col of['from_id','to_id']){
  let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,description').eq('user_id',uid).eq(col,oc.id).order('tx_date').range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
  for(const r of all)rows.push({...r,arah:col==='from_id'?1:-1});
}
rows.sort((a,b)=>a.tx_date<b.tx_date?-1:1);
console.log('anggap saldo 12 Jan = 139.708.330 (dari statement), lalu jalan dari ledger:\n');
console.log('  tutup buku      dihitung dari ledger      tagihan tercetak        selisih');
let saldo=139708330;
const tgl=Object.keys(TAGIHAN).sort();
for(let i=1;i<tgl.length;i++){
  const d0=tgl[i-1],d1=tgl[i];
  for(const r of rows.filter(r=>r.tx_date>d0&&r.tx_date<=d1)) saldo+=r.arah*(+r.amount_idr);
  const diff=saldo-TAGIHAN[d1];
  console.log(`  ${d1}   ${rp(saldo).padStart(18)}   ${rp(TAGIHAN[d1]).padStart(18)}   ${(Math.abs(diff)<1?'✓ cocok':rp(diff)).padStart(16)}`);
}
console.log('\nsetelah 12 Agu:');
let sisa=saldo;
for(const r of rows.filter(r=>r.tx_date>'2026-08-12')){sisa+=r.arah*(+r.amount_idr);
  console.log(`  ${r.tx_date} ${(r.arah>0?'+':'−')}${rp(r.amount_idr).padStart(12)} ${r.tx_type.padEnd(13)} | ${(r.description||'').slice(0,40)}`);}
console.log('  saldo akhir dihitung:',rp(sisa));
console.log('\n  initial_balance tersimpan:',rp(oc.initial_balance),'— dipakai app sbg titik awal');
process.exit(0);})();
