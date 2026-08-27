const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:h}=await supabase.from('ledger').select('id,tx_date,amount_idr,notes').eq('user_id',uid).eq('tx_date','2026-07-15').eq('tx_type','reimburse_out').gte('amount_idr',212000).lte('amount_idr',213200);
if(!h||!h.length){console.log('tidak ketemu');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/unstamp_${Date.now()}.json`,JSON.stringify(h,null,1));
for(const r of h){
  const{error}=await supabase.from('ledger').update({reimburse_settlement_id:null,
    notes:'UGREEN USB-C hub 7in1 (unit kedua) — BELUM DITAGIH ke Hamasa (Paulus); stempel settlement dilepas agar tampil sebagai piutang hidup'}).eq('id',r.id).eq('user_id',uid);
  console.log(error?('GAGAL '+error.message):`ok ${r.tx_date} ${rp(r.amount_idr)} → stempel dilepas, jadi piutang hidup`);
}
process.exit(0);})();
