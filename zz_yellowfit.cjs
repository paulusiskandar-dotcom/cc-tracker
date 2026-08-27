const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,category_name,description').eq('user_id',uid).in('tx_type',['expense','pay_liability']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const y=led.filter(r=>/YELLOW ?FIT|YELLOWFIT/i.test(r.description||''));
console.log(`YellowFit: ${y.length} baris = ${rp(y.reduce((s,r)=>s+ +r.amount_idr,0))}\n`);
for(const r of y)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(10)} ${nm(r.from_id).padEnd(12)} kat=${r.category_name}`);
const m={};y.forEach(r=>{const k=r.tx_date.slice(0,7);m[k]=(m[k]||0)+ +r.amount_idr;});
console.log('\nper bulan:');for(const[k,v]of Object.entries(m).sort())console.log(`  ${k} ${rp(v).padStart(10)}`);
console.log('\nsebagai pembanding — Food & Dining dan Health per bulan:');
for(const kat of ['Food & Dining','Health & Personal Care']){
  const g={};led.filter(r=>r.category_name===kat).forEach(r=>{const k=r.tx_date.slice(0,7);g[k]=(g[k]||0)+ +r.amount_idr;});
  console.log(`  ${kat}:`);
  for(const[k,v]of Object.entries(g).sort())console.log(`    ${k} ${rp(v).padStart(12)}`);
}
process.exit(0);})();
