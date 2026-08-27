const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const CSV='/Users/paulusiskandar/Downloads/PaperPayOut_Transaction_History_1787796834.csv';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const lines=fs.readFileSync(CSV,'utf8').split('\n').filter(l=>l.trim());
const hdr=lines[0].split(',');
const csv=lines.slice(1).map(l=>{const p=l.split(',');const o={};hdr.forEach((h,i)=>o[h.trim()]=(p[i]||'').trim());return o;})
  .filter(r=>r['Tanggal Pembayaran']>='2026-01-01'&&r['Status Transaksi']==='Diteruskan');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const dd=(a,b)=>(new Date(b)-new Date(a))/864e5;
const dipakai=new Set();const tdk=[];
for(const r of csv){
  const a=Math.round(Number(r['Jumlah Terbayar']));
  const k=led.filter(x=>!dipakai.has(x.id)&&Math.abs(+x.amount_idr-a)<=1500&&dd(r['Tanggal Pembayaran'],x.tx_date)>=-3&&dd(r['Tanggal Pembayaran'],x.tx_date)<=45);
  if(k.length){dipakai.add(k[0].id);continue;}
  tdk.push(r);
}
console.log(`Paper 2026 berhasil: ${csv.length} · cocok ${csv.length-tdk.length} · TIDAK cocok ${tdk.length} = ${rp(tdk.reduce((s,r)=>s+Number(r['Jumlah Terbayar']),0))}\n`);
const m={};tdk.forEach(r=>{const k=r['Tanggal Pembayaran'].slice(0,7);m[k]=m[k]||{n:0,t:0};m[k].n++;m[k].t+=Number(r['Jumlah Terbayar']);});
console.log('per bulan:');
for(const[k,v]of Object.entries(m).sort())console.log(`  ${k}: ${v.n} transaksi ${rp(v.t).padStart(14)}`);
console.log('\nrinciannya:');
for(const r of tdk)console.log(`  ${r['Tanggal Pembayaran']} ${rp(r['Jumlah Terbayar']).padStart(12)} ${r['Penerima'].padEnd(22)} ${r['Berita Acara']}`);
console.log('\n=== cakupan statement OCBC 90N di ledger ===');
const oc=accounts.find(a=>a.name==='OCBC 90N');
const or=led.filter(x=>x.from_id===oc?.id);
const b={};or.forEach(x=>{const k=x.tx_date.slice(0,7);b[k]=b[k]||{n:0,t:0};b[k].n++;b[k].t+= +x.amount_idr;});
for(const k of ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'])
  console.log(`  ${k}: ${b[k]?String(b[k].n).padStart(3)+' baris '+rp(b[k].t).padStart(14):'  KOSONG — statement belum masuk'}`);
process.exit(0);})();
