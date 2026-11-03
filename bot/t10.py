import bot, itertools, json, sqlite3
bot.find_browser=lambda: None
bot.DB_PATH='/tmp/st6.db'; calls=[]; mid=itertools.count(100)
bot.api=lambda m,**p:(calls.append((m,p)) or {"message_id":next(mid)})
bot.api_upload=lambda m,f,ff,path,*a:(calls.append(('UP:'+m,{'chat_id':f.get('chat_id'),'text':f.get('caption')})) or {"message_id":1})
bot.ADMIN_IDS=[1]; bot.STORE_URL="https://x.netlify.app/"
bot.init_db(); bot.init_db_v8()
src=sqlite3.connect('/tmp/regtest.db'); src.row_factory=sqlite3.Row; r=dict(src.execute("select * from students where user_id=77").fetchone())
with bot.db() as c: c.execute("INSERT OR REPLACE INTO students(%s) VALUES(%s)"%(",".join(r),",".join("?"*len(r))), list(r.values()))
def msg(uid,t=None,**kw):
    m={"chat":{"id":uid,"type":"private"},"from":{"id":uid},"message_id":next(mid)}
    if t is not None: m["text"]=t
    m.update(kw); bot.handle({"message":m})
def cb(uid,d): bot.handle({"callback_query":{"id":"x","from":{"id":uid},"message":{"chat":{"id":uid},"message_id":5},"data":d}})
def show():
    for m,p in calls:
        if m=='answerCallbackQuery':
            if p.get('text'): print('   NOTE',p['text'])
            continue
        rm=p.get('reply_markup') or {}
        kb=[b.get('text') for row in (rm.get('inline_keyboard') or rm.get('keyboard') or []) for b in row] if isinstance(rm,dict) else []
        print('  ',m,p.get('chat_id'),(p.get('text') or '')[:200].replace('\n',' / '), kb[:8])
    calls.clear()
print('== add lib'); cb(1,'a:lib'); cb(1,'a:liba'); msg(1,'مكتبة 1'); show()
print('== add member'); cb(1,'a:libm:1'); msg(1,'123456789'); msg(1,'أبو أحمد'); show()
print('== office user'); msg(123456789,'/start'); calls.clear(); msg(123456789,bot.BTN_OFFICE); show()
cb(123456789,'of:pos'); msg(123456789,'علي'); cb(123456789,'of:ps:77'); show()
o={"k":"pos","sid":77,"i":[[1,1],[4,1]],"t":0}
msg(123456789, web_app_data={"data":json.dumps(o)}); show()
msg(123456789, web_app_data={"data":json.dumps(o)}); calls.clear()
cb(123456789,'of:d:0'); cb(123456789,'of:u'); show()
print('== admin view'); cb(1,'a:libv:1'); cb(1,'a:libs:1'); show()
amt=bot.office_unsettled(1)['total']; cb(1,'a:libsy:1:%d'%amt); show()
cb(123456789,'of:a'); cb(123456789,'of:u'); show()
print('== limit'); cb(1,'a:libl:1'); msg(1,'100 الف'); calls.clear(); msg(123456789, web_app_data={"data":json.dumps(o)}); show()
print('== invite'); calls.clear(); cb(1,'a:libm:1'); show()
code=[k for k in [r['k'] for r in bot.db().execute("select k from kv where k like 'libinv_%'")]][-1][7:]
bot.handle({"message":{"chat":{"id":555555,"type":"private"},"from":{"id":555555,"first_name":"أبو","last_name":"زيد"},"message_id":1,"text":"/start lib_"+code}}); show()
msg(555555,'/start lib_'+code); show(); msg(555555,'رقمي'); msg(555555,'/myid'); show()
print('== code'); calls.clear(); cb(1,'a:libm:1'); t=[p['text'] for m,p in calls if 'text' in p and 'libinv' not in p['text'] and '<code>' in p['text']][-1]; show()
import re; code=re.findall(r'<code>(\d{6})</code>',t)[0]
ar=code.translate(str.maketrans('0123456789','٠١٢٣٤٥٦٧٨٩'))
bot.handle({"message":{"chat":{"id":666666,"type":"private"},"from":{"id":666666,"first_name":"سرى"},"message_id":1,"text":ar}}); show()
print('== quick'); calls.clear(); msg(1,'علي عربي بغداد'); msg(1,'0770'); show()
