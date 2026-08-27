const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:c}=await supabase.from('expense_categories').select('*').eq('user_id',uid).eq('name','Online Shopping').single();
console.log('kolom expense_categories:',Object.keys(c||{}).join(', '));
console.log('nilai:',JSON.stringify(c));
const{data:i,error}=await supabase.from('installments').select('*').limit(1);
console.log('\nkolom installments:',i&&i[0]?Object.keys(i[0]).join(', '):'(kosong / tak terbaca) '+(error?.message||''));
process.exit(0);})();
