// Ekstraksi CC Januari via edge gmail-estatement (process_upload) — DRY-RUN:
// tampilkan deteksi akun, jumlah baris, opening/closing + cek balance.
// Tidak menulis staging dulu.
const fs=require('fs');
const path=require('path');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');

const DIR=`${process.env.HOME}/Downloads/01 Januari`;
const UNL=`${process.env.HOME}/Downloads/01 Januari - Unlocked`;
const ONLY=process.argv[2]||null;

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});
const token=auth.session.access_token;const uid=auth.user.id;
const EDGE=`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;

// pilih file: versi _unlocked kalau ada
const orig=fs.readdirSync(DIR).filter(f=>f.toLowerCase().endsWith('.pdf'));
const unl=fs.existsSync(UNL)?fs.readdirSync(UNL).filter(f=>f.toLowerCase().endsWith('.pdf')):[];
const pick=[];
for(const f of orig){
  const base=f.replace(/\.pdf$/i,'');
  const u=unl.find(x=>x.toLowerCase()===`${base}_unlocked.pdf`.toLowerCase());
  pick.push(u?path.join(UNL,u):path.join(DIR,f));
}
const results=[];
for(const p of pick){
  const name=path.basename(p);
  if(ONLY&&!name.toLowerCase().includes(ONLY.toLowerCase()))continue;
  const b64=fs.readFileSync(p).toString('base64');
  try{
    const r=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json',
      Authorization:`Bearer ${token}`,apikey:process.env.REACT_APP_SUPABASE_ANON_KEY},
      body:JSON.stringify({action:'process_upload',user_id:uid,pdf_base64:b64})});
    const d=await r.json();
    if(d.needs_password||d.encrypted){console.log(name.padEnd(30),'TERKUNCI');results.push({name,err:'locked'});continue;}
    if(!d.transactions?.length){console.log(name.padEnd(30),'GAGAL:',(d.error||'no tx').slice(0,60));results.push({name,err:d.error});continue;}
    const tx=d.transactions;
    const chg=tx.filter(t=>t.direction!=='in').reduce((s,t)=>s+Math.abs(Number(t.amount||0)),0);
    const pay=tx.filter(t=>t.direction==='in').reduce((s,t)=>s+Math.abs(Number(t.amount||0)),0);
    const open=d.opening_balance,close=d.closing_balance;
    const calc=open!=null?open+chg-pay:null;
    const ok=(open!=null&&close!=null)?(Math.abs(calc-close)<=2?'BALANCE':'SELISIH '+rp(calc-close)):'(saldo hdr kurang)';
    console.log(name.padEnd(30),'akun:',String(d.detected_account?.name||d.detected_account?.card_last4||'?').padEnd(16),
      'tx',String(tx.length).padStart(3),'| open',rp(open).padStart(13),'close',rp(close).padStart(13),'|',ok);
    results.push({name,file:p,detected:d.detected_account,period:d.detected_period,open,close,tx});
  }catch(e){console.log(name.padEnd(30),'ERR',e.message.slice(0,60));results.push({name,err:e.message});}
}
fs.mkdirSync('.backups/cc_jan',{recursive:true});
for(const r of results){if(!r.err)fs.writeFileSync(`.backups/cc_jan/${r.name.replace(/\.pdf$/i,'')}.json`,JSON.stringify(r,null,1));}
console.log('\nhasil per-file tersimpan .backups/cc_jan/');
process.exit(0);
})();
