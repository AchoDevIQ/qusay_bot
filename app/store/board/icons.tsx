// أيقونات أزرار السبورة (بدل خط ويندوز): رسم بسيط بخطوط
const S = (d: string, extra?: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />{extra}
  </svg>
);
export const IC: Record<string, React.ReactNode> = {
  menu: S("M4 6h16M4 12h16M4 18h16"),
  pdf: S("M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6"),
  hand: S("M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13M17 11.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L4.5 15.5a1.6 1.6 0 0 1 2.4-2.1L8 14.5"),
  pen: S("M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3"),
  hl: S("M5 19h6M9 15l-2 4M8 14l7-9 4 3-7 9zM12 17l-4-3"),
  eraser: S("M8 20h12M5 15l8-9 6 6-6 7H9z M9 11l6 6"),
  shapes: S("M12 4l8 14H4z"),
  solids: S("M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"),
  board: S("M3 5h18v12H3zM8 21h8M12 17v4"),
  mic: S("M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3"),
  undo: S("M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"),
  redo: S("M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"),
  clear: S("M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"),
  add: S("M12 5v14M5 12h14"),
  prev: S("M9 6l6 6-6 6"),
  next: S("M15 6l-6 6 6 6"),
  min: S("M5 12h14"),
  close: S("M6 6l12 12M18 6L6 18"),
  send: S("M3 11l18-8-8 18-2-8z"),
  inbox: S("M4 13l3-8h10l3 8v6H4zM4 13h5l1 2h4l1-2h5"),
};
