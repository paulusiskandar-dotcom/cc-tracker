// Microsoft 365 1.950.000: dibeli lewat toco.id (marketplace, BUKAN Tokopedia) tgl
// 5 Feb 2026, dibayar via Mandiri. Email info@toco.id "Pembayaran Terverifikasi —
// Total Bayar Rp 1.950.000, Metode Pembayaran Mandiri". Di rekening Mandiri terbaca
// "Pembayaran SPRINT" (kode biller toco). Diganti SDC 16 Feb, nominal persis sama.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:ms}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-02-05').eq('amount_idr',1950000).eq('tx_type','expense').single();
const{data:sdc}=await supabase.from('ledger').select('reimburse_settlement_id').eq('user_id',uid).eq('tx_date','2026-02-16').eq('amount_idr',1950000).single();
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/ms365-${Date.now()}.json`,JSON.stringify(ms,null,2));
await supabase.from('ledger').update({tx_type:'reimburse_out',entity:'SDC',to_type:'reimburse',to_id:null,
  reimburse_settlement_id:sdc.reimburse_settlement_id,
  description:'toco.id — Microsoft 365 (rekening Mandiri terbaca "Pembayaran SPRINT"); diganti SDC 16 Feb'}).eq('id',ms.id);
console.log('- Microsoft 365 1.950.000 (5 Feb, Mandiri) jadi reimburse_out SDC, dicap lunas');
let led=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(x||[]);if(!x||x.length<1000)break;}
const e={};for(const q of led){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
console.log('\n=== piutang ===');
for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
process.exit(0);})();
