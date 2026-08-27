// Parser e-Statement Jenius (Saldo Aktif IDR) — pdftotext -layout.
// Blok: "DD Mon YYYY  DESKRIPSI  ±x.xxx.xxx" + baris lanjutan (bank/kartu, tipe).
// Validasi: SALDO SEBELUMNYA + Σ = saldo akhir ringkasan; Σ± = Transaksi Masuk/Keluar.
const{execSync}=require('child_process');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const num=s=>Number(s.replace(/\./g,'').replace(',','.'));

function parseJenius(path){
  const txt=execSync(`pdftotext -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');
  // ringkasan
  const sum=txt.match(/Saldo Aktif\s+IDR\s+([\d\.]+)\s+\+([\d\.]+)\s+-([\d\.]+)\s+([\d\.]+)/);
  const summary=sum?{awal:num(sum[1]),masuk:num(sum[2]),keluar:num(sum[3]),akhir:num(sum[4])}:null;
  // area detail: mulai dari "Saldo Aktif IDR ... Tertera rincian" s/d "Saldo Aktif USD/SGD/..." atau "Tabungan"
  let start=-1,end=lines.length;
  for(let i=0;i<lines.length;i++){
    if(start<0&&/Saldo Aktif IDR\s+.*Tertera rincian/.test(lines[i]))start=i;
    else if(start>=0&&/Saldo Aktif (USD|SGD|EUR|JPY|GBP|THB|CNY)/.test(lines[i])){end=i;break;}
  }
  const rows=[];let cur=null;let saldoAwal=null;
  for(let i=start;i<end&&i>=0;i++){
    const l=lines[i].replace(/\s+$/,'');
    if(/SALDO SEBELUMNYA/.test(l)){const m=l.match(/([\d\.]+)\s*$/);if(m)saldoAwal=num(m[1]);cur=null;continue;}
    const m=l.match(/^(\d{2} \w{3} \d{4})\s+(.+?)\s+([+-][\d\.]+)$/);
    if(m){cur={date:m[1],desc:m[2].trim(),amt:num(m[3].replace('+','')),raw3:m[3]};
      if(m[3].startsWith('-'))cur.amt=-Math.abs(cur.amt);
      rows.push(cur);continue;}
    // header tanggal tanpa nominal di baris yg sama (jarang) → skip aman
    const mh=l.match(/^(\d{2} \w{3} \d{4})\s+(.+)$/);
    if(mh&&!/^\d{2}:\d{2}/.test(mh[2])){cur={date:mh[1],desc:mh[2].trim(),amt:null};rows.push(cur);continue;}
    if(cur&&l.trim()&&!/^\d{2}:\d{2}/.test(l.trim())&&!/TANGGAL & JAM|RINCIAN|CATATAN|ID Transaksi|Tipe Transaksi|dari \d+|E-STATEMENT/.test(l)){
      const t=l.trim();
      const ma=t.match(/^([+-][\d\.]+)$/);
      if(ma&&cur.amt==null){cur.amt=num(ma[1].replace('+',''));if(ma[1].startsWith('-'))cur.amt=-Math.abs(cur.amt);}
      else cur.desc+=' | '+t;
    }
  }
  const clean=rows.filter(r=>r.amt!=null);
  return{rows:clean,saldoAwal,summary};
}

if(require.main===module){
const files=process.argv.slice(2);
let prev=null;
for(const f of files){
  const{rows,saldoAwal,summary}=parseJenius(f);
  const masuk=rows.filter(r=>r.amt>0).reduce((s,r)=>s+r.amt,0);
  const keluar=rows.filter(r=>r.amt<0).reduce((s,r)=>s-r.amt,0);
  const calc=(saldoAwal??summary?.awal??0)+masuk-keluar;
  const okM=summary?(Math.abs(masuk-summary.masuk)<1&&Math.abs(keluar-summary.keluar)<1?'ΣOK':`Σ✗ m${rp(masuk-summary.masuk)} k${rp(keluar-summary.keluar)}`):'?';
  const okA=summary?(Math.abs(calc-summary.akhir)<1?'BALANCE':'SELISIH '+rp(calc-summary.akhir)):'?';
  const chain=prev==null?'—':(Math.abs(prev-(saldoAwal??summary?.awal))<1?'NYAMBUNG':'PUTUS '+rp(prev-(saldoAwal??summary?.awal)));
  console.log(`${f.split('/').pop().padEnd(36)} rows ${String(rows.length).padStart(3)} | awal ${rp(saldoAwal??summary?.awal)} | akhir ${rp(summary?.akhir)} | ${okA} | ${okM} | rantai ${chain}`);
  prev=summary?.akhir;
  if(process.env.DUMP)for(const r of rows)console.log('  ',r.date,rp(r.amt).padStart(14),'|',r.desc.slice(0,85));
}
}
module.exports={parseJenius};
