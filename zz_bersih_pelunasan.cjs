// Tiga pelunasan tidak memuat baris apa pun — sisa dari perubahan hari ini
// (barisnya dipindah entitas / dipasangkan ulang, capnya menganggur).
const fs=require('fs'),B='/Users/paulusiskandar/cc-tracker/';
const load=f=>Object.fromEntries(fs.readFileSync(B+f,'utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()];}));
const env=load('.env.local'),sec=load('.secrets.local');for(const[k,v]of Object.entries(env))process.env[k]=v;
const{supabase}=require(B+'app.headless.cjs');
const APPLY=process.argv.includes('apply');
(async()=>{
const{data:a}=await supabase.auth.signInWithPassword({email:sec.APP_EMAIL,password:sec.APP_PASSWORD});const uid=a.user.id;
const{data:sets}=await supabase.from('reimburse_settlements').select('*').eq('user_id',uid);
let led=[];for(let off=0;;off+=1000){const{data:c}=await supabase.from('ledger').select('reimburse_settlement_id').eq('user_id',uid).not('reimburse_settlement_id','is',null).range(off,off+999);led=led.concat(c||[]);if(!c||c.length<1000)break;}
const dipakai=new Set(led.map(r=>r.reimburse_settlement_id));
const kosong=(sets||[]).filter(s=>!dipakai.has(s.id));
console.log(`pelunasan kosong: ${kosong.length} dari ${(sets||[]).length}`);
for(const s of kosong)console.log(`   ${s.id.slice(0,8)} ${String(s.settled_at).slice(0,10)} ${s.entity} | out ${Math.round(s.total_out||0).toLocaleString('id-ID')} in ${Math.round(s.total_in||0).toLocaleString('id-ID')}`);
if(!APPLY){console.log('\n(dry-run)');process.exit(0);}
fs.mkdirSync(B+'.backups',{recursive:true});
fs.writeFileSync(B+`.backups/pelunasan-kosong-${Date.now()}.json`,JSON.stringify(kosong,null,2));
for(const s of kosong)await supabase.from('reimburse_settlements').delete().eq('id',s.id);
const{count}=await supabase.from('reimburse_settlements').select('id',{count:'exact',head:true}).eq('user_id',uid);
console.log(`\n- ${kosong.length} dihapus | tersisa ${count}`);
process.exit(0);})();
