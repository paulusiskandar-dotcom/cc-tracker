// Pelajari mekanisme reimburse SEBELUM menulis apa pun, supaya piutang hidup tidak rusak.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,category_name,description,reimburse_settlement_id').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const ro=led.filter(r=>r.tx_type==='reimburse_out'), ri=led.filter(r=>r.tx_type==='reimburse_in');
console.log('reimburse_out:',ro.length,'=',rp(ro.reduce((s,r)=>s+ +r.amount_idr,0)));
console.log('reimburse_in :',ri.length,'=',rp(ri.reduce((s,r)=>s+ +r.amount_idr,0)));
console.log('\nreimburse_out per entity | berapa yg SUDAH distempel settlement:');
const g={};ro.forEach(r=>{const e=r.entity||'(kosong)';g[e]=g[e]||{n:0,t:0,st:0,stT:0};g[e].n++;g[e].t+= +r.amount_idr;if(r.reimburse_settlement_id){g[e].st++;g[e].stT+= +r.amount_idr;}});
for(const[e,v]of Object.entries(g))console.log(`  ${e.padEnd(10)} ${String(v.n).padStart(3)} baris ${rp(v.t).padStart(14)} | distempel ${v.st} (${rp(v.stT)}) | BELUM ${v.n-v.st} (${rp(v.t-v.stT)}) ← ini yg jadi piutang hidup`);
console.log('\nakun piutang (receivable) yg ada:');
for(const a of accounts.filter(a=>/piutang|receivable/i.test(a.name)||a.type==='receivable'))console.log(`  ${a.name} tipe=${a.type} saldo=${rp(a.current_balance)}`);
console.log('\nsettlement per entity & status:');
const{data:ss}=await supabase.from('reimburse_settlements').select('id,entity,status,total_out,total_in,notes,created_at').eq('user_id',uid).order('created_at');
const gs={};(ss||[]).forEach(s=>{const k=`${s.entity}/${s.status}`;gs[k]=(gs[k]||0)+1;});
console.log(' ',JSON.stringify(gs));
console.log('\nsettlement bernama BACKFILL/HISTORIS:');
for(const s of (ss||[]).filter(s=>/backfill|historis/i.test(s.notes||'')))console.log(`  ${String(s.id).slice(0,8)} ${s.entity} ${s.status} out=${rp(s.total_out)} in=${rp(s.total_in)} | ${(s.notes||'').slice(0,40)}`);
console.log('\ncontoh reimburse_out yang BELUM distempel (= piutang hidup sekarang):');
for(const r of ro.filter(r=>!r.reimburse_settlement_id).slice(0,12))console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id)} | ${(r.description||'').slice(0,42)}`);
console.log('\nstruktur satu baris reimburse_out (kolom apa saja yg terisi):');
const s1=ro.find(r=>r.reimburse_settlement_id);
if(s1){const{data:full}=await supabase.from('ledger').select('*').eq('id',s1.id).single();
  console.log(' ',JSON.stringify(Object.fromEntries(Object.entries(full).filter(([k,v])=>v!==null&&!['user_id','id'].includes(k))),null,1).slice(0,900));}
process.exit(0);})();
