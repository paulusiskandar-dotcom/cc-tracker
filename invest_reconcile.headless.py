#!/usr/bin/env python3
# Tarik statement investasi dari email -> parse nilai -> POST ke telegram-webhook.
# Edge function membandingkan vs nilai app; kalau beda kirim Telegram dgn tombol konfirmasi.
# TIDAK mengubah data apapun sendiri. Jalan via LaunchAgent tiap 12 jam.
import imaplib, email, json, subprocess, os, re, urllib.request
from email.utils import parsedate_to_datetime
from tempfile import mkstemp
HERE=os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
cfg=json.load(open('statement_fetch_config.json')); PW=cfg['app_password'].replace(' ',''); USER='paulusiskandar@gmail.com'
FN='https://zxkxfaoxzldxojwepnca.supabase.co/functions/v1/telegram-webhook'
def opentxt(raw):
    fd,p=mkstemp(suffix='.pdf'); os.write(fd,raw); os.close(fd)
    for pw in ['19891010','']:
        o=p+'_u.pdf'; r=subprocess.run(['qpdf','--password='+pw,'--decrypt',p,o],capture_output=True)
        if r.returncode==0: return subprocess.run(['pdftotext','-layout',o,'-'],capture_output=True,text=True).stdout
    return subprocess.run(['pdftotext','-layout',p,'-'],capture_output=True,text=True).stdout
# name(app asset), sender, regex
PLAT=[('Mirae Aset Sekuritas','customerservices@miraeasset.co.id',r'Total\s*:\s*([\d.,]{5,})'),
      ('Pluang','noreply@pluang.com',r'Total Asset\s*Rp\s*([\d.,]{5,})'),
      ('Ajaib','noreply@ajaib.co.id',r'Total\s*(?:Nilai|Pasar|Investasi)?\s*[:\s]([\d.,]{6,})')]
M=imaplib.IMAP4_SSL('imap.gmail.com'); M.login(USER,PW); M.select('INBOX')
vals=[]
for name,frm,rgx in PLAT:
    typ,d=M.search(None,f'(FROM "{frm}" SINCE 20-Jun-2026)'); ids=d[0].split()
    if not ids: continue
    typ,md=M.fetch(ids[-1],'(RFC822)'); msg=email.message_from_bytes(md[0][1])
    dt=parsedate_to_datetime(msg['Date']).strftime('%Y-%m-%d')
    for part in msg.walk():
        fn=part.get_filename()
        if fn and fn.lower().endswith('.pdf'):
            m=re.search(rgx,opentxt(part.get_payload(decode=True)),re.I|re.M)
            if m: vals.append({'name':name,'value':int(re.sub(r'[^\d]','',m.group(1))),'date':dt})
M.logout()
print('parsed:',json.dumps(vals))
req=urllib.request.Request(FN,data=json.dumps({'type':'investsync','values':vals}).encode(),headers={'Content-Type':'application/json'})
print('posted:',urllib.request.urlopen(req).read().decode())
