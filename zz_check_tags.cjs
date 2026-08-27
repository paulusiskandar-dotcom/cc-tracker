const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:tags}=await supabase.from('tags').select('id,name,start_date,end_date').eq('user_id',uid);
console.log('tags:',(tags||[]).map(t=>`${t.name} [${t.start_date}..${t.end_date}]`).join(' | '));
const{data:lt}=await supabase.from('ledger_tags').select('ledger_id,tag_id').limit(2000);
console.log('ledger_tags rows:',(lt||[]).length);
const ids=['2026-03-27','2026-03-30','2026-03-31','2026-06-04','2026-06-05','2026-06-09'];
const{data:rows}=await supabase.from('ledger').select('id,tx_date,amount_idr,description').eq('user_id',uid).eq('tx_type','income').in('tx_date',ids);
const tagged=new Set((lt||[]).map(x=>x.ledger_id));
for(const r of (rows||[]).filter(r=>/globalblue|osaka/i.test(r.description||'')))
  console.log(` ${r.tx_date} ${Math.round(r.amount_idr).toLocaleString('id-ID').padStart(10)} tag:${tagged.has(r.id)?'ADA':'TIDAK'} | ${(r.description||'').slice(0,40)}`);
process.exit(0);})();
