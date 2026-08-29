/**
 * Buang embel-embel hukum bank dari deskripsi ledger.
 *
 * Statement dan email bank menempelkan disclaimer OJK/LPS, alamat, dan nomor
 * layanan di belakang tiap baris. Yang berguna cuma bagian depannya.
 * Dry run: node bersihkan_deskripsi.cjs   ·   Terapkan: --apply
 */
require('dotenv').config({path:'.env.local'});require('dotenv').config({path:'.secrets.local'});
const {createClient}=require('@supabase/supabase-js');

// Titik potong: semua setelah ini basa-basi hukum, bukan keterangan transaksi.
const POTONG=[/\bberizin dan diawasi\b/i,/\bis licensed\s*&\s*supervised\b/i,
  /\bmerupakan peserta penjaminan\b/i,/\bis a member of\b/i,/\bdijamin oleh LPS\b/i,
  /\bSMBCI Care\b/i,/\bHalo BCA \d/i];

function rapikan(d){
  let s=String(d||'');
  for(const re of POTONG){
    const m=s.match(re);
    if(!m) continue;
    // Potong dari pemisah sebelum disclaimer, supaya nama banknya ikut terbuang
    // dan tidak meninggalkan ekor "| PT Bank SMBC Indonesia Tbk".
    const bar=s.lastIndexOf('|',m.index);
    s=s.slice(0,bar>=0?bar:m.index);
  }
  // Statement memakai spasi sebagai kolom; jangan sentuh susunan '|' yang ada.
  s=s.replace(/[ \t]{2,}/g,' ').replace(/\s*\|(\s*\|)+\s*/g,' | ')
     .replace(/^[\s|]+|[\s|]+$/g,'').trim();
  return s;
}

(async()=>{
  const apply=process.argv.includes('--apply');
  const sb=createClient(process.env.REACT_APP_SUPABASE_URL,process.env.REACT_APP_SUPABASE_ANON_KEY);
  await sb.auth.signInWithPassword({email:process.env.APP_EMAIL,password:process.env.APP_PASSWORD});
  let all=[],from=0;
  for(;;){const r=await sb.from('ledger').select('id,tx_date,description').range(from,from+999);
    if(r.error) return console.log('ERR',r.error.message);
    all=all.concat(r.data); if(r.data.length<1000)break; from+=1000;}
  const ubah=all.map(r=>({...r,baru:rapikan(r.description)}))
                .filter(r=>r.baru && r.baru!==r.description);
  ubah.forEach(r=>{console.log(r.tx_date);console.log('  lama:',r.description);console.log('  baru:',r.baru);});
  console.log(`\n${all.length} baris diperiksa · ${ubah.length} dirapikan`);
  if(!ubah.length||!apply) return console.log(apply?'':'dry run — tambahkan --apply');
  require('fs').writeFileSync(`.backups/deskripsi-${Date.now()}.json`,JSON.stringify(ubah,null,1));
  for(const r of ubah){
    const {error}=await sb.from('ledger').update({description:r.baru}).eq('id',r.id);
    if(error) console.log('GAGAL',r.id,error.message);
  }
  console.log(`${ubah.length} baris diperbarui`);
})();
