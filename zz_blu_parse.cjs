// Parser bluAccount (BCA Digital): blok "DD Mon YYYY / jam / keterangan",
// nominal (− utk keluar) + sisa saldo. Validasi: awal + Σ = akhir (header).
const{execSync}=require('child_process');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const num=s=>Number(s.replace(/\./g,'').replace(',','.'));

function parseBlu(path){
  const txt=execSync(`pdftotext -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');
  let open=null,close=null;
  for(const l of lines){
    const m=l.match(/(Initial Balance|Ending Balance)[^\d]*(?:Rp )?([\d\.]+,\d{2})\s*$/);
    if(m){if(/Initial/.test(m[1])&&open==null)open=num(m[2]);if(/Ending/.test(m[1]))close=num(m[2]);}
  }
  const rows=[];let cur=null;
  for(const raw of lines){
    const l=raw.replace(/\s+$/,'');
    const md=l.match(/^\s*(\d{1,2} \w{3} \d{4})\s+(.+)$/);
    if(md&&!/Initial Balance|Ending Balance/.test(l)){
      cur={dateRaw:md[1],desc:md[2].trim(),amt:null,db:false,saldo:null};rows.push(cur);continue;}
    if(!cur)continue;
    // baris nominal + saldo:  "   - 79,48   935.925,02" atau "  397,42  936.004,50"
    const ma=l.match(/^\s+(-\s?)?([\d\.]+,\d{2})\s+([\d\.]+,\d{2})\s*$/);
    if(ma&&cur.amt==null){cur.db=!!ma[1];cur.amt=num(ma[2]);cur.saldo=num(ma[3]);continue;}
    if(/^\s{10,}\S/.test(raw)&&!/^\s*\d{2}:\d{2}/.test(raw)&&raw.trim()&&!/Saldo|Total|Halaman|Page/.test(raw)){
      const t=raw.trim();
      if(!/^[-\s\d\.,]+$/.test(t))cur.desc+=' | '+t;
    }
  }
  const MON={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const clean=rows.filter(r=>r.amt!=null).map(r=>{
    const m=r.dateRaw.match(/(\d{1,2}) (\w{3}) (\d{4})/);
    return{...r,date:`${m[3]}-${MON[m[2]]}-${String(m[1]).padStart(2,'0')}`};
  });
  return{rows:clean,open,close};
}

if(require.main===module){
let prev=null;
for(const f of process.argv.slice(2)){
  const{rows,open,close}=parseBlu(f);
  const cr=rows.filter(r=>!r.db).reduce((s,r)=>s+r.amt,0);
  const db=rows.filter(r=>r.db).reduce((s,r)=>s+r.amt,0);
  const calc=(open||0)+cr-db;
  const ok=close!=null?(Math.abs(calc-close)<0.011?'BALANCE':'SELISIH '+rp(calc-close)):'?';
  const chain=prev==null?'—':(Math.abs(prev-open)<0.011?'NYAMBUNG':'PUTUS '+rp(prev-open));
  console.log(`${f.split('/').pop().padEnd(44)} rows ${String(rows.length).padStart(3)} | awal ${rp(open)} | akhir ${rp(close)} | ${ok} | ${chain}`);
  prev=close;
  if(process.env.DUMP)for(const r of rows)console.log('  ',r.date,(r.db?'-':'+')+rp(r.amt).padStart(14),'|',r.desc.slice(0,70));
}
}
module.exports={parseBlu};
