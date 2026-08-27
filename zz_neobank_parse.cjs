// Parser Neobank (Consolidated Statement, pw 10101989) — seksi Regular Savings.
// Baris: DD/MM/YYYY | deskripsi | mutasi | saldo. Arah ditentukan dari delta saldo.
const{execSync}=require('child_process');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const num=s=>Number(s.replace(/\./g,'').replace(',','.'));

function parseNeo(path){
  const txt=execSync(`pdftotext -upw 10101989 -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');
  const rows=[];let open=null,close=null,cur=null,prevSaldo=null;
  let inSec=false;
  for(const raw of lines){
    const l=raw.replace(/\s+$/,'');
    if(/Regular Savings\/Tabungan Regular/.test(l)){inSec=true;continue;}
    if(!inSec)continue;
    if(/Beginning Balance/.test(l)){const m=l.match(/([\d\.]+,\d{2})/);if(m&&open==null)open=num(m[1]);continue;}
    if(/Ending Balance/.test(l)){const m=l.match(/([\d\.]+,\d{2})/);if(m)close=num(m[1]);continue;}
    const m=l.match(/^\s*(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
    if(m){
      const rest=m[2];
      if(/Opening Balance/.test(rest)){const s=rest.match(/([\d\.]+,\d{2})/);if(s)prevSaldo=num(s[1]);cur=null;continue;}
      const amts=[...rest.matchAll(/([\d\.]+,\d{2})/g)];
      if(amts.length>=2){
        const mut=num(amts[amts.length-2][1]),sal=num(amts[amts.length-1][1]);
        const [d,mo,y]=m[1].split('/');
        const db=prevSaldo!=null?sal<prevSaldo:false;
        cur={date:`${y}-${mo}-${d}`,desc:rest.slice(0,rest.indexOf(amts[amts.length-2][0])).trim(),amt:mut,db,saldo:sal};
        rows.push(cur);prevSaldo=sal;
      } else if(amts.length===1){
        // mutasi tanpa saldo di baris sama (jarang) — tandai; saldo menyusul
        cur={date:m[1].split('/').reverse().join('-'),desc:rest.replace(amts[0][0],'').trim(),amt:num(amts[0][1]),db:null,saldo:null};
        rows.push(cur);
      } else {cur={date:m[1].split('/').reverse().join('-'),desc:rest.trim(),amt:null,db:null,saldo:null};rows.push(cur);}
      continue;
    }
    if(cur&&/^\s{10,}/.test(raw)&&raw.trim()&&!/Page|Statement|Date|Tanggal|Mutation|Balance|Customer/i.test(raw)){
      const t=raw.trim();
      if(!/^[\d\.,]+$/.test(t))cur.desc+=' | '+t;
    }
  }
  return{rows:rows.filter(r=>r.amt!=null),open,close};
}

if(require.main===module){
const files=process.argv.slice(2);
let prev=null;
for(const f of files){
  const{rows,open,close}=parseNeo(f);
  const cr=rows.filter(r=>!r.db).reduce((s,r)=>s+r.amt,0);
  const db=rows.filter(r=>r.db).reduce((s,r)=>s+r.amt,0);
  const calc=(open||0)+cr-db;
  const ok=close!=null?(Math.abs(calc-close)<0.011?'BALANCE':'SELISIH '+rp(calc-close)):'?';
  const chain=prev==null?'—':(Math.abs(prev-open)<0.011?'NYAMBUNG':'PUTUS '+rp(prev-open));
  console.log(`${f.split('/').pop().padEnd(34)} rows ${String(rows.length).padStart(3)} | awal ${rp(open)} | akhir ${rp(close)} | ${ok} | rantai ${chain}`);
  prev=close;
  if(process.env.DUMP)for(const r of rows)console.log('  ',r.date,(r.db?'-':'+')+rp(r.amt).padStart(14),'|',r.desc.slice(0,70));
}
}
module.exports={parseNeo};
