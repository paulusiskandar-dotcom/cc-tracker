const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const div=(srcs||[]).find(s=>s.name==='Dividend');
console.log('=== dividen Hamasa yang SUDAH tercatat ===');
const{data:d}=await supabase.from('ledger').select('tx_date,amount_idr,to_id,entity,description').eq('user_id',uid).eq('tx_type','income').eq('from_id',div?.id).gte('amount_idr',10000000).order('tx_date');
let t=0;for(const r of d||[]){t+= +r.amount_idr;console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(13)} entity=${(r.entity||'-').padEnd(8)} → ${nm(r.to_id).padEnd(8)} | ${(r.description||'').slice(0,44)}`);}
console.log(`  subtotal tercatat: ${rp(t)}`);
console.log('\n=== ditambah pasangan 11 Maret ===');
console.log(`  2026-03-11    52.000.000  transfer dari Judha Djohari → BCA IDR`);
console.log(`  2026-03-11    48.000.000  setoran tunai → BCA R`);
console.log(`  jumlah tahap ini: ${rp(100000000)}`);
console.log(`\n  TOTAL DIVIDEN: ${rp(t+100000000)}`);
console.log(`  angka di sheet Piutang: 479.000.000`);
console.log(`  selisih: ${rp(t+100000000-479000000)}`);
console.log('\n=== rincian empat tahap + tahap Maret ===');
const tahap=[['23 Feb',79000000],['25 Feb',100000000],['11 Mar',100000000],['7 Apr',100000000],['27 Apr',100000000]];
let s=0;for(const[k,v]of tahap){s+=v;console.log(`  ${k.padEnd(8)} ${rp(v).padStart(13)}   kumulatif ${rp(s).padStart(13)}`);}
process.exit(0);})();
