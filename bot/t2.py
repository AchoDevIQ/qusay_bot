import bot, itertools, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p: exe=p.chromium.executable_path
bot.find_browser=lambda: exe
calls=[]; mid=itertools.count(100)
def fake(method, **p):
    calls.append((method,p)); return {"message_id":next(mid)} if method=='sendMessage' else True
bot.api=fake; bot.api_upload=lambda m,f,ff,path,fname='x',ctype='y':(calls.append(('UPLOAD',{'text':f.get('caption'),'path':path,'kb':f.get('reply_markup')})) or {"ok":1}); bot.init_db()
def msg(uid,t,wad=None):
    m={"chat":{"id":uid,"type":"private"},"from":{"id":uid,"username":"st"},"text":t}
    if wad: m.pop("text"); m["web_app_data"]={"data":wad}
    bot.handle({"message":m})
def cb(uid,d,m=100): bot.handle({"callback_query":{"id":"x","from":{"id":uid,"username":"st"},"message":{"chat":{"id":uid},"message_id":m},"data":d}})
def last(n=1):
    out=[]
    for m,p in calls[-n:]:
        rm=p.get('reply_markup',{}) or {}
        if isinstance(rm,dict): kb=[[b['text']+('|'+b['copy_text']['text'] if 'copy_text' in b else '') for b in r] for r in rm.get('inline_keyboard',[])]
        else: kb=rm
        out.append((m,(p.get('text') or '')[:200],kb))
    calls.clear(); return out
msg(1,'/admin'); cb(1,'a:bulk'); msg(1,'# محاضرات + امتحانات\nالفصل الأول - محاضرات + امتحانات إلكتروني = 75000\n# الملازم\nدفتر محاضرات الفصل الأول = 15000')
cb(1,'a:feeall'); msg(1,'6000'); cb(1,'a:fee:0'); msg(1,'4000'); calls.clear()
names=["علي حسن محمد كاظم","زينب علي حسين جاسم","مصطفى عبد الله كريم حسن"]
for k,n in enumerate(names):
    u=10+k; msg(u,'/start'); [cb(u,'agree') for i in range(3)]
    o={"n":n,"cu":["عربي","إنجليزي"][k%2],"g":["بغداد","البصرة","بغداد"][k],"s":["الكرخ","","الرصافة"][k],"a":"المنصور","p1":"0770123456%d"%k,"p2":"0780123456%d"%k,"i":[[1,1],[2,k+1]],"t":75000+15000*(k+1)+(4000 if k!=1 else 6000)}
    msg(u,None,json.dumps(o,ensure_ascii=False))
for x in last(2): print(x)
cb(1,'a:pend'); print(last(2)[0])
cb(1,'a:t:1'); cb(1,'a:t:3'); print(last(2)[0]); cb(1,'a:pdf'); print(last(3))
import glob; print(glob.glob('pdf/*'))
up=[c for c in calls]
b=json.loads(__import__('bot').kv_get('batch_'+[k for k in [None]][0]) if False else '0')
bid=[k for k in __import__('sqlite3').connect('store.db').execute("select k from kv where k like 'batch_%'")][0][0][6:]
cb(1,'a:done:'+bid); print(last(3)[:2])
cb(1,'a:printed'); print(last(2)[0]); cb(1,'a:un:1'); print(last(1)); cb(1,'a:pend'); print(last(2)[0][2])
