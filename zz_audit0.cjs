// AUDIT DARI NOL — tidak mengubah apa pun. Menguji tujuh hal yang HARUS benar.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,entity,from_id,from_type,to_id,to_type,category_name,description,reimburse_settlement_id,source').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const{data:sets}=await supabase.from('reimburse_settlements').select('*').eq('user_id',uid).order('settled_at');
console.log(`ledger ${led.length} baris | pelunasan ${(sets||[]).length}\n`);

console.log('UJI 1 — snapshot pelunasan vs baris yang sebenarnya');
console.log('  (total_out/total_in disimpan saat pelunasan dibuat; kalau barisnya diubah belakangan, snapshot jadi basi)');
let basi=0,selisihTotal=0;
for(const s of sets||[]){
  const rows=led.filter(r=>r.reimburse_settlement_id===s.id);
  const o=rows.filter(r=>r.tx_type==='reimburse_out').reduce((x,r)=>x+ +r.amount_idr,0);
  const i=rows.filter(r=>r.tx_type==='reimburse_in' ).reduce((x,r)=>x+ +r.amount_idr,0);
  const dOut=o-Number(s.total_out||0), dIn=i-Number(s.total_in||0);
  if(Math.abs(dOut)>1||Math.abs(dIn)>1){basi++;selisihTotal+=Math.abs(dOut)+Math.abs(dIn);
    if(basi<=8)console.log(`   ${s.id.slice(0,8)} ${String(s.settled_at).slice(0,10)} ${(s.entity||'').padEnd(8)} out tersimpan ${rp(s.total_out).padStart(13)} vs nyata ${rp(o).padStart(13)} (${rp(dOut)})`);}
}
console.log(`   → ${basi} dari ${(sets||[]).length} pelunasan snapshotnya BASI, total geser ${rp(selisihTotal)}\n`);

console.log('UJI 2 — apakah tiap pelunasan seimbang (out = in)?');
let takSeimbang=0,jml=0;
for(const s of sets||[]){
  const rows=led.filter(r=>r.reimburse_settlement_id===s.id);
  const o=rows.filter(r=>r.tx_type==='reimburse_out').reduce((x,r)=>x+ +r.amount_idr,0);
  const i=rows.filter(r=>r.tx_type==='reimburse_in' ).reduce((x,r)=>x+ +r.amount_idr,0);
  if(Math.abs(o-i)>1){takSeimbang++;jml+=(i-o);}
}
console.log(`   → ${takSeimbang} pelunasan tidak seimbang, selisih bersih ${rp(jml)}\n`);

console.log('UJI 3 — baris bersisi tunggal (tanpa akun sumber & tujuan)');
const tunggal=led.filter(r=>!r.from_id&&!r.to_id);
const pt={};for(const r of tunggal)pt[r.tx_type]=(pt[r.tx_type]||0)+1;
console.log(`   → ${tunggal.length} baris ${JSON.stringify(pt)}, nilai ${rp(tunggal.reduce((s,r)=>s+ +r.amount_idr,0))}\n`);

console.log('UJI 4 — piutang per entitas');
for(const e of['Hamasa','SDC','Personal']){
  const o=led.filter(r=>r.entity===e&&r.tx_type==='reimburse_out').reduce((s,r)=>s+ +r.amount_idr,0);
  const i=led.filter(r=>r.entity===e&&r.tx_type==='reimburse_in' ).reduce((s,r)=>s+ +r.amount_idr,0);
  const ob=led.filter(r=>r.entity===e&&r.tx_type==='reimburse_out'&&!r.reimburse_settlement_id).reduce((s,r)=>s+ +r.amount_idr,0);
  const ib=led.filter(r=>r.entity===e&&r.tx_type==='reimburse_in' &&!r.reimburse_settlement_id).reduce((s,r)=>s+ +r.amount_idr,0);
  console.log(`   ${e.padEnd(9)} semua ${rp(o-i).padStart(13)} | belum dicap ${rp(ob-ib).padStart(12)}`);
}
console.log('\nUJI 5 — fee Paper: apakah jumlahnya masuk akal?');
const fee=led.filter(r=>r.source==='paper-split');
console.log(`   ${fee.length} baris fee, ${rp(fee.reduce((s,r)=>s+ +r.amount_idr,0))} (CSV Paper 2026: 17.366.291 termasuk kanal)`);
const feeTanpaAkun=fee.filter(r=>!r.from_id);
console.log(`   fee tanpa akun sumber: ${feeTanpaAkun.length}`);

console.log('\nUJI 6 — duplikat persis (tanggal+nominal+tipe+akun sama)');
const key={};for(const r of led){const k=[r.tx_date,r.amount_idr,r.tx_type,r.from_id,r.to_id].join('|');(key[k]=key[k]||[]).push(r);}
const dup=Object.values(key).filter(v=>v.length>1);
console.log(`   → ${dup.length} kelompok duplikat, ${dup.reduce((s,v)=>s+(v.length-1),0)} baris berlebih, nilai ${rp(dup.reduce((s,v)=>s+ +v[0].amount_idr*(v.length-1),0))}`);
for(const v of dup.slice(0,6))console.log(`      ${v[0].tx_date} ${rp(v[0].amount_idr).padStart(11)} ×${v.length} ${v[0].tx_type} ${nm(v[0].from_id)} | ${(v[0].description||'').slice(0,34)}`);

console.log('\nUJI 7 — saldo akun vs mutasi ledger');
let meleset=0;
for(const x of acc.filter(y=>['bank','credit_card'].includes(y.type)&&y.is_active)){
  let s=Number(x.initial_balance||0);
  for(const r of led){ if(r.from_id===x.id&&r.from_type==='account')s+=(x.type==='credit_card'?1:-1)*+r.amount_idr;
                       if(r.to_id===x.id&&r.to_type==='account')  s+=(x.type==='credit_card'?-1:1)*+r.amount_idr; }
  const d=s-Number(x.current_balance||0);
  if(Math.abs(d)>1000&&x.type==='bank'){meleset++;if(meleset<=6)console.log(`   ${x.name.padEnd(16)} hitung ${rp(s).padStart(14)} vs tersimpan ${rp(x.current_balance).padStart(14)} (${rp(d)})`);}
}
console.log(`   → ${meleset} rekening bank melesat`);
process.exit(0);})();
