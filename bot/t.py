import bot, itertools, json, base64
calls=[]; mid=itertools.count(100)
def fake(method, **p):
    calls.append((method,p)); return {"message_id":next(mid)} if method=='sendMessage' else True
bot.api=fake; bot.api_upload=lambda m,f,ff,path:(calls.append(('UPLOAD:'+path.split('/')[-1],{'text':f.get('caption')})) or {"photo":[{"file_id":"F"}]}); bot.init_db()
print(bot.STORE_URL)
def msg(uid,t,wad=None):
    m={"chat":{"id":uid,"type":"private"},"from":{"id":uid,"username":"st"},"text":t}
    if wad: m.pop("text"); m["web_app_data"]={"data":wad}
    bot.handle({"message":m})
def cb(uid,d,m=100): bot.handle({"callback_query":{"id":"x","from":{"id":uid,"username":"st"},"message":{"chat":{"id":uid},"message_id":m},"data":d}})
def last(n=1):
    out=[]
    for m,p in calls[-n:]:
        rm=p.get('reply_markup',{}) or {}
        out.append((m,(p.get('text') or '')[:300],[[b['text'] for b in r] for r in rm.get('inline_keyboard',[])], [[b.get('text')+('[WEB]' if 'web_app' in b else '') for b in r] for r in rm.get('keyboard',[])]))
    calls.clear(); return out
msg(1,'/admin'); cb(1,'a:bulk'); msg(1,'# محاضرات + امتحانات\nالفصل الأول = 75000\n# الملازم\nدفتر = 15000'); calls.clear()
bot.handle({"callback_query":{"id":"x","from":{"id":1},"message":{"chat":{"id":1},"message_id":1},"data":"a:feeall"}}); msg(1,'6000'); cb(1,'a:fee:0'); msg(1,'4000'); calls.clear()
msg(2,'/start'); 
for x in last(5): print(x)
for i in range(3):
    cb(2,'agree')
    for x in last(4): print(' ',x[:2] if x[0]!='sendMessage' or i<2 else x)
url=None
st,data=bot.get_session(2); print('state',st)
link=bot.store_link(); d=json.loads(base64.urlsafe_b64decode(link.split('?d=')[1]+'=='));print(d['f'][:3], d['c'])
o={"n":"علي حسن محمد كاظم","cu":"عربي","g":"بغداد","s":"الكرخ","a":"المنصور","p1":"07701234567","p2":"07801234567","i":[[1,2],[2,1]],"t":169000}
msg(2,None,json.dumps(o,ensure_ascii=False))
for x in last(4): print(x)
# bad order & price change
msg(3,'/start'); [cb(3,'agree') for i in range(3)]; calls.clear()
o2=dict(o,p2="07701234567",n="علي"); msg(3,None,json.dumps(o2,ensure_ascii=False)); print(last(1))
o3=dict(o,t=1); msg(3,None,json.dumps(o3,ensure_ascii=False)); print(last(1)); cb(3,'confirm'); print(last(3))
msg(4,None,json.dumps(o,ensure_ascii=False)); print('noagree',last(1))
