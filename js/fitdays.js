/* Fitdays daily log — IndexedDB images + metric history */
window.HGC_FITDAYS = (function () {
  const DB_NAME = "hgc_fitdays";
  const DB_VER = 1;
  const STORE = "shots";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveImage(id, blob) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id, blob, savedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getImage(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteImage(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Compress for mobile storage */
  function compressFile(file, maxW = 1100, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("compress"))),
          "image/jpeg",
          quality
        );
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /**
   * Simple trend rules for workout advice (ไม่ใช่คำแนะนำแพทย์)
   * logs: newest-first or any order — will sort by date
   */
  function analyze(logs, profile) {
    if (!logs || !logs.length) {
      return {
        summary: "ยังไม่มีบันทึก Fitdays — อัปโหลดรูป + กรอกตัวเลขรายวันได้",
        flags: [],
        suggestDuration: null,
        deload: false,
      };
    }
    const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const flags = [];
    let suggestDuration = null;
    let deload = false;

    const weekAgo = sorted.filter((l) => {
      const d = new Date(l.date + "T12:00:00");
      const now = new Date(latest.date + "T12:00:00");
      return (now - d) / 86400000 <= 7;
    });

    if (weekAgo.length >= 2) {
      const first = weekAgo[0];
      const last = weekAgo[weekAgo.length - 1];
      const dw = last.weightKg - first.weightKg;
      const dbf =
        last.bodyFatPct != null && first.bodyFatPct != null
          ? last.bodyFatPct - first.bodyFatPct
          : null;
      const dm =
        last.muscleKg != null && first.muscleKg != null
          ? last.muscleKg - first.muscleKg
          : null;

      if (dw >= 0.8) {
        flags.push(
          `น้ำหนักขึ้น ~${dw.toFixed(1)} kg ใน ~7 วัน — ถ้าไม่ได้ intentionally bulk อาจลดแคลอรี่เล็กน้อย และใช้โหมด 45+ ไม่ต้องยึด 60 ทุกวัน`
        );
        suggestDuration = "full";
      } else if (dw <= -0.8) {
        flags.push(
          `น้ำหนักลง ~${Math.abs(dw).toFixed(1)} kg ใน ~7 วัน — ระวังเสียกล้ามเนื้อ เน้นโปรตีน + พิจารณาโหมด 60 วัน Push/Pull`
        );
        suggestDuration = "long";
      }

      if (dbf != null && dbf <= -0.8 && dw > -0.3) {
        flags.push("ไขมันมีแนวโน้มลงขณะน้ำหนักค่อนข้างนิ่ง — ทิศทาง recomp ดี");
      }
      if (dm != null && dm <= -0.4) {
        flags.push(
          "กล้ามเนื้อโครงร่างมีแนวโน้มลง — ลด volume สัปดาห์นี้ (deload เบา) หรือกินโปรตีนเพิ่ม"
        );
        deload = true;
        suggestDuration = "short";
      }
      if (dm != null && dm >= 0.3 && (dbf == null || dbf <= 0.3)) {
        flags.push("กล้ามเนื้อมีแนวโน้มขึ้น — คง progressive overload ต่อได้");
      }
    }

    if (latest.visceral != null && latest.visceral >= 10) {
      flags.push(
        "ไขมันอวัยวะภายในค่อนข้างสูงในรายงาน — เน้นเดินเบา + นอนให้พอ (ยังไม่ต้องตัดอาหารรุนแรง)"
      );
    }

    if (latest.bodyFatPct != null && latest.bodyFatPct < 10) {
      flags.push(
        "ไขมันต่ำมากตามเครื่องชั่ง — อย่าตัดแคลอรี่เพิ่ม โฟกัสปั้นกล้ามเนื้อและฟื้นตัว"
      );
      suggestDuration = suggestDuration || "long";
    }

    const summary = latest
      ? `ล่าสุด ${latest.date}: ${latest.weightKg} kg` +
        (latest.bodyFatPct != null ? ` · ไขมัน ${latest.bodyFatPct}%` : "") +
        (latest.muscleKg != null ? ` · กล้ามเนื้อ ${latest.muscleKg} kg` : "") +
        (latest.score != null ? ` · คะแนน ${latest.score}` : "")
      : "";

    return {
      summary,
      flags,
      suggestDuration,
      deload,
      latest,
      baseline: profile,
    };
  }

  return { saveImage, getImage, deleteImage, compressFile, analyze };
})();
