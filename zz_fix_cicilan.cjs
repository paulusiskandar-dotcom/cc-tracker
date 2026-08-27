// Beri nama barang + kategori yg benar pada angsuran cicilan Tokopedia (hasil telusur email).
// Yang statusnya masih dipertanyakan (piutang/hadiah) TIDAK disentuh.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>{const c=(cats||[]).find(x=>x.name===n);if(!c)throw new Error('kategori tak ada: '+n);return c;};
// nominal angsuran → {barang, kategori}. Sumber: email checkout cicilan Tokopedia (pokok ÷ 12 persis).
const M={
 268349 :{b:'Elgato Stream Deck+ (cicilan 9 Sep 2025, pokok 3.220.186)',   k:'Electronics & Gadgets'},
 467931 :{b:'POCO F7 12/512GB (cicilan 21 Agu 2025, pokok 5.615.170)',      k:'Electronics & Gadgets'},
 2706631:{b:'Fujifilm X100VI Silver (cicilan 22 Mei 2025, pokok 32.479.576)',k:'Electronics & Gadgets'},
 723533 :{b:'Game Boy Advance SP AGS-101 + 2DS XL Zelda (cicilan 23 Jan 2026, pokok 8.682.400)',k:'Hobbies & Entertainment'},
 273654 :{b:'PlayStation Portal Remote Player (cicilan 26 Jun 2025, pokok 3.283.850)',k:'Hobbies & Entertainment'},
 260808 :{b:'iPhone 2G 8GB koleksi (cicilan 27 Apr 2025, pokok 3.129.700)', k:'Hobbies & Entertainment'},
 529625 :{b:'WHOOP 5.0 PEAK + membership 12 bln (cicilan 27 Jan 2026, pokok 6.355.500)',k:'Health & Personal Care'},
 957615 :{b:'Bambulab P1S 3D Printer + filament (cicilan 28 Jul 2025, pokok 11.491.385)',k:'Hobbies & Entertainment'},
 735083 :{b:'Bambulab AMS 2 Pro + tool kit + filament (cicilan 30 Jul 2025, pokok 8.821.000)',k:'Hobbies & Entertainment'},
 10328301:{b:'Oakley Meta HSTN Smart Glasses (2 Feb 2026) — dibatalkan, dikredit 10.262.701 pd 3 Feb',k:'Electronics & Gadgets'},
 10659590:{b:'Oakley Meta HSTN Smart Glasses (pembelian ulang 3 Feb 2026)',k:'Electronics & Gadgets'},
};
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,amount_idr,category_name,description,notes').eq('user_id',uid).eq('tx_type','expense').order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const jobs=[];
for(const[a,v]of Object.entries(M)){
  const hit=led.filter(r=>Math.abs(+r.amount_idr-Number(a))<1&&/TOKOPEDIA_CYBS|CCL12/i.test(r.description||''));
  console.log(`${rp(a).padStart(12)} × ${String(hit.length).padStart(2)} baris → ${v.k.padEnd(24)} ${v.b.slice(0,46)}`);
  hit.forEach(r=>jobs.push({r,v}));
}
console.log(`\ntotal baris disentuh: ${jobs.length}`);
console.log('DITAHAN (menunggu keputusan): Razer 131.588 · Logitech 151.380 · Lenovo 357.878 · POCO ke Syahnaz 483.393 · Eufy 6.738.925');
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/cicilan_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){const c=C(j.v.k);
  const{error}=await supabase.from('ledger').update({category_id:c.id,category_name:c.name,notes:j.v.b}).eq('id',j.r.id).eq('user_id',uid);
  if(error)console.log('GAGAL',error.message);else ok++;}
console.log(`ditulis ${ok}/${jobs.length}`);
process.exit(0);})();
