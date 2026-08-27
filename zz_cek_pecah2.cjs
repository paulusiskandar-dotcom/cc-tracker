const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:sp}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,notes').eq('user_id',uid).eq('source','split-email').order('tx_date');
console.log('baris piutang hasil pemecahan:',(sp||[]).length);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,from_id,notes').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
let salah=0;
for(const r of sp||[]){
  const m=(r.notes||'').match(/dipecah dari (?:tagihan )?([\d.]+)/);if(!m){console.log('  ⚠ tanpa catatan asal:',r.tx_date,rp(r.amount_idr));salah++;continue;}
  const asli=Number(m[1].replace(/\./g,''));
  const pas=led.find(x=>x.tx_date===r.tx_date&&x.from_id===r.from_id&&x.tx_type==='expense'&&Math.abs(+x.amount_idr-(asli-+r.amount_idr))<1);
  const ok=!!pas;if(!ok)salah++;
  console.log(`  ${r.tx_date} ${nm(r.from_id).padEnd(13)} tagihan ${rp(asli).padStart(11)} = piutang ${rp(r.amount_idr).padStart(10)} + pribadi ${rp(asli-+r.amount_idr).padStart(9)} → ${ok?'✓ pasangan ada':'⚠ PASANGAN TIDAK KETEMU'}`);
}
console.log(salah?`\n⚠ ${salah} bermasalah`:`\n✓ semua ${(sp||[]).length} pemecahan utuh, jumlahnya pas ke rupiah`);
console.log('\n=== 387.390: pola reimburse_in bulanan (bukti Indosat = internet SDC) ===');
const{data:ri}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,entity,description').eq('user_id',uid).eq('tx_type','reimburse_in').gte('amount_idr',387000).lte('amount_idr',387800).order('tx_date');
for(const r of ri||[])console.log(`  ${r.tx_date} ${rp(r.amount_idr)} entity=${r.entity||'-'} | ${(r.description||'').slice(0,55)}`);
process.exit(0);})();
