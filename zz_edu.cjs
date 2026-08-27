const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
let edu=(cats||[]).find(c=>c.name==='Education');
if(!edu){const{data:baru,error}=await supabase.from('expense_categories').insert([{user_id:uid,name:'Education',icon:'🎓',color:'#0891b2',is_active:true,
    keywords:['whop','tomtrades','course','kursus','udemy','coursera','seminar','workshop','training','anthropic','openai']}]).select('id,name').single();
  if(error){console.log('GAGAL buat kategori:',error.message);process.exit(1);}
  edu=baru;console.log('kategori "Education" dibuat');
}else console.log('kategori "Education" sudah ada');
const veh=(cats||[]).find(c=>c.name==='Vehicle');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const whop=led.filter(r=>/WHOP|TOMTRADES/i.test(r.description||''));
const koko=led.filter(r=>/KOKO Store/i.test(r.description||''));
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/edu_${Date.now()}.json`,JSON.stringify([...whop,...koko],null,1));
console.log(`\nWHOP/TomTrades → Education (${whop.length} baris = ${rp(whop.reduce((s,r)=>s+ +r.amount_idr,0))})`);
let ok=0;
for(const r of whop){const{error}=await supabase.from('ledger').update({category_id:edu.id,category_name:edu.name,notes:'WHOP TomTrades — kursus trading'}).eq('id',r.id).eq('user_id',uid);
  if(!error){ok++;console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(12)} ${r.category_name} → Education`);}else console.log('GAGAL',error.message);}
console.log(`\nKOKO Store VIP → Vehicle (${koko.length} baris = ${rp(koko.reduce((s,r)=>s+ +r.amount_idr,0))})`);
for(const r of koko){const{error}=await supabase.from('ledger').update({category_id:veh.id,category_name:veh.name,notes:'KOKO Store VIP'}).eq('id',r.id).eq('user_id',uid);
  if(!error){ok++;console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(12)} ${r.category_name} → Vehicle`);}else console.log('GAGAL',error.message);}
// cicilan WHOP ikut pindah
const{data:ins}=await supabase.from('installments').select('id,description').eq('user_id',uid).ilike('description','%WHOP%');
for(const i of ins||[]){await supabase.from('installments').update({expense_category_id:edu.id}).eq('id',i.id).eq('user_id',uid);
  console.log(`  cicilan "${(i.description||'').slice(0,34)}" → Education`);}
console.log(`\nditulis ${ok}`);
process.exit(0);})();
