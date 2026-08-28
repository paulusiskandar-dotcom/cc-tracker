const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}

console.log('=== cari tagihan Alice / Microsoft / internet lewat NAMA, bukan nominal ===');
for(const[label,re,d0,d1]of[['ALICE',/ALICE/i,'2025-12-01','2026-02-28'],['MICROSOFT/365',/MICROSOFT|OFFICE|M365/i,'2026-01-01','2026-03-31'],['internet Mar 5,1jt',/BIZNET|MYREPUBLIC|INDIHOME|FIRST ?MEDIA|ICONNET|CBN|MNC ?PLAY|LINKNET/i,'2026-01-01','2026-04-30']]){
  console.log(`\n  -- ${label}`);
  const c=led.filter(r=>re.test(r.description||'')&&r.tx_date>=d0&&r.tx_date<=d1);
  if(!c.length)console.log('     tidak ada');
  for(const r of c)console.log(`     ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type.padEnd(13)} ${(r.entity||'-').padEnd(8)} ${nm(r.from_id).padEnd(14)} | ${(r.description||'').slice(0,44)}`);
}
console.log('\n=== semua tagihan 1-6 juta di Jan & Mar yang belum bertuan (entity Personal, kartu) ===');
for(const r of led.filter(r=>r.tx_type==='expense'&&+r.amount_idr>=1500000&&+r.amount_idr<=6000000&&(r.tx_date<'2026-01-20'||(r.tx_date>='2026-02-25'&&r.tx_date<='2026-03-10'))))
  console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(14)} kat=${(r.category_name||'-').padEnd(22)} | ${(r.description||'').slice(0,40)}`);

if(!APPLY){console.log('\n(dry-run — 2 baris 2.368.679 akan pindah SDC → Personal)');process.exit(0);}
const{data:sd}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('amount_idr',2368679).eq('tx_type','reimburse_in').eq('entity','SDC');
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/sdc-pajak-${Date.now()}.json`,JSON.stringify(sd,null,2));
for(const r of sd)await supabase.from('ledger').update({entity:'Personal',
  description:'HENNY DJOHARI — penggantian pajak (pasangan tagihan Tokopedia 2.368.679); dulu salah masuk entitas SDC'}).eq('id',r.id);
console.log(`\n- ${sd.length} baris 2.368.679 dipindah SDC → Personal`);
let l2=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);l2=l2.concat(x||[]);if(!x||x.length<1000)break;}
const e={};for(const r of l2){const k=r.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][r.tx_type==='reimburse_out'?'o':'i']+= +r.amount_idr;}
console.log('\n=== piutang seluruhnya ===');
for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
process.exit(0);})();
