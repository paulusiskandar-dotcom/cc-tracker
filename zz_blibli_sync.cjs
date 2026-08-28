const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:one}=await supabase.from('email_sync').select('*').eq('user_id',uid).limit(1).single();
console.log('kolom email_sync:',Object.keys(one||{}).join(', '));
for(const q of ['blibli','paper','klikbca','ocbc']){
  const{count}=await supabase.from('email_sync').select('id',{count:'exact',head:true}).eq('user_id',uid).ilike('sender','%'+q+'%');
  console.log(`  pengirim mengandung "${q}": ${count||0} email`);
}
const{data:s}=await supabase.from('email_sync').select('sender').eq('user_id',uid).limit(400);
const c={};for(const r of s||[])c[r.sender]=(c[r.sender]||0)+1;
console.log('\npengirim yang terbaca sync (contoh 400 terakhir):');
for(const[k,v]of Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,14))console.log(`  ${String(v).padStart(4)}  ${k}`);
process.exit(0);})();
