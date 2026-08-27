const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const fxIds=new Set(accounts.filter(a=>a.currency&&a.currency!=='IDR').map(a=>a.id));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount,amount_idr,currency,from_id,from_type').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const bad=led.filter(r=>r.tx_type==='expense'&&fxIds.has(r.from_id)&&r.from_type==='account'&&r.currency!=='IDR'&&Math.abs(+r.amount_idr-+r.amount)<1);
// kurs BERSUMBER dari catatannya sendiri
const K={JPY:107.24,SGD:13352,EUR:19410.55};
const per={};
for(const r of bad){const m=r.tx_date.slice(0,7);per[m]=per[m]||{now:0,fix:0,n:0};
  per[m].now+= +r.amount_idr;per[m].fix+=(+r.amount)*(K[r.currency]||0);per[m].n++;}
console.log('baris terdampak:',bad.length);
console.log('\nbulan   | baris | tercatat skrg | seharusnya  | selisih');
for(const[m,v]of Object.entries(per).sort())console.log(` ${m} | ${String(v.n).padStart(5)} | ${rp(v.now).padStart(13)} | ${rp(v.fix).padStart(11)} | +${rp(v.fix-v.now)}`);
const T=Object.values(per).reduce((s,v)=>({now:s.now+v.now,fix:s.fix+v.fix}),{now:0,fix:0});
console.log(` TOTAL   |       | ${rp(T.now).padStart(13)} | ${rp(T.fix).padStart(11)} | +${rp(T.fix-T.now)}`);
const byc={};bad.forEach(r=>{byc[r.currency]=(byc[r.currency]||0)+ +r.amount;});
console.log('\nper mata uang:');for(const[c,v]of Object.entries(byc))console.log(`  ${c} ${rp(v).padStart(9)} × ${K[c]} = Rp ${rp(v*K[c])}`);
// dampak thd total expense bulanan
const isExp=r=>r.tx_type==='expense'||r.tx_type==='pay_liability';
for(const m of Object.keys(per).sort()){const tot=led.filter(r=>r.tx_date.slice(0,7)===m&&isExp(r)).reduce((s,r)=>s+ +r.amount_idr,0);
  console.log(` ${m}: total expense skrg ${rp(tot)} → ${rp(tot+per[m].fix-per[m].now)} (naik ${(100*(per[m].fix-per[m].now)/tot).toFixed(1)}%)`);}
process.exit(0);})();
