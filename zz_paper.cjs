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
const rows=lines.slice(1).map(l=>{const p=l.split(',');const o={};hdr.forEach((h,i)=>o[h.trim()]=(p[i]||'').trim());return o;})
  .filter(r=>r['Tanggal Pembayaran']);
console.log('=== isi CSV Paper ===');
console.log('baris:',rows.length);
const d=rows.map(r=>r['Tanggal Pembayaran']).sort();
console.log('rentang tanggal:',d[0],'s/d',d[d.length-1]);
const st={};rows.forEach(r=>st[r['Status Transaksi']]=(st[r['Status Transaksi']]||0)+1);
console.log('status:',JSON.stringify(st));
const tot=rows.reduce((s,r)=>s+Number(r['Jumlah Terbayar']||0),0);
console.log('total Jumlah Terbayar:',rp(tot));
const per={};rows.forEach(r=>{per[r['Penerima']]=per[r['Penerima']]||{n:0,t:0};per[r['Penerima']].n++;per[r['Penerima']].t+=Number(r['Jumlah Terbayar']||0);});
console.log('\npenerima teratas:');
for(const[k,v]of Object.entries(per).sort((a,b)=>b[1].t-a[1].t).slice(0,12))console.log(`  ${rp(v.t).padStart(14)} ${String(v.n).padStart(3)}× ${k}`);
// cocokkan ke ledger
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,entity,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const dd=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;
let ro=0,exp=0,none=0,other=0;const perluUbah=[],hilang=[];
const inBooks=rows.filter(r=>r['Tanggal Pembayaran']>='2026-01-01');
console.log(`\n=== cocokkan ${inBooks.length} transaksi (1 Jan 2026 ke atas) ke ledger ===`);
for(const r of inBooks){
  const a=Math.round(Number(r['Jumlah Terbayar']));
  const h=led.filter(x=>Math.abs(+x.amount_idr-a)<=1500&&dd(x.tx_date,r['Tanggal Pembayaran'])<=6);
  if(!h.length){none++;hilang.push(r);continue;}
  if(h.some(x=>x.tx_type==='reimburse_out'))ro++;
  else if(h.some(x=>x.tx_type==='expense')){exp++;perluUbah.push({r,l:h.find(x=>x.tx_type==='expense')});}
  else other++;
}
console.log(`  sudah reimburse_out : ${ro}`);
console.log(`  masih expense       : ${exp}  ← perlu diubah`);
console.log(`  tipe lain           : ${other}`);
console.log(`  tidak ada di ledger : ${none}`);
if(perluUbah.length){console.log('\nyang masih expense:');
  for(const p of perluUbah.slice(0,20))console.log(`  ${p.l.tx_date} ${rp(p.l.amount_idr).padStart(12)} ${nm(p.l.from_id).padEnd(14)} kat=${p.l.category_name||'-'} | ${p.r['Penerima']} · ${p.r['Berita Acara']}`);
  console.log(`  total: ${rp(perluUbah.reduce((s,p)=>s+ +p.l.amount_idr,0))}`);}
if(hilang.length){
  const g={};hilang.forEach(r=>g[r['Status Transaksi']]=(g[r['Status Transaksi']]||0)+1);
  console.log(`\ntidak ketemu di ledger (${hilang.length}) — per status: ${JSON.stringify(g)}`);
  const ok=hilang.filter(r=>r['Status Transaksi']==='Diteruskan');
  console.log(`  yang statusnya BERHASIL diteruskan tapi tak ada di ledger: ${ok.length} = ${rp(ok.reduce((s,r)=>s+Number(r['Jumlah Terbayar']),0))}`);
  for(const r of ok)console.log(`   ${r['Tanggal Pembayaran']} ${rp(r['Jumlah Terbayar']).padStart(12)} ${r['Penerima']} · ${r['Berita Acara']} [${r['Provider']}]`);
  const gagal=hilang.filter(r=>r['Status Transaksi']!=='Diteruskan');
  console.log(`  yang GAGAL diteruskan (wajar tak ada di ledger): ${gagal.length} = ${rp(gagal.reduce((s,r)=>s+Number(r['Jumlah Terbayar']),0))}`);}
process.exit(0);})();
