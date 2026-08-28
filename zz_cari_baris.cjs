const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const TARGET=[47937677,43556048,10070105,50776000];
let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('email_sync').select('id,subject,sender_email,received_at,ai_raw_result,status').eq('user_id',uid).gte('received_at','2026-08-01').range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
console.log('email_sync sejak 1 Agu:',all.length);
const hit=[];
for(const r of all){
  const txs=Array.isArray(r.ai_raw_result)?r.ai_raw_result:[];
  for(const t of txs){const a=Math.round(Number(t.amount_idr||t.amount||0));
    if(TARGET.some(x=>Math.abs(x-a)<=2))hit.push({id:r.id,d:r.received_at.slice(0,10),subj:(r.subject||'').slice(0,44),a,punya:!!t.paper_split,st:r.status});}
}
console.log('\nbaris email_sync yang nominalnya = tagihan Paper:');
for(const h of hit)console.log(`  ${h.d} ${rp(h.a).padStart(13)} pecahan:${h.punya?'ADA':'belum'} status:${h.st} | ${h.subj}\n     id ${h.id}`);
if(!hit.length)console.log('  (tidak ada — tagihan Paper Agustus mungkin masuk lewat statement, bukan notifikasi email)');
process.exit(0);})();
