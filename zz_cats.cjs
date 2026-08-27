const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:c,error}=await supabase.from('categories').select('*').limit(3);
console.log('err',error&&error.message);console.log('kolom:',c&&c[0]&&Object.keys(c[0]).join(', '));
const{data:all}=await supabase.from('categories').select('id,name,user_id').limit(100);
console.log('total baris terbaca:',all&&all.length);
console.log('user_id cocok:',(all||[]).filter(x=>x.user_id===uid).length,'| uid=',uid);
console.log((all||[]).map(x=>x.name).join(' | '));
process.exit(0);})();
