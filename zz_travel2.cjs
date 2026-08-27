const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const P=[
 [/TRAVELIO/i,             'Housing & Utilities',     'Travelio (sewa hunian)'],
 [/JRC SMART EX/i,         'Transport',               'JR Central Smart EX — tiket shinkansen'],
 [/KRIS ?SHOP/i,           'Donations & Gifts',       'KrisShop Singapore'],
 // restoran & kedai — nama merchant sudah jelas
 [/SAIZERIYA/i,            'Food & Dining',           'Saizeriya'],
 [/YABATON/i,              'Food & Dining',           'Yabaton (miso katsu Nagoya)'],
 [/ABURIYA/i,              'Food & Dining',           'Aburiya Umeda (izakaya)'],
 [/IKINARISUTEAKI/i,       'Food & Dining',           'Ikinari Steak'],
 [/SUKIYA/i,               'Food & Dining',           'Sukiya (gyudon)'],
 [/PASSIONHORMON|UMEDABAR/i,'Food & Dining',          'Umeda Bar Passion Hormon'],
 [/NANBAMINAMISAKABA/i,    'Food & Dining',           'Namba Minami Sakaba (izakaya)'],
 [/LIXIN TEOCHEW/i,        'Food & Dining',           'Lixin Teochew Fishball'],
 // bukan makanan, tapi jelas bukan travel
 [/DAIKOKU DRUG/i,         'Health & Personal Care',  'Daikoku Drug (apotek)'],
 [/BOOKOFF/i,              'Hobbies & Entertainment', 'Book Off (buku & game bekas)'],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,category_name,description').eq('user_id',uid).in('tx_type',['expense','pay_liability']).eq('category_name','Travel').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[];
for(const r of led){const p=P.find(([re])=>re.test(r.description||''));if(p)jobs.push({r,k:p[1],n:p[2]});}
const g={};jobs.forEach(j=>{g[j.k]=g[j.k]||{n:0,t:0};g[j.k].n++;g[j.k].t+= +j.r.amount_idr;});
console.log('=== akan dipindahkan dari Travel ===');
for(const[k,v]of Object.entries(g))console.log(`  → ${k.padEnd(24)} ${String(v.n).padStart(2)} baris ${rp(v.t).padStart(11)}`);
console.log(`  total ${jobs.length} baris ${rp(jobs.reduce((s,j)=>s+ +j.r.amount_idr,0))}`);
const sisa=led.filter(r=>!jobs.some(j=>j.r.id===r.id));
console.log(`\n=== tersisa di Travel: ${sisa.length} baris ${rp(sisa.reduce((s,r)=>s+ +r.amount_idr,0))} ===`);
const RAGU=/BSB |TOKYU PLAZA|EST OSAKA|KIX SHOPS|TSURUGAOKA|IWAKURA|MIFFUI|MONBERU|FURUICHI|OJIYAMA|MasterCard debit|HAPPY WC|BOLTON/i;
const ragu=sisa.filter(r=>RAGU.test(r.description||''));
console.log(`  di antaranya ${ragu.length} baris ${rp(ragu.reduce((s,r)=>s+ +r.amount_idr,0))} yang belum jelas:`);
for(const r of ragu)console.log(`    ${r.tx_date} ${rp(r.amount_idr).padStart(10)} | ${(r.description||'').slice(0,46)}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/travel_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){const c=C(j.k);
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:j.n}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`\nditulis ${ok}/${jobs.length}`);
process.exit(0);})();
