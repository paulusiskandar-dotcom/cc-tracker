import imaplib, email, json, subprocess, os, re
from email.header import decode_header
from email.utils import parsedate_to_datetime
from tempfile import mkstemp
cfg=json.load(open('statement_fetch_config.json')); PW=cfg['app_password'].replace(' ',''); USER='paulusiskandar@gmail.com'
PWS=['19891010','10101989','10Okt1989','']
def dh(s): 
    try: return str(decode_header(s)[0][0])
    except: return str(s)
def opentxt(raw):
    fd,p=mkstemp(suffix='.pdf'); os.write(fd,raw); os.close(fd)
    for pw in PWS:
        o=p+'_u.pdf'; r=subprocess.run(['qpdf','--password='+pw,'--decrypt',p,o],capture_output=True)
        if r.returncode==0: return subprocess.run(['pdftotext','-layout',o,'-'],capture_output=True,text=True).stdout
    return subprocess.run(['pdftotext','-layout',p,'-'],capture_output=True,text=True).stdout
M=imaplib.IMAP4_SSL('imap.gmail.com'); M.login(USER,PW); M.select('INBOX')
# PDF portfolio platforms: (name, sender, regex for total value)
PDF=[('Ajaib','noreply@ajaib.co.id',r'Total(?:\s*Nilai|\s*Pasar)?\s*[:\s]([\d.,]{6,})'),
     ('Mirae','customerservices@miraeasset.co.id',r'Total\s*:\s*([\d.,]{5,})'),
     ('Pluang','noreply@pluang.com',r'Total Asset\s*Rp\s*([\d.,]{5,})'),
     ('Stockbit/Bibit','no-reply@stockbit.com',r'(?:Total|Portfolio|Market Value|Nilai Pasar)[^\d]{0,25}([\d.,]{7,})')]
for name,frm,rgx in PDF:
    typ,d=M.search(None,f'(FROM "{frm}" SINCE 25-Mar-2026)'); ids=d[0].split()
    print(f'\n=== {name} ({len(ids)} email) ===')
    for i in ids:
        typ,md=M.fetch(i,'(RFC822)'); msg=email.message_from_bytes(md[0][1])
        dt=parsedate_to_datetime(msg['Date']).strftime('%Y-%m-%d'); subj=dh(msg.get('Subject',''))[:38]
        got=None
        for part in msg.walk():
            fn=part.get_filename()
            if fn and fn.lower().endswith('.pdf'):
                txt=opentxt(part.get_payload(decode=True))
                m=re.search(rgx,txt,re.I|re.M)
                if m: got=int(re.sub(r'[^\d]','',m.group(1)))
        print(f'  {dt}  {subj:40}  {"Rp{:,}".format(got) if got else "?"}')
# body-amount platforms
BODY=[('Reku','noreply@reku.id',r'dividend|received|payout'),('Bizhare','no-reply@bizhare.id',r'dividen|dicairkan|distribusi'),('Travelio','no-reply@travelio.com',r'transaction|payout'),('ICX','@icx.id',r'penghasilan|dividen|distribusi')]
for name,frm,kw in BODY:
    typ,d=M.search(None,f'(FROM "{frm}" SINCE 01-Apr-2026)'); ids=d[0].split()
    print(f'\n=== {name} transaksi ({len(ids)} email) ===')
    for i in ids[-12:]:
        typ,md=M.fetch(i,'(RFC822)'); msg=email.message_from_bytes(md[0][1])
        dt=parsedate_to_datetime(msg['Date']).strftime('%Y-%m-%d'); subj=dh(msg.get('Subject',''))
        if not re.search(kw,subj,re.I): continue
        body=''
        for part in msg.walk():
            if part.get_content_type() in ('text/html','text/plain'):
                try: body+=part.get_payload(decode=True).decode('utf-8','ignore')
                except: pass
        text=re.sub(r'<[^>]+>',' ',body)
        amts=re.findall(r'Rp[\s.]?([\d]{1,3}(?:[.,]\d{3}){1,})',text)
        # dividend "diterima/net" line
        print(f'  {dt}  {subj[:44]:46}  {amts[:4]}')
M.logout()
