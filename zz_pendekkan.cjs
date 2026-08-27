// Pangkas catatan jadi nama barang saja + x/x kalau itu angsuran.
// Penjelasan dasar keputusan (pokok, sheet, sisi pecahan) dibuang — sudah tercatat di git.
const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
const APPLY=process.argv.includes('--apply');
const NOISE=/^(backfill|statement |imported from|migrated|auto|ipl\/internet)/i;
function pendek(note,desc){
  let n=(note||'').trim();
  if(/^PLN ·|^Telkomsel ·|^Internet ·|^Pajak DJP/i.test(n))return n;  // format tagihan sudah ringkas
  n=n.split(' — ')[0].split(' – ')[0];   // buang penjelasan setelah em-dash
  n=n.replace(/\([^)]*\)/g,' ');         // buang SEMUA isi kurung
  n=n.replace(/\b(piutang penuh|sisi piutang|sisi pribadi|pribadi|piutang)\b/gi,' ');
  n=n.replace(/[·,;:+]\s*$/,'').replace(/\s{2,}/g,' ').replace(/\s*\+\s*$/,'').trim();
  if(n.length>44)n=n.slice(0,43).replace(/[\s,+·-]+$/,'')+'…';
  const f=(desc||'').match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if(f&&!/\d+\/\d+/.test(n))n=`${n} ${f[1]}/${f[2]}`;
  // catatan yang cuma mengulang nama merchant tidak berguna
  const d=(desc||'').toUpperCase().replace(/[^A-Z]/g,'');
  const c=n.toUpperCase().replace(/[^A-Z]/g,'');
  if(c.length<4||(d&&c&&d.includes(c)))return '';
  return n;
}
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,notes,description').eq('user_id',uid).not('notes','is',null).order('tx_date').range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const guna=led.filter(r=>r.notes&&r.notes.trim()&&!NOISE.test(r.notes.trim()));
const ubah=[];
for(const r of guna){const b=pendek(r.notes,r.description);if(b!==r.notes.trim())ubah.push({r,b});}
console.log(`catatan berguna: ${guna.length} · akan dipendekkan: ${ubah.length}\n`);
for(const u of ubah.slice(0,12))console.log(`  ${u.r.notes.slice(0,72)}\n  → ${u.b}\n`);
const pj=guna.map(r=>r.notes.length), pjB=ubah.map(u=>u.b.length);
console.log(`panjang rata-rata sebelum ${Math.round(pj.reduce((a,b)=>a+b,0)/pj.length)} → sesudah ${pjB.length?Math.round(pjB.reduce((a,b)=>a+b,0)/pjB.length):0} karakter`);
if(!APPLY){console.log('\n[DRY-RUN] tambahkan --apply.');process.exit(0);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/pendek_${Date.now()}.json`,JSON.stringify(ubah.map(u=>u.r),null,1));
let ok=0;
for(const u of ubah){const{error}=await supabase.from('ledger').update({notes:u.b||null}).eq('id',u.r.id).eq('user_id',uid);if(!error)ok++;else console.log('GAGAL',error.message);}
console.log(`ditulis ${ok}/${ubah.length}`);
process.exit(0);})();
