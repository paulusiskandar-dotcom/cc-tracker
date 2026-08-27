const fs=require('fs');
const load=f=>Object.fromEntries(fs.readFileSync(f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require('./app.headless.cjs');
(async()=>{
const{data:auth}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=auth.user.id;
const{data:cats}=await supabase.from('expense_categories').select('*').eq('user_id',uid).eq('name','Online Shopping');
if(!cats||!cats.length){console.log('kategori tidak ada');process.exit(0);}
const os=cats[0];
// pengaman: pastikan benar-benar nol pemakaian sebelum dihapus
let pakai=0;for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('id').eq('user_id',uid).eq('category_id',os.id).range(off,off+999);pakai+=(c||[]).length;if(!c||c.length<1000)break;}
console.log('baris yang masih memakai kategori ini:',pakai);
if(pakai>0){console.log('BATAL — masih dipakai');process.exit(1);}
fs.mkdirSync('.backups',{recursive:true});
fs.writeFileSync(`.backups/kategori_online_shopping_${Date.now()}.json`,JSON.stringify(os,null,1));
const{error}=await supabase.from('expense_categories').delete().eq('id',os.id).eq('user_id',uid);
console.log(error?('GAGAL: '+error.message):'kategori "Online Shopping" dihapus (definisinya tersimpan di .backups)');
const{data:sisa}=await supabase.from('expense_categories').select('name').eq('user_id',uid).order('name');
console.log('\nkategori sekarang ('+(sisa||[]).length+'):');
console.log('  '+(sisa||[]).map(c=>c.name).join(' · '));
process.exit(0);})();
