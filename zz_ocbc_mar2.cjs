// Sisa statement OCBC 90N periode 13 Mar – 12 Apr: seluruh baris 13–31 Maret tidak
// pernah masuk ledger (11 baris, 141.552.657). Terdeteksi dari selisih rantai saldo
// yang TETAP −140.552.657 sejak 12 April — tanda satu blok hilang, bukan kesalahan
// menyebar. Selisih 1.000.000 = annual fee 1 Mar yang sudah masuk lewat statement Maret.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
const TX=[
 ['2026-03-13', 2539750,'PT. GLOBAL DIGITAL NIA https://xendi ID','RO','Hamasa',null],
 ['2026-03-13', 1778125,'PT. GLOBAL DIGITAL NIA https://xendi ID','RO','Hamasa',null],
 ['2026-03-13',47937677,'PT. GLOBAL DIGITAL NIA https://xendi ID','RO','Hamasa',null],
 ['2026-03-13',10070105,'PT. GLOBAL DIGITAL NIA https://xendi ID','RO','Hamasa',null],
 ['2026-03-16',67024000,'PT. GLOBAL DIGITAL NIA https://xendi ID','RO','Hamasa',null],
 ['2026-03-17',    5000,'CHARGE BILLING E-STATEMENT FEE','E','Personal','Bank & Card Fees'],
 ['2026-03-20',   14500,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-03-23',  349000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-03-27',   89000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-03-30',  574000,'APPLE.COM/BILL ITUNES.COM IE','E','Personal','Subscriptions & Software'],
 ['2026-03-31',11171500,'PT. GLOBAL DIGITAL NIA https://xendi ID','RO','Hamasa',null],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const oc=accounts.find(a=>a.name==='OCBC 90N');
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n)?.id||null;
const{data:hist}=await supabase.from('reimburse_settlements').select('id,entity').eq('user_id',uid).eq('settled_at','2026-03-31');
const CAP=Object.fromEntries((hist||[]).map(s=>[s.entity,s.id]));
const{data:ada}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('from_id',oc.id).gte('tx_date','2026-03-13').lte('tx_date','2026-03-31');
console.log('baris 13–31 Mar yang sudah ada:',(ada||[]).length,(ada||[]).length?'<<< BATAL':'(aman)');
if((ada||[]).length)process.exit(1);
console.log('akan masuk',TX.length,'baris, jumlah',rp(TX.reduce((s,t)=>s+t[1],0)));
if(!APPLY){console.log('(dry-run)');process.exit(0);}
const ids=[];
try{
for(const[d,amt,desc,jenis,ent,kat]of TX){
  const base={user_id:uid,tx_date:d,amount:amt,amount_idr:amt,currency:'IDR',description:desc,
    source:'statement',notes:'impor statement OCBC 90N (12 Apr 2026, bagian 13–31 Mar)',entity:ent};
  const row=jenis==='RO'
    ?{...base,tx_type:'reimburse_out',from_type:'account',from_id:oc.id,to_type:'account',to_id:'f282ac7e-a908-4e5d-adb0-144473e9f126',reimburse_settlement_id:CAP[ent]}
    :{...base,tx_type:'expense',from_type:'account',from_id:oc.id,to_type:'expense',to_id:null,category_id:cat(kat),category_name:kat};
  const{data,error}=await supabase.from('ledger').insert([row]).select('id').single();
  if(error)throw new Error(error.message+' @ '+d);
  ids.push(data.id);
}
console.log('-',ids.length,'baris masuk');
}catch(e){console.log('!! ROLLBACK:',e.message);for(const id of ids)await supabase.from('ledger').delete().eq('id',id);process.exit(1);}
process.exit(0);})();
