#!/usr/bin/env python3
"""Exercise real browser layout using an isolated Chrome profile and synthetic input."""
import argparse, json, subprocess, tempfile, shutil
from html.parser import HTMLParser
from pathlib import Path
class Metrics(HTMLParser):
 def __init__(self): super().__init__(); self.active=False; self.parts=[]
 def handle_starttag(self,tag,attrs):
  if tag=='pre' and dict(attrs).get('id')=='metrics': self.active=True
 def handle_endtag(self,tag):
  if tag=='pre':self.active=False
 def handle_data(self,data):
  if self.active:self.parts.append(data)
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:17841/');parser.add_argument('--output',required=True);args=parser.parse_args()
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
results=[]
for theme in ['empryo','paper']:
 for width in [1280,980,500]:
  label=theme+'-'+str(width);profile=Path(tempfile.mkdtemp(prefix='dsh-spacing-chrome-'))
  try:
   cmd=[chrome,'--enable-logging=stderr','--log-level=0','--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--hide-scrollbars','--force-device-scale-factor=1','--user-data-dir='+str(profile),'--window-size='+str(width)+',1100','--virtual-time-budget=5000','--screenshot='+str(out/(label+'.png')),'--dump-dom',args.url+'?theme='+theme]
   r=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
   (out/(label+'.stderr.log')).write_text(r.stderr)
   if r.returncode:raise RuntimeError('Chrome exited '+str(r.returncode))
   parsed=Metrics();parsed.feed(r.stdout)
   if not parsed.parts:
    (out/(label+'.failure.html')).write_text(r.stdout);raise RuntimeError('Layout metrics did not become ready: '+label)
   d=json.loads(''.join(parsed.parts));assert d['ready'] and d['width']==width
   (out/(label+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
   cases=d['cases'];before=cases['paragraphs']['before'];after=cases['paragraphs']['after']
   assert after['height'] < before['height']-20,(label,'paragraph spacing did not shrink',before['height'],after['height'])
   assert before['text']==after['text'],(label,'paragraph content changed')
   assert cases['looseTable']['after']['tableRows']==2,(label,'copied loose table not rendered as a table',cases['looseTable']['after'])
   for name in ['softLines','hardBreaks']:
    c=cases[name]['after'];assert abs(c['paragraphHeight'] - c['lineHeight']*3) <= 1,(label,name,'line breaks collapsed')
   for name in ['fencedCode','indentedCode']:
    c=cases[name];assert c['before']['code']==c['after']['code'] and c['after']['code'],(label,name,'code text changed')
    assert c['after']['codeWhitespace'] in ['pre','pre-wrap','break-spaces'],(label,name,'code spacing not preserved')
   j=cases['pastedJson']['after']['jsonCode'];assert j and j.startswith('[\n  [\n    "search",\n    {\n      "query": "K13ORIGINALALPHA",'),(label,'pasted JSON not rendered as indented json block',j)
   assert cases['pastedJson']['before']['jsonCode'] is None,(label,'host bubble unexpectedly highlighted JSON')
   blank=cases['whitespaceOnly']['after'];assert blank['cards']==0 and blank['height']<=24,(label,'blank slice creates empty card',blank)
   for name,c in cases.items():
    assert c['after']['iframes']==0,(label,name,'user input executed iframe')
    assert c['after']['scrollWidth'] <= c['after']['width']+1,(label,name,'outer horizontal overflow')
   results.append({'theme':theme,'width':width,'paragraphHeightBefore':before['height'],'paragraphHeightAfter':after['height'],'cases':len(cases),'ok':True})
   print(json.dumps(results[-1]),flush=True)
  finally:shutil.rmtree(profile,ignore_errors=True)
(out/'summary.json').write_text(json.dumps({'ok':True,'runs':results,'liveModels':0},indent=2)+'\n')
