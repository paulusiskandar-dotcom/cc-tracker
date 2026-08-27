// Lengkapi deskripsi untuk baris yang isinya sudah diketahui dari telusur email/struk.
// Pencocok sebelumnya menuntut kecocokan tunggal, jadi nominal yang berulang tiap bulan
// (mis. listrik PT Hamasa 65.092.057 tiga kali) terlewat semua. Di sini nominal berulang
// justru diharapkan.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const NOISE=/^(backfill|statement |imported from|migrated|auto|ipl\/internet)/i;
const B=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu'];
// PLN per pelanggan: nominal tiap bulan (null = tidak ada)
const PLN=[
 ['PT HAMASA STEEL',[65090807,67687405,65591015,65092057,72272873,65092057,65092057,68015190]],
 ['H. SYAFAR LUTHAN',[5399422,5134925,4902688,6085237,6587522,6291802,6587483,5924678]],
 ['PT AGUNG PODOMORO',[3963283,2858959,null,3012463,4111005,4058969,4365404,4193878]],
 ['JOPIE DJOHARI',[2678847,3575903,4222787,3185917,4313369,4720022,4355769,5073075]],
 ['JOPIE DJOHARI (meter 2)',[null,null,2449702,null,null,2679047,null,null]],
 ['LEKHRAY DAULATIAM',[2072769,null,null,null,null,null,2431045,null]],
 ['HENNY DJOHARI',[null,null,null,null,null,null,2369093,null]],
 ['PAULUS ISKANDAR',[1427386,1036831,1227671,1178622,1419760,1579533,1650542,1789603]],
 ['SURYANTO SALIM',[970260,840075,791256,728893,854640,1034675,1056866,1005535]],
];
// nominal tetap → deskripsi (berlaku di bulan mana pun)
const TETAP=[
 [2385938,'Pajak DJP · Henny Djohari'],[2386000,'Pajak DJP · Henny Djohari'],[2368679,'Pajak DJP · Henny Djohari'],
 [5030400,'Printer Epson L8050'],[2573900,'TP-Link Deco X50 mesh 3-pack'],[430300,'TP-Link switch LS1005G + TL-SG108'],
 [2511250,'Printer Epson L3250'],[2812250,'Printer Epson LX310 dot matrix'],[298660,'NODX Wireless Display Adapter'],
 [387390,'Indosat HiFi · internet SDC'],[114000,'Telkomsel Halo 0812198168'],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,notes,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const kosong=led.filter(r=>!(r.notes&&r.notes.trim()&&!NOISE.test(r.notes.trim())));
const jobs=[];const dipakai=new Set();
// 1. PLN — per pelanggan per bulan
for(const[nama,arr]of PLN){
  arr.forEach((a,i)=>{
    if(!a)return;
    const bl=`2026-${String(i+1).padStart(2,'0')}`, bl2=`2026-${String(i+2).padStart(2,'0')}`;
    const c=kosong.filter(r=>!dipakai.has(r.id)&&Math.abs(+r.amount_idr-a)<=1000&&r.tx_date.slice(0,7)>=bl&&r.tx_date.slice(0,7)<=bl2);
    if(!c.length)return;
    dipakai.add(c[0].id);jobs.push({r:c[0],n:`PLN · ${nama} · ${B[i]} 2026`});
  });
}
// 2. nominal tetap
for(const r of kosong){
  if(dipakai.has(r.id))continue;
  const t=TETAP.find(([a])=>Math.abs(+r.amount_idr-a)<=5);
  if(t){dipakai.add(r.id);jobs.push({r,n:t[1]});}
}
console.log(`baris tanpa deskripsi: ${kosong.length} · bisa diisi: ${jobs.length}\n`);
const g={};jobs.forEach(j=>{const k=j.n.split(' · ').slice(0,2).join(' · ');g[k]=(g[k]||0)+1;});
for(const[k,v]of Object.entries(g).sort((a,b)=>b[1]-a[1]))console.log(`  ${String(v).padStart(2)}× ${k}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/lengkapi_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){const{error}=await supabase.from('ledger').update({notes:j.n}).eq('id',j.r.id).eq('user_id',uid);if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`\nditulis ${ok}/${jobs.length}`);
process.exit(0);})();
