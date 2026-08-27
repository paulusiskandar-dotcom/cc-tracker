const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,from_id,category_name,description,installment_id').eq('user_id',uid).eq('tx_type','expense').ilike('description','%tokopedia%').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('baris Tokopedia di ledger:',led.length,'=',rp(led.reduce((s,r)=>s+ +r.amount_idr,0)));
console.log('\nuji cocok: email checkout 29 Jan Rp 4.070.489');
for(const r of led.filter(r=>Math.abs(+r.amount_idr-4070489)<3000))console.log(`  COCOK → ${r.tx_date} ${rp(r.amount_idr)} ${nm(r.from_id)} kat=${r.category_name}`);
console.log('\nuji cocok: 28 Jan Rp 995.604 · 27 Jan Rp 6.355.500 · 29 Jan Rp 5.291.000');
for(const a of [995604,6355500,5291000]){const h=led.filter(r=>Math.abs(+r.amount_idr-a)<3000);
  console.log(`  ${rp(a).padStart(10)} → ${h.length?h.map(r=>r.tx_date+' '+nm(r.from_id)+(r.installment_id?' (cicilan)':'')).join(', '):'tidak ada baris tunggal (mungkin dipecah cicilan)'}`);}
console.log('\nsebaran nominal baris Tokopedia (utk gambaran):');
for(const r of led.slice(0,6))console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id)}`);
console.log('per bulan:');const m={};led.forEach(r=>{const k=r.tx_date.slice(0,7);m[k]=m[k]||{n:0,t:0};m[k].n++;m[k].t+= +r.amount_idr;});
for(const[k,v]of Object.entries(m).sort())console.log(`  ${k}: ${String(v.n).padStart(3)} baris ${rp(v.t).padStart(13)}`);
process.exit(0);})();
