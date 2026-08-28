// Sisa pembersihan Loss/Surplus:
//  1. Fee Paper Lieche 776.000 (paper-csv, entity Hamasa) — DUPLIKAT dari baris
//     Bank & Card Fees 776.000 di CIMB ALL yang sudah dua sisi. Hapus.
//  2. Siti Sarnah 1.000.000 (SDC) — kerugian piutang SUNGGUHAN, tapi bersisi
//     tunggal. Diberi lawan: kredit ke akun Piutang SDC (Dr Kerugian / Cr Piutang).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
const pSDC=acc.find(x=>x.name==='Piutang SDC');
// 1) Lieche: pastikan benar-benar ada pasangan dua sisi sebelum menghapus
const{data:lie}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-08-01').eq('amount_idr',776000);
console.log('baris 776.000 tanggal 1 Agu:',(lie||[]).length);
for(const r of lie||[])console.log(`  ${r.id.slice(0,8)} src=${(r.source||'-').padEnd(11)} kat=${(r.category_name||'-').padEnd(20)} ${nm(r.from_id)} ent=${r.entity}`);
const duaSisi=(lie||[]).filter(r=>r.from_id), tunggal=(lie||[]).filter(r=>!r.from_id);
console.log(`  dua sisi: ${duaSisi.length} | bersisi tunggal: ${tunggal.length}`);
// 2) Siti Sarnah
const{data:ss}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-08-26').eq('amount_idr',1000000).eq('entity','SDC').single();
console.log(`\nSiti Sarnah: ${ss.id.slice(0,8)} ${ss.tx_type} kat=${ss.category_name} sumber=${ss.from_id?nm(ss.from_id):'KOSONG'}`);
console.log(`  akan diberi sumber: ${pSDC.name} (kredit piutang)`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/beres3-${Date.now()}.json`,JSON.stringify({lie,ss},null,2));
if(duaSisi.length===1&&tunggal.length===1){
  await supabase.from('ledger').delete().eq('id',tunggal[0].id);
  console.log(`- Lieche 776.000 bersisi tunggal dihapus (duplikat dari baris CIMB ALL)`);
} else console.log('- Lieche: bentuk tak sesuai dugaan, TIDAK disentuh');
await supabase.from('ledger').update({from_type:'account',from_id:pSDC.id,
  description:'Siti Sarnah — kerugian piutang SDC (sisa 1jt dari talangan 2jt tidak tertagih)'}).eq('id',ss.id);
console.log('- Siti Sarnah jadi dua sisi: beban ← Piutang SDC');
const{data:sisaL}=await supabase.from('ledger').select('id,amount_idr,from_id').eq('user_id',uid).eq('category_name','Reimbursable Loss');
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sur=srcs.find(s=>s.name==='Reimbursable Surplus');
const{data:sisaS}=await supabase.from('ledger').select('id,amount_idr,to_id').eq('user_id',uid).eq('from_id',sur.id);
console.log(`\nsisa Loss: ${(sisaL||[]).length} baris ${rp((sisaL||[]).reduce((s,r)=>s+ +r.amount_idr,0))} (bersisi tunggal: ${(sisaL||[]).filter(r=>!r.from_id).length})`);
console.log(`sisa Surplus: ${(sisaS||[]).length} baris ${rp((sisaS||[]).reduce((s,r)=>s+ +r.amount_idr,0))} (bersisi tunggal: ${(sisaS||[]).filter(r=>!r.to_id).length})`);
process.exit(0);})();
