// تعريف بسيط لمكتبة إشعارات المتصفح (ما عندها تعريفات جاهزة)
declare module "web-push" {
  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts?: { TTL?: number }): Promise<unknown>;
    generateVAPIDKeys(): { publicKey: string; privateKey: string };
  };
  export default webpush;
}
