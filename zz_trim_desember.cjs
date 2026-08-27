// KOREKSI RUANG LINGKUP (Paulus 27/8): buku mulai 1 JANUARI 2026.
// Desember 2025 hanya pelengkap/penyambung (mis. periode statement CC), BUKAN transaksi.
// Aksi: hapus baris ledger source='backfill' tx_date < 2026-01-01, lalu geser initial_balance
// tiap akun terdampak supaya SALDO HARI INI tidak berubah sesenpun.
// Staging Des ditandai status 'rejected' agar tidak ikut ter-connect nanti.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const CUT='2026-01-01';

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const val=a=>a.type==='credit_card'?Number(a.outstanding_amount):a.type==='asset'?Number(a.current_value):Number(a.current_balance);

// baris backfill sebelum 1 Jan
let rows=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('id,tx_date,amount,tx_type,description,from_id,from_type,to_id,to_type,fx_rate_used').eq('user_id',uid).eq('source','backfill').lt('tx_date',CUT).order('id').range(off,off+999);
  rows=rows.concat(c||[]);if(!c||c.length<1000)break;}
console.log('baris ledger backfill < 1 Jan 2026:',rows.length);
const per={};
for(const r of rows){
  const k=nm(r.from_type==='account'?r.from_id:r.to_id);
  per[k]=(per[k]||0)+1;
  if(r.from_type==='account'&&r.to_type==='account'){const k2=nm(r.to_id);if(k2!==k)per[k2]=(per[k2]||0)+1;}
}
console.log(' per akun:',JSON.stringify(per));
// saldo SEBELUM (target yang harus dipertahankan)
const before={};for(const a of accounts)before[a.id]=val(a);
if(!APPLY){
  console.log('\ncontoh baris yang akan dihapus:');
  for(const r of rows.slice(0,10))console.log('  ',r.tx_date,rp(r.amount).padStart(14),(r.tx_type||'').padEnd(12),nm(r.from_id),'→',nm(r.to_id),'|',(r.description||'').slice(0,45));
  const{count}=await supabase.from('ledger_staging').select('id',{count:'exact',head:true}).eq('user_id',uid).lt('tx_date',CUT).eq('status','staged');
  console.log('\nstaging < 1 Jan yang masih "staged" (akan ditandai rejected):',count);
  console.log('(dry-run)');process.exit(0);
}
fs.writeFileSync('.backups/zz_trim_des_'+Date.now()+'.json',JSON.stringify({rows,accounts:accounts.map(a=>({id:a.id,name:a.name,initial_balance:a.initial_balance,val:val(a)}))}));

// hapus
const touched=new Set();
for(const r of rows){
  if(r.from_type==='account'&&r.from_id)touched.add(r.from_id);
  if(r.to_type==='account'&&r.to_id)touched.add(r.to_id);
  await supabase.from('ledger').delete().eq('id',r.id);
}
console.log('dihapus:',rows.length,'baris | akun tersentuh:',touched.size);
// recalc lalu koreksi initial agar saldo kembali seperti semula
for(const id of touched)await recalculateBalance(id,uid);
const{data:mid}=await supabase.from('accounts').select('id,name,type,initial_balance,current_balance,current_value,outstanding_amount').in('id',[...touched]);
for(const a of mid){
  const now=a.type==='credit_card'?Number(a.outstanding_amount):a.type==='asset'?Number(a.current_value):Number(a.current_balance);
  const diff=before[a.id]-now;
  if(Math.abs(diff)<0.005)continue;
  // CC: outstanding naik = initial naik; lainnya: saldo naik = initial naik
  const ni=Number(a.initial_balance)+diff;
  await supabase.from('accounts').update({initial_balance:ni}).eq('id',a.id);
  console.log('  initial',a.name.padEnd(28),rp(a.initial_balance),'→',rp(ni),'(jaga saldo',rp(before[a.id])+')');
}
for(const id of touched)await recalculateBalance(id,uid);
// verifikasi
const{data:after}=await supabase.from('accounts').select('id,name,type,current_balance,current_value,outstanding_amount').in('id',[...touched]);
let fail=null;
for(const a of after){
  const v=a.type==='credit_card'?Number(a.outstanding_amount):a.type==='asset'?Number(a.current_value):Number(a.current_balance);
  const ok=Math.abs(v-before[a.id])<=0.02;
  if(!ok){fail=a.name;console.log('  ✗',a.name,rp(v),'≠',rp(before[a.id]));}
}
console.log(fail?'!! ADA YANG BERGESER: '+fail:'✓ semua saldo hari ini IDENTIK seperti sebelum trim');
// staging Des → rejected
const{data:sd}=await supabase.from('ledger_staging').select('id').eq('user_id',uid).lt('tx_date',CUT).eq('status','staged');
for(let i=0;i<(sd||[]).length;i+=100){
  const ids=sd.slice(i,i+100).map(x=>x.id);
  await supabase.from('ledger_staging').update({status:'rejected'}).in('id',ids);
}
console.log('staging Des ditandai rejected:',(sd||[]).length);
process.exit(0);
})();
