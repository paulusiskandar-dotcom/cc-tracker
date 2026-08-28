// Januari: cari kombinasi baris KELUAR yang jumlahnya = tiap setoran.
// ⚠️ Subset-sum gampang overfit utk nominal kecil — makanya toleransi diketatkan
// ke Rp5.000 dan tiap setoran dilaporkan SEMUA solusinya, bukan yang pertama saja.
const fs=require('fs'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require(B+'app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('*').eq('user_id',uid).order('id').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const buka=led.filter(r=>r.entity==='Hamasa'&&!r.reimburse_settlement_id&&['reimburse_out','reimburse_in'].includes(r.tx_type));
const out=buka.filter(r=>r.tx_type==='reimburse_out'&&r.tx_date<'2026-02-01').sort((x,y)=>x.tx_date.localeCompare(y.tx_date));
const inn=buka.filter(r=>r.tx_type==='reimburse_in'&&r.tx_date<'2026-02-01').sort((x,y)=>x.tx_date.localeCompare(y.tx_date));
const T=v=>v.reduce((s,r)=>s+ +r.amount_idr,0);
console.log(`JANUARI · keluar ${out.length} baris ${rp(T(out))} · masuk ${inn.length} baris ${rp(T(inn))} · selisih ${rp(T(out)-T(inn))}\n`);
out.forEach((r,i)=>console.log(`  O${String(i+1).padStart(2)} ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).slice(0,14).padEnd(15)}| ${(r.description||'').slice(0,42)}`));
console.log();
inn.forEach((r,i)=>console.log(`  I${String(i+1).padStart(2)} ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.to_id).slice(0,14).padEnd(15)}| ${(r.description||'').slice(0,42)}`));
console.log('\n=== kombinasi keluar yang jumlahnya = setoran (toleransi 5.000, maks 6 baris) ===');
const v=out.map((r,i)=>({i,a:Math.round(+r.amount_idr)}));
for(const s of inn){
  const target=Math.round(+s.amount_idr);const sol=[];
  const rek=(mulai,sisa,pakai)=>{
    if(sol.length>=6)return;
    if(pakai.length&&Math.abs(sisa)<=5000){sol.push([...pakai]);return;}
    if(pakai.length>=6)return;
    for(let k=mulai;k<v.length;k++){if(v[k].a>sisa+5000)continue;pakai.push(k);rek(k+1,sisa-v[k].a,pakai);pakai.pop();}
  };
  rek(0,target,[]);
  console.log(`\n  ${s.tx_date} ${rp(target)} — ${(s.description||'').slice(0,40)}`);
  if(!sol.length){console.log('     tidak ada kombinasi');continue;}
  for(const c of sol.slice(0,6)){
    const j=c.reduce((t,k)=>t+v[k].a,0);
    console.log(`     ${c.map(k=>'O'+(k+1)).join(' + ')} = ${rp(j)} (beda ${rp(j-target)})`);
  }
  if(sol.length>6)console.log(`     … ${sol.length-6} kombinasi lain (terlalu banyak = bukan bukti)`);
}
process.exit(0);})();
