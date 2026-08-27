const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const RE=/GOJEK|GOPAY|GO-?PAY|GRAB/i;
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const fd=(cats||[]).find(c=>c.name==='Food & Dining');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,category_name,description').eq('user_id',uid).in('tx_type',['expense','pay_liability']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const h=led.filter(r=>RE.test(r.description||''));
console.log(`Gojek / GoPay / Grab: ${h.length} baris = ${rp(h.reduce((s,r)=>s+ +r.amount_idr,0))}\n`);
const g={};h.forEach(r=>{const k=r.category_name||'(tanpa)';g[k]=g[k]||{n:0,t:0};g[k].n++;g[k].t+= +r.amount_idr;});
console.log('kategori sekarang:');
for(const[k,v]of Object.entries(g).sort((a,b)=>b[1].t-a[1].t))console.log(`  ${k.padEnd(24)} ${String(v.n).padStart(3)} baris ${rp(v.t).padStart(12)}`);
const perlu=h.filter(r=>r.category_name!=='Food & Dining');
console.log(`\nakan dipindah ke Food & Dining: ${perlu.length} baris ${rp(perlu.reduce((s,r)=>s+ +r.amount_idr,0))}`);
if(!APPLY){console.log('[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/gojek_${Date.now()}.json`,JSON.stringify(perlu,null,1));
let ok=0;
for(const r of perlu){const{error}=await supabase.from('ledger').update({category_id:fd.id,category_name:fd.name}).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${perlu.length}`);
process.exit(0);})();
