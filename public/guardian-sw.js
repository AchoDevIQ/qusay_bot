// إشعارات ولي الأمر: يوصل إشعار بكل درجة جديدة، والدوسة تفتح صفحته
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "قصي العميري", { body: d.body || "رسالة جديدة", icon: "/app-logo.png", badge: "/app-logo.png", dir: "rtl", lang: "ar", data: { url: d.url || "/store/guardian" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data && e.notification.data.url ? e.notification.data.url : "/store/guardian"));
});
