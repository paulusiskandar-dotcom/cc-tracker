// HENNY DJOHARI 2.400.000 (12 Mei, BCA IDR) = penggantian tagihan Tokopedia pajak
// 2.368.679 (11 Mei), dibulatkan ke atas 31.321. Henny selalu mengganti nempel,
// jadi pasangan lintas bulan yang kuduga sebelumnya salah. Dulu tertulis Hamasa.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:r}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-05-12').eq('amount_idr',2400000).eq('entity','Hamasa').single();
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/henny-mei-${Date.now()}.json`,JSON.stringify(r,null,2));
await supabase.from('ledger').update({entity:'Personal',description:'HENNY DJOHARI — penggantian pajak (pasangan tagihan Tokopedia 2.368.679 tgl 11 Mei, dibulatkan +31.321)'}).eq('id',r.id);
console.log('- 2.400.000 (12 Mei) dipindah Hamasa → Personal');
let led=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(x||[]);if(!x||x.length<1000)break;}
const e={};for(const q of led){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
console.log('\n  penjelasan Personal: DP Hang Tuah 15.187.500 masuk tanpa pasangan (dibayar Nov/Des 2025, di luar buku)');
console.log('  piutang Personal yang benar-benar berjalan: Charine 2.277.300 + Samsung Agnes 4.166.500 + Sri Mulyati 1.375.000 =',rp(2277300+4166500+1375000));
console.log('  cek: 7.818.800 - 15.187.500 =',rp(7818800-15187500));
process.exit(0);})();
