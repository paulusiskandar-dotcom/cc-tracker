const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
console.log('sumber pendapatan:',(srcs||[]).map(s=>s.name).join(', '));
const{data:lain}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).eq('tx_type','income').ilike('description','%Listrik%').order('tx_date');
console.log('\n=== baris listrik SDC yang sudah ada (utk menyamakan bentuk) ===');
for(const r of lain||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} sumber=${(srcs.find(s=>s.id===r.from_id)?.name)||'-'} kat=${r.category_name||'-'} | ${(r.description||'').slice(0,44)}`);

let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,to_type,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}

console.log('\n=== Microsoft 365: semua tagihan Tokopedia/Lazada Des–Feb, 1jt–3jt ===');
for(const r of led.filter(r=>/TOKOPEDIA|LAZADA/i.test(r.description||'')&&+r.amount_idr>=1000000&&+r.amount_idr<=3000000&&r.tx_date>='2025-12-01'&&r.tx_date<='2026-02-29'))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id).padEnd(14)} kat=${(r.category_name||'-').padEnd(22)} | ${(r.description||'').slice(0,34)}`);
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,account_id,status').eq('user_id',uid).gte('tx_date','2025-12-01').lte('tx_date','2026-02-29').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
console.log('\n  -- di staging (semua status), Tokopedia/Lazada 1jt–3jt:');
for(const r of st.filter(r=>/TOKOPEDIA|LAZADA/i.test(r.description||'')&&+r.amount>=1000000&&+r.amount<=3000000))
  console.log(`     ${r.tx_date} ${rp(r.amount).padStart(11)} ${r.direction} ${nm(r.account_id).padEnd(14)} ${r.status} | ${(r.description||'').slice(0,38)}`);

console.log('\n=== Alice Dental 3.215.930 (masuk 15 Jan): SEMUA uang keluar 3,1–3,3jt, 1 Des–31 Jan ===');
for(const r of led.filter(r=>+r.amount_idr>=3100000&&+r.amount_idr<=3300000&&r.to_type!=='account'&&r.tx_date>='2025-12-01'&&r.tx_date<='2026-01-31'))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id).padEnd(14)} kat=${(r.category_name||'-').padEnd(22)} | ${(r.description||'').slice(0,34)}`);
console.log('  -- di staging:');
for(const r of st.filter(r=>+r.amount>=3100000&&+r.amount<=3300000&&r.direction==='out'))
  console.log(`     ${r.tx_date} ${rp(r.amount).padStart(11)} ${nm(r.account_id).padEnd(14)} ${r.status} | ${(r.description||'').slice(0,42)}`);

if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
const{data:mar}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-03-07').eq('amount_idr',5147838).single();
const src=(srcs||[]).find(s=>s.id===(lain||[])[0]?.from_id);
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/listrik-mar-${Date.now()}.json`,JSON.stringify(mar,null,2));
await supabase.from('ledger').update({tx_type:'income',entity:'Personal',from_type:src?'income_source':null,from_id:src?.id||null,
  reimburse_settlement_id:null,category_name:(lain||[])[0]?.category_name||null,
  description:'SAHABAT DENTAL CEM Listrik Maret (keterangan transfer salah tertulis "Internet" oleh Lieche)'}).eq('id',mar.id);
console.log(`\n- 5.147.838 (7 Mar) jadi income listrik SDC, sumber ${src?.name||'(kosong)'}`);
let l2=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);l2=l2.concat(x||[]);if(!x||x.length<1000)break;}
const e={};for(const q of l2){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
process.exit(0);})();
