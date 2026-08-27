const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,entity,category_name,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
// 51 struk PLN dari struk IAK/Lazada + 1 via Tokopedia
const PLN=[
 ['PAULUS ISKANDAR',[['2026-01-12',1427386],['2026-02-10',1036831],['2026-03-07',1227671],['2026-04-08',1178622],['2026-05-11',1419760],['2026-06-11',1579533],['2026-07-12',1650542],['2026-08-11',1789603]]],
 ['SURYANTO SALIM',[['2026-01-12',970260],['2026-02-10',840075],['2026-03-07',791256],['2026-04-08',728893],['2026-05-11',854640],['2026-06-25',1034675],['2026-07-27',1056866],['2026-08-11',1005535]]],
 ['PT HAMASA STEEL',[['2026-01-12',65090807],['2026-02-10',67687405],['2026-03-11',65591015],['2026-04-08',65092057],['2026-05-13',72272873],['2026-06-11',65092057],['2026-07-12',65092057],['2026-08-11',68015190]]],
 ['H. SYAFAR LUTHAN',[['2026-01-19',5399422],['2026-02-20',5134925],['2026-03-12',4902688],['2026-04-18',6085237],['2026-05-19',6587522],['2026-06-18',6291802],['2026-07-18',6587483],['2026-08-19',5924678]]],
 ['PT AGUNG PODOMORO',[['2026-01-19',3963283],['2026-02-20',2858959],['2026-04-18',3012463],['2026-05-19',4111005],['2026-06-18',4058969],['2026-07-18',4365404],['2026-08-19',4193878]]],
 ['JOPIE DJOHARI m1',[['2026-01-19',2678847],['2026-02-20',3575903],['2026-03-12',4222787],['2026-04-18',3185917],['2026-05-19',4313369],['2026-06-18',4720022],['2026-07-18',4355769],['2026-08-19',5073075]]],
 ['JOPIE DJOHARI m2',[['2026-03-12',2449702],['2026-06-18',2679047]]],
 ['LEKHRAY DAULATIAM',[['2026-01-19',2072769],['2026-07-18',2431045]]],
 ['HENNY DJOHARI',[['2026-07-18',2369093]]],
];
let sudah=0,salah=0,hilang=0;const perlu=[];
for(const[nama,rows]of PLN){
  const bad=[];
  for(const[d,a]of rows){
    const h=led.filter(r=>Math.abs(+r.amount_idr-a)<1&&Math.abs(new Date(r.tx_date)-new Date(d))/864e5<=4);
    if(!h.length){hilang++;bad.push(`${d} ${rp(a)} TIDAK ADA DI LEDGER`);continue;}
    const ro=h.find(r=>r.tx_type==='reimburse_out');
    if(ro)sudah++;
    else{salah++;bad.push(`${d} ${rp(a)} → ${h[0].tx_type} ${h[0].category_name||''} (${nm(h[0].from_id)})`);perlu.push(h[0]);}
  }
  console.log(`${nama.padEnd(20)} ${rows.length} struk · ${bad.length?'⚠ '+bad.length+' bermasalah':'✓ semua sudah reimburse_out'}`);
  for(const b of bad)console.log(`    ${b}`);
}
console.log(`\nringkas: sudah benar ${sudah} · belum jadi reimburse_out ${salah} · tidak ada di ledger ${hilang}`);
if(perlu.length){console.log('\nyang perlu diubah jadi reimburse_out:');
  for(const r of perlu)console.log(`  ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.tx_type} ${nm(r.from_id)} | ${(r.description||'').slice(0,44)}`);}
process.exit(0);})();
