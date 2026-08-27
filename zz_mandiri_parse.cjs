// Parser e-Statement Mandiri (pdftotext -layout, pw 10101989).
// Baris tx: nomor urut + tanggal "DD Mon YYYY" + keterangan multi-baris +
// nominal ±x.xxx,xx + saldo berjalan. Validasi: saldo awal + Σ = saldo akhir.
const{execSync}=require('child_process');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const num=s=>Number(s.replace(/\./g,'').replace(',','.'));

function parseMandiri(path){
  const txt=execSync(`pdftotext -upw 10101989 -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');
  let saldoAwal=null,saldoAkhir=null,masuk=null,keluar=null;
  for(const l of lines){
    let m;
    if((m=l.match(/Saldo Awal\/Opening Balance\s*:?\s*([\d\.]+,\d{2})/)))saldoAwal=num(m[1]);
    if((m=l.match(/Saldo Akhir\/Closing Balance\s*:?\s*([\d\.]+,\d{2})/)))saldoAkhir=num(m[1]);
    if((m=l.match(/Incoming Transactions\s*:?\s*\+\s*([\d\.]+,\d{2})/)))masuk=num(m[1]);
    if((m=l.match(/Outgoing Transactions\s*:?\s*-\s*([\d\.]+,\d{2})/)))keluar=num(m[1]);
  }
  // baris transaksi: kumpulkan blok bernomor
  const rows=[];let cur=null;let pendingDate=null,pendingDesc=''; // tanggal kadang tercetak SEBELUM baris bernomor
  for(const raw of lines){
    const l=raw.replace(/\s+$/,'');
    const mSolo=l.match(/^\s*(\d{2} \w{3} \d{4})\s*(.*)$/);
    if(mSolo&&!/^\d/.test(mSolo[2].trim())){pendingDate=mSolo[1];pendingDesc=mSolo[2].trim();}
    // baris dengan nomor urut di kolom kiri
    const mNo=l.match(/^(\d{1,3})\s{2,}(.*)$/);
    const mDate=l.match(/(\d{2} \w{3} \d{4})/);
    const mAmt=l.match(/(-?[\d\.]+,\d{2})\s+([\d\.]+,\d{2})\s*$/); // nominal + saldo
    const mAmtOnly=l.match(/(-?[\d\.]+,\d{2})\s*$/);
    if(mNo){
      if(cur&&cur.amt!=null)rows.push(cur);
      cur={no:Number(mNo[1]),date:null,desc:'',amt:null,saldo:null};
      const rest=mNo[2];
      const d2=rest.match(/(\d{2} \w{3} \d{4})/);
      if(d2)cur.date=d2[1];else if(pendingDate){cur.date=pendingDate;if(pendingDesc)cur.pre=pendingDesc;}
      pendingDesc='';
      const a2=rest.match(/(-?[\d\.]+,\d{2})\s+([\d\.]+,\d{2})\s*$/);
      if(a2){cur.amt=num(a2[1]);cur.saldo=num(a2[2]);cur.desc=rest.slice(0,rest.indexOf(a2[1])).trim();}
      else{
        const a1=rest.match(/(-?[\d\.]+,\d{2})\s*$/);
        if(a1&&!d2){cur.amt=num(a1[1]);cur.desc=rest.slice(0,rest.indexOf(a1[1])).trim();}
        else cur.desc=rest.replace(/(\d{2} \w{3} \d{4})/,'').trim();
      }
      continue;
    }
    if(!cur)continue;
    if(/Halaman|Page|^\s*No\s|Tanggal|Remarks|Saldo \(|Balance \(|e-?Statement|PT Bank Mandiri/i.test(l)){continue;}
    if(mDate&&!cur.date){cur.date=mDate[1];
      const rest=l.replace(mDate[1],'');
      const a2=rest.match(/(-?[\d\.]+,\d{2})\s+([\d\.]+,\d{2})\s*$/);
      if(a2&&cur.amt==null){cur.amt=num(a2[1]);cur.saldo=num(a2[2]);}
      continue;}
    if(/^\s+\d{2}:\d{2}:\d{2}/.test(l)){
      const after=l.replace(/^\s+\d{2}:\d{2}:\d{2}\s*(WIB)?\s*/,'').trim();
      if(after&&!/^[\d\.,-]+$/.test(after))cur.desc=(cur.desc?cur.desc+' | ':'')+after;
      continue;} // jam (nama lawan transaksi sering ada setelah WIB)
    if(l.trim()){
      const a2=l.match(/(-?[\d\.]+,\d{2})\s+([\d\.]+,\d{2})\s*$/);
      if(a2&&cur.amt==null){cur.amt=num(a2[1]);cur.saldo=num(a2[2]);
        const d=l.slice(0,l.indexOf(a2[1])).trim();if(d)cur.desc=(cur.desc?cur.desc+' | ':'')+d;}
      else{
        const t=l.trim();
        if(!/^[\d\.]+,\d{2}$/.test(t))cur.desc=(cur.desc?cur.desc+' | ':'')+t;
        else if(cur.amt==null)cur.amt=num(t);
      }
    }
  }
  if(cur&&cur.amt!=null)rows.push(cur);
  return{rows,saldoAwal,saldoAkhir,masuk,keluar};
}

if(require.main===module){
const files=process.argv.slice(2);
let prev=null;
for(const f of files){
  const{rows,saldoAwal,saldoAkhir,masuk,keluar}=parseMandiri(f);
  const cr=rows.filter(r=>r.amt>0).reduce((s,r)=>s+r.amt,0);
  const db=rows.filter(r=>r.amt<0).reduce((s,r)=>s-r.amt,0);
  // saldo awal kadang tidak dicetak — pakai saldo baris pertama − amt pertama
  let sa=saldoAwal;
  if(sa==null&&rows.length&&rows[0].saldo!=null)sa=rows[0].saldo-rows[0].amt;
  const calc=sa+cr-db;
  const okHdr=(masuk!=null&&Math.abs(cr-masuk)<0.011&&Math.abs(db-keluar)<0.011)?'HDR✓':`HDR✗ cr${rp(cr-((masuk??0)))} db${rp(db-((keluar??0)))}`;
  const ok=saldoAkhir!=null?(Math.abs(calc-saldoAkhir)<0.011?'BALANCE':'SELISIH '+rp(calc-saldoAkhir)):'(?)';
  const chain=prev==null?'—':(Math.abs(prev-sa)<0.011?'NYAMBUNG':'PUTUS '+rp(prev-sa));
  console.log(`${f.split('/').pop().padEnd(52)} rows ${String(rows.length).padStart(3)} | awal ${rp(sa)} | akhir ${rp(saldoAkhir)} | ${ok} | ${okHdr} | rantai ${chain}`);
  prev=saldoAkhir;
  if(process.env.DUMP)for(const r of rows)console.log('  ',r.no,r.date,rp(r.amt).padStart(15),'|',r.desc.slice(0,80));
}
}
module.exports={parseMandiri};
