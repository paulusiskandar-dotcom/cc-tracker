// UJI COBA pemecahan fee Paper di sumber, untuk seluruh transaksi Paper 2026.
// Aturan: tagihan kartu (reimburse_out) = Jumlah Terkirim + Biaya Tambahan + 1.000.
// Pecah jadi: reimburse_out sebesar Terkirim (piutang sah) + expense fee di kartu
// yang sama & tanggal sama (saldo kartu tak berubah). Baris Loss lama utk fee
// Paper dihapus (digantikan pecahan). Verifikasi: saldo kartu, piutang, Reports.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
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
  .filter(r=>r['Status Transaksi']==='Diteruskan'&&r['Tanggal Pembayaran']>='2026-01-01')
  .sort((a,b)=>a['Tanggal Pembayaran']<b['Tanggal Pembayaran']?-1:1);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,amount,entity,from_id,to_id,to_type,category_name,reimburse_settlement_id,description').eq('user_id',uid).gte('tx_date','2025-12-28').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const ro=led.filter(r=>r.tx_type==='reimburse_out');
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const catFee=cats.find(c=>c.name==='Bank & Card Fees');
const plan=[];const gagal=[];const pakai=new Set();
for(const r of P){
  const kirim=Math.round(+r['Jumlah Terkirim']),fee=Math.round(+r['Biaya Tambahan'])+1000,d=r['Tanggal Pembayaran'];
  let tag=ro.find(x=>!pakai.has(x.id)&&Math.abs(+x.amount_idr-(kirim+fee))<=2&&Math.abs(new Date(x.tx_date)-new Date(d))/864e5<=7);
  let feePakai=fee;
  if(!tag){ // cadangan: tagihan nyata bisa lebih kecil dari hitungan CSV (Feb -5rb..-20rb);
            // statement=final, jadi fee = tagihan - terkirim.
    tag=ro.find(x=>!pakai.has(x.id)&&+x.amount_idr>kirim&&+x.amount_idr<=kirim+fee+2&&
      /GLOBAL DIGITAL|BLIBLI|PAPER/i.test(x.description||'')&&Math.abs(new Date(x.tx_date)-new Date(d))/864e5<=9);
    if(tag)feePakai=Math.round(+tag.amount_idr-kirim);
  }
  if(!tag){gagal.push({d,kirim,fee,ref:r['Nomor Referensi'],ket:r['Berita Acara']});continue;}
  pakai.add(tag.id);
  plan.push({tag,kirim,fee:feePakai,feeCSV:fee,ket:r['Berita Acara']||'',ke:r['Penerima']});
}
console.log(`Paper 2026: ${P.length} transaksi | terpasang ke reimburse_out: ${plan.length} | tak ketemu: ${gagal.length}`);
for(const g of gagal)console.log(`  tak ketemu: ${g.d} kirim ${rp(g.kirim)} fee ${rp(g.fee)} | ${(g.ket||'').slice(0,30)}`);
// baris Loss lama yang nilainya = fee salah satu transaksi → dihapus (digantikan pecahan)
let{data:loss}=await supabase.from('ledger').select('id,tx_date,amount_idr,entity,description').eq('user_id',uid).eq('category_name','Reimbursable Loss');
const lossPakai=[];const sisaLoss=[...(loss||[])];
for(const p of plan){
  const i=sisaLoss.findIndex(x=>Math.abs(+x.amount_idr-p.fee)<=2||Math.abs(+x.amount_idr-p.feeCSV)<=2);
  if(i>=0)lossPakai.push(...sisaLoss.splice(i,1));
}
console.log(`\nbaris Loss lama yang akan dihapus (digantikan pecahan): ${lossPakai.length}, ${rp(lossPakai.reduce((s,r)=>s+ +r.amount_idr,0))}`);
console.log(`baris Loss yang DIBIARKAN (bukan fee Paper): ${sisaLoss.length}`);
for(const r of sisaLoss)console.log(`   biarkan: ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${r.entity} | ${(r.description||'').slice(0,40)}`);
const totFee=plan.reduce((s,p)=>s+p.fee,0);
console.log(`\ntotal fee yang dipecah: ${rp(totFee)} | piutang akan turun sebesar ini`);
// saldo kartu sebelum
const kartu=[...new Set(plan.map(p=>p.tag.from_id))];
const saldoK=async()=>{const o={};for(const k of kartu){let s=0;
  for(const col of['from_id','to_id']){let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('amount_idr').eq('user_id',uid).eq(col,k).range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
    for(const r of all)s+=(col==='from_id'?1:-1)*+r.amount_idr;}
  o[nm(k)]=s;}return o;};
const sebelum=await saldoK();
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/split-paper-${Date.now()}.json`,JSON.stringify({plan:plan.map(p=>({id:p.tag.id,amount:p.tag.amount_idr,kirim:p.kirim,fee:p.fee})),lossPakai},null,2));
let n=0;
for(const p of plan){
  const{error:e1}=await supabase.from('ledger').update({amount:p.kirim,amount_idr:p.kirim,
    description:(p.tag.description||'').replace(/\s*—.*$/,'').slice(0,180)+` — via Paper.id (fee ${rp(p.fee)} dipecah sbg beban)`}).eq('id',p.tag.id);
  if(e1)throw new Error(e1.message);
  const{error:e2}=await supabase.from('ledger').insert([{user_id:uid,tx_date:p.tag.tx_date,tx_type:'expense',
    amount:p.fee,amount_idr:p.fee,currency:'IDR',entity:p.tag.entity,
    from_type:'account',from_id:p.tag.from_id,to_type:'expense',to_id:null,
    category_id:catFee.id,category_name:'Bank & Card Fees',
    description:`Fee Paper.id 1,55% + kanal 1.000 — ${(p.ket||p.ke).slice(0,60)}`,
    source:'paper-split',notes:'pecahan fee dari tagihan Paper (bukan piutang)'}]);
  if(e2)throw new Error(e2.message);
  n++;
}
for(const l of lossPakai)await supabase.from('ledger').delete().eq('id',l.id);
for(const k of kartu)await recalculateBalance(k,uid);
console.log(`\n- ${n} tagihan dipecah, ${lossPakai.length} baris Loss lama dihapus`);
const sesudah=await saldoK();
console.log('\n=== VERIFIKASI saldo kartu (harus identik) ===');
let beres=true;
for(const k of Object.keys(sebelum)){const ok=Math.abs(sebelum[k]-sesudah[k])<1;if(!ok)beres=false;
  console.log(`  ${(ok?'✓':'✗')} ${k.padEnd(14)} ${rp(sebelum[k]).padStart(14)} → ${rp(sesudah[k]).padStart(14)}`);}
console.log(beres?'  SEMUA SALDO KARTU UTUH':'  !! ADA SALDO BERUBAH');
let l2=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);l2=l2.concat(x||[]);if(!x||x.length<1000)break;}
const e={};for(const q of l2){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
console.log('\n=== piutang sesudah pecah ===');
for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
process.exit(0);})();
