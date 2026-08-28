// UJI AKHIR: parser email Blibli vs LEDGER (hasil pemecahan manual yang sudah
// terverifikasi lewat saldo kartu & rantai statement). Kalau parser menghasilkan
// angka yang sama, berarti email sync ke depan akan memecah persis seperti ini.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const SC='/private/tmp/claude-501/-Users-paulusiskandar-Downloads/ddf30272-814e-499f-a44c-2cb4d7264aff/scratchpad';
const RINGKAS=(s,n=58)=>{const t=(s||'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n-1)+'…':t;};
function parsePaperSplit(subject,rawBody){
  const body=(rawBody||'').replace(/[|\r\n]+/g,' ').replace(/\s+/g,' ');
  if(!/Penyedia\s*Paper/i.test(body))return null;
  const angka=s=>Number(String(s).replace(/[^\d]/g,''))||0;
  const ambil=l=>{const m=body.match(new RegExp(l+String.raw`\s*Rp\s*([\d.,]+)`,'i'));return m?angka(m[1]):0;};
  const kirim=ambil('Total harga'),total=ambil('Total pembayaran');
  if(!kirim||!total||total<=kirim)return null;
  const ref=(body.match(/Nomor pembayaran\s*([A-Z0-9]+)/i)||[])[1]||'';
  const ke=RINGKAS(((body.match(/Nama\s+([A-Za-z*][^|]*?)\s+Detail pembayaran/i)||[])[1]||'').trim(),40);
  return{kirim,fee:total-kirim,total,ke,ref};
}
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,source,category_name,description').eq('user_id',uid).gte('tx_date','2026-01-01').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const fees=led.filter(r=>r.source==='paper-split');
const emails=JSON.parse(fs.readFileSync(SC+'/blibli_emails.json','utf8'));
const uniq=new Map();
for(const e of emails){const p=parsePaperSplit(e.subject,e.body);if(p&&!uniq.has(p.ref))uniq.set(p.ref,{...p,date:e.date});}
console.log(`email Blibli terparse: ${uniq.size} transaksi Paper unik\n`);
let ok=0,bedaFee=0,takAda=0;const laporan=[];
for(const p of uniq.values()){
  // baris pokok = reimburse_out/expense sebesar KIRIM di sekitar tanggal itu
  const pokok=led.find(r=>Math.abs(+r.amount_idr-p.kirim)<1&&['reimburse_out','expense'].includes(r.tx_type)&&Math.abs(new Date(r.tx_date)-new Date(p.date))/864e5<=9);
  const fee=fees.find(r=>Math.abs(+r.amount_idr-p.fee)<1&&Math.abs(new Date(r.tx_date)-new Date(p.date))/864e5<=9);
  if(pokok&&fee){ok++;continue;}
  if(!pokok&&!fee){takAda++;laporan.push(`  ? ${p.date} ${rp(p.total).padStart(13)} belum ada di ledger (kirim ${rp(p.kirim)} fee ${rp(p.fee)}) — ${p.ke}`);continue;}
  bedaFee++;laporan.push(`  ✗ ${p.date} kirim ${rp(p.kirim).padStart(12)} ${pokok?'ADA':'—'} | fee ${rp(p.fee).padStart(9)} ${fee?'ADA':'TIDAK ADA'}`);
}
for(const l of laporan)console.log(l);
console.log(`\n  ✓ pokok + fee cocok di ledger : ${ok}`);
console.log(`  ✗ sebagian tak cocok          : ${bedaFee}`);
console.log(`  ? belum masuk ledger          : ${takAda}`);
console.log(`\n  → parser ${bedaFee===0?'MENGHASILKAN PEMECAHAN YANG SAMA dengan migrasi manual':'MASIH MELESET'}`);
process.exit(0);})();
