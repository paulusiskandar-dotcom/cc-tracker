import imaplib, email, json, subprocess, os, re
from tempfile import mkstemp
cfg=json.load(open('statement_fetch_config.json')); PW=cfg['app_password'].replace(' ',''); USER='paulusiskandar@gmail.com'
def opentxt(raw):
    fd,p=mkstemp(suffix='.pdf'); os.write(fd,raw); os.close(fd)
    for pw in ['19891010','101089','19891010','']:
        o=p+'_u.pdf'; r=subprocess.run(['qpdf','--password='+pw,'--decrypt',p,o],capture_output=True)
        if r.returncode==0: return subprocess.run(['pdftotext','-layout',o,'-'],capture_output=True,text=True).stdout,pw
    return subprocess.run(['pdftotext','-layout',p,'-'],capture_output=True,text=True).stdout,'none'
M=imaplib.IMAP4_SSL('imap.gmail.com'); M.login(USER,PW); M.select('INBOX')
typ,d=M.search(None,'(FROM "noreply@panin-am.co.id" SUBJECT "Laporan" SINCE 01-May-2026)'); ids=d[0].split()
print('Panin Laporan emails:',len(ids))
if ids:
    typ,md=M.fetch(ids[-1],'(RFC822)'); msg=email.message_from_bytes(md[0][1])
    for part in msg.walk():
        fn=part.get_filename()
        if fn and fn.lower().endswith('.pdf'):
            txt,pw=opentxt(part.get_payload(decode=True))
            print(f'  {fn} unlocked_pw={pw} len={len(txt)}')
            for l in txt.split('\n'):
                if re.search(r'(total|nilai|nav|unit|saldo|investasi|market|value|rp)',l,re.I) and re.search(r'\d{3,}',l):
                    print('   ',l.strip()[:95])
M.logout()
