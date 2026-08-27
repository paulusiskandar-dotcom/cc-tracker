// RESTRUKTURISASI KATEGORI (disetujui Paulus 27/8): 25 → 18 belanja + 2 teknis, semua English.
// Fase: A) rename 1:1 (id tetap) · B) merge kategori kecil · C) bubarkan Installment & Other ·
// D) reklasifikasi merchant yang jelas salah kandang (hanya dari kategori-buangan) ·
// E) income: rename + sumber baru Refund & Asset Sale + pindahkan baris refund ·
// F) segarkan category_name denormalisasi. Verifikasi jumlah baris & total di tiap fase.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');

const RENAME={ // lama → baru (id tetap, baris ikut otomatis)
 'Food & Drink':'Food & Dining','Fashion & Apparel':'Clothing & Accessories','Bank Charges':'Bank & Card Fees',
 'Tax':'Taxes','Fuel & Vehicle':'Vehicle','Entertainment':'Hobbies & Entertainment','Staff & Salary':'Staff & Services',
 'Subscription':'Subscriptions & Software','Charity':'Donations & Gifts','Groceries':'Groceries & Household',
 'Property & IPL':'Housing & Utilities','Health':'Health & Personal Care','Shopping':'Online Shopping'};
const MERGE={ // kategori kecil → target (baris dipindah, kategori lama dihapus)
 'Bills (Utilities)':'Housing & Utilities','Coffee & Snacks':'Food & Dining',
 'Personal Care':'Health & Personal Care','Education':'Subscriptions & Software'};
// pembubaran per-baris (regex deskripsi → kategori target)
const INSTALLMENT_MAP=[[/CYBS|TOKOPEDIA|ERA ?SPACE|SAMSUNG|0\.00% 12BLN/i,'Electronics & Gadgets'],[/IKEA/i,'Home & Furniture'],[/TRIP/i,'Travel'],[/WHOP/i,'Subscriptions & Software'],[/SURUGAYA/i,'Hobbies & Entertainment']];
const OTHER_MAP=[[/Koreksi celah|tanpa deskripsi/i,'Adjustments'],[/AJANG RAHMAN|Fee Asep/i,'Staff & Services']];
// reklasifikasi merchant jelas — HANYA baris yang sekarang di kategori-buangan
const DUMPS=['Food & Dining','Online Shopping'];
const RECLASS=[
 [/NITORI|IKEA|INFORMA|ZWILLING/i,'Home & Furniture'],
 [/UNIQLO|G U CO|BIRKENSTOCK|TK MAXX|ADIDAS|PEDRO|JD ?SPORTS|H&M/i,'Clothing & Accessories'],
 [/BIC CAMERA|SUPERSPRING/i,'Electronics & Gadgets'],
 [/JRC SMART EX/i,'Travel'],
 [/LEGO|POP ?MART|PLAYSTATION|SURUGAYA|CGV|XXI |CINEMA/i,'Hobbies & Entertainment'],
 [/DAISO|MUJI|AEON MALL|DON ?QUIJOTE|MEGADONQUIJOTE|MINISO|ALFAMART|INDOMARET|IDM /i,'Groceries & Household'],
 [/ROSSMANN|DM DROGERIE|GUARDIAN|DAIKOKU/i,'Health & Personal Care'],
 [/SITI SARNAH/i,'Family'],
];
const SRC_RENAME={'Bank Interest':'Interest & Investment','Cashback':'Cashback & Rewards'};
// baris income → Refund (regex) + kategori asal utk pengurangan per-kategori
const REFUND_PATTERNS=[
 [/TRIP\.?COM.*(refund|CR)|refund.*TRIP/i,'Travel'],
 [/ANNUAL FEE|MEMBERSHIP FEE/i,'Bank & Card Fees'],
 [/SURUGAYA/i,'Hobbies & Entertainment'],
 [/TOKOPEDIA.*(conversion|credit|CR)|Credit IDN.*TOKOPEDIA|ECI\.IDC12/i,'Electronics & Gadgets'],
 [/GLOBALBLUE/i,null],
 [/REFUND|REVERSAL|\(CR\)|refund\/CR/i,null],
];

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats0}=await supabase.from('expense_categories').select('*').or('user_id.is.null,user_id.eq.'+uid);
const{data:srcs0}=await supabase.from('income_sources').select('*').eq('user_id',uid);
let led=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('id,tx_type,category_id,category_name,from_id,to_id,description,amount,amount_idr').eq('user_id',uid).order('id').range(off,off+999);
  led=led.concat(c||[]);if(!c||c.length<1000)break;}
