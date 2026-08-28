const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
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
const raw=parseCSV(fs.readFileSync(CSV,'utf8'));const H=raw[0];
const P=raw.slice(1).filter(r=>r.length>=13).map(r=>Object.fromEntries(H.map((h,i)=>[h,r[i]])))
  .filter(r=>r['Status Transaksi']==='Diteruskan'&&r['Tanggal Pembayaran']>='2026-01-01'&&r['Tanggal Pembayaran']<='2026-03-31');
const fee=P.reduce((s,r)=>s+Math.round(+r['Biaya Tambahan'])+1000,0);
console.log('=== uraian selisih batch Januari–Maret 53.743.384 ===');
console.log(`  setoran tunai 48jt (11 Mar) yang dipindah jadi dividen   ${rp(48000000).padStart(14)}`);
console.log(`  fee Paper Jan–Mar (${P.length} transaksi, +1.000 tiap satu)      ${rp(fee).padStart(14)}`);
const sisa=53743384-48000000-fee;
console.log(`  ${'sisa (kelebihan penggantian lain)'.padEnd(55)} ${rp(sisa).padStart(14)}`);
console.log(`  ${'JUMLAH'.padEnd(55)} ${rp(48000000+fee+sisa).padStart(14)}`);
console.log(`\n  → ${Math.abs(sisa)<2000000?'terjelaskan; sisa '+rp(Math.abs(sisa))+' saja':'MASIH ADA '+rp(Math.abs(sisa))+' yang belum jelas'}`);
console.log('\n=== catatan penting ===');
console.log('  Baris Reimbursable Loss bertipe expense tanpa akun sumber, jadi ia');
console.log('  MEMUNCULKAN biayanya di Reports tapi TIDAK mengurangi piutang.');
console.log('  Akibatnya piutang Hamasa akan terus naik sebesar fee tiap bulan.');
const{data:l}=await supabase.from('ledger').select('amount_idr').eq('user_id',uid).eq('category_name','Reimbursable Loss').eq('entity','Hamasa');
console.log('  Reimbursable Loss Hamasa tercatat:',rp((l||[]).reduce((s,r)=>s+ +r.amount_idr,0)));
process.exit(0);})();
