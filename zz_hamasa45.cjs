const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,reimburse_settlement_id,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).eq('entity','Hamasa').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const g={};
for(const r of led){const k=r.reimburse_settlement_id?r.reimburse_settlement_id.slice(0,8):'BUKA';
  g[k]=g[k]||{o:0,i:0,n:0,d0:'9',d1:'0'};g[k][r.tx_type==='reimburse_out'?'o':'i']+= +r.amount_idr;g[k].n++;
  if(r.tx_date<g[k].d0)g[k].d0=r.tx_date; if(r.tx_date>g[k].d1)g[k].d1=r.tx_date;}
console.log('=== per cap pelunasan (yang tidak nol = sumber selisih) ===');
let tot=0;
for(const[k,v]of Object.entries(g).sort((a,b)=>Math.abs(b[1].o-b[1].i)-Math.abs(a[1].o-a[1].i))){
  const d=v.o-v.i; tot+=d;
  if(Math.abs(d)>1)console.log(`  ${k}  ${String(v.n).padStart(3)} baris  ${v.d0}→${v.d1}  keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  selisih ${rp(d).padStart(14)}`);
}
console.log('  total selisih:',rp(tot));
console.log('\n=== isi cap historis 014ccdfa (31 Mar) — cap terbesar ===');
const hist=led.filter(r=>r.reimburse_settlement_id&&r.reimburse_settlement_id.startsWith('014ccdfa'));
const bl={};for(const r of hist){const m=r.tx_date.slice(0,7);bl[m]=bl[m]||{o:0,i:0};bl[m][r.tx_type==='reimburse_out'?'o':'i']+= +r.amount_idr;}
let k2=0;for(const[m,v]of Object.entries(bl).sort()){k2+=v.o-v.i;
  console.log(`  ${m}  keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  selisih ${rp(v.o-v.i).padStart(14)}  kumulatif ${rp(k2).padStart(14)}`);}
process.exit(0);})();
