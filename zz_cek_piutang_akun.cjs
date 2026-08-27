const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const rec=accounts.filter(a=>a.type==='receivable');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('to_id,from_id,tx_type,amount_idr').eq('user_id',uid).order('id').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('akun piutang & pemakaiannya:');
for(const a of rec){
  const t=led.filter(r=>r.to_id===a.id).length, f=led.filter(r=>r.from_id===a.id).length;
  console.log(`  ${a.name.padEnd(18)} id=${String(a.id).slice(0,8)} dipakai sbg tujuan ${String(t).padStart(3)}× · sbg asal ${String(f).padStart(3)}× ${t+f===0?'  ← TIDAK PERNAH DIPAKAI':''}`);
}
process.exit(0);})();
