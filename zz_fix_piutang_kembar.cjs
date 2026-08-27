// Dua akun piutang kembar (dibuat 26 Agu oleh skrip backfill-ku sendiri, 0 transaksi).
// Bahaya: accountsApi.getAll mengurutkan created_at DESC, dan Dashboard memilih dengan
// receivables.find(r => r.entity === entity) → yang KEMBAR KOSONG yang terpilih duluan.
// Perbaikan: nonaktifkan (is_active=false) — getAll menyaring .neq('is_active',false),
// jadi akun hilang dari app tapi bisa dikembalikan kapan saja.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let acc=await accountsApi.getAll(uid);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('from_id,to_id').eq('user_id',uid).order('id').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const pakai=id=>led.filter(r=>r.to_id===id||r.from_id===id).length;
const rec=acc.filter(a=>a.type==='receivable');
console.log('URUTAN yang dilihat app sekarang (find() ambil yang PERTAMA per entity):');
for(const a of rec)console.log(`  ${a.entity.padEnd(9)} ${String(a.id).slice(0,8)} dibuat ${a.created_at.slice(0,10)} · ${pakai(a.id)} transaksi`);
for(const e of ['Hamasa','SDC','Personal']){
  const pick=rec.find(r=>r.entity===e); if(!pick)continue;
  console.log(`  → entity ${e.padEnd(9)} terpilih ${String(pick.id).slice(0,8)} (${pakai(pick.id)} transaksi) ${pakai(pick.id)===0?'⚠ SALAH — yang kosong':'✓'}`);
}
const buang=rec.filter(a=>pakai(a.id)===0);
console.log(`\nakan dinonaktifkan: ${buang.length} akun tanpa transaksi`);
for(const a of buang)console.log(`  ${a.name} ${String(a.id).slice(0,8)} dibuat ${a.created_at.slice(0,10)}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/piutang_kembar_${Date.now()}.json`,JSON.stringify(buang,null,1));
for(const a of buang){
  const{error}=await supabase.from('accounts').update({is_active:false}).eq('id',a.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`dinonaktifkan: ${a.name} ${String(a.id).slice(0,8)}`);
}
acc=await accountsApi.getAll(uid);
const rec2=acc.filter(a=>a.type==='receivable');
console.log('\nSESUDAH — yang akan dipilih app:');
for(const e of ['Hamasa','SDC','Personal']){
  const pick=rec2.find(r=>r.entity===e);
  console.log(`  ${e.padEnd(9)} ${pick?String(pick.id).slice(0,8)+' ('+pakai(pick.id)+' transaksi) '+(pakai(pick.id)>0?'✓':'⚠'):'TIDAK ADA ⚠'}`);
}
process.exit(0);})();
