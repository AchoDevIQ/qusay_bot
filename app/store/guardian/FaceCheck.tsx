"use client";
// كاميرا وجه ولي الأمر: فحص الحياة (يلف راسه يمين ويسار)، وبعدين بصمة الوجه (128 رقم) وصورة صغيرة للمراجعة.
// المكتبة والنماذج تشتغل على التلفون نفسه، والوجه ما يطلع لأي مكان غير سيرفرنا
import { useEffect, useRef, useState } from "react";

type Result = { desc: number[]; photo: string };
type Api = typeof import("@vladmandic/face-api");
let loaded: Promise<Api> | null = null;
function faceApi(): Promise<Api> {
  loaded ??= (async () => {
    const fa = await import("@vladmandic/face-api");
    await fa.nets.tinyFaceDetector.loadFromUri("/face-models");
    await fa.nets.faceLandmark68Net.loadFromUri("/face-models");
    await fa.nets.faceRecognitionNet.loadFromUri("/face-models");
    return fa;
  })();
  return loaded;
}

const STEPS = ["باوع گدام الكاميرا", "لف راسك شوية لليمين", "هسه لف راسك لليسار", "رجع باوع گدام"];

export default function FaceCheck({ onDone, onCancel }: { onDone: (r: Result) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState("جاري تشغيل الكاميرا...");
  const stop = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setMsg("جاري التحضير...");
        const fa = await faceApi();
        setMsg("");
        let s = 0, turnedR = false, turnedL = false;
        const opts = new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
        while (!stop.current) {
          const v = video.current;
          if (!v) break;
          const det = await fa.detectSingleFace(v, opts).withFaceLandmarks().withFaceDescriptor();
          if (!det) { setMsg("ما دا أشوف وجهك. قرّب للكاميرا بضوء زين"); await new Promise((r) => setTimeout(r, 250)); continue; }
          setMsg("");
          // اتجاه الراس: الخشم بالنسبة لنص العينين
          const p = det.landmarks.positions;
          const eyeL = p[36], eyeR = p[45], nose = p[30];
          const mid = (eyeL.x + eyeR.x) / 2, span = Math.abs(eyeR.x - eyeL.x) || 1;
          const yaw = (nose.x - mid) / span;   // الكاميرا الأمامية معكوسة، فنقبل الجهتين بأي ترتيب
          if (s === 0 && Math.abs(yaw) < 0.12) { s = 1; setStep(1); }
          else if (s === 1 && Math.abs(yaw) > 0.22) { turnedR = yaw > 0; turnedL = yaw < 0; s = 2; setStep(2); }
          else if (s === 2 && Math.abs(yaw) > 0.22 && ((turnedR && yaw < 0) || (turnedL && yaw > 0))) { s = 3; setStep(3); }
          else if (s === 3 && Math.abs(yaw) < 0.12) {
            const c = document.createElement("canvas");
            c.width = 320; c.height = Math.round((v.videoHeight / v.videoWidth) * 320) || 240;
            c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
            stop.current = true;
            onDone({ desc: Array.from(det.descriptor), photo: c.toDataURL("image/jpeg", 0.7) });
            break;
          }
          await new Promise((r) => setTimeout(r, 120));
        }
      } catch {
        setMsg("ما گدرت أفتح الكاميرا. اسمح للتطبيق يستعمل الكاميرا وجرب مرة ثانية");
      }
    })();
    return () => { stop.current = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card"><div className="form" style={{ textAlign: "center" }}>
      <video ref={video} playsInline muted style={{ width: "100%", maxWidth: 360, borderRadius: 16, transform: "scaleX(-1)", background: "#141F33" }} />
      <div style={{ fontSize: 20, fontWeight: 800, margin: "10px 0" }}>{msg || `${step + 1}/4 · ${STEPS[step]}`}</div>
      <button type="button" className="btn ghost" onClick={() => { stop.current = true; onCancel(); }}>رجوع</button>
    </div></div>
  );
}
