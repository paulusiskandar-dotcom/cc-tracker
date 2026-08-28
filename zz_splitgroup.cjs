// Ikat tiap pecahan dengan split_group_id supaya Pass 0 rekonsiliasi menjumlahkannya
// jadi SATU transaksi = satu baris statement. Tanpa ini, 44 baris statement (1,14 M)
// dilaporkan hilang dan berisiko ditambahkan dobel.
const fs=require('fs'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase,accountsApi}=require(B+'app.headless.cjs');
const rp=n=>Math.round(Number(n||0)).toLocaleString('id-ID');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const acc=await accountsApi.getAll(uid);const nm=id=>acc.find(x=>x.id===id)?.name||'—';
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id,tx_date,tx_type,amount_idr,from_id,to_id,split_group_id,source,description').eq('user_id',uid).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const rencana=[];
// 1) fee Paper: induk = baris di KARTU & TANGGAL sama, bukan baris fee itu sendiri
for(const f of led.filter(r=>r.source==='paper-split')){
  const kandidat=led.filter(r=>r.id!==f.id&&r.from_id===f.from_id&&r.tx_date===f.tx_date&&
    ['reimburse_out','expense','give_loan'].includes(r.tx_type)&&r.source!=='paper-split');
  if(kandidat.length!==1){rencana.push({jenis:'fee',f,induk:null,kandidat:kandidat.length});continue;}
  rencana.push({jenis:'fee',f,induk:kandidat[0]});
}
// 2) margin listrik: pasangannya reimburse_in di REKENING & TANGGAL sama
for(const m of led.filter(r=>r.source==='pecah-listrik')){
  const kandidat=led.filter(r=>r.id!==m.id&&r.to_id===m.to_id&&r.tx_date===m.tx_date&&r.tx_type==='reimburse_in');
  rencana.push({jenis:'listrik',f:m,induk:kandidat.length===1?kandidat[0]:null,kandidat:kandidat.length});
}
const siap=rencana.filter(x=>x.induk), gagal=rencana.filter(x=>!x.induk);
console.log(`pecahan siap diikat : ${siap.length}`);
console.log(`tidak jelas induknya: ${gagal.length}`);
for(const g of gagal)console.log(`   ${g.jenis} ${g.f.tx_date} ${rp(g.f.amount_idr)} ${nm(g.f.from_id||g.f.to_id)} — kandidat ${g.kandidat} | ${(g.f.description||'').slice(0,40)}`);
console.log('\ncontoh ikatan:');
for(const s of siap.slice(0,5))console.log(`   ${s.f.tx_date} ${nm(s.f.from_id||s.f.to_id).padEnd(13)} ${rp(s.induk.amount_idr).padStart(12)} + ${rp(s.f.amount_idr).padStart(9)} = ${rp(+s.induk.amount_idr+ +s.f.amount_idr)}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync(B+'.backups',{recursive:true});
fs.writeFileSync(B+`.backups/splitgroup-${Date.now()}.json`,JSON.stringify(siap.map(s=>({fee:s.f.id,induk:s.induk.id})),null,2));
let n=0;
for(const s of siap){
  const gid=s.induk.split_group_id||crypto.randomUUID();
  if(!s.induk.split_group_id)await supabase.from('ledger').update({split_group_id:gid}).eq('id',s.induk.id);
  await supabase.from('ledger').update({split_group_id:gid}).eq('id',s.f.id);
  n++;
}
console.log(`\n- ${n} pasangan diikat`);
const{count}=await supabase.from('ledger').select('id',{count:'exact',head:true}).eq('user_id',uid).not('split_group_id','is',null);
console.log(`- total baris ber-split_group_id sekarang: ${count}`);
process.exit(0);})();
