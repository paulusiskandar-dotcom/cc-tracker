// Hasil telusur email Tokopedia April–Agustus. Untuk tiap baris: isi deskripsi,
// dan kalau perlu ubah jadi piutang / pecah. Yang sudah benar hanya diberi deskripsi.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const PH='f282ac7e-a908-4e5d-adb0-144473e9f126', SH='014ccdfa-5837-4e32-a9ef-c6ce6fae8142';
// [tanggal, nominal, deskripsi, kategori-sisi-pribadi (null=piutang penuh), nominal piutang]
const P=[
 ['2026-04-14',1254167,'Pajak DJP · Paulus Iskandar','Taxes',0],
 ['2026-04-18',859300,'SanDisk microSD 32GB×2 + 64GB + adaptor travel KiiP','Electronics & Gadgets',642722],
 ['2026-04-18',113500,'Telkomsel Halo 0812198168 · Apr 2026','Housing & Utilities',0],
 ['2026-04-18',591123,'Telkomsel Halo 0812188168 · Apr 2026','Housing & Utilities',588623],
 ['2026-04-22',413297,'Winn Gas selang+regulator + kompor Rinnai RI-511E','Home & Furniture',0],
 ['2026-04-29',2382800,'Printer Epson L3250',null,2382800],
 ['2026-04-29',299900,'Pulsa Telkomsel 300rb (085121166853)','Housing & Utilities',0],
 ['2026-04-29',301000,'Pulsa Telkomsel 300rb (081313510548)','Housing & Utilities',0],
 ['2026-04-30',2176100,'Dymatize ISO-100 5 Lbs + shaker','Health & Personal Care',0],
 ['2026-05-02',11000,'Pulsa Indosat 10rb (08156755598)','Housing & Utilities',0],
 ['2026-05-04',470900,'UGREEN Power Strip 6in1 + KiiP C27T — kirim ke Kristy','Electronics & Gadgets',0],
 ['2026-05-04',471318,'GOOJODOQ AT100 tracker + TP-Link LS1005G + PSU 450W',null,471318],
 ['2026-05-04',1332000,'Biznet Home · pelanggan 9193562087','Housing & Utilities',0],
 ['2026-05-08',3296600,'TP-Link Deco X20 3-Pack + switch LS1008G',null,3296600],
 ['2026-05-11',1254167,'Pajak DJP · Paulus Iskandar','Taxes',0],
 ['2026-05-15',856010,'TP-Link TL-MR6400 4G router + adaptor NYK 12V ×2',null,856010],
 ['2026-05-15',157065,'Dekkson Floor Drain FD 1700','Home & Furniture',0],
 ['2026-05-18',440890,'ResMed AirMini HumidX PLUS ×2 (CPAP)','Health & Personal Care',0],
 ['2026-05-19',137112,'Skintific Outdoor Sun Spray SPF50+','Health & Personal Care',0],
 ['2026-05-31',224000,'Photo Paper Glossy Premium A4 ×8',null,224000],
 ['2026-06-08',661220,'Adaptor Hikvision 12V + tray organizer armrest BYD Seal','Vehicle',0],
 ['2026-06-11',1254167,'Pajak DJP · Paulus Iskandar','Taxes',0],
 ['2026-06-15',7313000,'Turntable Audio Technica AT-LP120X + adaptor DVR','Hobbies & Entertainment',174000],
 ['2026-06-16',1736650,'Vinyl Ryo Fukui Scenery + Joe Hisaishi Spirited Away','Hobbies & Entertainment',0],
 ['2026-06-16',607300,'Perlengkapan vinyl: brush, sleeve ×40, cleaner, stylus kit','Hobbies & Entertainment',0],
 ['2026-06-17',383240,'Vicks Vapo Drops + Anticol + tempered glass iPhone 14 Pro','Health & Personal Care',136340],
 ['2026-06-18',1787800,'Vinyl Sufjan Stevens + Bon Iver + OST La La Land','Hobbies & Entertainment',0],
 ['2026-06-19',735774,'SSD Eyota 128GB ×2 + duplikat remot pagar 433MHz ×2','Electronics & Gadgets',685400],
 ['2026-06-21',2539000,'4 vinyl: Laufey ×2, Norah Jones, Sufjan Stevens','Hobbies & Entertainment',0],
 ['2026-06-22',211410,'Sonoff Smart Switch Mini-D','Electronics & Gadgets',0],
 ['2026-06-24',4063200,'CarlinKit CarPlay Ai Box Android 13 8/128','Vehicle',0],
 ['2026-06-24',12241040,'Huawei MatePad Pro 12.2" 12/512 + stylus','Electronics & Gadgets',0],
 ['2026-06-25',324116,'Tempered glass Samsung S24 Ultra Spigen 2-pack','Electronics & Gadgets',0],
 ['2026-06-25',234900,'Sonoff Smart Switch Mini-D (kedua)','Electronics & Gadgets',0],
 ['2026-06-25',21200,'Dioda Bridge KBL610 ×4','Electronics & Gadgets',0],
 ['2026-07-04',1802799,'Vinyl Disney Ultimate Hits 2LP + Ed Sheeran Tour 2LP','Hobbies & Entertainment',0],
 ['2026-07-09',1254167,'Pajak DJP · Paulus Iskandar','Taxes',0],
 ['2026-07-09',517100,'Logitech MK120 ×2 + tempered glass Infinix + toner HP 85A','Electronics & Gadgets',441400],
 ['2026-07-09',963024,'Set cuci mobil NERDS + Google ATV TV Box','Vehicle',0],
 ['2026-07-13',230264,'Niimbot Cable Label D11 ×3',null,230264],
 ['2026-07-13',649600,'Mouse Logitech Signature M840 L',null,649600],
 ['2026-07-15',907000,'Bambulab PLA Basic ×5 — kirim ke Adi Djohari',null,907000],
 ['2026-07-15',1080180,'PSU 1STPLAYER 450W ×2 + Logitech MK120 ×2',null,1080180],
 ['2026-07-16',251789,'Bambulab PLA Yellow + reusable spool ×2 — Adi Djohari',null,251789],
 ['2026-07-22',1101485,'Flashdisk Lexar 32GB + TP-Link TL-WR845N + Belden RJ45 ×2',null,1101485],
 ['2026-07-22',793900,'YALE Key Box + sensor infrared ×2 + brankas kunci M4','Home & Furniture',0],
 ['2026-08-04',150465,'Tongkat Tol Lite ×2 + chia seed + palu darurat Vention','Vehicle',0],
 ['2026-08-04',138100,'Arctic Cooling MX4 thermal paste 4gr ×2',null,138100],
 ['2026-08-05',751820,'Outer sleeve vinyl ×20 + brush Fidelity + vinyl Adhitia Sofyan','Hobbies & Entertainment',0],
 ['2026-08-07',438300,'Vinyl DUA EMPAT','Hobbies & Entertainment',0],
 ['2026-08-08',4096304,'LEGO Technic 42171 Mercedes-AMG F1 W14','Hobbies & Entertainment',0],
 ['2026-08-11',1254167,'Pajak DJP · Paulus Iskandar','Taxes',0],
 ['2026-08-26',4273500,'Biznet Home · pelanggan 1000823437','Housing & Utilities',0],
];
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'∅';
const before=Object.fromEntries(accounts.filter(a=>a.type==='credit_card').map(a=>[a.name,Number(a.outstanding_amount||0)]));
const{data:cats}=await supabase.from('expense_categories').select('id,name').eq('user_id',uid);
const C=n=>(cats||[]).find(x=>x.name===n);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,entity,category_name,notes,description,reimburse_settlement_id').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const dd=(a,b)=>Math.abs(new Date(a)-new Date(b))/864e5;
let nKat=0,nPiu=0,nPecah=0,nNote=0,nLewat=0;const jobs=[];
for(const[d,a,note,kat,piu]of P){
  const h=led.filter(r=>Math.abs(+r.amount_idr-a)<=1&&dd(r.tx_date,d)<=6&&/tokopedia/i.test(r.description||''));
  if(h.length!==1){nLewat++;console.log(`  ⚠ ${d} ${rp(a).padStart(11)} cocok ${h.length} — dilewati`);continue;}
  jobs.push({r:h[0],a,note,kat,piu});
}
console.log(`\ncocok ${jobs.length} dari ${P.length}`);
for(const j of jobs){
  const{r,a,piu,kat}=j;
  const jenis=piu===0?(r.tx_type==='expense'?'kategori+deskripsi':'deskripsi saja')
            :piu===a?(r.tx_type==='reimburse_out'?'deskripsi saja':'JADI PIUTANG')
            :'DIPECAH';
  j.jenis=jenis;
  if(jenis==='kategori+deskripsi')nKat++;else if(jenis==='JADI PIUTANG')nPiu++;else if(jenis==='DIPECAH')nPecah++;else nNote++;
}
console.log(`  kategori+deskripsi ${nKat} · jadi piutang ${nPiu} · dipecah ${nPecah} · deskripsi saja ${nNote} · dilewati ${nLewat}`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/aprags_${Date.now()}.json`,JSON.stringify(jobs.map(j=>j.r),null,1));
let ok=0;
for(const j of jobs){
  const{r,a,note,kat,piu}=j;
  if(piu===0){
    const c=kat?C(kat):null;const upd={notes:note};
    if(c&&r.tx_type==='expense'){upd.category_id=c.id;upd.category_name=c.name;}
    const{error}=await supabase.from('ledger').update(upd).eq('id',r.id).eq('user_id',uid);
    if(!error)ok++;else console.log('GAGAL',error.message);
  } else if(piu===a){
    const upd={notes:note};
    if(r.tx_type!=='reimburse_out'){Object.assign(upd,{tx_type:'reimburse_out',to_type:'account',to_id:PH,entity:'Hamasa',reimburse_settlement_id:SH,category_id:null,category_name:null});}
    const{error}=await supabase.from('ledger').update(upd).eq('id',r.id).eq('user_id',uid);
    if(!error)ok++;else console.log('GAGAL',error.message);
  } else {
    if(r.tx_type!=='expense'){console.log(`  lewat pecah (bukan expense): ${r.tx_date} ${rp(a)}`);continue;}
    const sisa=a-piu,c=C(kat);
    const{error:e1}=await supabase.from('ledger').update({amount:sisa,amount_idr:sisa,category_id:c.id,category_name:c.name,
      notes:`${note} — sisi pribadi (dipecah dari tagihan ${rp(a)})`}).eq('id',r.id).eq('user_id',uid);
    if(e1){console.log('GAGAL pecah',e1.message);continue;}
    const{error:e2}=await supabase.from('ledger').insert([{user_id:uid,tx_date:r.tx_date,tx_type:'reimburse_out',amount:piu,currency:'IDR',
      amount_idr:piu,description:r.description,notes:`${note} — sisi piutang (dipecah dari tagihan ${rp(a)})`,source:'split-email',
      from_type:'account',from_id:r.from_id,to_type:'account',to_id:PH,entity:'Hamasa',reimburse_settlement_id:SH}]);
    if(!e2)ok++;else console.log('GAGAL pecah-2',e2.message);
  }
}
console.log(`\nditulis ${ok}/${jobs.length}`);
const after=await accountsApi.getAll(uid);
let beda=0;for(const x of after.filter(x=>x.type==='credit_card'))if(Math.abs(before[x.name]-Number(x.outstanding_amount||0))>0.5){console.log(`⚠ ${x.name} berubah`);beda++;}
console.log(beda?'⚠ saldo kartu berubah':'✓ saldo kartu tidak berubah');
process.exit(0);})();
