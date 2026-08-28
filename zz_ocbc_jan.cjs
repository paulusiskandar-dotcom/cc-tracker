const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const oc=accounts.find(a=>a.name==='OCBC 90N');
let st=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger_staging').select('tx_date,amount,direction,description,status').eq('user_id',uid).eq('account_id',oc.id).order('tx_date').range(off,off+999);st=st.concat(c||[]);if(!c||c.length<1000)break;}
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,tx_type,description').eq('user_id',uid).eq('from_id',oc.id).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('OCBC 90N — staging',st.length,'baris | ledger',led.length,'baris');
const bl={};for(const r of st){const m=r.tx_date.slice(0,7);bl[m]=(bl[m]||0)+1;}
console.log('\nstaging per bulan:');for(const[m,n]of Object.entries(bl).sort())console.log(`  ${m}  ${n}`);
const bl2={};for(const r of led){const m=r.tx_date.slice(0,7);bl2[m]=(bl2[m]||0)+1;}
console.log('\nledger per bulan:');for(const[m,n]of Object.entries(bl2).sort())console.log(`  ${m}  ${n}`);
console.log('\n=== SEMUA baris OCBC 90N 15 Des – 31 Jan ===');
const win=[...st.filter(r=>r.tx_date>='2025-12-15'&&r.tx_date<='2026-01-31').map(r=>({d:r.tx_date,a:+r.amount,x:r.description,s:'staging/'+r.status})),
           ...led.filter(r=>r.tx_date>='2025-12-15'&&r.tx_date<='2026-01-31').map(r=>({d:r.tx_date,a:+r.amount_idr,x:r.description,s:'ledger'}))]
  .sort((p,q)=>p.d<q.d?-1:1);
for(const r of win)console.log(`  ${r.d} ${rp(r.a).padStart(12)} ${r.s.padEnd(18)} | ${(r.x||'').slice(0,50)}`);
process.exit(0);})();
