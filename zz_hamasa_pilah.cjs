const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).eq('entity','Hamasa').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const g={};for(const r of led){const k=r.reimburse_settlement_id?r.reimburse_settlement_id.slice(0,8):'BUKA';
  g[k]=g[k]||{o:0,i:0};g[k][r.tx_type==='reimburse_out'?'o':'i']+= +r.amount_idr;}
let hist=0,buka=0,pos=0,neg=0;
for(const[k,v]of Object.entries(g)){const d=v.o-v.i;
  if(k==='014ccdfa')hist=d; else if(k==='BUKA')buka=d; else if(d>0)pos+=d; else neg+=d;}
console.log('=== pilahan piutang Hamasa 45.543.694 ===');
console.log(`  cap historis 31 Mar (Jan–Mar)      ${rp(hist).padStart(14)}`);
console.log(`  masih terbuka (15 Jul–24 Ags)      ${rp(buka).padStart(14)}`);
console.log(`  sisa kurang bayar batch lain       ${rp(pos).padStart(14)}`);
console.log(`  sisa LEBIH bayar batch lain        ${rp(neg).padStart(14)}`);
console.log(`  ${'jumlah'.padEnd(34)} ${rp(hist+buka+pos+neg).padStart(14)}`);
const{data:l}=await supabase.from('ledger').select('amount_idr,entity').eq('user_id',uid).eq('category_name','Reimbursable Loss');
const lossH=(l||[]).filter(r=>r.entity==='Hamasa').reduce((s,r)=>s+ +r.amount_idr,0);
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sur=(srcs||[]).find(s=>s.name==='Reimbursable Surplus');
const{data:s}=await supabase.from('ledger').select('amount_idr,entity,description').eq('user_id',uid).eq('from_id',sur.id);
const surH=(s||[]).filter(r=>/Hamasa/i.test(r.description||'')||r.entity==='Hamasa').reduce((s2,r)=>s2+ +r.amount_idr,0);
console.log(`\n  sudah dibukukan sbg Reimbursable Loss (Hamasa)    ${rp(lossH).padStart(14)}`);
console.log(`  sudah dibukukan sbg Reimbursable Surplus (Hamasa) ${rp(surH).padStart(14)}`);
console.log(`  selisih bersih yg sudah diakui                    ${rp(lossH-surH).padStart(14)}`);
console.log(`\n  → sisa yang BELUM dijelaskan: ${rp(hist+buka+pos+neg-(lossH-surH))}`);
process.exit(0);})();
