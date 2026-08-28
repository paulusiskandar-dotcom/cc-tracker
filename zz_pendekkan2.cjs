// Pendekkan deskripsi yang KUTULIS terlalu panjang. Paulus berkali-kali: "langsung
// aja nama barangnya", "terlalu banyak subtitle yg ga penting". Yang dipangkas cuma
// keterangan tempelanku (— penjelasan, (ID …), ; struk …), bukan teks bank asli.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const APPLY=process.argv.includes('apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const RAPI=[
  // [pola, pengganti]  — dijalankan berurutan
  [/^LAZADA — PLN ([A-Z .]+?) \(ID \d+, ([A-Z]{3}) (\d{4})\).*$/i, (m,n,b,t)=>`PLN ${n.trim()} ${b} ${t}`],
  [/^Setoran tunai — penggantian PLN Suryanto\+Paulus ([A-Z]{3}).*$/i,(m,b)=>`Penggantian PLN ${b} (Hamasa)`],
  [/^Utility Income dari Hamasa — kelebihan penggantian listrik ([A-Z]{3}).*$/i,(m,b)=>`Kelebihan penggantian listrik ${b}`],
  [/^Utility Income dari Hamasa —.*$/i,()=>`Kelebihan penggantian listrik (Hamasa)`],
  [/^SAHABAT DENTAL CEM Listrik Maret \(keterangan.*$/i,()=>`SDC Listrik Maret`],
  [/^Dividen Hamasa tahap Maret — (transfer Judha Djohari|setoran tunai).*$/i,(m,x)=>`Dividen Hamasa Maret (${/Judha/i.test(x)?'transfer Judha':'setoran tunai'})`],
  [/^ANNUAL FEE WAIVER —.*$/i,()=>`Annual fee waiver`],
  [/^APPLE\.COM\/BILL — refund langganan$/i,()=>`Apple — refund`],
  [/^AIRBNB \* \w+ — reimburse Hamasa.*$/i,()=>`Airbnb (reimburse Hamasa)`],
  [/^KR OTOMATIS LLG-MANDIRI \d+ \| PAULUS ISKANDAR — penggantian Airbnb.*$/i,()=>`LLG Mandiri — penggantian Airbnb`],
  [/^toco\.id — Microsoft 365.*$/i,()=>`toco.id — Microsoft 365`],
  [/^LAZADA — internet SDC Maret.*$/i,()=>`Internet SDC Maret`],
  [/^(HERLINA|HENNY) DJOHARI — patungan hotel Singapore.*$/i,(m,n)=>`${n[0]+n.slice(1).toLowerCase()} Djohari — hotel Singapore`],
  [/^TRIPCOM — hotel Singapore \(patungan.*$/i,()=>`Trip.com — hotel Singapore`],
  [/^HENNY DJOHARI — penggantian pajak \(pasangan.*$/i,()=>`Henny Djohari — penggantian pajak`],
  [/^Fee Paper — (.+?) \(.*\)$/i,(m,x)=>`Fee Paper — ${x.trim()}`],
  [/^TRSF E-BANKING CR \d+ \| AGNES — pelunasan DP termin 1 Hang Tuah.*$/i,()=>`Agnes — pelunasan DP Hang Tuah`],
  [/^Siti Sarnah — (\w+) 2026 \(via Paper\.id\)$/i,(m,b)=>`Siti Sarnah — ${b} 2026`],
  [/^(PT\.? ?GLOBAL DIGITAL|BLIBLI)[^—]*— via Paper\.id \(fee.*$/i,()=>`Paper.id — Blibli`],
  [/^(.{20,}?) — via Paper\.id \(fee .*$/i,(m,x)=>x.trim()],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,description,source').eq('user_id',uid).order('tx_date',{ascending:false}).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const ubah=[];
for(const r of led){
  const d=r.description||''; let baru=d;
  for(const[re,f]of RAPI){ if(re.test(baru)){ baru=baru.replace(re,f); break; } }
  if(baru!==d&&baru.length<d.length)ubah.push({id:r.id,tgl:r.tx_date,dari:d,ke:baru});
}
console.log(`akan dipendekkan: ${ubah.length} baris`);
for(const u of ubah.slice(0,30))console.log(`  [${String(u.dari.length).padStart(3)}→${String(u.ke.length).padStart(2)}] ${u.ke}\n         dari: ${u.dari.slice(0,88)}`);
if(ubah.length>30)console.log(`  … dan ${ubah.length-30} lagi`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/pendekkan-${Date.now()}.json`,JSON.stringify(ubah,null,2));
for(const u of ubah)await supabase.from('ledger').update({description:u.ke}).eq('id',u.id);
console.log(`\n- ${ubah.length} deskripsi dipendekkan`);
process.exit(0);})();
