/**
 * Tambah tiga RDN yang belum ada, dan isi account_no untuk kelima-limanya.
 *
 * Statement RDN selama ini "akun tak dikenali" karena pencocok di server
 * membandingkan accounts.account_no, dan kolom itu kosong di semua akun.
 * Menambah akun tanpa mengisi nomornya tidak akan mengubah apa pun.
 *
 * Nama broker dibaca dari keterangan transfer di dalam statement, bukan
 * ditebak. 4998600543 tidak pernah punya transaksi sehingga brokernya tidak
 * tertulis di mana pun — dinamai dengan nomornya sampai Paulus memberi tahu.
 */
require('dotenv').config({path:'.env.local'});require('dotenv').config({path:'.secrets.local'});
const {createClient}=require('@supabase/supabase-js');
const rp=n=>Number(n||0).toLocaleString('id-ID',{minimumFractionDigits:2});

const ADA=[  // sudah ada di app, nomornya saja yang perlu diisi
  {no:'4996395715', nama:'BCA RDN Ajaib', saldo:1170769.68},
  {no:'4587945702', nama:'BCA RDN Mirae', saldo:1571728.07},
];
const BARU=[
  {no:'4587684798', nama:'BCA RDN Indo Premier',  saldo:6696.77},
  {no:'4952980762', nama:'BCA RDN Sucor',         saldo:100000.92},
  {no:'4998600543', nama:'BCA RDN 4998600543',    saldo:0},
];
const ANCHOR='2026-07-31';

(async()=>{
const apply=process.argv.includes('--apply');
const sb=createClient(process.env.REACT_APP_SUPABASE_URL,process.env.REACT_APP_SUPABASE_ANON_KEY);
const {data:auth}=await sb.auth.signInWithPassword({email:process.env.APP_EMAIL,password:process.env.APP_PASSWORD});
const uid=auth.user.id;
const {data:acc}=await sb.from('accounts').select('id,name,type,account_no,initial_balance,current_balance,sort_order');
const maxSort=Math.max(...acc.map(a=>Number(a.sort_order)||0));

console.log('=== isi nomor rekening akun yang sudah ada ===');
for(const a of ADA){
  const cur=acc.find(x=>x.name===a.nama);
  if(!cur){console.log('  TIDAK KETEMU',a.nama);continue;}
  console.log(`  ${a.nama.padEnd(24)} account_no ${cur.account_no||'kosong'} → ${a.no}  (saldo app ${rp(cur.current_balance)} vs statement ${rp(a.saldo)})`);
  if(apply) {
    const {error}=await sb.from('accounts').update({account_no:a.no,
      last_statement_date:ANCHOR,last_statement_amount:a.saldo}).eq('id',cur.id);
    if(error) console.log('   GAGAL',error.message);
  }
}
console.log('\n=== akun baru ===');
for(const [i,a] of BARU.entries()){
  if(acc.some(x=>x.name===a.nama||String(x.account_no||'')===a.no)){console.log('  sudah ada, dilewati:',a.nama);continue;}
  console.log(`  ${a.nama.padEnd(24)} no ${a.no}  saldo awal ${rp(a.saldo)}`);
  if(apply){
    const {error}=await sb.from('accounts').insert([{
      user_id:uid, name:a.nama, type:'bank', bank_name:'BCA', account_no:a.no,
      currency:'IDR', initial_balance:a.saldo, current_balance:a.saldo,
      last_statement_date:ANCHOR, last_statement_amount:a.saldo,
      is_active:true, include_networth:true, entity:'Personal',
      sort_order:maxSort+1+i,
      notes:'Rekening Dana Nasabah BCA — ditambahkan dari statement RDN Jul 2026',
    }]);
    if(error) console.log('   GAGAL',error.message);
  }
}
console.log(apply?'\nselesai':'\ndry run — tambahkan --apply');
})();
