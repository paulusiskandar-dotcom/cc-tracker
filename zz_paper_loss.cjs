// Bukukan fee Paper 2026 yang belum jadi Reimbursable Loss. Fee per transaksi =
// "Biaya Tambahan" + Rp1.000 (biaya kanal yang selalu menempel di tagihan kartu).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
const CSV='/Users/paulusiskandar/Downloads/PaperPayOut_Transaction_History_1787796834.csv';
function parseCSV(t){const out=[];let row=[],cur='',q=false;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(q){ if(c==='"'&&t[i+1]==='"'){cur+='"';i++;} else if(c==='"'){q=false;} else cur+=c; }
    else if(c==='"')q=true; else if(c===','){row.push(cur);cur='';}
    else if(c==='\n'){row.push(cur);out.push(row);row=[];cur='';}
    else if(c!=='\r')cur+=c;}
  if(cur||row.length){row.push(cur);out.push(row);} return out;}
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const raw=parseCSV(fs.readFileSync(CSV,'utf8'));const H=raw[0];
const P=raw.slice(1).filter(r=>r.length>=13).map(r=>Object.fromEntries(H.map((h,i)=>[h,r[i]])))
  .filter(r=>r['Status Transaksi']==='Diteruskan'&&(r['Tanggal Pembayaran']||'')>='2026-01-01')
  .sort((a,b)=>a['Tanggal Pembayaran']<b['Tanggal Pembayaran']?-1:1);
let{data:loss}=await supabase.from('ledger').select('id,amount_idr').eq('user_id',uid).eq('category_name','Reimbursable Loss').eq('entity','Hamasa');
loss=[...(loss||[])];
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const catId=cats.find(c=>c.name==='Reimbursable Loss').id;
const buat=[];
for(const r of P){
  const nilai=Math.round(+r['Biaya Tambahan'])+1000, d=r['Tanggal Pembayaran'];
  const i=loss.findIndex(x=>Math.abs(+x.amount_idr-nilai)<=1500);
  if(i>=0){loss.splice(i,1);continue;}
  buat.push({d,nilai,ke:r['Penerima'],ket:r['Berita Acara']||r['Provider']});
}
console.log(`fee Paper 2026 yang belum dibukukan: ${buat.length} baris, ${rp(buat.reduce((s,x)=>s+x.nilai,0))}`);
const bl={};for(const b of buat){const m=b.d.slice(0,7);bl[m]=(bl[m]||0)+b.nilai;}
for(const[m,v]of Object.entries(bl).sort())console.log(`  ${m}  ${rp(v).padStart(11)}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});fs.writeFileSync(`.backups/paper-loss-${Date.now()}.json`,JSON.stringify(buat,null,2));
const ids=[];
for(const b of buat){
  const{data,error}=await supabase.from('ledger').insert([{user_id:uid,tx_date:b.d,tx_type:'expense',
    amount:b.nilai,amount_idr:b.nilai,currency:'IDR',entity:'Hamasa',
    from_type:null,from_id:null,to_type:'expense',to_id:null,
    category_id:catId,category_name:'Reimbursable Loss',
    description:`Fee Paper — ${b.ket} (${b.ke})`,source:'paper-csv',
    notes:'fee Paper.id + biaya kanal 1.000; tidak diganti Hamasa'}]).select('id').single();
  if(error)throw new Error(error.message+' @ '+b.d);
  ids.push(data.id);
}
console.log(`\n- ${ids.length} baris Reimbursable Loss masuk`);
const{data:tot}=await supabase.from('ledger').select('amount_idr').eq('user_id',uid).eq('category_name','Reimbursable Loss').eq('entity','Hamasa');
console.log('  total Reimbursable Loss Hamasa sekarang:',rp((tot||[]).reduce((s,r)=>s+ +r.amount_idr,0)));
process.exit(0);})();
