// Cocokkan CSV Paper 2026 dengan ledger. Struktur Paper:
//   Jumlah Terkirim  = yang diganti Hamasa
//   Biaya Tambahan   = fee Paper (ditanggung Paulus)
//   Jumlah Terbayar  = Terkirim + Biaya Tambahan  ... dan tagihan kartu = Terbayar + 1.000
// Jadi: kerugian per transaksi = Biaya Tambahan + 1.000 (cocok dgn baris Reimbursable Loss).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const CSV='/Users/paulusiskandar/Downloads/PaperPayOut_Transaction_History_1787796834.csv';
function parseCSV(t){const out=[];let row=[],cur='',q=false;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(q){ if(c==='"'&&t[i+1]==='"'){cur+='"';i++;} else if(c==='"'){q=false;} else cur+=c; }
    else if(c==='"')q=true; else if(c===','){row.push(cur);cur='';}
    else if(c==='\n'){row.push(cur);out.push(row);row=[];cur='';}
    else if(c!=='\r')cur+=c;}
  if(cur||row.length){row.push(cur);out.push(row);} return out;}
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const raw=parseCSV(fs.readFileSync(CSV,'utf8'));const H=raw[0];
const P=raw.slice(1).filter(r=>r.length>=13).map(r=>Object.fromEntries(H.map((h,i)=>[h,r[i]])))
  .filter(r=>r['Status Transaksi']==='Diteruskan'&&(r['Tanggal Pembayaran']||'')>='2026-01-01');
console.log('transaksi Paper 2026 (diteruskan):',P.length);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,category_name,description').eq('user_id',uid).gte('tx_date','2025-12-25').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const outs=led.filter(r=>r.tx_type==='reimburse_out'), ins=led.filter(r=>r.tx_type==='reimburse_in'),
      loss=led.filter(r=>r.category_name==='Reimbursable Loss');
const near=(a,b,t)=>Math.abs(a-b)<=t;
const dekat=(d1,d2,h)=>Math.abs(new Date(d1)-new Date(d2))/864e5<=h;
let sT=0,sF=0,adaTag=0,adaGanti=0,adaLoss=0,feeBelum=0;
const belum=[];
for(const r of P){
  const kirim=Math.round(+r['Jumlah Terkirim']), fee=Math.round(+r['Biaya Tambahan']), d=r['Tanggal Pembayaran'];
  sT+=kirim; sF+=fee;
  const tag=outs.find(x=>near(+x.amount_idr,kirim+fee+1000,1500)&&dekat(x.tx_date,d,7));
  const gan=ins.find(x=>near(+x.amount_idr,kirim,1500)&&dekat(x.tx_date,d,20));
  const los=loss.find(x=>near(+x.amount_idr,fee+1000,1500));
  if(tag)adaTag++; if(gan)adaGanti++; if(los){adaLoss++;loss.splice(loss.indexOf(los),1);} else {feeBelum+=fee+1000;belum.push([d,kirim,fee,!!tag,!!gan]);}
}
console.log(`\n  tagihan kartunya ada di ledger : ${adaTag}/${P.length}`);
console.log(`  penggantian Hamasa ada         : ${adaGanti}/${P.length}`);
console.log(`  fee sudah jadi Reimbursable Loss: ${adaLoss}/${P.length}`);
console.log(`\n  total terkirim 2026 : ${rp(sT)}`);
console.log(`  total fee Paper 2026: ${rp(sF)}  (+1.000/transaksi = ${rp(sF+P.length*1000)})`);
console.log(`  fee yang BELUM dibukukan jadi Loss: ${rp(feeBelum)}`);
console.log('\n=== transaksi Paper yang fee-nya belum jadi Reimbursable Loss ===');
console.log('  tanggal      terkirim         fee   tagihan?  ganti?');
for(const[d,k,f,t,g]of belum)console.log(`  ${d}  ${rp(k).padStart(13)}  ${rp(f+1000).padStart(10)}   ${t?'ada':'—  '}     ${g?'ada':'—'}`);
process.exit(0);})();
