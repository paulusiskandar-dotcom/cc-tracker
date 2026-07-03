import imaplib, email, json, subprocess, os, re
from email.header import decode_header
from tempfile import mkstemp
cfg=json.load(open('statement_fetch_config.json')); PW=cfg['app_password'].replace(' ',''); USER='paulusiskandar@gmail.com'; PDFPW='19891010'
M=imaplib.IMAP4_SSL('imap.gmail.com'); M.login(USER,PW); M.select('INBOX')
def pdfval(frm,rgx,since='20-May-2026'):
    typ,d=M.search(None,f'(FROM "{frm}" SINCE {since})'); ids=d[0].split()
    if not ids: return None,'no-email'
    typ,md=M.fetch(ids[-1],'(RFC822)'); msg=email.message_from_bytes(md[0][1]); subj=str(decode_header(msg.get('Subject',''))[0][0])
    for part in msg.walk():
        fn=part.get_filename()
        if fn and fn.lower().endswith('.pdf'):
            fd,p=mkstemp(suffix='.pdf'); os.write(fd,part.get_payload(decode=True)); os.close(fd)
            o=p+'_u.pdf'; r=subprocess.run(['qpdf','--password='+PDFPW,'--decrypt',p,o],capture_output=True)
            txt=subprocess.run(['pdftotext','-layout',(o if r.returncode==0 else p),'-'],capture_output=True,text=True).stdout
            m=re.search(rgx,txt,re.I|re.M)
            return (int(re.sub(r'[^\d]','',m.group(1))) if m else None), subj[:40]
    return None,subj[:40]
def bodyamts(frm,since,kw):
    typ,d=M.search(None,f'(FROM "{frm}" SINCE {since})'); ids=d[0].split()[-4:]
    res=[]
    for i in reversed(ids):
        typ,md=M.fetch(i,'(RFC822)'); msg=email.message_from_bytes(md[0][1]); subj=str(decode_header(msg.get('Subject',''))[0][0])
        body=''
        for part in msg.walk():
            if part.get_content_type()=='text/html':
                try: body+=part.get_payload(decode=True).decode('utf-8','ignore')
                except: pass
        text=re.sub(r'<[^>]+>',' ',body); text=re.sub(r'&nbsp;',' ',text)
        amts=re.findall(r'Rp[\s.]?([\d]{1,3}(?:[.,]\d{3}){1,})', text)
        if re.search(kw,subj,re.I) or amts:
            res.append((subj[:44], [a for a in amts][:5]))
    return res
print('=== PORTFOLIO (PDF) ===')
for n,frm,rgx in [('Ajaib','noreply@ajaib.co.id',r'Total\s*(?:Nilai|Portfolio|Aset|Investasi|Pasar)?[^\d]{0,15}([\d.,]{6,})'),('Mirae','customerservices@miraeasset.co.id',r'Total\s*:\s*([\d.,]{5,})'),('Pluang','noreply@pluang.com',r'Total Asset\s*Rp\s*([\d.,]{5,})')]:
    v,s=pdfval(frm,rgx); print(f'  {n}: {v}  [{s}]')
print('=== TRANSAKSI (body) ===')
for n,frm,kw in [('Bizhare','no-reply@bizhare.id',r'dividen|dicairkan|berakhir|distribusi'),('Travelio','no-reply@travelio.com',r'transaction|transaksi|payout'),('ICX','project@icx.id',r'penghasilan|dividen|distribusi')]:
    print(f'  --{n}--')
    for subj,amts in bodyamts(frm,'25-May-2026',kw): print(f'    {subj} | {amts}')
M.logout()
