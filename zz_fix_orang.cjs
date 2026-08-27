const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== MAHKOTA BUANA (yang kau tanyakan) ===');
for(const r of led.filter(r=>/MAHKOTA BUANA/i.test(r.description||'')))
  console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(9)} dari ${nm(r.from_id)} kat=${r.category_name} | ${(r.description||'').slice(0,60)}`);
console.log('\n=== ARI PURWANTO / RIKY RESTU ===');
for(const r of led.filter(r=>/ARI PURWANTO|RIKY RESTU|RICKY RESTU/i.test(r.description||'')))
  console.log(` ${r.tx_date} ${rp(r.amount_idr).padStart(11)} dari ${nm(r.from_id)} kat=${r.category_name} | ${(r.description||'').slice(0,55)}`);
console.log('\n=== SISA ISI TRAVEL (cek apakah masih ada yg bukan penginapan/tiket) ===');
const tv=led.filter(r=>r.category_name==='Travel'&&['expense','pay_liability'].includes(r.tx_type));
const by={};tv.forEach(r=>{const k=(r.description||'?').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim().slice(0,26);by[k]=by[k]||{n:0,t:0};by[k].n++;by[k].t+= +r.amount_idr;});
console.log(`total Travel: ${rp(tv.reduce((s,r)=>s+ +r.amount_idr,0))} dari ${tv.length} baris`);
for(const[k,v]of Object.entries(by).sort((a,b)=>b[1].t-a[1].t).slice(0,20))console.log(`  ${rp(v.t).padStart(12)} ${String(v.n).padStart(2)}×  ${k}`);
if(APPLY){
  const jobs=[];
  for(const[re,cat]of [[/ARI PURWANTO/i,'Clothing & Accessories'],[/RIKY RESTU|RICKY RESTU/i,'Electronics & Gadgets']]){
    led.filter(r=>re.test(r.description||'')&&['expense','pay_liability'].includes(r.tx_type)&&r.category_name!==cat).forEach(r=>jobs.push({r,c:C(cat)}));}
  fs.mkdirSync('.backups',{recursive:true});
  fs.writeFileSync(`.backups/orang_${Date.now()}.json`,JSON.stringify(jobs.map(j=>({id:j.r.id,dari:j.r.category_name,ke:j.c.name,amt:j.r.amount_idr})),null,1));
  let ok=0;for(const j of jobs){const{error}=await supabase.from('ledger').update({category_id:j.c.id,category_name:j.c.name}).eq('id',j.r.id).eq('user_id',uid);if(!error)ok++;else console.log('GAGAL',error.message);}
  console.log(`\nditulis ${ok}/${jobs.length} (Ari Purwanto → Clothing, Riky Restu → Electronics)`);
}
process.exit(0);})();
