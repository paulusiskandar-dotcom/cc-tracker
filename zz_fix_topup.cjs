const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:t}=await supabase.from('ledger').select('id,amount,amount_idr,description').eq('user_id',uid).ilike('description','%Top-up JPY dari IDR%');
for(const r of t||[]){
  const m=(r.description||'').match(/IDR\s*([\d.]+)/); if(!m){console.log('lewat: nominal IDR tak tertulis');continue;}
  const idr=parseInt(m[1].replace(/\./g,''),10); const rate=idr/Number(r.amount);
  if(!(idr>0)||!(rate>50&&rate<200)){console.log('lewat: kurs di luar akal',rate);continue;}
  const{error}=await supabase.from('ledger').update({amount_idr:idr,fx_rate_used:rate}).eq('id',r.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`ok: JPY ${r.amount} → Rp ${idr.toLocaleString('id-ID')} (kurs ${rate.toFixed(2)}, dari deskripsi baris itu sendiri)`);
}
process.exit(0);})();
