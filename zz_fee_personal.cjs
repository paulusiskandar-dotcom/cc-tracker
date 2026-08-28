// Baris fee hasil migrasi manual mewarisi entity induknya (Hamasa/SDC), padahal
// aturan tetap: "expense SELALU Personal" — fee itu biaya Paulus sendiri. Kode baru
// (ledgerApi.create) sudah menulis Personal; samakan yang lama supaya konsisten.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:rows}=await supabase.from('ledger').select('id,tx_date,amount_idr,entity,category_name').eq('user_id',uid).eq('source','paper-split');
const per={};for(const r of rows||[])per[r.entity]=(per[r.entity]||0)+1;
console.log('baris paper-split:',(rows||[]).length,'| entity:',JSON.stringify(per));
const salah=(rows||[]).filter(r=>r.entity!=='Personal');
if(!salah.length){console.log('sudah semua Personal');process.exit(0);}
for(const r of salah)await supabase.from('ledger').update({entity:'Personal'}).eq('id',r.id);
console.log(`- ${salah.length} baris fee → entity Personal (${rp(salah.reduce((s,r)=>s+ +r.amount_idr,0))})`);
const{data:kat}=await supabase.from('ledger').select('category_name').eq('user_id',uid).eq('source','paper-split');
const k={};for(const r of kat||[])k[r.category_name]=(k[r.category_name]||0)+1;
console.log('  kategori:',JSON.stringify(k));
process.exit(0);})();
