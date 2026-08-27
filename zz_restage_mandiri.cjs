// RE-STAGE Mandiri dgn parser yang tanggalnya sudah dibetulkan (bug: tanggal tercetak
// SEBELUM baris bernomor → 48/71 baris bergeser). Klasifikasi ulang dgn aturan memory.
// Baris Des → status 'rejected' (buku mulai 1 Jan). Baris yang sebelumnya 'connected'
// (mirror dari akun lain yang sudah connect) ditandai connected lagi.
const fs=require('fs');const{execSync}=require('child_process');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const{parseMandiri}=require('./zz_mandiri_parse.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};
const APPLY=process.argv.includes('apply');
const D=process.env.HOME+'/Library/CloudStorage/GoogleDrive-paulusiskandar@gmail.com/My Drive/Financial Statements';
const F=n=>execSync('find '+JSON.stringify(D)+' -name '+JSON.stringify(n)).toString().trim().split('\n')[0];
const MON={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
const FILES=['e-Statement_XXXXXXXXX8868_01 Des 2025-31 Des 2025.pdf','e-Statement_XXXXXXXXX8868_01 Jan 2026-31 Jan 2026.pdf','e-Statement_XXXXXXXXX8868_01 Feb 2026-28 Feb 2026.pdf','e-Statement_XXXXXXXXX8868_01 Mar 2026-31 Mar 2026.pdf'];

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const acc=n=>accounts.find(a=>a.name===n);
const M=acc('Mandiri');
const{data:cats}=await supabase.from('expense_categories').select('id,name').or('user_id.is.null,user_id.eq.'+uid);
const cat=n=>cats.find(c=>c.name===n)?.id;
const{data:srcs}=await supabase.from('income_sources').select('id,name').eq('user_id',uid);
const src=n=>srcs.find(s=>s.name===n)?.id;
const cardBy4=l4=>accounts.find(a=>a.type==='credit_card'&&String(a.card_last4)===String(l4));

// simpan yang sebelumnya connected utk ditandai ulang
const{data:old}=await supabase.from('ledger_staging').select('id,tx_date,amount,direction,status,description').eq('user_id',uid).eq('account_id',M.id);
const wasConnected=(old||[]).filter(r=>r.status==='connected').map(r=>({amt:Math.round(Number(r.amount)),dir:r.direction,desc:(r.description||'').slice(0,40)}));
console.log('staging lama:',(old||[]).length,'| yang connected (akan ditandai ulang):',wasConnected.length);
for(const c of wasConnected)console.log('   ',c.dir,rp(c.amt),c.desc);

const rows=[];
for(const f of FILES){
  const{rows:rs}=parseMandiri(F(f));
  for(const r of rs){
    const m=r.date&&r.date.match(/(\d{2}) (\w{3}) (\d{4})/);
    if(!m){console.log('!! baris tanpa tanggal:',rp(r.amt),r.desc.slice(0,50));continue;}
    const date=`${m[3]}-${MON[m[2]]}-${m[1]}`;
    let desc=((r.pre?r.pre+' | ':'')+r.desc)
      .replace(/\s+/g,' ')
      .replace(/\d{2} \w{3} \d{4}/g,'')
      .replace(/PT Bank Mandiri[^|]*/gi,'').replace(/Mandiri Call \d+/gi,'')
      .replace(/serta merupakan[^|]*/gi,'').replace(/ini adalah batas akhir[^|]*/gi,'')
      .replace(/Menara Mandiri[^|]*/gi,'').replace(/Dis[a-z]*$/i,'')
      .replace(/\|\s*\|/g,'|').replace(/^[\s|+-]+|[\s|+-]+$/g,'').trim();
    const row={user_id:uid,account_id:M.id,tx_date:date,amount:Math.abs(r.amt),currency:'IDR',
      direction:r.amt<0?'out':'in',description:desc.slice(0,290),source_file:f.slice(24,40),statement_month:date.slice(0,7),
      tx_type:null,category_id:null,entity:null,counter_account_id:null,needs_review:true,
      status:date<'2026-01-01'?'rejected':'staged'};
    const U=desc.toUpperCase(),In=r.amt>0,amt=Math.round(Math.abs(r.amt));
    if(/BIAYA ADMINISTRASI|BIAYA TRANSAKSI BANK/.test(U)&&amt<50000){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';row.needs_review=false;}
    else if(/PENYETORAN TUNAI/.test(U)&&In&&amt>=20000000){row.tx_type='income';row.category_id=src('Salary');row.entity='Personal';row.needs_review=false;row.description=(desc+' — gaji Hamasa').slice(0,290);}
    else if(/PEMBAYARAN KARTU KREDIT|KARTU KREDIT/.test(U)&&!In){row.tx_type='pay_cc';}
    else if(/TOP-UP E-MONEY|TOP UP E-MONEY/.test(U)&&!In){row.tx_type='transfer';row.counter_account_id=acc('IDR Cash')?.id;row.needs_review=false;}
    else if(/PEMBAYARAN QR|IMPERIAL SOUP/.test(U)&&!In){row.tx_type='expense';row.category_id=cat('Food & Drink');row.entity='Personal';row.needs_review=false;}
    else if(/SMBC INDONESIA/.test(U)&&!In){row.tx_type='transfer';row.counter_account_id=acc('Jenius IDR').id;row.needs_review=false;}
    else if(/IKFATUL|AGUSTINI|ANDREAN|DANIEL TOMY/.test(U)&&In){row.tx_type='income';row.category_id=src('Freelance');row.entity='Personal';row.needs_review=false;}
    else if(/LIECHE/.test(U)&&In){
      if(amt>=5000000){row.tx_type='income';row.category_id=src('Freelance');row.entity='Personal';}
      else{row.tx_type='collect_loan';row.entity='Personal';}
      row.needs_review=false;}
    else if(/VERONIKA/.test(U)){row.tx_type=In?'collect_loan':'give_loan';row.entity='Personal';row.needs_review=false;}
    else if(/BUNGA REKENING/.test(U)&&In){row.tx_type='income';row.category_id=src('Bank Interest');row.entity='Personal';row.needs_review=false;}
    else if(/PAJAK REKENING|BIAYA TRANSFER|PEMBAYARAN DOKU VA|PEMBAYARAN SPRINT/.test(U)&&!In&&amt<=50000){row.tx_type='expense';row.category_id=cat('Bank Charges');row.entity='Personal';row.needs_review=false;}
    else if(/OCBC NISP/.test(U)&&!In){row.tx_type='transfer';row.counter_account_id=acc('OCBC IDR').id;row.needs_review=false;}
    else if(/RAFI PUTRA/.test(U)&&!In&&amt>100000){row.tx_type='expense';row.category_id=cat('Electronics & Gadgets');row.entity='Personal';row.needs_review=false;}
    else if(/BANK SAMPOERNA|WISE/.test(U)&&!In){row.description=(desc+' — WISE (kirim luar negeri)').slice(0,290);}
    rows.push(row);
  }
}
const jan=rows.filter(r=>r.status==='staged');
console.log('parse:',rows.length,'baris | Des(rejected)',rows.length-jan.length,'| Jan–Mar(staged)',jan.length);
const bytype={};for(const r of jan)bytype[r.tx_type||'REVIEW']=(bytype[r.tx_type||'REVIEW']||0)+1;
console.log('tipe Jan–Mar:',JSON.stringify(bytype));
// validasi saldo: 1 Jan 19.243.689 + net Jan–Mar = 47.754.754 (statement 31 Mar)
const net=jan.reduce((s,r)=>s+(r.direction==='in'?1:-1)*Number(r.amount),0);
console.log('validasi: 19.243.689 +',rp(net),'=',rp(19243689+net),'| statement 31 Mar 47.754.754 | delta',rp(19243689+net-47754754));
if(!APPLY){console.log('(dry-run)');process.exit(0);}
fs.writeFileSync('.backups/zz_mandiri_restage_'+Date.now()+'.json',JSON.stringify(old));
await supabase.from('ledger_staging').delete().eq('user_id',uid).eq('account_id',M.id);
for(let i=0;i<rows.length;i+=100){
  const{error}=await supabase.from('ledger_staging').insert(rows.slice(i,i+100));
  if(error){console.log('ERR',error.message);process.exit(1);}
}
console.log('STAGED ulang',rows.length,'baris Mandiri');
// tandai ulang yang connected
let n=0;
for(const c of wasConnected){
  const{data:m}=await supabase.from('ledger_staging').select('id').eq('user_id',uid).eq('account_id',M.id).eq('direction',c.dir).eq('status','staged').gte('amount',c.amt-1).lte('amount',c.amt+1).limit(1);
  if(m&&m[0]){await supabase.from('ledger_staging').update({status:'connected'}).eq('id',m[0].id);n++;}
  else console.log('  ! tidak ketemu utk ditandai connected:',c.dir,rp(c.amt),c.desc);
}
console.log('ditandai connected ulang:',n,'/',wasConnected.length);
process.exit(0);
})();
