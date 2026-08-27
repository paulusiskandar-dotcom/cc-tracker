// Parser OCBC Tanda360 (pw 10Okt1989): TGL | uraian | DEBET | KREDIT | SALDO,
// baris "Berita :" = lanjutan deskripsi. Validasi: beginning + Σ = saldo akhir.
const{execSync}=require('child_process');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const num=s=>Number(s.replace(/,/g,''));

function parseOCBC(path){
  const txt=execSync(`pdftotext -upw 10Okt1989 -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');
  const rows=[];let open=null;let cur=null;let period=null;
  for(const raw of lines){
    const l=raw.replace(/\s+$/,'');
    const mp=l.match(/PERIODE.*:\s*(\d{2} \w+ \d{4})\s*-\s*(\d{2} \w+ \d{4})/);
    if(mp)period=mp[0];
    if(/Beginning Balance/.test(l)){const m=l.match(/([\d,]+\.\d{2})\s*$/);if(m&&open==null)open=num(m[1]);continue;}
    const m=l.match(/^\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+)$/);
    if(m){
      const rest=m[3];
      const nums=[...rest.matchAll(/([\d,]+\.\d{2})/g)];
      if(nums.length>=3){
        const debit=num(nums[nums.length-3][1]),credit=num(nums[nums.length-2][1]),saldo=num(nums[nums.length-1][1]);
        const desc=rest.slice(0,rest.indexOf(nums[nums.length-3][0])).trim();
        const[d,mo,y]=m[1].split('/');
        cur={date:`${y}-${mo}-${d}`,desc,amt:debit>0?debit:credit,db:debit>0,saldo};
        rows.push(cur);
      }
      continue;
    }
    if(cur&&/Berita\s*:/.test(l)){cur.desc+=' | '+l.replace(/.*Berita\s*:\s*/,'').trim();continue;}
  }
  const close=rows.length?rows[rows.length-1].saldo:open;
  return{rows,open,close,period};
}

if(require.main===module){
const files=process.argv.slice(2);
let prev=null;
for(const f of files){
  const{rows,open,close,period}=parseOCBC(f);
  const cr=rows.filter(r=>!r.db).reduce((s,r)=>s+r.amt,0);
  const db=rows.filter(r=>r.db).reduce((s,r)=>s+r.amt,0);
  const calc=(open||0)+cr-db;
  const ok=Math.abs(calc-close)<0.011?'BALANCE':'SELISIH '+rp(calc-close);
  const chain=prev==null?'—':(Math.abs(prev-open)<0.011?'NYAMBUNG':'PUTUS '+rp(prev-open));
  console.log(`${f.split('/').pop().padEnd(52)} rows ${String(rows.length).padStart(3)} | awal ${rp(open)} | akhir ${rp(close)} | ${ok} | rantai ${chain}`);
  prev=close;
  if(process.env.DUMP)for(const r of rows)console.log('  ',r.date,(r.db?'-':'+')+rp(r.amt).padStart(14),'|',r.desc.slice(0,75));
}
}
module.exports={parseOCBC};
