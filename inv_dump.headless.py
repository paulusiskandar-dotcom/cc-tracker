import imaplib, email, json, subprocess, os, re
from tempfile import mkstemp
cfg=json.load(open('statement_fetch_config.json')); PW=cfg['app_password'].replace(' ',''); USER='paulusiskandar@gmail.com'
def opentxt(raw):
    fd,p=mkstemp(suffix='.pdf'); os.write(fd,raw); os.close(fd)
    for pw in ['19891010','']:
        o=p+'_u.pdf'; r=subprocess.run(['qpdf','--password='+pw,'--decrypt',p,o],capture_output=True)
        if r.returncode==0: return subprocess.run(['pdftotext','-layout',o,'-'],capture_output=True,text=True).stdout
    return subprocess.run(['pdftotext','-layout',p,'-'],capture_output=True,text=True).stdout
M=imaplib.IMAP4_SSL('imap.gmail.com'); M.login(USER,PW); M.select('INBOX')
for name,frm in [('Ajaib','noreply@ajaib.co.id'),('Stockbit','no-reply@stockbit.com')]:
    typ,d=M.search(None,f'(FROM "{frm}" SINCE 01-Jun-2026)'); ids=d[0].split()
    if not ids: print(name,'none'); continue
    typ,md=M.fetch(ids[-1],'(RFC822)'); msg=email.message_from_bytes(md[0][1])
    for part in msg.walk():
        fn=part.get_filename()
        if fn and fn.lower().endswith('.pdf'):
            txt=opentxt(part.get_payload(decode=True))
            print(f'\n===== {name} ({fn}) — lines with money/total =====')
            for l in txt.split('\n'):
                if re.search(r'(total|nilai|value|market|saldo|equity|portfolio|net|cash|RDN)',l,re.I) and re.search(r'\d{4,}',l):
                    print('  ',l.strip()[:100])
M.logout()
