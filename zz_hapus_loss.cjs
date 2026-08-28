// Paulus 2026-08-28: "reimbursable loss kita hilangkan aj. Siti sarnah kita bikin
// 1 jutanya jadi ke family aj. expense".
//  - Siti Sarnah 1.000.000 → kategori Family (sumber tetap Piutang SDC supaya kas
//    tidak terhitung keluar dua kali; uangnya sudah keluar 3 Jul).
//  - 6 baris residu batch bersisi tunggal → dihapus. Fee Paper yang dulu masuk sini
//    kini sudah dipecah di sumbernya (Bank & Card Fees), jadi membiarkannya = dobel.
//  - Kategori Reimbursable Loss dihapus setelah kosong.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const loss=cats.find(c=>c.name==='Reimbursable Loss'), fam=cats.find(c=>c.name==='Family');
const{data:rows}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('category_name','Reimbursable Loss').order('tx_date');
const siti=(rows||[]).find(r=>/Siti Sarnah/i.test(r.description||''));
const residu=(rows||[]).filter(r=>r.id!==siti?.id);
console.log('Siti Sarnah →',siti?rp(siti.amount_idr)+' jadi kategori Family':'TIDAK KETEMU');
console.log(`residu dihapus: ${residu.length} baris, ${rp(residu.reduce((s,r)=>s+ +r.amount_idr,0))}`);
for(const r of residu)console.log(`   ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${r.entity}`);
// cek pemakaian kategori di tabel lain sebelum dihapus
const{count:ci}=await supabase.from('installments').select('id',{count:'exact',head:true}).eq('expense_category_id',loss.id);
const{count:cl}=await supabase.from('ledger').select('id',{count:'exact',head:true}).eq('category_id',loss.id);
console.log(`\npemakaian kategori: installments ${ci||0} | ledger(category_id) ${cl||0}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/hapus-loss-${Date.now()}.json`,JSON.stringify(rows,null,2));
if(siti)await supabase.from('ledger').update({category_id:fam.id,category_name:'Family',entity:'Personal',
  description:'Siti Sarnah — sisa 1jt talangan yang tidak diganti SDC'}).eq('id',siti.id);
for(const r of residu)await supabase.from('ledger').delete().eq('id',r.id);
const{count:sisa}=await supabase.from('ledger').select('id',{count:'exact',head:true}).eq('user_id',uid).eq('category_id',loss.id);
console.log(`\n- Siti Sarnah → Family\n- ${residu.length} residu dihapus\n- baris tersisa memakai kategori: ${sisa||0}`);
if((sisa||0)===0){
  const{error}=await supabase.from('expense_categories').delete().eq('id',loss.id);
  console.log(error?'  !! kategori gagal dihapus: '+error.message:'- kategori "Reimbursable Loss" DIHAPUS');
}
process.exit(0);})();
