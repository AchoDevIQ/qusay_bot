// الطالب دا يصور جوابه: الكاميرا (أو قائمة الموبايل) ممكن تخلي صفحة الامتحان «مخفية» شوية،
// وهذا مو خروج من الامتحان، فما ينرسل تنبيه. ينتهي من يرجع للصفحة، أو بعد 5 دقايق كحد أعلى
let at = 0;
export const markPicking = () => { at = Date.now(); };
export const donePicking = () => { at = 0; };
export const pickingNow = () => at > 0 && Date.now() - at < 5 * 60_000;
