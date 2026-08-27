// Sapu seluruh ledger: cari merchant yang sama tapi kategorinya tercecer.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
// buang derau: nomor referensi, kota, kode negara, kata teknis bank
const BUANG=/\b(JAKARTA|SELATAN|SELATID|BARAT|PUSAT|UTARA|TIMUR|IDN?|ID|JKT|TANGERANG|BEKASI|DEPOK|BANDUNG|SURABAYA|MEDAN|NON|3DS|TRSF|E-?BANKING|DB|CR|KARTU|DEBIT|KREDIT|TRANSAKSI|PEMBAYARAN|QRIS|BIF|BI-?FAST|FTSCY|FTFVA|WS\d*|COM|CO|PT|CV|TBK|INDONESIA|JPN|SGP|SG|DEU|DE|GB|USA?|NL|LU)\b/gi;
const norm=s=>{
  let t=(s||'').toUpperCase();
  t=t.split('|')[0];                       // buang bagian setelah pipa (nomor rekening dll)
  t=t.replace(/[^A-Z ]/g,' ');             // buang angka & tanda baca
  t=t.replace(BUANG,' ').replace(/\s+/g,' ').trim();
  return t.split(' ').filter(w=>w.length>2).slice(0,3).join(' ');
};
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,category_name,description').eq('user_id',uid).in('tx_type',['expense','pay_liability']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const g={};
for(const r of led){
  const k=norm(r.description); if(!k||k.length<4)continue;
  g[k]=g[k]||{n:0,t:0,kat:{},contoh:[]};
  g[k].n++; g[k].t+= +r.amount_idr;
  const c=r.category_name||'(tanpa)';
  g[k].kat[c]=(g[k].kat[c]||0)+ +r.amount_idr;
  if(g[k].contoh.length<2)g[k].contoh.push(r.description.slice(0,40));
}
const pecah=Object.entries(g).filter(([k,v])=>Object.keys(v.kat).length>1&&v.n>=2)
  .sort((a,b)=>b[1].t-a[1].t);
console.log(`merchant dengan kategori tercecer: ${pecah.length}\n`);
let n=0;
for(const[k,v]of pecah){
  if(n++>=28)break;
  const kats=Object.entries(v.kat).sort((a,b)=>b[1]-a[1]);
  console.log(`${k.padEnd(24)} ${String(v.n).padStart(3)}× ${rp(v.t).padStart(12)}`);
  console.log(`   ${kats.map(([a,b])=>`${a} ${rp(b)}`).join('  ·  ')}`);
}
console.log(`\n(ditampilkan ${Math.min(28,pecah.length)} teratas dari ${pecah.length})`);
const totPecah=pecah.reduce((s,[,v])=>s+v.t,0);
console.log(`nilai seluruh merchant tercecer: ${rp(totPecah)}`);
process.exit(0);})();
