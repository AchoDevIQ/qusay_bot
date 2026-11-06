// شخصيات جاهزة للدرجات: «كيو» الذهبي بخمس حالات، كل وحدة لمدى درجات. تنضاف لمكتبة الملصقات بزر،
// وبعدها صاحب البوت يغير اسمها أو مداها أو يحذفها، ويضيف شخصيات غيرها مثل أي ملصق
type Char = { name: string; lo: number; hi: number; bg: [string, string]; svg: string };

const GOLD = `<radialGradient id="g" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFE9A8"/><stop offset=".55" stop-color="#F9C445"/><stop offset="1" stop-color="#CEA239"/></radialGradient>`;
const ink = "#1d2c47", edge = "#A87B22";

const eye = (x: number) => `<ellipse cx="${x}" cy="300" rx="34" ry="40" fill="#fff" stroke="${edge}" stroke-width="4"/><circle cx="${x + 5}" cy="308" r="19" fill="${ink}"/><circle cx="${x + 12}" cy="298" r="7" fill="#fff"/>`;
const wink = (x: number) => `<path d="M${x - 32} 306 Q${x} 280 ${x + 32} 306" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>`;
const cheeks = `<ellipse cx="200" cy="368" rx="28" ry="15" fill="#ff7f7f" opacity=".55"/><ellipse cx="400" cy="368" rx="28" ry="15" fill="#ff7f7f" opacity=".55"/>`;
const arm = (d: string) => `<path d="${d}" fill="none" stroke="${edge}" stroke-width="40" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#F2BB3C" stroke-width="28" stroke-linecap="round"/>`;
const hand = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="27" fill="#F9C445" stroke="${edge}" stroke-width="6"/>`;
const spark = (x: number, y: number, s: number, c = "#fff") => `<path d="M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s}Z" fill="${c}"/>`;

/** الجسم: دائرة ذهبية بذيل حرف Q، والوجه والإضافات فوگه */
function body(bg: [string, string], back: string, face: string, front: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs>${GOLD}<linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
<rect width="600" height="600" rx="70" fill="url(#b)"/>
<circle cx="300" cy="560" r="150" fill="#000" opacity=".12"/>
${back}
<path d="M395 440 L470 525" stroke="${edge}" stroke-width="52" stroke-linecap="round"/><path d="M395 440 L470 525" stroke="#E9B23A" stroke-width="38" stroke-linecap="round"/>
<circle cx="300" cy="330" r="170" fill="url(#g)" stroke="${edge}" stroke-width="8"/>
<ellipse cx="240" cy="235" rx="55" ry="28" fill="#fff" opacity=".35" transform="rotate(-20 240 235)"/>
${face}${front}</svg>`;
}

export const CHARACTERS: Char[] = [
  {
    name: "كيو البطل", lo: 95, hi: 100, bg: ["#5b3cc4", "#1d2c6b"],
    svg: "",
  },
  { name: "كيو النجم", lo: 85, hi: 94, bg: ["#0f8f86", "#123b5c"], svg: "" },
  { name: "كيو الشاطر", lo: 70, hi: 84, bg: ["#2f9e55", "#16413a"], svg: "" },
  { name: "كيو المجتهد", lo: 50, hi: 69, bg: ["#e0782c", "#6b2a1d"], svg: "" },
  { name: "كيو لا تستسلم", lo: 0, hi: 49, bg: ["#3b7dd8", "#1d2c47"], svg: "" },
];

const crown = `<path d="M215 178 L228 98 L268 140 L300 80 L332 140 L372 98 L385 178 Z" fill="#FFD54A" stroke="${edge}" stroke-width="7" stroke-linejoin="round"/><circle cx="300" cy="150" r="13" fill="#e8445a"/><circle cx="252" cy="160" r="9" fill="#3b7dd8"/><circle cx="348" cy="160" r="9" fill="#3b7dd8"/>`;
const cap = `<path d="M235 175 L235 205 Q300 232 365 205 L365 175Z" fill="${ink}"/><path d="M300 105 L430 150 L300 195 L170 150Z" fill="#26375a" stroke="#0e1626" stroke-width="5" stroke-linejoin="round"/><path d="M300 150 L410 160 L412 225" fill="none" stroke="#F9C445" stroke-width="6"/><circle cx="412" cy="232" r="11" fill="#F9C445"/>`;
const band = `<path d="M140 252 Q300 196 460 252" fill="none" stroke="#e8445a" stroke-width="30"/><path d="M455 250 L515 225 M455 252 L505 285" stroke="#e8445a" stroke-width="18" stroke-linecap="round"/>`;
const brows = `<path d="M200 248 L272 266" stroke="${ink}" stroke-width="11" stroke-linecap="round"/><path d="M400 248 L328 266" stroke="${ink}" stroke-width="11" stroke-linecap="round"/>`;

