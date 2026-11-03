import bot, itertools, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p: exe=p.chromium.executable_path
bot.find_browser=lambda: exe
bot.DB_PATH='/tmp/regtest.db'; calls=[]; mid=itertools.count(100)
bot.api=lambda m,**p:(calls.append((m,p)) or {"message_id":next(mid)})
bot.api_upload=lambda m,f,ff,path,*a:(calls.append(('UPLOAD',{'text':f.get('caption'),'path':path})) or {'photo':[{'file_id':'F'}]})
bot.ADMIN_IDS=[1]; bot.STORE_URL="https://x.netlify.app/"
bot.init_db(); bot.init_db_v8()
with bot.db() as c: c.execute("DELETE FROM students WHERE user_id=77")
def msg(uid,t=None,**kw):
    m={"chat":{"id":uid,"type":"private"},"from":{"id":uid,"username":"u"},"message_id":next(mid)}
    if t is not None: m["text"]=t
    m.update(kw); bot.handle({"message":m})
def cb(uid,d): bot.handle({"callback_query":{"id":"x","from":{"id":uid},"message":{"chat":{"id":uid},"message_id":5},"data":d}})
def lasturl(): return [p['reply_markup']['keyboard'][0][0]['web_app']['url'] for m,p in calls if 'web_app' in str(p.get('reply_markup'))][-1]
def run(url, actions, shot):
    out={}
    with sync_playwright() as pw:
        b=pw.chromium.launch(); pg=b.new_page(viewport={'width':400,'height':900})
        pg.on('dialog', lambda d:(out.__setitem__('d',d.message), d.dismiss()))
        pg.goto(url); pg.wait_for_timeout(700); actions(pg); pg.screenshot(path=shot,full_page=True)
        if pg.is_visible('#save'): pg.click('#save')
        else: pg.click('#next'); pg.wait_for_timeout(100); pg.click('#next')
        pg.wait_for_timeout(300); b.close()
    return out.get('d')
msg(77,'/start'); u=lasturl()
def fill(pg):
    pg.fill('#name','علي حسن محمد كاظم'); pg.click('#curr button >> nth=0'); pg.click('#grade button >> nth=0')
    pg.select_option('#gov','بغداد'); pg.click('#side button >> nth=1'); pg.fill('#area','المنصور')
    pg.fill('#ph1','07701234567'); pg.fill('#ph2','07801234567'); pg.click('#exam button >> nth=1')
d=run('file:///tmp/w71/store/reg.html?'+u.split('?',1)[1], fill, '/tmp/r1.png'); calls.clear()
msg(77, web_app_data={"data":d}); print('student saved:', bot.student(77)['exam'], [c[1].get('text','')[:40] for c in calls])
calls.clear(); msg(77,'👤 معلوماتي'); print('me:', [(c[0],c[1].get('text','')[:50]) for c in calls])
# student tries resending form
calls.clear(); msg(77, web_app_data={"data":d.replace('علي','عمر')}); print('resend:', [c[1].get('text','')[:50] for c in calls], bot.student(77)['name'])
# admin edits
calls.clear(); cb(1,'a:sw:77'); u=lasturl()
def adm(pg):
    pg.click('#grade button >> nth=1'); pg.click('#exam button >> nth=0'); pg.click('#carea button >> nth=2'); pg.click('#center button >> nth=0')
d=run('file:///tmp/w71/store/reg.html?'+u.split('?',1)[1], adm, '/tmp/r2.png'); print(d)
calls.clear(); msg(1, web_app_data={"data":d}); s=bot.student(77); print('admin edit:', s['grade'], s['exam'], bot.center_name(s['center_id']), [c[1].get('text','')[:40] for c in calls])
# store page lock
u=bot.store_link(77); run('file:///tmp/w71/store/index.html?'+u.split('?',1)[1], lambda pg:(pg.click('.qty .add >> nth=0'), pg.click('#next')), '/tmp/r3.png')
