import bot, itertools, json, sqlite3
from playwright.sync_api import sync_playwright
with sync_playwright() as p: exe=p.chromium.executable_path
bot.find_browser=lambda: exe
bot.DB_PATH='/tmp/st5.db'; calls=[]; mid=itertools.count(100)
bot.api=lambda m,**p:(calls.append((m,p)) or {"message_id":next(mid)})
def up(m,f,ff,path,*a):
    calls.append(('UP:'+m,{'chat_id':f.get('chat_id'),'text':f.get('caption'),'path':path})); return {"photo":[{"file_id":"F"}],"message_id":1}
bot.api_upload=up
bot.ADMIN_IDS=[1]; bot.STORE_URL="https://x.netlify.app/"
bot.init_db(); bot.init_db_v8()
src=sqlite3.connect('/tmp/regtest.db'); src.row_factory=sqlite3.Row; r=dict(src.execute("select * from students where user_id=77").fetchone())
with bot.db() as c:
    c.execute("INSERT OR REPLACE INTO students(%s) VALUES(%s)"%(",".join(r),",".join("?"*len(r))), list(r.values()))
    c.execute("INSERT OR REPLACE INTO staff(user_id,name,perms) VALUES(5,'أبو علي','orders')")
def msg(uid,t=None,**kw):
    m={"chat":{"id":uid,"type":"private"},"from":{"id":uid},"message_id":next(mid)}
    if t is not None: m["text"]=t
    m.update(kw); bot.handle({"message":m})
def cb(uid,d): bot.handle({"callback_query":{"id":"x","from":{"id":uid},"message":{"chat":{"id":uid},"message_id":5},"data":d}})
def show():
    for m,p in calls:
        if m=='answerCallbackQuery': continue
        print('  ',m,p.get('chat_id'),(p.get('text') or '')[:140].replace('\n',' / '), p.get('path',''))
    calls.clear()
print('== admin sale'); cb(1,'a:pos'); msg(1,'علي'); cb(1,'a:pss:77'); show()
url=bot.pos_link(77)
with sync_playwright() as pw:
    b=pw.chromium.launch(); pg=b.new_page(viewport={'width':400,'height':900}); out={}
    pg.on('dialog', lambda d:(out.__setitem__('d',d.message), d.dismiss()))
    pg.goto('file:///tmp/w71/store/pos.html?'+url.split('?',1)[1]); pg.wait_for_timeout(800)
    pg.click('.qty .add >> nth=0'); pg.click('.qty .add >> nth=0'); pg.click('.qty .add >> nth=3')
    pg.screenshot(path='/tmp/pos.png',full_page=True); pg.click('#go'); pg.wait_for_timeout(200); b.close()
print(out); msg(1, web_app_data={"data":out['d']}); show()
print('== assistant limit'); bot.kv_set('limit_5','100000')
o=json.loads(out['d']); msg(5, web_app_data={"data":json.dumps(o)}); show()
msg(5, web_app_data={"data":json.dumps(o)}); show()
print('== payment'); cb(1,'a:sfy:5'); msg(1,'50 الف'); show()
cb(1,'a:of'); show()
print('== log'); cb(1,'a:of'); show(); d=bot.time.strftime("%Y-%m-%d", bot.now_iq()); cb(1,'a:of:'+bot.shift_day(d,-1)); show(); cb(1,'a:ofd'); show(); cb(1,'a:ofp:'+d); show(); cb(1,'a:ofr:1'); show()
