// 🖨 تطبيق جهاز البيع (مجلد device-app): يفتح صفحاتنا جوة، ويطبع بطابعة الجهاز مباشرة بلا نافذة الطباعة.
// التطبيق يحط بالصفحة window.QApp. كل دالة طباعة ترجع "" إذا نجحت، أو سبب الغلط
export type DeviceApp = {
  /** وصل: صورة PNG (بيس64) بعرض 384 نقطة */
  printImage(b64: string): string;
  /** ليبل الامتحان: أوامر TSPL (بيس64) لطابعة الليبل */
  printTspl(b64: string): string;
  /** نافذة الطباعة العادية للصفحة المفتوحة */
  systemPrint(): void;
  /** الطابعة شغالة؟ */
  printerReady(): boolean;
};
export const deviceApp = (): DeviceApp | null =>
  typeof window !== "undefined" && (window as unknown as { QApp?: DeviceApp }).QApp?.printImage ? (window as unknown as { QApp: DeviceApp }).QApp : null;
