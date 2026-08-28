// Baris fee Paper berpotensi DOBEL: zz_paper_loss.cjs (source=paper-csv) membuat
// baris Loss bersisi tunggal, lalu zz_split_uji.cjs memecah tagihan dan membuat
// baris fee dua sisi (source=paper-split) sambil menghapus Loss lama. Yang lolos
// dari penghapusan = biaya terhitung DUA KALI.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
const{data:csv}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('source','paper-csv');
const{data:split}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('source','paper-split');
console.log(`baris paper-csv (Loss lama): ${(csv||[]).length} | paper-split (fee baru): ${(split||[]).length}`);
const dobel=[];
for(const c of csv||[]){
  const s=(split||[]).find(x=>x.tx_date===c.tx_date&&Math.abs(+x.amount_idr-+c.amount_idr)<=2);
  if(s)dobel.push({c,s});
}
console.log(`\nDOBEL (ada di kedua sumber, tanggal & nilai sama): ${dobel.length}`);
for(const d of dobel)console.log(`  ${d.c.tx_date} ${rp(d.c.amount_idr).padStart(10)} | lama ${d.c.id.slice(0,8)} (${d.c.category_name}, ${nm(d.c.from_id)}) vs baru ${d.s.id.slice(0,8)} (${d.s.category_name}, ${nm(d.s.from_id)})`);
const sisa=(csv||[]).filter(c=>!dobel.some(d=>d.c.id===c.id));
console.log(`\npaper-csv yang TIDAK dobel (tetap dipertahankan): ${sisa.length}`);
for(const c of sisa)console.log(`  ${c.tx_date} ${rp(c.amount_idr).padStart(10)} ${c.entity} | ${(c.description||'').slice(0,44)}`);
console.log(`\nbiaya terhitung dua kali: ${rp(dobel.reduce((s,d)=>s+ +d.c.amount_idr,0))}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/fee-dobel-${Date.now()}.json`,JSON.stringify(dobel.map(d=>d.c),null,2));
for(const d of dobel)await supabase.from('ledger').delete().eq('id',d.c.id);
console.log(`\n- ${dobel.length} baris Loss dobel dihapus`);
process.exit(0);})();