const totBefore=led.filter(r=>r.tx_type==='expense').reduce((s,r)=>s+Number(r.amount_idr||r.amount),0);
console.log('SEBELUM: kategori',cats0.length,'| sumber',srcs0.length,'| total expense',rp(totBefore));
const byName=n=>cats0.find(c=>c.name===n);
const plan={ren:[],merge:[],inst:[],other:[],reclass:[],refund:[],srcren:[],srcmove:[]};

// A) rename
for(const[o,n]of Object.entries(RENAME)){const c=byName(o);if(c)plan.ren.push({id:c.id,o,n});}
// B) merge
for(const[o,t]of Object.entries(MERGE)){const c=byName(o);if(!c)continue;
  const rows=led.filter(r=>r.tx_type==='expense'&&r.category_id===c.id);
  plan.merge.push({from:c,tName:t,rows});}
// C) Installment & Other
for(const nm of['Installment','Other']){
  const c=byName(nm);if(!c)continue;
  const MAP=nm==='Installment'?INSTALLMENT_MAP:OTHER_MAP;
  for(const r of led.filter(x=>x.tx_type==='expense'&&x.category_id===c.id)){
    const hit=MAP.find(([re])=>re.test(r.description||''));
    (nm==='Installment'?plan.inst:plan.other).push({r,target:hit?hit[1]:null,cat:c});
  }
}
// D) reclass dari kategori buangan
const dumpIds=new Set(DUMPS.map(n=>byName(n==='Food & Dining'?'Food & Drink':'Shopping')?.id).filter(Boolean));
for(const r of led.filter(x=>x.tx_type==='expense'&&dumpIds.has(x.category_id))){
  const hit=RECLASS.find(([re])=>re.test(r.description||''));
  if(hit)plan.reclass.push({r,target:hit[1]});
}
// E) income
for(const[o,n]of Object.entries(SRC_RENAME)){const s=srcs0.find(x=>x.name===o);if(s)plan.srcren.push({id:s.id,o,n});}
const OI=srcs0.find(s=>s.name==='Other Income');
for(const r of led.filter(x=>x.tx_type==='income')){
  const src=srcs0.find(s=>s.id===r.from_id);
  const D=r.description||'';
  if(!src||src.name==='Other Income'){
    const hit=REFUND_PATTERNS.find(([re])=>re.test(D));
    if(hit){plan.refund.push({r,cat:hit[1]});continue;}
    if(/JUAL BARANG/i.test(D))plan.srcmove.push({r,to:'Asset Sale'});
    else if(/HORIZON INTERNUSA/i.test(D))plan.srcmove.push({r,to:'Rental Income'});
    else if(/HENNY DJOHARI/i.test(D)&&Number(r.amount)<=500000)plan.srcmove.push({r,to:'Cashback & Rewards'});
  }
}
console.log('\nRENCANA:');
console.log(' rename kategori:',plan.ren.map(x=>x.o+'→'+x.n).join(' · '));
console.log(' merge:',plan.merge.map(x=>x.from.name+'→'+x.tName+'('+x.rows.length+' baris)').join(' · '));
console.log(' Installment dibubarkan:',plan.inst.length,'baris → ',[...new Set(plan.inst.map(x=>x.target||'??'))].join('/'));
for(const x of plan.inst.filter(x=>!x.target))console.log('   ?? tanpa target:',(x.r.description||'').slice(0,50));
console.log(' Other dibubarkan:',plan.other.length,'baris');
for(const x of plan.other.filter(x=>!x.target))console.log('   ?? tanpa target:',(x.r.description||'').slice(0,50));
console.log(' reklasifikasi merchant:',plan.reclass.length,'baris');
const rc={};for(const x of plan.reclass)rc[x.target]=(rc[x.target]||0)+1;console.log('   ',JSON.stringify(rc));
console.log(' income → Refund:',plan.refund.length,'baris ·',rp(plan.refund.reduce((s,x)=>s+Number(x.r.amount_idr||x.r.amount),0)));
console.log(' income pindah sumber:',plan.srcmove.map(x=>x.to+' '+rp(x.r.amount)).join(' · ')||'(tidak ada)');
console.log(' rename sumber:',plan.srcren.map(x=>x.o+'→'+x.n).join(' · '));
const tanpaTarget=[...plan.inst,...plan.other].filter(x=>!x.target);
if(tanpaTarget.length){console.log('!! masih ada',tanpaTarget.length,'baris tanpa target — BATAL');if(APPLY)process.exit(1);}
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}

