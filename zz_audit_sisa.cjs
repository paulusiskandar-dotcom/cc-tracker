// Audit menyeluruh area Reports yg BELUM pernah diperiksa.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);const nm=id=>accounts.find(a=>a.id===id)?.name||'?';
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('*').eq('user_id',uid).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const isExp=r=>r.tx_type==='expense'||r.tx_type==='pay_liability';
let issues=0;const bad=(t,n,d)=>{if(n){issues++;console.log(`⚠ ${t}: ${n}`);if(d)d();}else console.log(`✓ ${t}`);};

// 1. semua baris non-IDR di MANA PUN (termasuk kartu kredit) yg idr==amount
const cur=led.filter(r=>r.currency&&r.currency!=='IDR'&&r.tx_type!=='fx_exchange'&&Math.abs(+r.amount_idr-+r.amount)<1&&+r.amount>0);
bad('baris mata uang asing tanpa konversi (semua akun)',cur.length,()=>cur.slice(0,5).forEach(r=>console.log('   ',r.tx_date,r.currency,r.amount,nm(r.from_id),'|',(r.description||'').slice(0,40))));

// 2. amount_idr kosong/0 pada baris yg dihitung laporan
const nol=led.filter(r=>(isExp(r)||r.tx_type==='income')&&!(+r.amount_idr>0));
bad('baris expense/income dgn amount_idr kosong atau 0',nol.length,()=>nol.slice(0,5).forEach(r=>console.log('   ',r.tx_date,r.tx_type,r.amount,'|',(r.description||'').slice(0,40))));

// 3. expense tanpa kategori → jatuh ke grup "Other"
const nocat=led.filter(r=>isExp(r)&&!r.category_id&&r.tx_type!=='pay_liability');
bad('expense tanpa category_id (muncul sbg "Other")',nocat.length,()=>nocat.slice(0,5).forEach(r=>console.log('   ',r.tx_date,rp(r.amount_idr),'|',(r.description||'').slice(0,45))));

// 4. income tanpa source → grup "Other Income"
const nosrc=led.filter(r=>r.tx_type==='income'&&!r.from_id);
bad('income tanpa income_source',nosrc.length,()=>nosrc.slice(0,6).forEach(r=>console.log('   ',r.tx_date,rp(r.amount_idr),nm(r.to_id),'|',(r.description||'').slice(0,42))));

// 5. baris di luar rentang buku (buku mulai 1 Jan 2026)
const luar=led.filter(r=>r.tx_date<'2026-01-01'||r.tx_date>'2026-12-31');
bad('baris di luar 2026',luar.length,()=>luar.slice(0,5).forEach(r=>console.log('   ',r.tx_date,r.tx_type,rp(r.amount_idr),'|',(r.description||'').slice(0,40))));

// 6. dugaan duplikat: tanggal+nominal+akun+deskripsi sama
const seen={},dup=[];
for(const r of led){const k=[r.tx_date,Math.round(r.amount_idr),r.from_id,r.to_id,(r.description||'').slice(0,40)].join('|');
  if(seen[k])dup.push(r);else seen[k]=1;}
bad('dugaan baris kembar persis',dup.length,()=>dup.slice(0,6).forEach(r=>console.log('   ',r.tx_date,rp(r.amount_idr),r.tx_type,'|',(r.description||'').slice(0,45))));

// 7. tipe transaksi yg SENGAJA tidak masuk laporan — pastikan ukurannya wajar
console.log('\ntipe yg sengaja dikecualikan dari expense (cek besarannya masuk akal):');
const byt={};led.forEach(r=>{byt[r.tx_type]=byt[r.tx_type]||{n:0,t:0};byt[r.tx_type].n++;byt[r.tx_type].t+= +r.amount_idr;});
for(const[t,v]of Object.entries(byt).sort((a,b)=>b[1].t-a[1].t))
  console.log(`  ${t.padEnd(18)} ${String(v.n).padStart(5)} baris  ${rp(v.t).padStart(15)}  ${['expense','pay_liability'].includes(t)?'← MASUK expense':['income'].includes(t)?'← MASUK income':'dikecualikan'}`);

// 8. atribusi gaji: apakah income bulanan jadi rata?
const{data:tpl}=await supabase.from('recurring_templates').select('*').eq('user_id',uid).eq('tx_type','income').eq('is_active',true);
console.log('\ntemplate income aktif utk atribusi gaji:',(tpl||[]).length);
for(const t of tpl||[])console.log(`  ${(t.name||'?').padEnd(22)} amount=${rp(t.amount)} day=${t.day_of_month} freq=${t.frequency} rule=${t.match_rule?'ada':'TIDAK ADA'}`);
console.log('\nincome kas per bulan (sebelum atribusi):');
const m={};led.filter(r=>r.tx_type==='income').forEach(r=>{const k=r.tx_date.slice(0,7);m[k]=(m[k]||0)+ +r.amount_idr;});
for(const[k,v]of Object.entries(m).sort())console.log(`  ${k} ${rp(v).padStart(14)}`);
console.log(issues?`\n⚠ ${issues} area perlu perhatian`:'\n✓ tidak ada temuan');
process.exit(0);})();
