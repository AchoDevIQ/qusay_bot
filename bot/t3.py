import bot, itertools, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p: exe=p.chromium.executable_path
bot.find_browser=lambda: exe
calls=[]; mid=itertools.count(100); th=itertools.count(500)
def fake(method, **p):
    calls.append((method,p))
    if method=='sendMessage': return {"message_id":next(mid)}
    if method=='createForumTopic': return {"message_thread_id":next(th),"name":p['name']}
    if method=='copyMessage': return {"message_id":next(mid)}
    return True
bot.api=fake; bot.api_upload=lambda m,f,ff,path,fname='x',ctype='y':(calls.append(('UPLOAD:'+fname,{'text':f.get('caption')})) or {"photo":[{"file_id":"F"}]})
bot.ADMIN_IDS=[1]
bot.init_db(); bot.init_db_v8()
G=-1001234567890
def msg(uid,t=None,**kw):
    m={"chat":{"id":uid,"type":"private"},"from":{"id":uid,"username":"u%d"%uid},"message_id":next(mid)}
    if t is not None: m["text"]=t
    m.update(kw); bot.handle({"message":m})
def gmsg(uid,thread,t=None,**kw):
    m={"chat":{"id":G,"type":"supergroup"},"from":{"id":uid},"message_id":next(mid),"message_thread_id":thread,"is_topic_message":True}
    if t is not None: m["text"]=t
    m.update(kw); bot.handle({"message":m})
def cb(uid,d,m=100): bot.handle({"callback_query":{"id":"x","from":{"id":uid,"username":"u%d"%uid},"message":{"chat":{"id":uid},"message_id":m},"data":d}})
def show(n=None):
    out=[]
    for m,p in (calls if n is None else calls[-n:]):
        rm=p.get('reply_markup') or {}
        if isinstance(rm,str): rm={}
        kb=[[b.get('text')+'|'+str(b.get('callback_data',''))[:14] for b in r] for r in rm.get('inline_keyboard',[])]
        rk=[[b.get('text') for b in r] for r in rm.get('keyboard',[])]
        out.append((m,(p.get('text') or p.get('name') or '')[:160].replace('\n',' / '),kb or rk))
    calls.clear(); return out
def P(x):
    for y in x: print('  ',y)
print('--- student /start (registration)')
msg(10,'/start'); P(show())
msg(10,'Ali Hasan'); P(show()); msg(10,'علي حسن محمد كاظم'); P(show())
cb(10,'rc:0'); cb(10,'rg:1'); P(show(2)); cb(10,'rv:0'); P(show(2)); cb(10,'rd:1'); msg(10,'المنصور قرب جامع الرحمن'); msg(10,'07701234567'); msg(10,'07801234567'); P(show(1))
cb(10,'rx:0'); P(show(2)); cb(10,'ra:1'); P(show(2)); cb(10,'rn:2'); P(show(2)); cb(10,'rs:ok'); P(show())
print('--- basra student (online auto)')
msg(11,'/start'); msg(11,'زينب علي حسين جاسم'); cb(11,'rc:1'); cb(11,'rg:0'); cb(11,'rv:1'); msg(11,'العشار'); msg(11,'07701111111'); msg(11,'07702222222'); P(show(1)); cb(11,'rs:ok'); show()
print('--- store link profile + filter')
with bot.db() as c:
    cid=bot.cat_id_for(c,'محاضرات + امتحانات')
    for n,pr in [('الفصل الرابع والخامس - محاضرات + امتحانات إلكتروني',125000),('الفصل الرابع والخامس - محاضرات + امتحانات حضوري',150000),('دفتر محاضرات الفصل الأول',15000)]:
        c.execute("INSERT INTO products(name,price,cat_id,mode) VALUES(?,?,?,?)",(n,pr,cid,bot.mode_from_name(n)))
import base64
for u in (10,11):
    bot.STORE_URL='https://x.netlify.app'
    l=bot.store_link(u); d=json.loads(base64.urlsafe_b64decode(l.split('&d=')[1]+'=='))
    print(u,[p[1][-12:] for p in d['c'][0][1]], d.get('p',{}).get('n'))
print('--- ask: no group')
msg(10,'❓ سؤال علمي'); P(show())
gmsg(1,None,'/setgroup'); P(show())
msg(10,'❓ سؤال علمي'); P(show()); cb(10,'qc:3'); P(show()); cb(10,'qt:15'); P(show()); cb(10,'ql:15:5'); P(show())
msg(10,'شلون نشتق بالنسبة للزمن؟'); P(show())
print('--- teacher replies in topic')
gmsg(1,500,'نشتق الطرفين بالنسبة لـ t'); P(show())
gmsg(999,500,'random person'); P(show())
cb(10,'qf:1'); msg(10,None,photo=[{"file_id":"p"}]); P(show())
gmsg(1,500,'تمام هيچ'); show(); cb(10,'qok:1'); P(show())
msg(10,'📂 أسئلتي'); P(show())
print('--- hours closed')
bot.kv_set('q_hours',json.dumps({"on":True,"days":[],"from":"16:00","to":"22:00"})); msg(11,'❓ سؤال علمي'); P(show())
print('--- admin menu, staff')
msg(1,'/admin'); P(show()); cb(1,'a:sfa'); msg(1,'5551234'); msg(1,'أحمد'); P(show())
msg(5551234,'/admin'); P(show()); cb(5551234,'a:pend'); P(show())
cb(1,'a:st'); P(show()); cb(1,'a:ce'); P(show()); cb(1,'a:cc:2'); P(show()); cb(1,'a:5th'); P(show())
cb(1,'a:gm'); cb(1,'a:gm:1'); P(show(1)); cb(1,'a:hr'); cb(1,'a:hrd:5'); msg(1,'x') ; show(); cb(1,'a:hrt'); msg(1,'16-22'); P(show(1))
cb(1,'a:cur'); P(show()); 
txt=bot.curriculum_text().replace('المعدلات الزمنية | Related Rates = 8','المعدلات الزمنية | Related Rates = 9'); cb(1,'a:cur'); show(); msg(1,txt); P(show()); print(bot.topic(15)['lectures'])
print('--- me edit')
msg(10,'👤 معلوماتي'); P(show()); 
