// Isi deskripsi untuk 51 pembayaran PLN via Lazada/Tokopedia (dari struk IAK).
// Format padat: "PLN · NAMA · tarif · periode"
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const B=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu'];
const P=[
 ['PAULUS ISKANDAR','B2/7.700',[1427386,1036831,1227671,1178622,1419760,1579533,1650542,1789603]],
 ['SURYANTO SALIM','B2/11.000',[970260,840075,791256,728893,854640,1034675,1056866,1005535]],
 ['PT HAMASA STEEL','I3/1.525.000',[65090807,67687405,65591015,65092057,72272873,65092057,65092057,68015190]],
 ['H. SYAFAR LUTHAN','R3/23.000',[5399422,5134925,4902688,6085237,6587522,6291802,6587483,5924678]],
 ['PT AGUNG PODOMORO','R3/7.700',[3963283,2858959,null,3012463,4111005,4058969,4365404,4193878]],
 ['JOPIE DJOHARI (meter 1)','R3/7.700',[2678847,3575903,4222787,3185917,4313369,4720022,4355769,5073075]],
 ['JOPIE DJOHARI (meter 2)','R3/7.700',[null,null,2449702,null,null,2679047,null,null]],
 ['LEKHRAY DAULATIAM','R3/23.000',[2072769,null,null,null,null,null,2431045,null]],
 ['HENNY DJOHARI','R2/5.500',[null,null,null,null,null,null,2369093,null]],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,notes,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[];
for(const[nama,tarif,arr]of P){
  arr.forEach((a,i)=>{
    if(!a)return;
    const bln=`2026-${String(i+1).padStart(2,'0')}`;
    const h=led.filter(r=>Math.abs(+r.amount_idr-a)<=1000&&r.tx_date.slice(0,7)>=bln&&r.tx_date.slice(0,7)<=`2026-${String(i+2).padStart(2,'0')}`);
    if(h.length!==1)return;
    jobs.push({r:h[0],n:`PLN · ${nama} · ${tarif} VA · ${B[i]} 2026`});
  });
}
console.log('=== deskripsi PLN yang akan diisi ===');
for(const j of jobs)console.log(`  ${j.r.tx_date} ${rp(j.r.amount_idr).padStart(12)} ${nm(j.r.from_id).padEnd(10)} → ${j.n}`);
console.log(`\n${jobs.length} baris`);
if(!APPLY){console.log('[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/notespln_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){const{error}=await supabase.from('ledger').update({notes:j.n}).eq('id',j.r.id).eq('user_id',uid);if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${jobs.length}`);
process.exit(0);})();
