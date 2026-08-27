// Parser statement BCA (pdftotext -layout) — mendukung file multi-valuta:
// tiap seksi "MATA UANG : XXX" diparse terpisah dengan saldo awal/akhir sendiri.
// TIDAK menulis DB. DUMP=1 utk daftar baris, CUR=IDR utk filter valuta.
const{execSync}=require('child_process');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const num=s=>Number(s.replace(/,/g,''));

function parseBCA(path){
  const txt=execSync(`pdftotext -layout ${JSON.stringify(path)} -`,{maxBuffer:20e6}).toString();
  const lines=txt.split('\n');
  const sections={}; // cur -> {rows,saldoAwal,saldoAkhir}
  let cur=null,sec=null,lastRow=null;
  for(const raw of lines){
    const line=raw.replace(/\s+$/,'');
    const mc=line.replace(/\s+/g,'').match(/MATAUANG:([A-Z]{3})/);
    if(mc){cur=mc[1];sec=sections[cur]=sections[cur]||{rows:[],saldoAwal:null,saldoAkhir:null};lastRow=null;continue;}
    if(!sec)continue;
    const m=line.match(/^\s{3,14}(\d{2}\/\d{2})\s+(.*)$/);
    if(m){
      const rest=m[2];
      if(/SALDO AWAL/.test(rest)){
        const sa=rest.match(/([\d,]+\.\d{2})/);
        if(sa&&sec.saldoAwal==null)sec.saldoAwal=num(sa[1]);
        lastRow=null;continue;
      }
      const amts=[...rest.matchAll(/([\d,]+\.\d{2})( DB)?/g)];
      if(!amts.length){lastRow={date:m[1],desc:rest.trim(),amt:null,db:false};sec.rows.push(lastRow);continue;}
      const a0=amts[0];
      const desc=rest.slice(0,rest.indexOf(a0[0])).replace(/\s+/g,' ').trim();
      lastRow={date:m[1],desc,amt:num(a0[1]),db:!!a0[2]};
      sec.rows.push(lastRow);continue;
    }
    // footer saldo akhir per seksi
    const se=line.match(/SALDO AKHIR\s*:?\s+([\d,]+\.\d{2})/i);
    if(se){sec.saldoAkhir=num(se[1]);continue;}
    // lanjutan keterangan
    if(lastRow&&/^\s{28,}/.test(raw)&&raw.trim()){
      const t=raw.trim();
      if(/SALDO|HALAMAN|PERIODE|TANGGAL|KETERANGAN|Bersambung|MUTASI (CR|DB)/i.test(t))continue;
      if(/^[\d,\.]+( DB)?$/.test(t)){
        if(lastRow.amt==null){const mm=t.match(/^([\d,]+\.\d{2})( DB)?$/);if(mm){lastRow.amt=num(mm[1]);lastRow.db=!!mm[2];}}
      } else lastRow.desc+=' | '+t;
    }
  }
  for(const c of Object.keys(sections))sections[c].rows=sections[c].rows.filter(r=>r.amt!=null);
  return sections;
}

if(require.main===module){
const files=process.argv.slice(2);
const filt=process.env.CUR||null;
const prevClose={};
for(const f of files){
  const secs=parseBCA(f);
  console.log(`\n=== ${f.split('/').pop()} ===`);
  for(const[c,sec]of Object.entries(secs)){
    if(filt&&c!==filt)continue;
    const cr=sec.rows.filter(r=>!r.db).reduce((s,r)=>s+r.amt,0);
    const db=sec.rows.filter(r=>r.db).reduce((s,r)=>s+r.amt,0);
    const calc=(sec.saldoAwal||0)+cr-db;
    const ok=sec.saldoAkhir!=null?(Math.abs(calc-sec.saldoAkhir)<0.011?'BALANCE':'SELISIH '+rp(calc-sec.saldoAkhir)):'(no akhir)';
    const chain=prevClose[c]==null?'—':(Math.abs(prevClose[c]-(sec.saldoAwal||0))<0.011?'NYAMBUNG':'PUTUS '+rp(prevClose[c]-sec.saldoAwal));
    console.log(` ${c}: rows ${String(sec.rows.length).padStart(3)} | awal ${rp(sec.saldoAwal)} | akhir ${rp(sec.saldoAkhir!=null?sec.saldoAkhir:calc)} | ${ok} | rantai ${chain}`);
    prevClose[c]=sec.saldoAkhir!=null?sec.saldoAkhir:calc;
    if(process.env.DUMP)for(const r of sec.rows)console.log('   ',r.date,(r.db?'-':'+')+rp(r.amt).padStart(14),'|',r.desc.slice(0,90));
  }
}
}
module.exports={parseBCA};
