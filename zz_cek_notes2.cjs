const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,notes').eq('user_id',uid).order('id').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const GENERIK=/^(backfill|statement rebuild|imported from|Migrated|auto|IPL\/internet)/i;
const ada=led.filter(r=>r.notes&&r.notes.trim());
const guna=ada.filter(r=>!GENERIK.test(r.notes.trim()));
console.log('total baris:',led.length,'· punya notes:',ada.length,'· notes berguna (bukan generik):',guna.length);
const exp=guna.filter(r=>['expense','pay_liability'].includes(r.tx_type));
console.log('di antaranya baris belanja:',exp.length);
console.log('\ncontoh notes berguna:');
for(const r of guna.slice(0,6))console.log('  •',r.notes.slice(0,86));
console.log('\ncontoh notes generik yang harus DISEMBUNYIKAN:');
const gen=ada.filter(r=>GENERIK.test(r.notes.trim()));
const s=new Set();for(const r of gen){const k=r.notes.slice(0,34);if(!s.has(k)){s.add(k);console.log('  ×',k);}if(s.size>=6)break;}
process.exit(0);})();
