// Pindahkan baris refund yang salah tercatat sbg "Cashback & Rewards" ke source
// "Refund" + kategori tagihan asalnya. Hanya baris yang tagihan asalnya
// teridentifikasi. DRY-RUN default; jalankan dgn --apply untuk menulis.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const refundId=(srcs||[]).find(s=>s.name==='Refund')?.id;
if(!refundId){console.log('FATAL: source Refund tidak ada');process.exit(1);}
const{data:cats}=await supabase.from("expense_categories").select('id,name').eq('user_id',uid);
const cid=n=>{const c=(cats||[]).find(x=>x.name===n);if(!c)throw new Error('kategori tidak ada: '+n);return c;};
// alokasi GlobalBlue: dasar = belanja BARANG yg memenuhi syarat tax-free Jerman
// (in-store, >= EUR 50/struk). Jasa (transport, resto, zoo), Amazon (online),
// dan struk < EUR 50 tidak bisa direstitusi.
const PLAN=[
  {match:/Refund Globalblue\.com Stockholm SWE$/i, date:'2026-03-27', amt:164545, cat:'Clothing & Accessories'},
  {match:/REFUND GLOBALBLUE/i, date:'2026-03-31', amt:427636, cat:'Clothing & Accessories'},
  {match:/REFUND GLOBALBLUE/i, date:'2026-03-31', amt:470545, cat:'Clothing & Accessories'},
  {match:/REFUND GLOBALBLUE/i, date:'2026-03-30', amt:328909, cat:'Hobbies & Entertainment'},
  {match:/Globalblue/i,        date:'2026-06-09', amt:254510, cat:'Hobbies & Entertainment'},
  {match:/GRAND FRONT OSAKA/i, date:'2026-06-04', amt:88577,  cat:'Travel'},
  {match:/GRAND FRONT OSAKA/i, date:'2026-06-05', amt:109426, cat:'Travel'},
  {match:/APPLE\.COM\/BILL/i,  date:'2026-04-08', amt:247677, cat:'Subscriptions & Software'},
];
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,category_id,category_name,description').eq('user_id',uid).eq('tx_type','income').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const picks=[];
for(const p of PLAN){
  const hit=led.filter(r=>r.tx_date===p.date&&Math.abs(+r.amount_idr-p.amt)<1&&p.match.test(r.description||''));
  if(hit.length!==1){console.log('SKIP (cocok',hit.length,'baris):',p.date,rp(p.amt));continue;}
  picks.push({row:hit[0],cat:cid(p.cat)});
}
console.log(`\ncocok ${picks.length}/${PLAN.length} baris — total ${rp(picks.reduce((s,p)=>s+ +p.row.amount_idr,0))}\n`);
const alloc={};
for(const p of picks){console.log(` ${p.row.tx_date} ${rp(p.row.amount_idr).padStart(10)} → Refund / ${p.cat.name.padEnd(26)} | ${(p.row.description||'').slice(0,42)}`);
  alloc[p.cat.name]=(alloc[p.cat.name]||0)+ +p.row.amount_idr;}
console.log('\nalokasi per kategori:');for(const[k,v]of Object.entries(alloc))console.log(`  ${k.padEnd(28)} ${rp(v)}`);
// apakah kategori tujuan punya belanja di bulan yg sama? (kalau tidak, pengurangan
// hanya muncul di KPI, tidak di breakdown kategori)
let allExp=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('tx_date,tx_type,amount_idr,category_id').eq('user_id',uid).in('tx_type',['expense','pay_liability']).order('tx_date').range(off,off+999);allExp=allExp.concat(c||[]);if(!c||c.length<1000)break;}
console.log('\ncek: kategori tujuan ada belanjanya di bulan yg sama?');
for(const p of picks){const m=p.row.tx_date.slice(0,7);
  const s=allExp.filter(r=>r.tx_date.slice(0,7)===m&&r.category_id===p.cat.id).reduce((a,r)=>a+ +r.amount_idr,0);
  console.log(`  ${m} ${p.cat.name.padEnd(26)} belanja ${rp(s).padStart(12)} ${s> +p.row.amount_idr?'OK':'⚠ TIDAK CUKUP/NOL'}`);}
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply untuk menulis.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
const bk=`.backups/refund_source_${Date.now()}.json`;
fs.writeFileSync(bk,JSON.stringify(picks.map(p=>p.row),null,1));
console.log('\nbackup:',bk);
let ok=0;
for(const p of picks){
  const{error}=await supabase.from('ledger').update({from_id:refundId,category_id:p.cat.id,category_name:p.cat.name}).eq('id',p.row.id).eq('user_id',uid);
  if(error){console.log('GAGAL',p.row.id,error.message);}else ok++;
}
console.log(`ditulis ${ok}/${picks.length}`);
process.exit(0);
})();
