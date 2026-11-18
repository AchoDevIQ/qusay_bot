"use client";
// بنين لو بنات، والصف: إجباريات. الطالب القديم اللي ناقصه وحدة يختارها هنا أول شي
import { useState } from "react";

export type Basics = { gender: boolean; grade: boolean };
export default function BasicsCard({ need, busy, save }: { need: Basics; busy: boolean; save: (b: { gender?: string; grade?: string }) => void }) {
  const [gender, setGender] = useState("");
  const [grade, setGrade] = useState("");
  const ready = (!need.gender || gender) && (!need.grade || grade);
  return (
    <div className="card"><div className="form">
      <div className="who">📝 <b>قبل كل شي اختار{need.gender ? " بنين لو بنات" : ""}{need.gender && need.grade ? "، و" : " "}{need.grade ? "صفك بالمدرسة هذه السنة" : ""}.</b><br />بعد الحفظ ما تتغير إلا عن طريق الإدارة.</div>
      {need.gender && (
        <div className="seg">
          {["بنين", "بنات"].map((g) => <button type="button" key={g} className={gender === g ? "on" : ""} onClick={() => setGender(g)}>{g}</button>)}
        </div>
      )}
      {need.grade && (
        <div className="seg">
          {["السادس العلمي", "الخامس العلمي"].map((g) => <button type="button" key={g} className={grade === g ? "on" : ""} onClick={() => setGrade(g)}>{g}</button>)}
        </div>
      )}
      <button type="button" className="btn agbtn" disabled={busy || !ready} onClick={() => save({ ...(need.gender ? { gender } : {}), ...(need.grade ? { grade } : {}) })}>✅ احفظ</button>
    </div></div>
  );
}
