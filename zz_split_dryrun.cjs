// DRY RUN pemecahan manual — memakai matchRows() ASLI dari ReconcileOverlay
// dan statement SUNGGUHAN hasil ekstraksi PDF (.backups/cc_*), bukan tiruan.
// Yang dibuktikan: setelah dipecah, grup masih cocok ke baris statement yang SAMA;
// dan kalau syaratnya dilanggar, ia memang rusak (kontrol negatif).
const fs=require('fs'),path=require('path'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require(B+'app.headless.cjs');
const{matchRows}=require(B+'match.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');

// pecah nominal jadi n bagian bulat yang jumlahnya PERSIS sama
const bagi=(total,n)=>{const d=Math.floor(total/n),a=Array(n).fill(d);a[n-1]=total-d*(n-1);return a;};
const pecah=(row,n,{pakaiGroupId=true,geser=0}={})=>{
  const total=Math.round(Number(row.amount_idr??row.amount??0));
  const bag=bagi(total,n); bag[n-1]+=geser;                 // geser = uji toleransi
  const gid=pakaiGroupId?'gid-uji-'+row.id.slice(0,8):null;
  return bag.map((v,i)=>({...row,id:`${row.id}#${i}`,amount:v,amount_idr:v,split_group_id:gid,
    description:`${row.description} (${i+1}/${n})`}));
};

(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('*').eq('user_id',uid).order('id').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}

const berkas=[];
for(const dir of ['cc_apr','cc_feb','cc_jan']){
  const p=B+'.backups/'+dir; if(!fs.existsSync(p))continue;
  for(const f of fs.readdirSync(p).filter(x=>x.endsWith('.json')))berkas.push(path.join(p,f));
}
const cocokAkun=(d)=>{
  const l4=(d.tx||[]).map(t=>t.card_last4).filter(Boolean)[0];
  return acc.find(x=>l4&&String(x.card_last4||'')===String(l4))||acc.find(x=>x.name===d.detected)||null;
};
const jalan=(stmt,rows)=>{const r=matchRows(stmt,rows);
  return{cocok:r.matched.size,hilang:r.missing.length,lebih:r.extraIds.size,peta:r.matched};};

let diuji=0;
for(const f of berkas){
  let d;try{d=JSON.parse(fs.readFileSync(f,'utf8'));}catch{continue;}
  if(!Array.isArray(d.tx)||d.tx.length<5)continue;
  const A=cocokAkun(d); if(!A)continue;
  const stmt=d.tx.map((t,i)=>({...t,_id:'s'+i,amount:Math.round(Number(t.amount||0))}));
  const tgl=stmt.map(t=>t.date).filter(Boolean).sort();
  const rows=led.filter(r=>r.from_id===A.id&&r.tx_date>=tgl[0]&&r.tx_date<=tgl[tgl.length-1]);
  if(rows.length<3)continue;
  const dasar=jalan(stmt,rows);
  if(dasar.cocok<3)continue;

  // kandidat: baris yang COCOK, bukan bagian split, tanpa cicilan/pinjaman, tak ter-Finalize
  const kand=rows.find(r=>dasar.peta.has(r.id)&&!r.split_group_id&&!r.installment_id
    &&!r.employee_loan_id&&!r.reimburse_settlement_id&&Number(r.amount_idr)>=50000);
  if(!kand)continue;
  diuji++;
  const garisStmt=dasar.peta.get(kand.id);
  console.log(`\n═══ ${A.name} · ${path.basename(f)} · ${stmt.length} baris statement, ${rows.length} baris ledger`);
  console.log(`    dasar: ${dasar.cocok} cocok · ${dasar.hilang} hilang · ${dasar.lebih} lebih`);
  console.log(`    kandidat pecah: ${kand.tx_date} ${rp(kand.amount_idr)} — ${(kand.description||'').slice(0,40)}`);

  const uji=(label,n,opt)=>{
    const bagian=pecah(kand,n,opt);
    const rows2=rows.filter(r=>r.id!==kand.id).concat(bagian);
    const h=jalan(stmt,rows2);
    const semua=bagian.every(b=>h.peta.get(b.id)?._id===garisStmt._id);
    const lainUtuh=rows.filter(r=>r.id!==kand.id&&dasar.peta.has(r.id))
      .every(r=>h.peta.get(r.id)?._id===dasar.peta.get(r.id)._id);
    const jml=bagian.reduce((s,b)=>s+b.amount_idr,0);
    const ok=semua&&lainUtuh&&h.hilang===dasar.hilang&&h.lebih===dasar.lebih;
    console.log(`    ${ok?'LULUS':'GAGAL'}  ${label.padEnd(44)} ${bagian.filter(b=>h.peta.get(b.id)?._id===garisStmt._id).length}/${n} pecahan ke baris statement yg sama · hilang ${h.hilang} (dasar ${dasar.hilang}) · lebih ${h.lebih} (dasar ${dasar.lebih})${lainUtuh?'':' · BARIS LAIN BERGESER'}`);
  };
  uji('3 bagian, split_group_id ADA',3,{});
  uji('5 bagian, split_group_id ADA',5,{});
  uji('9 bagian, split_group_id ADA',9,{});
  uji('3 bagian, TANPA split_group_id',3,{pakaiGroupId:false});
  uji('5 bagian, TANPA split_group_id',5,{pakaiGroupId:false});
  uji('3 bagian, group ADA, selisih +50 (dlm toleransi)',3,{geser:50});
  uji('3 bagian, group ADA, selisih +500 (LEWAT toleransi)',3,{geser:500});
  if(diuji>=4)break;
}
console.log(`\n${diuji} statement diuji.`);
process.exit(0);})();
