const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,category_name,description,notes').eq('user_id',uid).gte('tx_date','2025-12-15').lte('tx_date','2026-03-20').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const RE=/TOKOPEDIA|LAZADA|SHOPEE|BLIBLI|IAK|PAPER/i;
console.log('=== semua tagihan Tokopedia/Lazada/Shopee 15 Des – 20 Mar ===');
for(const r of led.filter(r=>RE.test((r.description||'')+' '+(r.notes||''))))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id).padEnd(14)} kat=${(r.category_name||'-').padEnd(20)} | ${(r.description||'').slice(0,36)}`);
console.log('\n=== target yang dicari ===');
console.log('  Alice Dental   3.215.930  (SDC bayar 15 Jan)');
console.log('  Microsoft 365  1.950.000  (SDC bayar 16 Feb)');
console.log('  Internet Mar   5.147.838  (SDC bayar  7 Mar)');
console.log('\n=== kemungkinan gabungan beberapa tagihan untuk 5.147.838 ===');
const kand=led.filter(r=>r.tx_type==='expense'&&RE.test(r.description||'')&&r.tx_date>='2026-02-01'&&r.tx_date<='2026-03-07').map(r=>({d:r.tx_date,a:+r.amount_idr,k:(r.description||'').slice(0,26)}));
for(let i=0;i<kand.length;i++)for(let j=i+1;j<kand.length;j++){
  if(Math.abs(kand[i].a+kand[j].a-5147838)<=2000)console.log(`  ${rp(kand[i].a)} (${kand[i].d}) + ${rp(kand[j].a)} (${kand[j].d}) = ${rp(kand[i].a+kand[j].a)}`);
  for(let l=j+1;l<kand.length;l++)
    if(Math.abs(kand[i].a+kand[j].a+kand[l].a-5147838)<=2000)console.log(`  ${rp(kand[i].a)} + ${rp(kand[j].a)} + ${rp(kand[l].a)} = ${rp(kand[i].a+kand[j].a+kand[l].a)}  (${kand[i].d}, ${kand[j].d}, ${kand[l].d})`);
}
process.exit(0);})();
