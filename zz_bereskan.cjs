// 1) Hapus baris kembar 10 Jan 2.386.000 (dua sisipan identik, detik yang sama — cacat skrip).
// 2) 22 Jun 5.095.500 bukan dividen, tapi penggantian listrik Suryanto Salim + Paulus (Hamasa).
// 3) Dua setoran Agnes (19 Jan & 13 Feb, @50jt) belum dicap lunas padahal pasangannya sudah.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const bak=[];const touch=new Set();

// --- 1. baris kembar 10 Jan
const{data:dup}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-01-10').eq('amount_idr',2386000).eq('tx_type','reimburse_in').order('id');
console.log('1) baris kembar 10 Jan:',dup.length,'baris');
if(dup.length!==2){console.log('   !! bukan 2 — dilewati');}

// --- 2. 22 Jun 5.095.500
const{data:jun}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date','2026-06-22').eq('amount_idr',5095500).eq('tx_type','income');
console.log('2) 22 Jun 5.095.500:',jun.length,'baris —',(jun[0]?.description||'').slice(0,52));
// cap lunas yang dipakai baris reimburse_in Hamasa lain di Juni
const{data:ref}=await supabase.from('ledger').select('reimburse_settlement_id').eq('user_id',uid).eq('tx_type','reimburse_in').eq('entity','Hamasa').gte('tx_date','2026-06-01').lte('tx_date','2026-06-30').not('reimburse_settlement_id','is',null).limit(1);
const cap=ref?.[0]?.reimburse_settlement_id||null;
console.log('   cap lunas Hamasa Juni:',cap?cap.slice(0,8):'(tidak ada — dibiarkan terbuka)');

// --- 3. dua setoran Agnes belum dicap
const{data:ag}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_type','reimburse_in').eq('amount_idr',50000000).is('reimburse_settlement_id',null).in('tx_date',['2026-01-19','2026-02-13']);
console.log('3) setoran Agnes belum dicap:',ag.length,'baris');
const caps={};
for(const r of ag){const{data:p}=await supabase.from('ledger').select('reimburse_settlement_id').eq('user_id',uid).eq('tx_type','reimburse_out').eq('tx_date',r.tx_date).eq('amount_idr',50000000).not('reimburse_settlement_id','is',null).limit(1);
  caps[r.id]=p?.[0]?.reimburse_settlement_id||null;
  console.log(`   ${r.tx_date} → cap pasangannya ${caps[r.id]?caps[r.id].slice(0,8):'TIDAK ADA'}`);}

if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/bereskan-${Date.now()}.json`,JSON.stringify({dup,jun,ag},null,2));

if(dup.length===2){await supabase.from('ledger').delete().eq('id',dup[1].id);touch.add(dup[1].to_id);console.log('\n- dihapus baris kembar',dup[1].id.slice(0,8));}
if(jun.length===1){await supabase.from('ledger').update({tx_type:'reimburse_in',from_type:null,from_id:null,entity:'Hamasa',
  reimburse_settlement_id:cap,description:'Setoran tunai — penggantian listrik Suryanto Salim + Paulus Iskandar (Hamasa)'}).eq('id',jun[0].id);
  touch.add(jun[0].to_id);console.log('- 5.095.500 jadi reimburse_in Hamasa');}
for(const r of ag)if(caps[r.id]){await supabase.from('ledger').update({reimburse_settlement_id:caps[r.id]}).eq('id',r.id);console.log('- setoran Agnes',r.tx_date,'dicap lunas');}
for(const id of touch)if(id)await recalculateBalance(id,uid);

let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,entity,reimburse_settlement_id').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
for(const[label,f]of[['SEMUA',()=>true],['BERJALAN (belum dicap)',r=>!r.reimburse_settlement_id]]){
  const e={};for(const r of led.filter(f)){const k=r.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][r.tx_type==='reimburse_out'?'o':'i']+= +r.amount_idr;}
  console.log(`\n=== piutang ${label} ===`);
  for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(10)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
}
for(const id of touch)if(id){const{data:a}=await supabase.from('accounts').select('name,current_balance').eq('id',id).single();console.log(`  saldo ${a.name}: ${rp(a.current_balance)}`);}
process.exit(0);})();
