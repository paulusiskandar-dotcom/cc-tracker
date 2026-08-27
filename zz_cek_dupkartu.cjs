const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const norm=s=>(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,22);
const dd=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const cc=new Set(accounts.filter(a=>a.type==='credit_card').map(a=>a.id));
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,description,source,created_at').eq('user_id',uid).eq('tx_type','expense').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const ccx=led.filter(r=>cc.has(r.from_id));
console.log('tagihan kartu (expense):',ccx.length);
const pairs=[];
for(let i=0;i<ccx.length;i++)for(let j=i+1;j<ccx.length;j++){
  const a=ccx[i],b=ccx[j];
  if(a.from_id!==b.from_id)continue;
  if(Math.abs(+a.amount_idr-+b.amount_idr)>0.5)continue;
  if(dd(a.tx_date,b.tx_date)>3)continue;
  if(norm(a.description)!==norm(b.description))continue;
  pairs.push([a,b]);
}
console.log('pasangan mirip (kartu sama, nominal sama, ≤3 hari, merchant sama):',pairs.length);
let tot=0;
for(const[a,b]of pairs){tot+= +a.amount_idr;
  console.log(`\n ${rp(a.amount_idr)} ${nm(a.from_id)}`);
  console.log(`   ${a.tx_date} src=${a.source} dibuat ${a.created_at.slice(0,19)} | ${(a.description||'').slice(0,50)}`);
  console.log(`   ${b.tx_date} src=${b.source} dibuat ${b.created_at.slice(0,19)} | ${(b.description||'').slice(0,50)}`);}
console.log('\nnilai pasangan mirip: Rp',rp(tot),'(kalau semuanya duplikat, sebesar itu belanja dihitung dobel)');
process.exit(0);})();
