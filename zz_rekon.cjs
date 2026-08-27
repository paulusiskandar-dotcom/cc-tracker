// Rekonsiliasi piutang per entity per bulan: keluar vs masuk vs saldo berjalan.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>{const s=Math.round(Math.abs(n)).toLocaleString('id-ID');return (n<0?'-':'')+s;};
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,reimburse_settlement_id,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const E of ['Hamasa','SDC','Personal']){
  const rows=led.filter(r=>r.entity===E);
  if(!rows.length)continue;
  const m={};rows.forEach(r=>{const k=r.tx_date.slice(0,7);m[k]=m[k]||{out:0,inn:0,no:0,ni:0};
    if(r.tx_type==='reimburse_out'){m[k].out+= +r.amount_idr;m[k].no++;}else{m[k].inn+= +r.amount_idr;m[k].ni++;}});
  console.log(`\n═══ ${E} ═══`);
  console.log('bulan   |         keluar |          masuk |        selisih |   saldo berjalan');
  let saldo=0;
  for(const[k,v]of Object.entries(m).sort()){
    saldo+=v.out-v.inn;
    const d=v.out-v.inn;
    console.log(`${k} | ${rp(v.out).padStart(14)} | ${rp(v.inn).padStart(14)} | ${rp(d).padStart(14)} | ${rp(saldo).padStart(16)}`);
  }
  const tot=rows.reduce((s,r)=>s+(r.tx_type==='reimburse_out'?1:-1)* +r.amount_idr,0);
  console.log(`TOTAL   | ${rp(rows.filter(r=>r.tx_type==='reimburse_out').reduce((s,r)=>s+ +r.amount_idr,0)).padStart(14)} | ${rp(rows.filter(r=>r.tx_type==='reimburse_in').reduce((s,r)=>s+ +r.amount_idr,0)).padStart(14)} | ${rp(tot).padStart(14)} |`);
  const belum=rows.filter(r=>!r.reimburse_settlement_id);
  console.log(`  tanpa stempel settlement: ${belum.length} baris = ${rp(belum.reduce((s,r)=>s+(r.tx_type==='reimburse_out'?1:-1)* +r.amount_idr,0))}  ← inilah yg app tampilkan sebagai piutang hidup`);
}
process.exit(0);})();
