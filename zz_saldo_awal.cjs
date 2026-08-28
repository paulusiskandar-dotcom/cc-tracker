// Saldo pembuka piutang 1 Jan 2026. Transaksi Desember TIDAK diimpor —
// initial_balance tiap rekening sudah bertanggal 1 Jan (terbukti: 37 dari 38
// rekening bank cocok kalau dihitung dari sana), jadi mengimpor Desember akan
// menggeser semua saldo dua kali.
// Lawannya akun "Saldo Awal 2026" (liability, di luar kekayaan bersih) supaya
// pembukuannya tetap dua sisi tanpa menyentuh rekening bank mana pun.
const fs=require('fs'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require(B+'app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
const BARIS=[
 {ent:'Personal',nilai:15187500,ket:'Saldo awal piutang — DP Hang Tuah bagian Agnes (ditalangi 17 Des 2025)'},
 {ent:'SDC',     nilai:387390,  ket:'Saldo awal piutang — internet Desember (Lazada, kartu Jenius)'},
];
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const piut=e=>{const o=led.filter(r=>r.entity===e&&r.tx_type==='reimburse_out').reduce((s,r)=>s+ +r.amount_idr,0);
  const i=led.filter(r=>r.entity===e&&r.tx_type==='reimburse_in').reduce((s,r)=>s+ +r.amount_idr,0);return o-i;};
console.log('piutang SEBELUM:');
for(const e of['Hamasa','SDC','Personal'])console.log(`  ${e.padEnd(9)} ${rp(piut(e)).padStart(13)}`);
console.log('\nakan dibuat:');
for(const b of BARIS)console.log(`  1 Jan 2026 · ${b.ent.padEnd(9)} reimburse_out ${rp(b.nilai).padStart(11)} | ${b.ket.slice(0,52)}`);
const sudahAda=acc.find(x=>x.name==='Saldo Awal 2026');
console.log(`\nakun "Saldo Awal 2026": ${sudahAda?'sudah ada':'akan dibuat (liability)'}`);
// cek belum pernah dibuat
const{data:cek}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('tx_date','2026-01-01').ilike('description','Saldo awal piutang%');
console.log(`baris saldo awal yang sudah ada: ${(cek||[]).length}`);
if((cek||[]).length){console.log('!! sudah pernah dibuat — BATAL');process.exit(1);}
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
let akun=sudahAda;
if(!akun){
  const{data:baru,error}=await supabase.from('accounts').insert([{user_id:uid,name:'Saldo Awal 2026',
    type:'liability',currency:'IDR',initial_balance:0,current_balance:0,is_active:true,
    include_networth:false,notes:'Lawan bagi saldo pembuka piutang 1 Jan 2026. Bukan rekening nyata.'}]).select().single();
  if(error)throw new Error(error.message);
  akun=baru; console.log('- akun "Saldo Awal 2026" dibuat');
}
fs.mkdirSync(B+'.backups',{recursive:true});
const ids=[];
for(const b of BARIS){
  const{data,error}=await supabase.from('ledger').insert([{user_id:uid,tx_date:'2026-01-01',
    tx_type:'reimburse_out',amount:b.nilai,amount_idr:b.nilai,currency:'IDR',entity:b.ent,
    from_type:'account',from_id:akun.id,to_type:'account',to_id:acc.find(x=>x.name==='Piutang '+b.ent)?.id||null,
    description:b.ket,source:'saldo-awal',is_reimburse:true,
    notes:'saldo pembuka; transaksi Desember 2025 sengaja TIDAK diimpor'}]).select('id').single();
  if(error)throw new Error(error.message);
  ids.push(data.id); console.log(`- ${b.ent} ${rp(b.nilai)} masuk`);
}
fs.writeFileSync(B+`.backups/saldo-awal-${Date.now()}.json`,JSON.stringify(ids,null,2));
let l2=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_type,amount_idr,entity').eq('user_id',uid).in('tx_type',['reimburse_out','reimburse_in']).range(off,off+999);l2=l2.concat(c||[]);if(!c||c.length<1000)break;}
const piut2=e=>{const o=l2.filter(r=>r.entity===e&&r.tx_type==='reimburse_out').reduce((s,r)=>s+ +r.amount_idr,0);
  const i=l2.filter(r=>r.entity===e&&r.tx_type==='reimburse_in').reduce((s,r)=>s+ +r.amount_idr,0);return o-i;};
console.log('\npiutang SESUDAH:');
for(const e of['Hamasa','SDC','Personal'])console.log(`  ${e.padEnd(9)} ${rp(piut2(e)).padStart(13)}`);
process.exit(0);})();
