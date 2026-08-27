// Amazon JP — dari screenshot riwayat pesanan Paulus (Gmail tidak memuat email Amazon).
// Cocok berdasarkan nominal JPY yang persis sama dengan Grand Total di layar.
// + Suryanto Salim PLN → reimburse_out Hamasa (Paulus).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const PIUTANG='f282ac7e-a908-4e5d-adb0-144473e9f126', SETTLE='014ccdfa-5837-4e32-a9ef-c6ce6fae8142';
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const before=Object.fromEntries(accounts.filter(a=>a.type==='credit_card').map(a=>[a.name,Number(a.outstanding_amount||0)]));
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
// kunci = nominal JPY (kolom amount), bukan rupiah
const AZ={
 26956:{k:'Health & Personal Care',  n:'FANCL Inner Fat Support + serat 3× + ETVOS massage brush (pesanan 503-0534667-5312633, 1 Jun; ¥27.676 − promo ¥720)'},
 14935:{k:'Health & Personal Care',  n:'Ikirarin Blueberry functional drink 4× (pesanan 250-0863333-2213446, 19 Jun; ¥17.920 − poin ¥2.985)'},
 1612 :{k:'Health & Personal Care',  n:'Vasilisa Kurumi Design Nude (pesanan 503-1722151-6968650, kirim 3 Jun)'},
 5534 :{k:'Health & Personal Care',  n:'sisa pesanan 503-1722151-6968650, kirim 4 Jun (¥7.146 − ¥1.612)'},
 9000 :{k:'Hobbies & Entertainment', n:'Nintendo prepaid ¥9.000'},
 5000 :{k:'Hobbies & Entertainment', n:'Nintendo prepaid ¥5.000 (pesanan 21 Jan)'},
 6982 :{k:'Hobbies & Entertainment', n:'Mario Tennis Fever unduhan (pesanan 8 Feb) — kecocokan dari tanggal, bukan harga tertulis'},
 11008:{k:'Electronics & Gadgets',   n:'Spigen case MacBook Air 13" M5 ¥9.349 + bantal leher ¥1.659 (pesanan 503-3847632-0294241, 2 Jun)'},
};
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount,amount_idr,currency,from_id,category_name,description').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const az=led.filter(r=>r.tx_type==='expense'&&/AMAZON\.CO\.JP/i.test(r.description||''));
console.log('=== Amazon Jepang di ledger:',az.length,'baris ===');
const jobs=[];
for(const r of az){
  const m=(r.description||'').match(/JPY\s*([\d.,]+)/i);
  const jpy=m?Math.round(parseFloat(m[1].replace(/[.,]/g,''))):null;
  const v=AZ[jpy];
  console.log(`  ${r.tx_date} JPY ${String(jpy??'?').padStart(6)} = ${rp(r.amount_idr).padStart(10)} ${v?'→ '+v.k:'→ MASIH TIDAK JELAS'}`);
  if(v)jobs.push({r,v});
}
console.log(`\ncocok ${jobs.length} dari ${az.length}`);
const jp=r=>{const m=(r.description||'').match(/JPY\s*([\d.,]+)/i);return m?Math.round(parseFloat(m[1].replace(/[.,]/g,''))):null;};
const sisa=az.filter(r=>!AZ[jp(r)]);
if(sisa.length){console.log('belum terjawab:',sisa.map(r=>`${r.tx_date} JPY ${jp(r)} (${rp(r.amount_idr)})`).join(' · '));}
// Suryanto
const sur=led.find(r=>r.tx_type==='expense'&&Math.abs(+r.amount_idr-1034675)<1&&/lazada/i.test(r.description||''));
console.log('\n=== PLN Suryanto Salim ===');
console.log(sur?`  ${sur.tx_date} ${rp(sur.amount_idr)} → reimburse_out Hamasa`:'  tidak ketemu');
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/amazon_${Date.now()}.json`,JSON.stringify([...jobs.map(j=>j.r),sur].filter(Boolean),null,1));
let ok=0;
for(const j of jobs){const c=C(j.v.k);const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:j.v.n}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
if(sur){const{error}=await supabase.from('ledger').update({tx_type:'reimburse_out',to_type:'account',to_id:PIUTANG,entity:'Hamasa',
  reimburse_settlement_id:SETTLE,category_id:null,category_name:null,
  notes:'tagihan PLN a.n. SURYANTO SALIM (tarif bisnis B2 11.000 VA) via Lazada — reimburse Hamasa (Paulus)'}).eq('id',sur.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL suryanto',error.message);}
console.log(`\nditulis ${ok}`);
const after=await accountsApi.getAll(uid);
let beda=0;for(const a of after.filter(a=>a.type==='credit_card'))if(Math.abs(before[a.name]-Number(a.outstanding_amount||0))>0.5){console.log(`⚠ ${a.name} berubah`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
