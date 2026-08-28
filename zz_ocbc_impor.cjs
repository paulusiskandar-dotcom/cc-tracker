// Impor statement OCBC 90N 12 Feb & 12 Mar 2026 — dua statement yang selama ini
// dikira hilang, padahal ada di Gmail (e-statement@ocbc.id, password 10Okt1989).
// Keduanya lolos uji saldo: Feb 139.708.330 + 100.468.572 − 147.277.300 = 92.899.602
// Mar  92.899.602 + 133.979.871 −  93.138.602 = 133.740.871  (rantai nyambung).
// Baris PAYMENT (ATM) TIDAK diinsert — kelimanya sudah ada di sisi bank sbg pay_cc.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');

// [tanggal, nominal, keterangan, jenis, entitas, kategori]  jenis: RO=reimburse_out, RI=reimburse_in, E=expense
const TX=[
 ['2026-01-15',    5000,'CHARGE BILLING E-STATEMENT FEE','E','Personal','Bank & Card Fees'],
 ['2026-01-15', 3215930,'Tokopedia — Alice Dental (Tokopedia SDC, kartu Paulus)','RO','SDC',null],
 ['2026-01-19',   14500,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-01-21',47937677,'PT. GLOBAL DIGITAL NIA CentralJakartID','RO','Hamasa',null],
 ['2026-01-21',10070105,'PT. GLOBAL DIGITAL NIA CentralJakartID','RO','Hamasa',null],
 ['2026-01-22',  349000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-01-23', 2277300,'TURKISH AIRL WWW.TURKISHAIGB — refund tiket (diteruskan ke Charine 30 Mar)','RI','Personal',null],
 ['2026-01-27',  218000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-01-30',  346000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-01-31', 6576361,'PT. GLOBAL DIGITAL NIA CentralJakartID','RO','Hamasa',null],
 ['2026-01-31',11171499,'PT. GLOBAL DIGITAL NIA CentralJakartID','RO','Hamasa',null],
 ['2026-02-03',18271000,'PT. GLOBAL DIGITAL NIA CentralJakartID','RO','Hamasa',null],
 ['2026-02-04', 1954500,'GARUDA REDEMPTION WEB Tangerang','E','Personal','Travel'],
 ['2026-02-07',  319000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-02-12',   10000,'BIAYA NOTIFIKASI','E','Personal','Bank & Card Fees'],
 ['2026-02-12',   10000,'STAMP DUTY','E','Personal','Bank & Card Fees'],
 ['2026-02-12',43536048,'PT. GLOBAL DIGITAL NIA CentralJakartID','RO','Hamasa',null],
 ['2026-02-19',    5000,'CHARGE BILLING E-STATEMENT FEE','E','Personal','Bank & Card Fees'],
 ['2026-02-19',   14500,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-02-22',  349000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-02-23',  479000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-02-24',47917677,'PT. GLOBAL DIGITAL NIA CentralJakartID','RO','Hamasa',null],
 ['2026-02-24',10065148,'PT. GLOBAL DIGITAL NIA CentralJakartID','RO','Hamasa',null],
 ['2026-02-27',   89000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-02-28',  287000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-02-28',11171499,'PT. GLOBAL DIGITAL NIA https://xendi ID','RO','Hamasa',null],
 ['2026-03-02',  239000,'APPLE.COM/BILL ITUNES.COM IE — refund','RI','Personal',null],
 ['2026-03-04',18279999,'PT. GLOBAL DIGITAL NIA https://xendi ID','RO','Hamasa',null],
 ['2026-03-07',   29000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-03-07',  169000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-03-07',  319000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-03-11',  249000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-03-01', 1000000,'ANNUAL FEE - PRINC RENEW','E','Personal','Bank & Card Fees'],
 ['2026-03-12',   10000,'BIAYA NOTIFIKASI','E','Personal','Bank & Card Fees'],
 ['2026-03-12',   10000,'STAMP DUTY','E','Personal','Bank & Card Fees'],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const oc=accounts.find(a=>a.name==='OCBC 90N');
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n)?.id||null;
// bentuk contoh: baris reimburse_out Hamasa OCBC 90N yang sudah ada
const{data:ct}=await supabase.from('ledger').select('from_type,to_type,to_id,reimburse_settlement_id').eq('user_id',uid).eq('from_id',oc.id).eq('tx_type','reimburse_out').eq('entity','Hamasa').limit(1).single();
console.log('bentuk contoh reimburse_out:',JSON.stringify(ct));
// Cap yang benar = pelunasan historis 31 Maret 2026. Baris contoh di atas hanya
// dipakai utk MENIRU BENTUK (from_type/to_type/to_id), bukan capnya — capnya
// milik periode Apr–Mei dan akan salah kalau dipakai untuk Feb/Mar.
const{data:hist}=await supabase.from('reimburse_settlements').select('id,entity').eq('user_id',uid).eq('settled_at','2026-03-31');
const CAP=Object.fromEntries((hist||[]).map(s=>[s.entity,s.id]));
for(const e of['Hamasa','SDC','Personal']) if(!CAP[e]) throw new Error('cap historis 31 Mar tidak ada utk '+e);
console.log('cap lunas:',Object.fromEntries(Object.entries(CAP).map(([k,v])=>[k,v?v.slice(0,8):null])));
const deb=TX.filter(t=>t[3]!=='RI').reduce((s,t)=>s+t[1],0), cr=TX.filter(t=>t[3]==='RI').reduce((s,t)=>s+t[1],0);
console.log(`\n${TX.length} baris | belanja ${rp(deb)} | kredit ${rp(cr)}`);
console.log(`uji Feb: 139.708.330 + 100.468.572 − 147.277.300 = ${rp(139708330+100468572-147277300)} (tagihan 92.899.602)`);
console.log(`uji Mar:  92.899.602 + 133.979.871 −  93.138.602 = ${rp(92899602+133979871-93138602)} (tagihan 133.740.871)`);
const{data:ada}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('from_id',oc.id).gte('tx_date','2026-01-13').lte('tx_date','2026-03-12');
console.log('baris OCBC 90N yang sudah ada di jendela ini:',(ada||[]).length,(ada||[]).length?'<<< BATAL, sudah pernah diimpor':'(aman)');
if((ada||[]).length){process.exit(1);}
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
const ids=[];
try{
for(const[d,amt,desc,jenis,ent,kat]of TX){
  const base={user_id:uid,tx_date:d,amount:amt,amount_idr:amt,currency:'IDR',description:desc,
    source:'statement',notes:'impor statement OCBC 90N (12 Feb & 12 Mar 2026)',entity:ent};
  let row;
  if(jenis==='RI') row={...base,tx_type:'reimburse_in',from_type:'reimburse',from_id:null,to_type:'account',to_id:oc.id,reimburse_settlement_id:CAP[ent]};
  else if(jenis==='RO') row={...base,tx_type:'reimburse_out',from_type:'account',from_id:oc.id,to_type:ct.to_type,to_id:ct.to_id,reimburse_settlement_id:CAP[ent]};
  else row={...base,tx_type:'expense',from_type:'account',from_id:oc.id,to_type:'expense',to_id:null,category_id:cat(kat),category_name:kat};
  const{data,error}=await supabase.from('ledger').insert([row]).select('id').single();
  if(error)throw new Error(error.message+' @ '+d+' '+desc);
  ids.push(data.id);
}
await recalculateBalance(oc.id,uid);
const{data:after}=await supabase.from('accounts').select('current_balance').eq('id',oc.id).single();
console.log(`\n- ${ids.length} baris masuk`);
console.log('  saldo OCBC 90N:',rp(after.current_balance),'(sebelum',rp(oc.current_balance)+')');
}catch(e){console.log('!! ROLLBACK:',e.message);for(const id of ids)await supabase.from('ledger').delete().eq('id',id);process.exit(1);}
let led=[];for(let off=0;;off+=1000){const{data:x}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(x||[]);if(!x||x.length<1000)break;}
const e={};for(const q of led){const k=q.entity||'-';e[k]=e[k]||{o:0,i:0};e[k][q.tx_type==='reimburse_out'?'o':'i']+= +q.amount_idr;}
console.log('\n=== piutang ===');
for(const[k,v]of Object.entries(e))console.log(`  ${k.padEnd(9)} keluar ${rp(v.o).padStart(14)}  masuk ${rp(v.i).padStart(14)}  piutang ${rp(v.o-v.i).padStart(13)}`);
process.exit(0);})();
