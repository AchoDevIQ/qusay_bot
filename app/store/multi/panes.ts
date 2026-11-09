// ترتيب الصفحات الظاهرة سوا: panes أرقام التبويبات الظاهرة بالترتيب، والأول يطلع بأقصى اليمين (أو فوك بالموبايل)

/** الشاشة الضيقة (موبايل): الصفحات وحدة فوك وحدة */
export const isStacked = (width: number) => width < 640;
/** كم صفحة تنعرض سوا. كل صفحة تحتاج عرض 320 حتى تنقرا */
export const maxPanes = (width: number) => (isStacked(width) ? 2 : Math.min(4, Math.max(2, Math.floor(width / 320))));

/** أقل عرض تنعرض بيه الصفحة بدون ما تحتاج تحركها يمين ويسار: عرض موبايل */
export const PANE_MIN = 360;
/** كم تتصغر الصفحة بمكانها حتى تدخل كلها. width عرض الصفحة بالبكسل، وzoom تكبير الصفحة الكبيرة */
export const paneFit = (width: number, zoom: number) => Math.min(1, width / (PANE_MIN * zoom));

/** بكم قسم تنقسم المساحة إذا هذا التبويب ينحط */
export function slotCount(panes: number[], key: number, max: number) {
  return Math.min(panes.filter((k) => k !== key).length + 1, max);
}
/** المكان تحت الإصبع. pos من 0 (أول حافة) إلى 1 (آخر حافة) */
export function slotAt(pos: number, count: number) {
  return Math.max(0, Math.min(count - 1, Math.floor(pos * count)));
}
/** يحط التبويب بالمكان. إذا الشاشة ما تتحمل أكثر، ياخذ مكان الصفحة اللي نزل عليها */
export function placePane(panes: number[], key: number, slot: number, max: number) {
  const rest = panes.filter((k) => k !== key);
  const at = Math.max(0, Math.min(slot, rest.length));
  if (rest.length >= max) {
    const out = rest.slice(0, max);
    out[Math.min(at, max - 1)] = key;
    return out;
  }
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}
/** زر ◫: يضيف التبويب جنب الظاهرة، أو يشيله منها. آخر صفحة ظاهرة ما تنشال */
export function togglePane(panes: number[], key: number, max: number) {
  if (panes.includes(key)) return panes.length > 1 ? panes.filter((k) => k !== key) : panes;
  return placePane(panes, key, panes.length, max);
}
/** دوسة على تبويب مو ظاهر: ياخذ مكان الصفحة اللي كنت عليها */
export function showTab(panes: number[], key: number, on: number) {
  if (panes.includes(key)) return panes;
  if (!panes.length) return [key];
  const at = panes.includes(on) ? panes.indexOf(on) : panes.length - 1;
  return panes.map((k, i) => (i === at ? key : k));
}
/** سد تبويب: إذا ما بقت صفحة ظاهرة، يطلع آخر تبويب مفتوح */
export function closePane(panes: number[], key: number, left: number[]) {
  const out = panes.filter((k) => k !== key);
  return out.length || !left.length ? out : [left[left.length - 1]];
}
