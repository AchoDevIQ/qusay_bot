import bot, itertools, json
calls=[]; mid=itertools.count(1000); th=itertools.count(500)
def fake(method, **p):
    calls.append((method,p))
    if method=='createForumTopic': return {"message_thread_id":next(th)}
    if method in ('sendMessage','copyMessage'): return {"message_id":next(mid)}
    return True
bot.api=fake; bot.api_upload=lambda *a,**k:{"photo":[{"file_id":"F"}]}; bot.find_browser=lambda:None
bot.DB_PATH='/tmp/st3.db'; bot.ADMIN_IDS=[1]; bot.init_db(); bot.init_db_v8()
G=-100999; bot.kv_set("q_group", str(G))
def msg(uid,t=None,**kw):
    m={"chat":{"id":uid,"type":"private"},"from":{"id":uid},"message_id":next(mid)}
    if t is not None: m["text"]=t
    m.update(kw); bot.handle({"message":m})
def gmsg(uid,thread,t):
    bot.handle({"message":{"chat":{"id":G,"type":"supergroup"},"from":{"id":uid},"message_id":next(mid),"message_thread_id":thread,"is_topic_message":True,"text":t}})
def cb(uid,d,chat=None): bot.handle({"callback_query":{"id":"x","from":{"id":uid},"message":{"chat":{"id":chat or uid},"message_id":5},"data":d}})
def show():
    for m,p in calls:
        if m in('answerCallbackQuery',): continue
        print('  ',m,p.get('chat_id'),p.get('message_thread_id',''),(p.get('text') or p.get('name') or '')[:70].replace('\n',' / '), p.get('from_chat_id',''),p.get('message_id',''))
    calls.clear()
tid=bot.topics(bot.chapters()[0]["id"])[0]["id"] if hasattr(bot,'topics') else 1
bot.set_session(77,"q:write",{"t":tid,"l":1})
msg(77,"شلون نحل السؤال 3؟"); print('--new'); show()
q=bot.question(max(r['id'] for r in [bot.question(i) or {'id':0} for i in range(1,50)]))
gmsg(1,q['thread_id'],"الجواب: نشتق"); gmsg(1,q['thread_id'],"وبعدين نعوض"); print('--answer x2'); show()
cb(1,"qh:%d"%q['id'],G); print('--hide'); show()
cb(77,"qf:%d"%q['id']); msg(77,"ما فهمت التعويض"); print('--follow'); show()
