// Tiga baris ini BUKAN belanja — uangnya pindah bentuk, bukan habis:
//   19 Feb  29.969.280  beli €1.500 (Danamon → EUR tunai)   → fx_exchange
//   29 Mei   JPY 50.000 tarik tunai Seven Bank (BCA JPY)     → transfer ke JPY Cash
//    1 Jul     500.000  tarik tunai ATM Mandiri              → transfer ke IDR Cash
// Selama dicatat expense, belanja Feb/Mei/Jul terlihat lebih besar dari kenyataan
// dan akun kas tetap nol sehingga uang tunai lenyap dari buku.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi,recalculateBalance}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const by=n=>acc.find(x=>x.name===n);
const eur=by('EUR Cash'),jpy=by('JPY Cash'),idr=by('IDR Cash');
const get=async(d,amt)=>{const{data:r}=await supabase.from('ledger').select('*').eq('user_id',uid).eq('tx_date',d).eq('amount_idr',amt).limit(1).single();return r;};
const rFx=await get('2026-02-19',29969280), rJp=await get('2026-05-29',5670000), rAtm=await get('2026-07-01',500000);
const rencana=[
 {r:rFx, jadi:'fx_exchange', ke:eur, patch:{tx_type:'fx_exchange',to_type:'account',to_id:eur.id,
   amount:29969280,currency:'IDR',fx_rate_used:29969280/1500,category_id:null,category_name:null,
   description:'Beli EUR 1.500 (Danamon → EUR tunai)'}, catatan:'EUR tunai bertambah 1.500'},
 {r:rJp, jadi:'transfer', ke:jpy, patch:{tx_type:'transfer',to_type:'account',to_id:jpy.id,
   category_id:null,category_name:null,description:'Tarik tunai Seven Bank (BCA JPY → JPY tunai)'},
   catatan:'JPY tunai bertambah 50.000'},
 {r:rAtm, jadi:'transfer', ke:idr, patch:{tx_type:'transfer',to_type:'account',to_id:idr.id,
   category_id:null,category_name:null,description:'Tarik tunai ATM Mandiri'},
   catatan:'IDR tunai bertambah 500.000'},
];
console.log('=== rencana ===');
for(const p of rencana)console.log(`  ${p.r.tx_date} ${rp(p.r.amount_idr).padStart(12)} ${p.r.tx_type} → ${p.jadi} ke ${p.ke.name}  | ${p.catatan}`);
console.log(`\n  keluar dari expense: ${rp(rencana.reduce((s,p)=>s+ +p.r.amount_idr,0))}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/kas-${Date.now()}.json`,JSON.stringify(rencana.map(p=>p.r),null,2));
const sentuh=new Set();
for(const p of rencana){
  const{error}=await supabase.from('ledger').update(p.patch).eq('id',p.r.id);
  if(error)throw new Error(error.message);
  sentuh.add(p.r.from_id); sentuh.add(p.ke.id);
  console.log(`- ${p.r.tx_date} → ${p.jadi}`);
}
for(const id of sentuh)await recalculateBalance(id,uid);
console.log('\n=== saldo akun kas sesudah ===');
for(const x of[eur,jpy,idr]){const{data:f}=await supabase.from('accounts').select('name,current_balance,currency').eq('id',x.id).single();
  console.log(`  ${f.name.padEnd(10)} ${f.currency} ${Number(f.current_balance).toLocaleString('id-ID')}`);}
console.log('\n=== expense per bulan sesudah ===');
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr').eq('user_id',uid).eq('tx_type','expense').gte('tx_date','2026-01-01').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const bl={};for(const r of led)bl[r.tx_date.slice(0,7)]=(bl[r.tx_date.slice(0,7)]||0)+ +r.amount_idr;
for(const[m,v]of Object.entries(bl).sort())console.log(`  ${m}  ${rp(v).padStart(14)}`);
console.log(`  TOTAL ${rp(Object.values(bl).reduce((s,v)=>s+v,0))}  (sebelum 924.772.328)`);
process.exit(0);})();
