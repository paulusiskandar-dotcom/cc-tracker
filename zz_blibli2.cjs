const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('email_sync').select('sender_email,subject,email_type,extracted_count,imported_count,received_at').eq('user_id',uid).order('received_at',{ascending:false}).range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
console.log('total email tersinkron:',all.length,'| rentang',all[all.length-1]?.received_at?.slice(0,10),'→',all[0]?.received_at?.slice(0,10));
const c={};for(const r of all)c[r.sender_email]=(c[r.sender_email]||0)+1;
console.log('\npengirim:');
for(const[k,v]of Object.entries(c).sort((a,b)=>b[1]-a[1]))console.log(`  ${String(v).padStart(4)}  ${k}`);
const bl=all.filter(r=>/blibli/i.test(r.sender_email||''));
console.log('\nemail Blibli yang tertelan:',bl.length);
for(const r of bl.slice(0,8))console.log(`  ${r.received_at?.slice(0,10)} ${r.subject?.slice(0,44)} | diekstrak ${r.extracted_count} diimpor ${r.imported_count}`);
process.exit(0);})();
