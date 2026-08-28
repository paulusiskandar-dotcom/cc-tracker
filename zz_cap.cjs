const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const g={};
for(const r of led){const k=(r.entity||'-')+' | '+(r.reimburse_settlement_id?r.reimburse_settlement_id.slice(0,8):'BUKA');
  g[k]=g[k]||{n:0,d0:'9',d1:'0',v:0};g[k].n++;g[k].v+= +r.amount_idr;
  if(r.tx_date<g[k].d0)g[k].d0=r.tx_date; if(r.tx_date>g[k].d1)g[k].d1=r.tx_date;}
console.log('entitas | cap        baris   rentang tanggal            nilai');
for(const[k,v]of Object.entries(g).sort())console.log(`  ${k.padEnd(20)} ${String(v.n).padStart(4)}   ${v.d0} → ${v.d1}   ${rp(v.v).padStart(15)}`);
const{data:s}=await supabase.from('reimburse_settlements').select('*').eq('user_id',uid).order('settled_at',{ascending:true});
console.log('\n=== tabel pelunasan ===');
for(const r of s||[])console.log(`  ${r.id.slice(0,8)} ${(r.entity||'-').padEnd(9)} ${String(r.settled_at).slice(0,10)} ${rp(r.amount||0).padStart(14)} | ${(r.note||'').slice(0,44)}`);
process.exit(0);})();
