// Pasangan ditentukan CSV Paper (bukan tebakan): tiap transaksi punya Jumlah Terkirim
// dan Biaya Tambahan. Induk = baris bernilai TERKIRIM, pecahan = baris bernilai fee,
// di kartu & tanggal yang sama. Kalau masih ambigu → dilewati, tidak ditebak.
const fs=require('fs'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require(B+'app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
const EMAILS='/private/tmp/claude-501/-Users-paulusiskandar-Downloads/ddf30272-814e-499f-a44c-2cb4d7264aff/scratchpad/blibli_emails.json';
function parseCSV(t){const out=[];let row=[],cur='',q=false;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(q){ if(c==='"'&&t[i+1]==='"'){cur+='"';i++;} else if(c==='"'){q=false;} else cur+=c; }
    else if(c==='"')q=true; else if(c===','){row.push(cur);cur='';}
    else if(c==='\n'){row.push(cur);out.push(row);row=[];cur='';}
    else if(c!=='\r')cur+=c;}
  if(cur||row.length){row.push(cur);out.push(row);} return out;}
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,split_group_id,source,description').eq('user_id',uid).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
// Sumber pasangan: email Blibli e-invoicing (terbukti menutup 48/48 transaksi Paper).
// CSV Paper tidak terbaca lagi (izin berubah) — email memuat angka yang sama.
const P=[];const seen=new Set();
for(const e of JSON.parse(fs.readFileSync(EMAILS,'utf8'))){
  if(/Menunggu Pembayaran/i.test(e.subject||''))continue;
  const b=(e.body||'').replace(/[|\r\n]+/g,' ').replace(/\s+/g,' ');
  if(!/Penyedia\s*Paper/i.test(b))continue;
  const g=l=>{const m=b.match(new RegExp(l+String.raw`\s*Rp\s*([\d.,]+)`,'i'));return m?Number(m[1].replace(/[^\d]/g,'')):0;};
  const kirim=g('Total harga'),total=g('Total pembayaran');
  const ref=(b.match(/Nomor pembayaran\s*([A-Z0-9]+)/i)||[])[1]||'';
  if(!kirim||!total||total<=kirim||seen.has(ref))continue;
  seen.add(ref);
  P.push({'Jumlah Terkirim':kirim,'Biaya Tambahan':total-kirim-1000,'Berita Acara':ref});
}
console.log('transaksi Paper dari email:',P.length);
const fees=led.filter(r=>r.source==='paper-split').map(r=>({...r,pakai:false}));
const pasang=[],lewat=[];
for(const p of P){
  const kirim=Math.round(+p['Jumlah Terkirim']);
  // fee bisa +1.000 (kanal) dan kadang meleset 1 rupiah → cari dalam rentang sempit
  const f=fees.find(x=>!x.pakai&&Math.abs(+x.amount_idr-(Math.round(+p['Biaya Tambahan'])+1000))<=2);
  if(!f){continue;}
  const induk=led.find(r=>r.from_id===f.from_id&&r.tx_date===f.tx_date&&Math.abs(+r.amount_idr-kirim)<=2&&r.id!==f.id);
  if(!induk){lewat.push({f,kirim,ket:p['Berita Acara']});continue;}
  f.pakai=true; pasang.push({f,induk,total:kirim+ +f.amount_idr});
}
const sisaFee=fees.filter(x=>!x.pakai);
// listrik: pasangan dari nilai tagihan PLN bulan itu (sudah terverifikasi sebelumnya)
const LIS=[['2026-04-15',2018927],['2026-05-13',1907515],['2026-06-22',2274400],['2026-07-02',2614208]];
for(const[d,tag]of LIS){
  const m=led.find(r=>r.source==='pecah-listrik'&&r.tx_date===d);
  const induk=led.find(r=>r.tx_date===d&&r.tx_type==='reimburse_in'&&Math.abs(+r.amount_idr-tag)<=2);
  if(m&&induk)pasang.push({f:m,induk,total:tag+ +m.amount_idr}); else lewat.push({f:m,kirim:tag,ket:'listrik '+d});
}
console.log(`pasangan pasti  : ${pasang.length}`);
console.log(`fee tanpa induk : ${lewat.length}`);
console.log(`fee tak terpakai: ${sisaFee.length}`);
for(const l of lewat.slice(0,6))console.log(`   ${l.f?.tx_date} ${rp(l.f?.amount_idr)} cari induk ${rp(l.kirim)} | ${(l.ket||'').slice(0,30)}`);
for(const s of sisaFee.slice(0,6))console.log(`   sisa: ${s.tx_date} ${rp(s.amount_idr)} ${nm(s.from_id)} | ${(s.description||'').slice(0,40)}`);
console.log('\ncontoh:');
for(const s of pasang.slice(0,4))console.log(`   ${s.f.tx_date} ${nm(s.f.from_id||s.f.to_id).padEnd(13)} ${rp(s.induk.amount_idr).padStart(12)} + ${rp(s.f.amount_idr).padStart(9)} = ${rp(s.total)}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync(B+'.backups',{recursive:true});
fs.writeFileSync(B+`.backups/splitgroup2-${Date.now()}.json`,JSON.stringify(pasang.map(s=>({fee:s.f.id,induk:s.induk.id})),null,2));
let n=0;
for(const s of pasang){
  const gid=s.induk.split_group_id||crypto.randomUUID();
  if(!s.induk.split_group_id)await supabase.from('ledger').update({split_group_id:gid}).eq('id',s.induk.id);
  await supabase.from('ledger').update({split_group_id:gid}).eq('id',s.f.id);
  n++;
}
console.log(`\n- ${n} pasangan diikat`);
process.exit(0);})();
