const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sname=id=>(srcs||[]).find(s=>s.id===id)?.name||'(?)';
console.log('=== 1. baris 171.000 tgl 12 Jan (yg kubilang cashback asli) ===');
const{data:r171}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_name,description,source').eq('user_id',uid).eq('tx_date','2026-01-12');
for(const r of (r171||[]).filter(r=>Math.abs(+r.amount_idr-171000)<1))
  console.log(` ${r.tx_date} ${rp(r.amount_idr)} ${r.tx_type} source=${sname(r.from_id)} → ${nm(r.to_id)} kat=${r.category_name||'(null)'} | ${r.description}`);
console.log('\n=== 2. asal-usul baris Maybank: dari statement kartu mana? ===');
const AMT=[395566,339900,558154,7731514,9693415];
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,description,status,source_file').eq('user_id',uid).gte('tx_date','2026-01-01').lte('tx_date','2026-01-31').order('id').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
for(const a of AMT){
  const h=st.filter(s=>Math.abs(+s.amount-a)<1);
  console.log(` ${rp(a).padStart(11)} → staging: ${h.length?h.map(x=>`${nm(x.account_id)} [${x.status}] ${x.source_file||''}`).join(' | '):'tidak ada di staging'}`);
}
console.log('\n=== 3. tagihan pajak/utilitas yg tersembunyi di Tokopedia ===');
const{data:tp}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).in('tx_date',['2026-01-10','2026-01-19']).ilike('description','%tokopedia%');
for(const r of tp||[])console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(12)} kat=${r.category_name} | ${r.description}`);
console.log('\n=== 4. adakah baris lain 2.385.938 (pajak Henny) di ledger? ===');
const{data:h}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,category_name,description').eq('user_id',uid).gte('amount_idr',2385000).lte('amount_idr',2386500);
for(const r of h||[])console.log(` ${r.tx_date} ${rp(r.amount_idr)} ${r.tx_type} ${nm(r.from_id)} kat=${r.category_name} | ${(r.description||'').slice(0,50)}`);
process.exit(0);})();