const faces = {
  hero: `${eye(240)}${eye(360)}${cheeks}<path d="M240 375 Q300 465 360 375 Z" fill="#7a2d1f" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/><path d="M265 412 Q300 440 335 412 Q300 425 265 412Z" fill="#ff8a8a"/>`,
  star: `${eye(240)}${wink(360)}${cheeks}<path d="M250 380 Q300 432 350 380" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>`,
  smart: `${eye(240)}${eye(360)}${cheeks}<path d="M258 385 Q300 420 342 385" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>`,
  strong: `${eye(240)}${eye(360)}${brows}${cheeks}<path d="M262 398 Q300 412 338 398" fill="none" stroke="${ink}" stroke-width="10" stroke-linecap="round"/>`,
  kind: `${eye(240)}${eye(360)}${cheeks}<path d="M270 388 Q300 410 330 388" fill="none" stroke="${ink}" stroke-width="9" stroke-linecap="round"/>`,
};

const pencil = `<g transform="rotate(-35 520 300)"><rect x="505" y="220" width="30" height="130" rx="4" fill="#ffcd3c" stroke="${ink}" stroke-width="5"/><rect x="505" y="220" width="30" height="20" fill="#e8445a" stroke="${ink}" stroke-width="5"/><path d="M505 350 L520 385 L535 350Z" fill="#f3d9b1" stroke="${ink}" stroke-width="5" stroke-linejoin="round"/></g>`;
const thumb = `<rect x="502" y="205" width="22" height="48" rx="11" fill="#F9C445" stroke="${edge}" stroke-width="6"/>${hand(515, 262)}`;
const book = `<path d="M300 430 Q250 410 195 425 L195 515 Q250 500 300 520Z" fill="#fff" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/><path d="M300 430 Q350 410 405 425 L405 515 Q350 500 300 520Z" fill="#f2f5fb" stroke="${ink}" stroke-width="6" stroke-linejoin="round"/><path d="M220 450 L280 455 M220 470 L280 475 M320 455 L380 450 M320 475 L380 470" stroke="#9fb0c9" stroke-width="5" stroke-linecap="round"/>${hand(195, 470)}${hand(405, 470)}`;
const heart = `<path d="M470 140 C470 115 505 110 510 135 C515 110 550 115 550 140 C550 170 510 190 510 200 C510 190 470 170 470 140Z" fill="#ff6b81"/>`;

CHARACTERS[0].svg = body(CHARACTERS[0].bg, `${arm("M160 300 Q110 230 118 160")}${arm("M440 300 Q490 230 482 160")}${hand(118, 155)}${hand(482, 155)}`, faces.hero, `${crown}${spark(90, 90, 26)}${spark(520, 80, 20, "#FFD54A")}${spark(70, 470, 18, "#FFD54A")}${spark(540, 420, 24)}`);
CHARACTERS[1].svg = body(CHARACTERS[1].bg, `${arm("M445 350 Q515 330 515 275")}`, faces.star, `${cap}${thumb}${spark(95, 120, 22, "#FFD54A")}${spark(80, 420, 16)}`);
CHARACTERS[2].svg = body(CHARACTERS[2].bg, `${arm("M445 360 Q505 350 510 300")}`, faces.smart, `${pencil}${hand(510, 300)}${spark(95, 110, 20)}`);
CHARACTERS[3].svg = body(CHARACTERS[3].bg, `${arm("M450 345 L520 330 L520 255")}`, faces.strong, `${band}${hand(520, 245)}<path d="M478 318 Q500 290 522 318" fill="none" stroke="${edge}" stroke-width="6"/>`);
CHARACTERS[4].svg = body(CHARACTERS[4].bg, "", faces.kind, `${book}${heart}${spark(90, 120, 18)}`);
