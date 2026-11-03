import bot, itertools, json, os, urllib.parse
bot.DB_PATH='/tmp/regtest.db'
calls=[]; mid=itertools.count(100)
def fake(method, **p):
    calls.append((method,p)); return {"message_id":next(mid)}
from playwright.sync_api import sync_playwright as _s
with _s() as _p: _e=_p.chromium.executable_path
bot.find_browser=lambda:_e
bot.api=fake; bot.api_upload=lambda m,f,ff,path,*a: (calls.append(('UPLOAD',{'text':f.get('caption')})) or {'photo':[{'file_id':'F'}]})
bot.ADMIN_IDS=[1]; bot.STORE_URL="https://x.netlify.app/"
bot.init_db(); bot.init_db_v8()
with bot.db() as c: c.execute("DELETE FROM students WHERE user_id IN (77,78)")
def msg(uid,t=None,**kw):
    m={"chat":{"id":uid,"type":"private"},"from":{"id":uid,"username":"u"},"message_id":next(mid)}
    if t is not None: m["text"]=t
    m.update(kw); bot.handle({"message":m})
msg(77,'/start')
url=[p['reply_markup']['keyboard'][0][0]['web_app']['url'] for m,p in calls if isinstance(p.get('reply_markup'),dict) and 'web_app' in str(p['reply_markup'])][-1]
print(url[:60])
from playwright.sync_api import sync_playwright
q=url.split('?',1)[1]
local='file:///tmp/w71/store/reg.html?'+q
out={}
with sync_playwright() as pw:
    b=pw.chromium.launch(); pg=b.new_page(viewport={'width':400,'height':900})
    pg.on('dialog', lambda d:(out.__setitem__('d',d.message), d.dismiss()))
    pg.goto(local); pg.wait_for_timeout(800)
    pg.screenshot(path='/tmp/reg1.png',full_page=True)
    pg.fill('#name','علي حسن محمد كاظم'); pg.click('#curr button >> nth=0'); pg.click('#grade button >> nth=1')
    pg.select_option('#gov','بغداد'); pg.click('#side button >> nth=1'); pg.fill('#area','المنصور قرب الجامع')
    pg.fill('#ph1','07701234567'); pg.fill('#ph2','07801234567')
    pg.click('#exam button >> nth=0'); pg.click('#carea button >> nth=0'); pg.click('#center button >> nth=1')
    pg.screenshot(path='/tmp/reg2.png',full_page=True)
    pg.click('#save'); pg.wait_for_timeout(300)
    b.close()
print(out)
calls.clear()
msg(77, web_app_data={"data":out['d']})
for m,p in calls: print(m,(p.get('text') or '')[:400])
print(bot.student(77))
calls.clear(); msg(77,'👤 معلوماتي'); cb={"callback_query":{"id":"x","from":{"id":77},"message":{"chat":{"id":77},"message_id":5},"data":"me:edit"}}
bot.handle(cb); url=[p['reply_markup']['keyboard'][0][0]['web_app']['url'] for m,p in calls if 'web_app' in str(p.get('reply_markup'))][-1]
with sync_playwright() as pw:
    b=pw.chromium.launch(); pg=b.new_page(viewport={'width':400,'height':900})
    pg.goto('file:///tmp/w71/store/reg.html?'+url.split('?',1)[1]); pg.wait_for_timeout(800)
    pg.screenshot(path='/tmp/reg3.png',full_page=True); b.close()
