// Uji ulang yang tadi CACAT: saldo akun valas harus dihitung dalam mata uangnya,
// bukan rupiah. Dan ketidakseimbangan pelunasan diurai per sebab.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('*').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('UJI 7 (diperbaiki) — saldo akun, valas dihitung dalam mata uangnya');
let meleset=0;
for(const x of acc.filter(y=>['bank','credit_card'].includes(y.type)&&y.is_active)){
  const valas=x.currency&&x.currency!=='IDR';
  const nilai=r=>valas?Number(r.amount||0):Number(r.amount_idr||r.amount||0);
  let s=Number(x.initial_balance||0);
  for(const r of led){
    if(r.from_id===x.id&&r.from_type==='account')s+=(x.type==='credit_card'?1:-1)*nilai(r);
    if(r.to_id===x.id&&r.to_type==='account'){
      const v=(r.tx_type==='fx_exchange'&&r.fx_rate_used)?Number(r.amount)/Number(r.fx_rate_used):nilai(r);
      s+=(x.type==='credit_card'?-1:1)*v;}
  }
  const d=s-Number(x.current_balance||0);
  const batas=valas?1:1000;
  if(Math.abs(d)>batas){meleset++;console.log(`   ${x.name.padEnd(16)} ${(x.currency||'IDR').padEnd(4)} hitung ${rp(s).padStart(14)} vs tersimpan ${rp(x.current_balance).padStart(14)} (${rp(d)})`);}
}
console.log(`   → ${meleset} akun melesat\n`);
console.log('UJI 2 (diurai) — ketidakseimbangan pelunasan, sebabnya apa');
const{data:sets}=await supabase.from('reimburse_settlements').select('*').eq('user_id',uid);
let byFee=0,lain=0,nFee=0,nLain=0;
for(const s of sets||[]){
  const rows=led.filter(r=>r.reimburse_settlement_id===s.id);
  const o=rows.filter(r=>r.tx_type==='reimburse_out').reduce((x,r)=>x+ +r.amount_idr,0);
  const i=rows.filter(r=>r.tx_type==='reimburse_in' ).reduce((x,r)=>x+ +r.amount_idr,0);
  const d=i-o; if(Math.abs(d)<=1)continue;
  // fee Paper yang dipecah dari batch ini (tanggal berdekatan, kartu sama)
  const tgl=rows.map(r=>r.tx_date).sort();
  const fee=led.filter(r=>r.source==='paper-split'&&tgl.length&&r.tx_date>=tgl[0]&&r.tx_date<=tgl[tgl.length-1]&&rows.some(x=>x.from_id===r.from_id))
    .reduce((x,r)=>x+ +r.amount_idr,0);
  if(fee>0&&Math.abs(d-fee)<Math.abs(d)*0.6){byFee+=d;nFee++;} else {lain+=d;nLain++;}
}
console.log(`   dijelaskan pemecahan fee Paper : ${nFee} pelunasan, ${rp(byFee)}`);
console.log(`   BELUM dijelaskan               : ${nLain} pelunasan, ${rp(lain)}`);
process.exit(0);})();
