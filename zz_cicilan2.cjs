// Cocokkan angsuran yg belum berdeskripsi ke pokok pembelian yang sudah diketahui.
// Deskripsi Agustus cuma "TOKOPEDIA" tanpa penanda x/12, dan nominalnya bergeser
// beberapa rupiah dari bulan sebelumnya — jadi dicocokkan lewat pokok ÷ tenor.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
// [pokok, tenor, barang, kategori]
const POKOK=[
 [1579060,12,'Razer Atlas gaming mouse mat','Electronics & Gadgets'],
 [3220186,12,'Elgato Stream Deck','Electronics & Gadgets'],
 [1816560,12,'Logitech MX Master 4 for Mac','Electronics & Gadgets'],
 [5615170,12,'POCO F7 12/512GB','Electronics & Gadgets'],
 [5800710,12,'POCO F7 512GB — kirim ke Syahnaz','Electronics & Gadgets'],
 [4294530,12,'Lenovo V14 Core i3','Electronics & Gadgets'],
 [32479576,12,'Fujifilm X100VI Silver','Electronics & Gadgets'],
 [8682400,12,'Game Boy Advance SP + 2DS XL Zelda','Hobbies & Entertainment'],
 [3283850,12,'PlayStation Portal Remote Player','Hobbies & Entertainment'],
 [3129700,12,'iPhone 2G 8GB koleksi','Hobbies & Entertainment'],
 [6355500,12,'WHOOP 5.0 PEAK + membership','Health & Personal Care'],
 [11491385,12,'Bambulab P1S 3D Printer','Hobbies & Entertainment'],
 [8821000,12,'Bambulab AMS 2 Pro','Hobbies & Entertainment'],
 [7313000,12,'Turntable Audio Technica AT-LP120X','Hobbies & Entertainment'],
 [4096304,12,'LEGO Technic 42171 Mercedes-AMG F1','Hobbies & Entertainment'],
 [4063200,12,'CarlinKit CarPlay Ai Box','Vehicle'],
 [2539000,12,'4 vinyl: Laufey, Norah Jones, Sufjan','Hobbies & Entertainment'],
 [1787800,6, 'Vinyl Sufjan + Bon Iver + La La Land','Hobbies & Entertainment'],
];
const NOISE=/^(backfill|statement |imported from|migrated|auto)/i;
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,amount_idr,from_id,category_name,notes,description').eq('user_id',uid).eq('tx_type','expense').ilike('description','%tokopedia%').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const kosong=led.filter(r=>!(r.notes&&r.notes.trim()&&!NOISE.test(r.notes.trim())));
console.log(`baris Tokopedia tanpa deskripsi: ${kosong.length}\n`);
const jobs=[];
for(const r of kosong){
  const a=+r.amount_idr;
  let best=null,bd=Infinity;
  for(const[pokok,tenor,brg,kat]of POKOK){
    const cicil=pokok/tenor, d=Math.abs(cicil-a);
    if(d<bd&&d<=3000){bd=d;best={brg,kat,cicil,pokok,tenor};}
  }
  if(best)jobs.push({r,...best,d:bd});
}
console.log('=== cocok ke pokok pembelian ===');
for(const j of jobs)console.log(`  ${j.r.tx_date} ${rp(j.r.amount_idr).padStart(10)} ${nm(j.r.from_id).padEnd(10)} → ${j.brg.padEnd(36)} (pokok ${rp(j.pokok)}÷${j.tenor}=${rp(j.cicil)}, selisih ${Math.round(j.d)})`);
const sisa=kosong.filter(r=>!jobs.some(j=>j.r.id===r.id));
console.log(`\ncocok ${jobs.length} · belum ${sisa.length}`);
for(const r of sisa)console.log(`  BELUM: ${r.tx_date} ${rp(r.amount_idr).padStart(11)} ${nm(r.from_id).padEnd(13)} | ${(r.description||'').slice(0,40)}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/cicilan2_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){const c=C(j.kat);
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:j.brg}).eq('id',j.r.id).eq('user_id',uid);
  if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${jobs.length}`);
process.exit(0);})();
