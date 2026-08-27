// 1) Buat income source "Utility Income" & pindahkan kredit listrik SDC ke sana (tetap pendapatan).
// 2) Dua Amazon JPY 4.900 & 500 → game Switch (Hobbies & Entertainment).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(?)';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,from_id,to_id,entity,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
// kredit listrik dari SDC (income, deskripsi menyebut listrik)
const lis=led.filter(r=>r.tx_type==='income'&&/listrik/i.test(r.description||''));
console.log('=== kredit listrik yang akan pindah ke "Utility Income" ===');
for(const r of lis)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} src=${sname(r.from_id).padEnd(10)} → ${nm(r.to_id)} | ${(r.description||'').slice(0,50)}`);
console.log(`  total ${rp(lis.reduce((s,r)=>s+ +r.amount_idr,0))} dari ${lis.length} baris`);
// dua Amazon
const jp=r=>{const m=(r.description||'').match(/JPY\s*([\d.,]+)/i);return m?Math.round(parseFloat(m[1].replace(/[.,]/g,''))):null;};
const az=led.filter(r=>r.tx_type==='expense'&&/AMAZON\.CO\.JP/i.test(r.description||'')&&[4900,500].includes(jp(r)));
console.log('\n=== dua Amazon → game Switch ===');
for(const r of az)console.log(`  ${r.tx_date} JPY ${jp(r)} = ${rp(r.amount_idr)} ${r.category_name} → Hobbies & Entertainment`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
let ui=(srcs||[]).find(s=>s.name==='Utility Income');
if(!ui){const{data:baru,error}=await supabase.from('income_sources').insert([{user_id:uid,name:'Utility Income'}]).select('id,name').single();
  if(error){console.log('GAGAL buat source:',error.message);process.exit(1);} ui=baru;console.log('\nsource "Utility Income" dibuat');}
else console.log('\nsource "Utility Income" sudah ada');
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/utility_${Date.now()}.json`,JSON.stringify([...lis,...az],null,1));
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const hob=(cats||[]).find(c=>c.name==='Hobbies & Entertainment');
let ok=0;
for(const r of lis){const{error}=await supabase.from('ledger').update({from_id:ui.id,
  notes:'penggantian listrik dari SDC — pendapatan (Paulus: bukan dividen)'}).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
for(const r of az){const{error}=await supabase.from('ledger').update({category_id:hob.id,category_name:hob.name,
  notes:'game Nintendo Switch (Paulus) — Amazon Jepang'}).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${lis.length+az.length}`);
process.exit(0);})();
