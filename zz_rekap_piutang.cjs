// Rekap SELURUH piutang untuk ditinjau Paulus satu per satu.
// Pencocokan bertahap: (1) nominal persis ±45 hari, (2) mendekati ≤2% ±45 hari,
// (3) borongan setoran (satu masuk menutup beberapa keluar berdekatan).
// Sisanya = yang benar-benar perlu keputusan.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,description,reimburse_settlement_id,source,category_name').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const hari=(x,y)=>Math.abs(new Date(x)-new Date(y))/864e5;
const hasil={};
for(const ent of['Hamasa','SDC','Personal']){
  const outs=led.filter(r=>r.entity===ent&&r.tx_type==='reimburse_out').map(r=>({...r,sisa:+r.amount_idr}));
  const ins =led.filter(r=>r.entity===ent&&r.tx_type==='reimburse_in' ).map(r=>({...r,sisa:+r.amount_idr}));
  // 1) persis
  for(const i of ins) for(const o of outs){ if(i.sisa<=0)break;
    if(o.sisa>0&&Math.abs(o.sisa-i.sisa)<1&&hari(o.tx_date,i.tx_date)<=45){const m=Math.min(o.sisa,i.sisa);o.sisa-=m;i.sisa-=m;} }
  // 2) mendekati (pembulatan ≤2%)
  for(const i of ins) for(const o of outs){ if(i.sisa<=0)break;
    if(o.sisa>0&&Math.abs(o.sisa-i.sisa)/Math.max(o.sisa,i.sisa)<=0.02&&hari(o.tx_date,i.tx_date)<=45){const m=Math.min(o.sisa,i.sisa);o.sisa-=m;i.sisa-=m;} }
  // 3) borongan
  for(const i of ins) for(const o of outs){ if(i.sisa<=0)break;
    if(o.sisa>0&&hari(o.tx_date,i.tx_date)<=45){const m=Math.min(o.sisa,i.sisa);o.sisa-=m;i.sisa-=m;} }
  const sisaOut=outs.filter(r=>r.sisa>1000), sisaIn=ins.filter(r=>r.sisa>1000);
  hasil[ent]={
    totOut:outs.reduce((s,r)=>s+ +r.amount_idr,0), totIn:ins.reduce((s,r)=>s+ +r.amount_idr,0),
    nOut:outs.length, nIn:ins.length,
    belumGanti:sisaOut.map(r=>({id:r.id,tgl:r.tx_date,nilai:r.sisa,penuh:+r.amount_idr,kartu:nm(r.from_id),ket:r.description||'',cap:!!r.reimburse_settlement_id})),
    lebihTerima:sisaIn.map(r=>({id:r.id,tgl:r.tx_date,nilai:r.sisa,penuh:+r.amount_idr,akun:nm(r.to_id),ket:r.description||'',cap:!!r.reimburse_settlement_id})),
  };
}
// Loss & Surplus bersisi tunggal
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const sur=srcs.find(s=>s.name==='Reimbursable Surplus');
let all=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,to_id,description,category_name').eq('user_id',uid).range(off,off+999);all=all.concat(c||[]);if(!c||c.length<1000)break;}
hasil._loss=all.filter(r=>r.category_name==='Reimbursable Loss').map(r=>({id:r.id,tgl:r.tx_date,nilai:+r.amount_idr,ent:r.entity,ket:r.description||'',tunggal:!r.from_id}));
hasil._surplus=all.filter(r=>r.from_id===sur.id).map(r=>({id:r.id,tgl:r.tx_date,nilai:+r.amount_idr,ent:r.entity,ket:r.description||'',tunggal:!r.to_id}));
fs.writeFileSync('/private/tmp/claude-501/-Users-paulusiskandar-Downloads/ddf30272-814e-499f-a44c-2cb4d7264aff/scratchpad/piutang.json',JSON.stringify(hasil,null,1));
for(const ent of['Hamasa','SDC','Personal']){const h=hasil[ent];
  console.log(`\n=== ${ent} ===`);
  console.log(`  keluar ${rp(h.totOut).padStart(14)} (${h.nOut} baris) | masuk ${rp(h.totIn).padStart(14)} (${h.nIn} baris)`);
  console.log(`  BELUM DIGANTI : ${h.belumGanti.length} baris, ${rp(h.belumGanti.reduce((s,r)=>s+r.nilai,0))}`);
  console.log(`  LEBIH TERIMA  : ${h.lebihTerima.length} baris, ${rp(h.lebihTerima.reduce((s,r)=>s+r.nilai,0))}`);
}
console.log(`\nLoss bersisi tunggal: ${hasil._loss.filter(r=>r.tunggal).length} | Surplus bersisi tunggal: ${hasil._surplus.filter(r=>r.tunggal).length}`);
process.exit(0);})();
