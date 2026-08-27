// Ekstraksi CC generik: node zz_cc_extract2.cjs <dirPDF> <label>
// - auto-unlock (passwords.txt) ke temp bila terkunci
// - panggil edge gmail-estatement process_upload (AI pipeline app)
// - simpan JSON per file ke .backups/cc_<label>/ ; skip yang sudah ada & file non-statement
const fs=require('fs');
const path=require('path');
const os=require('os');
const{execSync}=require('child_process');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');

const DIR=process.argv[2];
const LABEL=process.argv[3];
if(!DIR||!LABEL){console.log('usage: node zz_cc_extract2.cjs <dir> <label>');process.exit(1);}
const OUT=`.backups/cc_${LABEL}`;
const PWS=['',...fs.readFileSync(`${os.homedir()}/passwords.txt`,'utf8').split('\n').map(s=>s.trim()).filter(Boolean)];

function unlockedPath(p){
  try{execSync(`qpdf --check ${JSON.stringify(p)} 2>/dev/null`);return p;}catch(_){/* terkunci */}
  for(const pw of PWS){
    const tmp=path.join(os.tmpdir(),'ul_'+Math.random().toString(36).slice(2)+'.pdf');
    try{execSync(`qpdf --password=${JSON.stringify(pw)} --decrypt ${JSON.stringify(p)} ${JSON.stringify(tmp)} 2>/dev/null`);return tmp;}catch(_){}
  }
  return null;
}

(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});
const token=auth.session.access_token;const uid=auth.user.id;
const EDGE=`${process.env.REACT_APP_SUPABASE_URL}/functions/v1/gmail-estatement`;
fs.mkdirSync(OUT,{recursive:true});
const files=fs.readdirSync(DIR).filter(f=>f.toLowerCase().endsWith('.pdf'))
  .filter(f=>!/REGISTRATION|RDN|reward|promo|marketing/i.test(f));
for(const f of files){
  const jsonPath=path.join(OUT,f.replace(/\.pdf$/i,'')+'.json');
  if(fs.existsSync(jsonPath)){console.log(f.padEnd(40),'(sudah)');continue;}
  const up=unlockedPath(path.join(DIR,f));
  if(!up){console.log(f.padEnd(40),'TERKUNCI (pw tak cocok)');continue;}
  const b64=fs.readFileSync(up).toString('base64');
  try{
    const r=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json',
      Authorization:`Bearer ${token}`,apikey:process.env.REACT_APP_SUPABASE_ANON_KEY},
      body:JSON.stringify({action:'process_upload',user_id:uid,pdf_base64:b64})});
    const d=await r.json();
    if(!d.transactions?.length){console.log(f.padEnd(40),'GAGAL:',(d.error||'no tx').slice(0,50));continue;}
    const tx=d.transactions;
    const chg=tx.filter(t=>t.direction!=='in').reduce((s,t)=>s+Math.abs(Number(t.amount||0)),0);
    const pay=tx.filter(t=>t.direction==='in').reduce((s,t)=>s+Math.abs(Number(t.amount||0)),0);
    const open=d.opening_balance,close=d.closing_balance;
    const calc=open!=null?open+chg-pay:null;
    const ok=(open!=null&&close!=null)?(Math.abs(calc-close)<=2?'BALANCE':'SELISIH '+rp(calc-close)):'(hdr?)';
    console.log(f.padEnd(40),'tx',String(tx.length).padStart(3),'| open',rp(open).padStart(12),'close',rp(close).padStart(12),'|',ok);
    fs.writeFileSync(jsonPath,JSON.stringify({name:f,label:LABEL,detected:d.detected_account,period:d.detected_period,open,close,tx},null,1));
  }catch(e){console.log(f.padEnd(40),'ERR',e.message.slice(0,50));}
}
console.log('selesai →',OUT);
process.exit(0);
})();
