// Koreksi presisi: fee harus = tagihan ASLI - terkirim (bukan angka CSV yang bisa
// meleset 1 rupiah). Baca cadangan split, betulkan baris fee yang selisih.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const bakFile=fs.readdirSync('.backups').filter(f=>f.startsWith('split-paper-')).sort().pop();
const bak=JSON.parse(fs.readFileSync('.backups/'+bakFile,'utf8'));
console.log('cadangan:',bakFile,'|',bak.plan.length,'pecahan');
const{data:feeRows}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,description').eq('user_id',uid).eq('source','paper-split');
console.log('baris fee terpasang:',(feeRows||[]).length);
const kartu=new Set();let n=0;
for(const p of bak.plan){
  const benar=Math.round(+p.amount - p.kirim);      // fee sejati dari tagihan asli
  if(benar===p.fee)continue;
  // cari baris fee pasangan: tanggal & nilai fee lama
  const{data:asal}=await supabase.from('ledger').select('tx_date,from_id').eq('id',p.id).single();
  const f=(feeRows||[]).find(x=>x.tx_date===asal.tx_date&&x.from_id===asal.from_id&&Math.abs(+x.amount_idr-p.fee)<1&&!x._pakai);
  if(!f){console.log('  !! fee tak ketemu utk',p.id.slice(0,8),rp(p.fee));continue;}
  f._pakai=true;
  await supabase.from('ledger').update({amount:benar,amount_idr:benar}).eq('id',f.id);
  kartu.add(asal.from_id);n++;
  console.log(`  ${asal.tx_date} ${nm(asal.from_id).padEnd(14)} fee ${rp(p.fee)} → ${rp(benar)}  (tagihan asli ${rp(p.amount)})`);
}
for(const k of kartu)await recalculateBalance(k,uid);
console.log(`\n${n} baris fee dikoreksi`);
// verifikasi ulang saldo kartu vs sebelum pecah (dari mutasi)
const cek=async(k)=>{let s=0;
  for(const col of['from_id','to_id']){let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('amount_idr').eq('user_id',uid).eq(col,k).range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
    for(const r of all)s+=(col==='from_id'?1:-1)*+r.amount_idr;}
  return s;};
const target={'OCBC 90N':7767609,'Maybank MU':75999,'Mandiri Bonvoy':4593378,'BCA Krisflyer':14760427,'Maybank VI':40023804};
console.log('\n=== saldo kartu vs sebelum pecah ===');
let beres=true;
for(const[nma,v]of Object.entries(target)){const a=accounts.find(x=>x.name===nma);const s=await cek(a.id);
  const ok=Math.abs(s-v)<1;if(!ok)beres=false;
  console.log(`  ${(ok?'✓':'✗')} ${nma.padEnd(14)} ${rp(s).padStart(14)} (target ${rp(v)})`);}
console.log(beres?'  SEMUA SALDO KARTU UTUH — pecahan netral':'  !! masih meleset');
process.exit(0);})();
