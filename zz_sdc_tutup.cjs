const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
// betulkan label: 2e59e6d3 = HERLINA (baris "Transfer Berhasil..." dari email), 1c8be611 = HENNY (BI-FAST)
const{data:rows}=await supabase.from('ledger').select('id,description').eq('user_id',uid).eq('tx_date','2026-08-03').eq('amount_idr',1750000).eq('tx_type','reimburse_in').order('id');
for(const r of rows){
  const herlina=r.id.startsWith('2e59e6d3');
  await supabase.from('ledger').update({description:(herlina?'HERLINA DJOHARI':'HENNY DJOHARI')+' — patungan hotel Singapore (pasangan TRIPCOM 3.459.324 tgl 3 Ags)'}).eq('id',r.id);
  console.log(' ',r.id.slice(0,8),'→',herlina?'HERLINA DJOHARI':'HENNY DJOHARI');
}
// rekonsiliasi SDC yang jujur: pasangkan greedy, sisanya tampilkan apa adanya
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,description').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).eq('entity','SDC').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const outs=led.filter(r=>r.tx_type==='reimburse_out').map(r=>({...r,sisa:+r.amount_idr}));
const ins =led.filter(r=>r.tx_type==='reimburse_in').map(r=>({...r,sisa:+r.amount_idr}));
// 1) pasangan persis, 2) pasangan mendekati (<=3% atau <=50rb) dalam 45 hari, 3) borongan setoran besar
for(const tol of[0,50000]) for(const i of ins){ if(i.sisa<=0)continue;
  for(const o of outs){ if(o.sisa<=0)continue;
    if(Math.abs(o.sisa-i.sisa)<=tol&&Math.abs(new Date(o.tx_date)-new Date(i.tx_date))/864e5<=45){const m=Math.min(o.sisa,i.sisa);o.sisa-=m;i.sisa-=m;break;} } }
for(const i of ins){ if(i.sisa<=0)continue;
  for(const o of outs){ if(o.sisa<=0||Math.abs(new Date(o.tx_date)-new Date(i.tx_date))/864e5>45)continue;
    const m=Math.min(o.sisa,i.sisa);o.sisa-=m;i.sisa-=m; if(i.sisa<=0)break; } }
console.log('\n=== SISA yang benar-benar tidak berpasangan ===');
let si=0,so=0;
console.log('  MASUK tanpa tagihan:');
for(const i of ins.filter(r=>r.sisa>0.5)){si+=i.sisa;console.log(`    ${i.tx_date} ${rp(i.sisa).padStart(11)} | ${(i.description||'').slice(0,56)}`);}
console.log('  KELUAR belum diganti:');
for(const o of outs.filter(r=>r.sisa>0.5)){so+=o.sisa;console.log(`    ${o.tx_date} ${rp(o.sisa).padStart(11)} ${nm(o.from_id).padEnd(13)} | ${(o.description||'').slice(0,42)}`);}
console.log(`\n  masuk tanpa tagihan ${rp(si)} − keluar belum diganti ${rp(so)} = ${rp(si-so)}`);
const tot=ins.reduce((s,r)=>s+ +r.amount_idr,0)-outs.reduce((s,r)=>s+ +r.amount_idr,0);
console.log(`  piutang SDC tercatat: ${rp(-tot)}  ${Math.abs((si-so)-tot)<1?'✓ cocok':'✗ MELESET '+rp((si-so)-tot)}`);
process.exit(0);})();
