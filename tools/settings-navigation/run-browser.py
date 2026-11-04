#!/usr/bin/env python3
import argparse,json,subprocess,tempfile,shutil
from pathlib import Path
from html.parser import HTMLParser
class Metrics(HTMLParser):
 def __init__(self):super().__init__();self.active=False;self.parts=[]
 def handle_starttag(self,tag,attrs):
  if tag=='pre' and dict(attrs).get('id')=='metrics':self.active=True
 def handle_endtag(self,tag):
  if tag=='pre':self.active=False
 def handle_data(self,data):
  if self.active:self.parts.append(data)
p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:17842/');p.add_argument('--output',required=True);a=p.parse_args();out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True);results=[]
for width in [1280,980,500]:
 profile=Path(tempfile.mkdtemp(prefix='dsh-settings-nav-chrome-'))
 try:
  command=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','--headless','--enable-logging=stderr','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-gpu','--force-device-scale-factor=1','--user-data-dir='+str(profile),'--window-size='+str(width)+',1100','--virtual-time-budget=5000','--screenshot='+str(out/(str(width)+'.png')),'--dump-dom',a.url]
  r=subprocess.run(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45);(out/(str(width)+'.stderr.log')).write_text(r.stderr);assert r.returncode==0
  parser=Metrics();parser.feed(r.stdout)
  if not parser.parts:(out/(str(width)+'.failure.html')).write_text(r.stdout);raise RuntimeError('Fixture metrics unavailable')
  d=json.loads(''.join(parser.parts));(out/(str(width)+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');assert d['ready'] and d['ok'] and d['width']==width,d;assert d['nativeRows']==d['groupedRows']==20 and len(d['clicked'])==20;assert d['categories']=={'模型与账号':9,'界面与显示':4,'Solar 与工作流':5,'插件管理':2},d['categories']
  results.append(d);print(json.dumps(d,ensure_ascii=False),flush=True)
 finally:shutil.rmtree(profile,ignore_errors=True)
(out/'summary.json').write_text(json.dumps({'ok':True,'runs':results,'liveModels':0},ensure_ascii=False,indent=2)+'\n')
