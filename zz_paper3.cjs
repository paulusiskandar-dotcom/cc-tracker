// Pencocokan Paper ↔ ledger yang benar: nominal (+biaya ±1.500), jendela tanggal lebar,
// DAN saluran pembayaran (Global Digital Niaga / Blibli / Paper.id) atau nama penerima.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const CSV='/Users/paulusiskandar/Downloads/PaperPayOut_Transaction_History_1787796834.csv';
const KANAL=/GLOBAL DIGITAL|BLIBLI|PAPER\.ID|PAPER ID/i;
const norm=s=>(s||'').toUpperCase().replace(/[^A-Z ]/g,' ').replace(/\s+/g,' ').trim();
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const lines=fs.readFileSync(CSV,'utf8').split('\n').filter(l=>l.trim());
const hdr=lines[0].split(',');
const csv=lines.slice(1).map(l=>{const p=l.split(',');const o={};hdr.forEach((h,i)=>o[h.trim()]=(p[i]||'').trim());return o;})
  .filter(r=>r['Tanggal Pembayaran']>='2026-01-01'&&r['Status Transaksi']==='Diteruskan');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,entity,reimburse_settlement_id,description,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const dd=(a,b)=>(new Date(b)-new Date(a))/864e5;
const dipakai=new Set();
const hasil=[];
for(const r of csv){
  const a=Math.round(Number(r['Jumlah Terbayar']));
  const pen=norm(r['Penerima']);
  // kandidat: nominal cocok (±1.500), ledger 0–45 hari SETELAH tanggal bayar
  const kand=led.filter(x=>!dipakai.has(x.id)&&Math.abs(+x.amount_idr-a)<=1500&&dd(r['Tanggal Pembayaran'],x.tx_date)>=-3&&dd(r['Tanggal Pembayaran'],x.tx_date)<=45);
  // prioritas: saluran Paper/Blibli > nama penerima > apa pun
  const pick=kand.find(x=>KANAL.test(x.description||''))||kand.find(x=>pen&&norm(x.description).includes(pen.split(' ')[0]))||kand[0];
  if(pick)dipakai.add(pick.id);
  hasil.push({r,pick,jarak:pick?Math.round(dd(r['Tanggal Pembayaran'],pick.tx_date)):null});
}
const ket=hasil.filter(h=>h.pick), tdk=hasil.filter(h=>!h.pick);
console.log(`=== Paper 2026 (status Diteruskan): ${csv.length} transaksi = ${rp(csv.reduce((s,r)=>s+Number(r['Jumlah Terbayar']),0))} ===\n`);
const byTipe={};ket.forEach(h=>byTipe[h.pick.tx_type]=(byTipe[h.pick.tx_type]||0)+1);
console.log(`cocok ke ledger: ${ket.length} — per tipe: ${JSON.stringify(byTipe)}`);
console.log(`tidak ketemu   : ${tdk.length} = ${rp(tdk.reduce((s,h)=>s+Number(h.r['Jumlah Terbayar']),0))}\n`);
const salah=ket.filter(h=>h.pick.tx_type!=='reimburse_out');
if(salah.length){console.log('COCOK TAPI BUKAN reimburse_out (perlu ditinjau):');
  for(const h of salah)console.log(`  bayar ${h.r['Tanggal Pembayaran']} ${rp(h.r['Jumlah Terbayar']).padStart(12)} ${h.r['Penerima']} · ${h.r['Berita Acara']}\n     → ledger ${h.pick.tx_date} ${h.pick.tx_type} ${nm(h.pick.from_id)} | ${(h.pick.description||'').slice(0,40)}`);}
if(tdk.length){console.log('\nTIDAK ADA DI LEDGER:');
  for(const h of tdk)console.log(`  ${h.r['Tanggal Pembayaran']} ${rp(h.r['Jumlah Terbayar']).padStart(12)} ${h.r['Penerima']} · ${h.r['Berita Acara']}`);}
console.log('\nkartu yang dipakai untuk yang COCOK:');
const kk={};ket.forEach(h=>{const k=nm(h.pick.from_id);kk[k]=kk[k]||{n:0,t:0};kk[k].n++;kk[k].t+= +h.pick.amount_idr;});
for(const[k,v]of Object.entries(kk).sort((a,b)=>b[1].t-a[1].t))console.log(`  ${k.padEnd(14)} ${String(v.n).padStart(3)}× ${rp(v.t)}`);
console.log('\nrentang tanggal transaksi OCBC 90N yang ADA di ledger:');
const oc=accounts.find(a=>a.name==='OCBC 90N');
const or=led.filter(x=>x.from_id===oc?.id).map(x=>x.tx_date).sort();
console.log(`  ${or.length} baris, ${or[0]} s/d ${or[or.length-1]}`);
const bulan={};or.forEach(d=>{const m=d.slice(0,7);bulan[m]=(bulan[m]||0)+1;});
console.log(' ',JSON.stringify(bulan));
console.log('\njarak tanggal bayar → posting kartu (hari):');
const j={};ket.forEach(h=>{const b=h.jarak<=0?'0':h.jarak<=7?'1-7':h.jarak<=21?'8-21':'22-45';j[b]=(j[b]||0)+1;});
console.log(' ',JSON.stringify(j));
process.exit(0);})();
