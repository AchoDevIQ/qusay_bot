exec(open('t10.py').read().split("print('== add lib')")[0].replace("bot.find_browser=lambda: None","from playwright.sync_api import sync_playwright\nwith sync_playwright() as p: exe=p.chromium.executable_path\nbot.find_browser=lambda: exe"))
cb(1,'a:liba'); msg(1,'مكتبه 1 (سرى)'); cb(1,'a:libm:1')
import re
t=[p['text'] for m,p in calls if 'text' in p and '<code>' in p.get('text','')][-1]; code=re.findall(r'<code>(\d{6})</code>',t)[0]
bot.handle({"message":{"chat":{"id":666666,"type":"private"},"from":{"id":666666,"first_name":"خاص خاص خاص"},"message_id":1,"text":code}})
calls.clear()
msg(666666, web_app_data={"data":json.dumps({"k":"pos","sid":77,"i":[[1,1],[4,2]],"t":0})})
show()
cb(666666,'of:rc:1'); cb(666666,'of:r:1'); show()
