const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const SC='/private/tmp/claude-501/-Users-paulusiskandar-Downloads/ddf30272-814e-499f-a44c-2cb4d7264aff/scratchpad';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const R=JSON.parse(fs.readFileSync(SC+'/pln_receipts.json','utf8')).filter(r=>r.total>0);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
console.log('=== tiap struk vs buku (cari nominal persis ±7 hari) ===');
const miss=[];
for(const r of R.sort((a,b)=>a.tgl<b.tgl?-1:1)){
  const cand=led.filter(x=>Math.abs(+x.amount_idr-r.total)<1&&Math.abs(new Date(x.tx_date)-new Date(r.tgl))/864e5<=7&&x.tx_type!=='reimburse_in'&&x.tx_type!=='income');
  const c=cand[0];
  const label=(r.nama||r.biller).slice(0,24);
  if(c)console.log(`  ${r.tgl} ${rp(r.total).padStart(12)} ${label.padEnd(24)} → ${c.tx_type.padEnd(13)} ${(c.entity||'-').padEnd(8)} ${nm(c.from_id)}`);
  else{miss.push(r);console.log(`  ${r.tgl} ${rp(r.total).padStart(12)} ${label.padEnd(24)} → *** TIDAK ADA DI BUKU ***`);}
}
console.log(`\n  hilang: ${miss.length} struk, ${rp(miss.reduce((s,r)=>s+r.total,0))}`);
console.log('\n=== khusus Suryanto + Paulus per bulan vs reimburse_in listrik ===');
const SP=R.filter(r=>/SURYANTO|PAULUS/.test(r.nama||''));
const bln={};for(const r of SP){const m=r.blth||r.tgl.slice(0,7);bln[m]=(bln[m]||0)+r.total;}
for(const[m,v]of Object.entries(bln))console.log(`  ${m}  ${rp(v).padStart(12)}`);
console.log('  reimburse_in listrik tercatat: 15 Apr 5.182.122 | 13 Mei 5.289.200 | 22 Jun 5.095.500 | 2 Jul 5.892.000');
process.exit(0);})();
