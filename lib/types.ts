export type Row = Record<string, any>;

/** العمليات الأساسية. كل منطق البحث والترتيب والتعديل بـ db.ts، فنفس السلوك على القاعدتين */
export type Driver = {
  /** الصفوف المطابقة بالضبط، بترتيب إضافتها */
  list(table: string, eq: Row): Promise<Row[]>;
  /** يرجع رقم الصف الجديد إذا الجدول يرقّم نفسه */
  insert(table: string, row: Row): Promise<number>;
  /** يضيف الصف أو يبدله كله إذا مفتاحه موجود */
  put(table: string, row: Row): Promise<void>;
  patch(table: string, key: unknown[], fields: Row): Promise<void>;
  del(table: string, key: unknown[]): Promise<void>;
  /** إذا فشل شي داخله ما يتغير شي. ممكن تتنفذ fn أكثر من مرة على Firestore */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  /** تجهيز قاعدة البيانات أول مرة */
  init(): Promise<void>;
};
