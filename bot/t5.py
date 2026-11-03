exec(open('t3.py').read().split("print('--- student /start")[0])
bot.STORE_URL='https://x.netlify.app'
msg(1,'/admin'); cb(1,'a:bulk'); msg(1,'# محاضرات + امتحانات\nالفصل الأول - محاضرات + امتحانات إلكتروني = 75000\nالفصل الأول - محاضرات + امتحانات حضوري = 90000\nالفصل الثاني - محاضرات + امتحانات حضوري = 90000\nالفصل الرابع والخامس - محاضرات + امتحانات حضوري = 150000\n# الملازم\nدفتر محاضرات الفصل الأول = 15000'); show()
msg(20,'/start'); msg(20,'علي حسن محمد كاظم'); cb(20,'rc:0'); cb(20,'rg:0'); cb(20,'rv:0'); cb(20,'rd:0'); msg(20,'الأعظمية'); msg(20,'07701234567'); msg(20,'07801234567'); cb(20,'rx:0'); cb(20,'ra:1'); cb(20,'rn:1'); cb(20,'rs:ok'); show()
import base64
def L():
    d=json.loads(base64.urlsafe_b64decode(bot.store_link(20).split('&d=')[1]+'==')); return [p[1] for ct in d['c'] for p in ct[1]], d.get('w')
print(L())
cb(1,'a:oo'); P(show()); cb(1,'a:oo:0'); P(show(2)); print(L())
