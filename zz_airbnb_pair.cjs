// Airbnb 35.546.243 (1 Mar, kartu Jenius) dipasangkan dengan KR OTOMATIS LLG-MANDIRI
// 36.000.000 (5 Mar, BCA R) — penggantian Hamasa dibulatkan ke atas, selisih 453.757.
// LLG Mandiri lain berpola gaji bulanan 65-67jt pertengahan bulan; yang ini ganjil.
// Juga: setoran Agnes 15.187.500 (19 Jan) = pelunasan DP termin 1 Hang Tuah yang
// ditalangi Paulus Nov/Des 2025. Bagian per orang 209.812.500 + 15.187.500 = 225jt pas.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:llg}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-03-05').eq('amount_idr',36000000).single();
const{data:air}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-03-01').eq('amount_idr',35546243).single();
const{data:ag}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-01-19').eq('amount_idr',15187500).single();
console.log('Airbnb :',air.tx_type,air.entity,nm(air.from_id),'| kategori',air.category_name,'| cap',air.reimburse_settlement_id?'lunas':'buka');
console.log('LLG 36 :',llg.tx_type,llg.entity,'→',nm(llg.to_id),'| cap',llg.reimburse_settlement_id?.slice(0,8));
console.log('Agnes  :',ag.tx_type,ag.entity,'| cap',ag.reimburse_settlement_id?.slice(0,8));
console.log('selisih pembulatan:',rp(36000000-35546243));
console.log('\ncek 225jt: 209.812.500 + 15.187.500 =',rp(209812500+15187500));
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/airbnb-${Date.now()}.json`,JSON.stringify({air,llg,ag},null,2));
await supabase.from('ledger').update({tx_type:'reimburse_out',entity:'Hamasa',to_type:'reimburse',to_id:null,
  reimburse_settlement_id:llg.reimburse_settlement_id,
  description:'AIRBNB * HMETPDMM4J — reimburse Hamasa (diganti LLG Mandiri 36.000.000 tgl 5 Mar, dibulatkan +453.757)'}).eq('id',air.id);
await supabase.from('ledger').update({
  description:'TRSF E-BANKING CR 1901 | AGNES — pelunasan DP termin 1 Hang Tuah yang ditalangi Paulus (Nov/Des 2025); bagian per orang 225jt'}).eq('id',ag.id);
await supabase.from('ledger').update({
  description:'KR OTOMATIS LLG-MANDIRI 0938 | PAULUS ISKANDAR — penggantian Airbnb 35.546.243 (1 Mar), dibulatkan'}).eq('id',llg.id);
await recalculateBalance(air.from_id,uid);
const{data:c}=await supabase.from('accounts').select('name,current_balance').eq('id',air.from_id).single();
console.log('\n- Airbnb jadi reimburse_out Hamasa, dicap lunas');
console.log('- saldo kartu',c.name,':',rp(c.current_balance),'(sebelum',rp(accounts.find(a=>a.id===air.from_id).current_balance)+')');
let led=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(x||[]);if(!x||x.length<1000)break;}
const e={};for(const r of led){const k=r.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][r.tx_type==='reimburse_out'?'o':'i']+= +r.amount_idr;}
console.log('\n=== piutang seluruhnya ===');
for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
process.exit(0);})();
