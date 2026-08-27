const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,description').eq('user_id',uid).eq('tx_type','expense').gte('tx_date','2026-05-20').lte('tx_date','2026-06-15').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const rs=[];for(const r of led){const m=(r.description||'').match(/JPY\s*[\d.,]+\s*@\s*([\d.,]+)/i);if(m)rs.push({d:r.tx_date,r:parseFloat(m[1])});}
console.log('kurs JPY tertulis di statement kartu, 20 Mei – 15 Jun:',rs.length,'baris');
const byd={};rs.forEach(x=>{(byd[x.d]=byd[x.d]||[]).push(x.r);});
for(const[d,v]of Object.entries(byd))console.log(` ${d}: ${[...new Set(v)].join(', ')}`);
process.exit(0);})();