// ===== EKSEKUSI =====
const catId={};for(const c of cats0)catId[RENAME[c.name]||c.name]=c.id;
// A renames
for(const x of plan.ren)await supabase.from('expense_categories').update({name:x.n}).eq('id',x.id);
// buat Adjustments
{const{data,error}=await supabase.from('expense_categories').insert([{user_id:uid,name:'Adjustments'}]).select().single();
 if(error){console.log('ERR Adjustments',error.message);process.exit(1);}catId['Adjustments']=data.id;}
// B merges
for(const m of plan.merge){
  const t=catId[m.tName];
  for(let i=0;i<m.rows.length;i+=100)await supabase.from('ledger').update({category_id:t,category_name:m.tName}).in('id',m.rows.slice(i,i+100).map(r=>r.id));
  await supabase.from('expense_categories').delete().eq('id',m.from.id);
}
// C Installment & Other
for(const x of[...plan.inst,...plan.other]){
  const t=catId[x.target||'Adjustments'];
  await supabase.from('ledger').update({category_id:t,category_name:x.target||'Adjustments'}).eq('id',x.r.id);
}
for(const nm of['Installment','Other']){const c=byName(nm);if(c)await supabase.from('expense_categories').delete().eq('id',c.id);}
// D reclass
for(const x of plan.reclass)await supabase.from('ledger').update({category_id:catId[x.target],category_name:x.target}).eq('id',x.r.id);
// E income
for(const x of plan.srcren)await supabase.from('income_sources').update({name:x.n}).eq('id',x.id);
const newSrc={};
for(const nm of['Refund','Asset Sale']){
  const{data,error}=await supabase.from('income_sources').insert([{user_id:uid,name:nm}]).select().single();
  if(error){console.log('ERR',nm,error.message);process.exit(1);}newSrc[nm]=data.id;
}
for(const x of plan.refund)await supabase.from('ledger').update({from_id:newSrc['Refund'],from_type:'income_source',category_id:x.cat?catId[x.cat]:null,category_name:x.cat||null}).eq('id',x.r.id);
const srcIdByName={};for(const s of srcs0)srcIdByName[SRC_RENAME[s.name]||s.name]=s.id;
srcIdByName['Asset Sale']=newSrc['Asset Sale'];
for(const x of plan.srcmove)await supabase.from('ledger').update({from_id:srcIdByName[x.to],from_type:'income_source'}).eq('id',x.r.id);
// F segarkan category_name utk semua expense (hindari fenomena "Other kembar")
const{data:catsNow}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const nmNow={};for(const c of catsNow)nmNow[c.id]=c.name;
let fixed=0;
let led2=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('id,tx_type,category_id,category_name').eq('user_id',uid).eq('tx_type','expense').order('id').range(off,off+999);
  led2=led2.concat(c||[]);if(!c||c.length<1000)break;}
for(const r of led2){
  const want=nmNow[r.category_id]||null;
  if(want&&r.category_name!==want){await supabase.from('ledger').update({category_name:want}).eq('id',r.id);fixed++;}
}
console.log('\ncategory_name disegarkan:',fixed,'baris');
// VERIFIKASI
let led3=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger').select('tx_type,category_id,amount,amount_idr').eq('user_id',uid).order('id').range(off,off+999);
  led3=led3.concat(c||[]);if(!c||c.length<1000)break;}
const exp3=led3.filter(r=>r.tx_type==='expense');
const totAfter=exp3.reduce((s,r)=>s+Number(r.amount_idr||r.amount),0);
const noCat=exp3.filter(r=>!nmNow[r.category_id]).length;
console.log('SESUDAH: kategori',catsNow.length,'| total expense',rp(totAfter),(Math.abs(totAfter-totBefore)<1?'= SEBELUM ✓':'≠ BERUBAH ✗'),'| expense tanpa kategori valid:',noCat);
const agg={};for(const r of exp3){const k=nmNow[r.category_id]||'??';agg[k]=agg[k]||{n:0,s:0};agg[k].n++;agg[k].s+=Number(r.amount_idr||r.amount);}
console.log('\nSTRUKTUR BARU:');
for(const[k,v]of Object.entries(agg).sort((a,b)=>b[1].s-a[1].s))console.log('  ',k.padEnd(26),String(v.n).padStart(5),rp(v.s).padStart(16));
process.exit(0);})();
