const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,category_name,description').eq('user_id',uid).eq('tx_type','expense').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const de=led.filter(r=>/AMAZON.*(\bLU\b|AMAZON\.DE)/i.test(r.description||''));
const us=led.filter(r=>/AMAZON\.COM/i.test(r.description||''));
console.log('Amazon Jerman/Eropa → Electronics & Gadgets:');
for(const r of de)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.category_name} | ${(r.description||'').slice(0,46)}`);
console.log('\nAmazon Amerika → Hobbies & Entertainment (vinyl):');
for(const r of us)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.category_name} | ${(r.description||'').slice(0,46)}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/amazon2_${Date.now()}.json`,JSON.stringify([...de,...us],null,1));
let ok=0;
for(const r of de){const c=C('Electronics & Gadgets');
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:'Amazon Jerman, trip Berlin — gadget (Paulus)'}).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
for(const r of us){const c=C('Hobbies & Entertainment');
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:'Amazon Amerika — piringan hitam (Paulus)'}).eq('id',r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`\nditulis ${ok}/${de.length+us.length}`);
process.exit(0);})();
