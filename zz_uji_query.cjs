// Uji query Gmail API yang dipakai buildPaperSplits — pakai token Gmail milik app,
// jalur yang PERSIS sama dengan edge function (bukan IMAP).
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const RINGKAS=(s,n=58)=>{const t=(s||'').replace(/\s+/g,' ').trim();return t.length>n?t.slice(0,n-1)+'…':t;};
function decodeBodyPlain(part){
  const walk=(p)=>{
    if(!p)return'';
    if(p.body?.data&&(p.mimeType==='text/plain'||p.mimeType==='text/html')){
      const s=Buffer.from(p.body.data.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
      return p.mimeType==='text/html'?s:s;
    }
    return (p.parts||[]).map(walk).join('\n');
  };
  return walk(part).replace(/<[^>]+>/g,' ').replace(/[ \t]+/g,' ');
}
function parsePaperSplit(_s,rawBody){
  const body=(rawBody||'').replace(/[|\r\n]+/g,' ').replace(/\s+/g,' ');
  if(!/Penyedia\s*Paper/i.test(body))return null;
  const angka=s=>Number(String(s).replace(/[^\d]/g,''))||0;
  const ambil=l=>{const m=body.match(new RegExp(l+String.raw`\s*Rp\s*([\d.,]+)`,'i'));return m?angka(m[1]):0;};
  const kirim=ambil('Total harga'),total=ambil('Total pembayaran');
  if(!kirim||!total||total<=kirim)return null;
  const ref=(body.match(/Nomor pembayaran\s*([A-Z0-9]+)/i)||[])[1]||'';
  const ke=RINGKAS(((body.match(/Nama\s+([A-Za-z*][^|]*?)\s+Detail pembayaran/i)||[])[1]||'').trim(),40);
  return{kirim,fee:total-kirim,total,ke,ref};
}
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:tok}=await supabase.from('gmail_tokens').select('*').eq('user_id',uid).single();
if(!tok){console.log('!! tidak ada token Gmail');process.exit(1);}
let at=tok.access_token;
// segarkan kalau kedaluwarsa
if(tok.token_expiry&&new Date(tok.token_expiry)<new Date(Date.now()+60000)){
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:env.REACT_APP_GOOGLE_CLIENT_ID,client_secret:sec.GOOGLE_CLIENT_SECRET||'',refresh_token:tok.refresh_token,grant_type:'refresh_token'})});
  const j=await r.json(); if(j.access_token){at=j.access_token;console.log('token disegarkan');}
  else{console.log('!! gagal segarkan token:',JSON.stringify(j).slice(0,120));}
}
const q='from:blibli.com subject:(E-invoicing) after:2026/08/01';
console.log('query:',q);
const res=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=60`,{headers:{Authorization:`Bearer ${at}`}});
if(!res.ok){console.log('!! Gmail API',res.status,(await res.text()).slice(0,200));process.exit(1);}
const list=(await res.json()).messages||[];
console.log('email ditemukan lewat Gmail API:',list.length);
let n=0;
for(const m of list){
  const r=await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`,{headers:{Authorization:`Bearer ${at}`}});
  if(!r.ok)continue;
  const d=await r.json();
  const subj=(d.payload?.headers||[]).find(h=>h.name==='Subject')?.value||'';
  const p=parsePaperSplit(subj,decodeBodyPlain(d.payload));
  if(p){n++;console.log(`  ✓ ${rp(p.total).padStart(13)} = kirim ${rp(p.kirim).padStart(12)} + fee ${rp(p.fee).padStart(8)} | ${p.ke} | ${subj.slice(0,32)}`);}
  else console.log(`  – ditolak: ${subj.slice(0,44)}`);
}
console.log(`\n  terparse lewat jalur Gmail API: ${n} dari ${list.length}`);
process.exit(n>0?0:1);})();
