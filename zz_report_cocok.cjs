// LAPORAN COCOK/TIDAK per akun: staged net + uji anchor (opening statement Des
// + net staging == anchor frozen di genesis), jumlah review, transfer yatim.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require('./app.headless.cjs');
const rp=n=>{const x=Number(n||0);return (Math.round(x*100)/100).toLocaleString('id-ID');};

// saldo awal statement per akun (1 Des 2025) — dari parser tervalidasi
const OPENING={
 'BCA R':29514510.81,'BCA IDR':6048698.92,'BCA JPY':219178,'BCA SGD':300,'BCA EUR':154.33,
 'BCA CHF':215.05,'BCA HKD':500,'BCA MYR':577.61,'Mandiri':18108518.32,'Jenius IDR':16015569,
 'OCBC IDR':186644855.63,'Superbank':399471.38,'Neobank':1389230.91,
};
// catatan genesis khusus
const NOTE={'Mandiri':'genesis 27 Feb — jendela tumpang tindih, uji saat connect',
 'Jenius IDR':'genesis 6 Apr — anchor bergeser oleh 1–5 Apr','Superbank':'genesis 12 Mei — rantai lanjut via file Mei–Jul',
 'Neobank':'anchor = akhir Apr (sudah terbukti persis)'};

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const accounts=await accountsApi.getAll(uid);
const{data:frz}=await supabase.from('backfill_freeze').select('*').eq('user_id',uid);
const F=id=>frz.find(f=>f.account_id===id);
let st=[];for(let off=0;;off+=1000){
  const{data:c}=await supabase.from('ledger_staging').select('account_id,tx_date,amount,direction,tx_type,needs_review,counter_account_id').eq('user_id',uid).order('id').range(off,off+999);
  st=st.concat(c||[]);if(!c||c.length<1000)break;}

const byAcc={};
for(const r of st){(byAcc[r.account_id]=byAcc[r.account_id]||[]).push(r);}
console.log('══ BANK ══');
console.log('akun'.padEnd(12),'rows','rev','| opening Des + netStaging = proyeksi | anchor frozen | delta | verdict');
for(const[id,rows]of Object.entries(byAcc)){
  const a=accounts.find(x=>x.id===id);if(!a||a.type!=='bank')continue;
  const open=OPENING[a.name];
  // net staging s/d 31 Mar (jendela backfill inti)
  const win=rows.filter(r=>r.tx_date<='2026-03-31');
  const net=win.reduce((s,r)=>s+(r.direction==='in'?1:-1)*Number(r.amount),0);
  const rev=rows.filter(r=>r.needs_review).length;
  const proj=open!=null?open+net:null;
  const anchor=Number(F(id)?.frozen_initial_balance??NaN);
  const delta=proj!=null&&!isNaN(anchor)?proj-anchor:null;
  const verdict=delta==null?'—':Math.abs(delta)<=2?'COCOK ✓':Math.abs(delta)<=100000?'HAMPIR ('+rp(delta)+')':'SELISIH '+rp(delta);
  console.log(a.name.padEnd(12),String(rows.length).padStart(4),String(rev).padStart(3),'|',
    open!=null?rp(open).padStart(14):'?'.padStart(14),'+',rp(net).padStart(14),'=',proj!=null?rp(proj).padStart(14):'—',
    '|',!isNaN(anchor)?rp(anchor).padStart(14):'—','|',verdict, NOTE[a.name]?('· '+NOTE[a.name]):'');
}
console.log('\n══ KARTU (rantai statement sudah tervalidasi saat ekstraksi) ══');
console.log('kartu'.padEnd(16),'rows','rev','payIn-unlinked');
for(const[id,rows]of Object.entries(byAcc)){
  const a=accounts.find(x=>x.id===id);if(!a||a.type!=='credit_card')continue;
  const rev=rows.filter(r=>r.needs_review).length;
  const unl=rows.filter(r=>r.tx_type==='pay_cc'&&r.direction==='in'&&!r.counter_account_id).length;
  console.log(a.name.padEnd(16),String(rows.length).padStart(4),String(rev).padStart(3),String(unl).padStart(3));
}
const totRev=st.filter(r=>r.needs_review).length;
console.log('\nTOTAL staging:',st.length,'baris | needs_review:',totRev);
process.exit(0);
})();
