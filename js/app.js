/* Home Gym Coach — mobile session engine */
(function () {
  const STORE_KEY = "hgc_v1";
  const DATA = window.HGC_DATA;

  const state = loadState();
  let session = null;
  let restTimer = null;
  let restLeft = 0;
  let sessionTick = null;
  let workTimer = null;
  let workMode = "up";
  let workSeconds = 0;
  let workRunning = false;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  function loadState() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      dayIndex: 0,
      duration: "full",
      sound: true,
      weights: {},
      targets: {},
      fitdaysLogs: [],
      fitdaysAdvice: null,
      history: [],
      completedDays: {},
      profile: {
        weightKg: 73,
        heightCm: 176,
        age: 33,
        sex: "male",
        bodyFatPct: 15.3,
        muscleKg: 35.1,
        visceral: 3,
        score: 82,
        note: "Fitdays baseline · เป้าหุ่นนายแบบ (hypertrophy + lean)",
        updated: "2026-07-29",
      },
    };
  }

  function saveState() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function ensureTargets() {
    if (!state.targets) {
      state.targets = {};
      saveState();
    }
  }

  function ensureFitdays() {
    if (!Array.isArray(state.fitdaysLogs)) {
      state.fitdaysLogs = [];
      saveState();
    }
  }

  let pendingFitdaysBlob = null;
  let pendingFitdaysPreviewUrl = null;

  function refreshFitdaysAdvice() {
    ensureFitdays();
    ensureProfile();
    const FD = window.HGC_FITDAYS;
    if (!FD) return null;
    const advice = FD.analyze(state.fitdaysLogs, state.profile);
    state.fitdaysAdvice = advice;
    saveState();
    return advice;
  }

  function renderFitdaysAdviceUI() {
    const advice = state.fitdaysAdvice || refreshFitdaysAdvice();
    const box = $("#fd-advice-body");
    const tip = $("#home-fitdays-tip");
    if (!advice) return;
    let html = `<div>${advice.summary}</div>`;
    if (advice.flags && advice.flags.length) {
      html +=
        "<ul style='margin:8px 0 0;padding-left:1.1rem'>" +
        advice.flags.map((f) => `<li style="margin-bottom:6px">${f}</li>`).join("") +
        "</ul>";
    } else if (state.fitdaysLogs.length) {
      html += `<p class="muted" style="margin-top:8px">แนวโน้มยังไม่ชัด — บันทึกต่อเนื่องอีก 3–7 วันจะแม่นขึ้น</p>`;
    }
    if (advice.deload) {
      html += `<p class="ok" style="margin-top:8px">แนะนำสัปดาห์นี้: volume เบา / โหมด 30 นาที</p>`;
    } else if (advice.suggestDuration) {
      html += `<p class="muted" style="margin-top:8px">โหมดที่ระบบเอนเอียง: ${durationLabel(
        advice.suggestDuration
      )}</p>`;
    }
    if (box) box.innerHTML = html;
    if (tip) {
      tip.textContent = advice.flags?.[0] || advice.summary || "";
      tip.classList.toggle("hidden", !tip.textContent);
    }
  }

  async function renderFitdays() {
    ensureFitdays();
    ensureProfile();
    refreshFitdaysAdvice();
    renderFitdaysAdviceUI();

    if (!$("#fd-date").value) $("#fd-date").value = todayKey();
    // prefill from profile / last log
    const last = [...state.fitdaysLogs].sort((a, b) =>
      b.date.localeCompare(a.date)
    )[0];
    if (!$("#fd-weight").value) {
      $("#fd-weight").value =
        last?.weightKg ?? state.profile.weightKg ?? "";
    }
    if (!$("#fd-bf").value && (last?.bodyFatPct ?? state.profile.bodyFatPct)) {
      $("#fd-bf").value = last?.bodyFatPct ?? state.profile.bodyFatPct;
    }
    if (!$("#fd-muscle").value && (last?.muscleKg ?? state.profile.muscleKg)) {
      $("#fd-muscle").value = last?.muscleKg ?? state.profile.muscleKg;
    }
    if (!$("#fd-visceral").value && (last?.visceral ?? state.profile.visceral) != null) {
      $("#fd-visceral").value = last?.visceral ?? state.profile.visceral;
    }
    if (!$("#fd-score").value && (last?.score ?? state.profile.score) != null) {
      $("#fd-score").value = last?.score ?? state.profile.score;
    }

    const list = $("#fd-list");
    const logs = [...state.fitdaysLogs].sort((a, b) =>
      b.date.localeCompare(a.date)
    );
    if (!logs.length) {
      list.innerHTML =
        '<p class="muted">ยังไม่มีบันทึก — เริ่มจากรูปวันนี้ได้เลย</p>';
      return;
    }

    list.innerHTML = logs
      .map(
        (l) => `
      <div class="fd-item" data-id="${l.id}">
        <img data-img="${l.imageId || ""}" alt="" />
        <div>
          <div><strong>${l.date}</strong> · ${l.weightKg} kg</div>
          <div class="muted">${
            l.bodyFatPct != null ? `ไขมัน ${l.bodyFatPct}%` : ""
          }${l.muscleKg != null ? ` · กล้ามเนื้อ ${l.muscleKg}` : ""}${
          l.score != null ? ` · ${l.score} คะแนน` : ""
        }</div>
          ${l.note ? `<div class="muted">${l.note}</div>` : ""}
        </div>
        <button type="button" class="del" data-del="${l.id}">ลบ</button>
      </div>`
      )
      .join("");

    // load thumbs
    for (const img of list.querySelectorAll("img[data-img]")) {
      const id = img.getAttribute("data-img");
      if (!id) continue;
      try {
        const blob = await window.HGC_FITDAYS.getImage(id);
        if (blob) img.src = URL.createObjectURL(blob);
      } catch (_) {}
    }

    list.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del");
        if (!confirm("ลบบันทึกนี้?")) return;
        const row = state.fitdaysLogs.find((x) => x.id === id);
        state.fitdaysLogs = state.fitdaysLogs.filter((x) => x.id !== id);
        saveState();
        if (row?.imageId) {
          try {
            await window.HGC_FITDAYS.deleteImage(row.imageId);
          } catch (_) {}
        }
        toast("ลบแล้ว");
        renderFitdays();
        renderHome();
      });
    });
  }

  async function onFitdaysFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const blob = await window.HGC_FITDAYS.compressFile(file);
      pendingFitdaysBlob = blob;
      if (pendingFitdaysPreviewUrl) URL.revokeObjectURL(pendingFitdaysPreviewUrl);
      pendingFitdaysPreviewUrl = URL.createObjectURL(blob);
      $("#fd-preview").src = pendingFitdaysPreviewUrl;
      $("#fd-preview").classList.remove("hidden");
      $("#fd-upload-box").classList.add("hidden");
      toast("โหลดรูปแล้ว — กรอกตัวเลขแล้วกดบันทึก");
    } catch (_) {
      toast("อ่านรูปไม่สำเร็จ");
    }
  }

  async function saveFitdaysEntry() {
    ensureFitdays();
    const date = $("#fd-date").value || todayKey();
    const weightKg = Number($("#fd-weight").value);
    if (!weightKg) {
      toast("ใส่น้ำหนักจาก Fitdays ด้วย");
      return;
    }
    const bodyFatPct = $("#fd-bf").value === "" ? null : Number($("#fd-bf").value);
    const muscleKg =
      $("#fd-muscle").value === "" ? null : Number($("#fd-muscle").value);
    const visceral =
      $("#fd-visceral").value === "" ? null : Number($("#fd-visceral").value);
    const score = $("#fd-score").value === "" ? null : Number($("#fd-score").value);
    const note = ($("#fd-note").value || "").trim();

    const id = `fd_${date}_${Date.now()}`;
    let imageId = null;
    if (pendingFitdaysBlob) {
      imageId = `img_${id}`;
      await window.HGC_FITDAYS.saveImage(imageId, pendingFitdaysBlob);
    }

    // replace same date if exists
    state.fitdaysLogs = state.fitdaysLogs.filter((x) => x.date !== date);
    state.fitdaysLogs.push({
      id,
      date,
      weightKg,
      bodyFatPct,
      muscleKg,
      visceral,
      score,
      note,
      imageId,
    });

    // sync profile
    ensureProfile();
    state.profile.weightKg = weightKg;
    if (bodyFatPct != null) state.profile.bodyFatPct = bodyFatPct;
    if (muscleKg != null) state.profile.muscleKg = muscleKg;
    if (visceral != null) state.profile.visceral = visceral;
    if (score != null) state.profile.score = score;
    state.profile.updated = date;
    saveState();

    pendingFitdaysBlob = null;
    refreshFitdaysAdvice();
    toast("บันทึก Fitdays แล้ว");
    renderFitdays();
    renderHome();
  }

  function applyFitdaysDurationSuggestion() {
    const advice = state.fitdaysAdvice || refreshFitdaysAdvice();
    if (!advice?.suggestDuration) {
      toast("ยังไม่มีคำแนะนำโหมดเวลา — บันทึกต่อเนื่องก่อน");
      return;
    }
    state.duration = advice.suggestDuration;
    saveState();
    toast(`ตั้งโหมดเป็น ${durationLabel(advice.suggestDuration)} ตาม Fitdays`);
    renderHome();
    showView("home");
  }

  function ensureProfile() {
    const defaults = {
      weightKg: 73,
      heightCm: 176,
      age: 33,
      sex: "male",
      bodyFatPct: 15.3,
      muscleKg: 35.1,
      visceral: 3,
      score: 82,
      note: "Fitdays baseline · เป้าหุ่นนายแบบ (hypertrophy + lean)",
      updated: "2026-07-29",
    };
    if (!state.profile) {
      state.profile = { ...defaults };
      saveState();
      return;
    }
    let changed = false;
    for (const [k, v] of Object.entries(defaults)) {
      if (state.profile[k] == null || state.profile[k] === "") {
        state.profile[k] = v;
        changed = true;
      }
    }
    if (changed) saveState();
  }

  function calcBmi(p) {
    const m = p.heightCm / 100;
    if (!m) return null;
    return p.weightKg / (m * m);
  }

  function profileSummaryText() {
    ensureProfile();
    const p = state.profile;
    const bmi = calcBmi(p);
    const bmiStr = bmi != null ? bmi.toFixed(1) : "—";
    return `${p.weightKg} kg · ${p.heightCm} cm · อายุ ${p.age} · BMI ${bmiStr}` +
      (p.bodyFatPct != null ? ` · ไขมัน ${p.bodyFatPct}%` : "");
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  }

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function getDay() {
    return DATA.days[state.dayIndex % DATA.days.length];
  }

  function getPlan(day) {
    if (state.duration === "short") return day.short;
    if (state.duration === "long") return day.long || day.full;
    return day.full;
  }

  function durationLabel(d) {
    if (d === "short") return "30 นาที";
    if (d === "long") return "60 นาที";
    return "45+ นาที";
  }

  function resolveWeight(ex) {
    if (state.weights[ex.id] != null) return state.weights[ex.id];
    if (ex.startKg != null) return ex.startKg;
    return null;
  }

  function stepWeight(current, dir) {
    const steps = DATA.dbSteps;
    if (current == null) current = 8;
    let idx = steps.findIndex((s) => s === current);
    if (idx < 0) {
      let best = 0;
      let bestDiff = Infinity;
      steps.forEach((s, i) => {
        const diff = Math.abs(s - current);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      });
      idx = best;
    }
    idx = Math.max(0, Math.min(steps.length - 1, idx + dir));
    return steps[idx];
  }

  /** Parse "8-10", "12-15", "3-5", "8-10/ข้าง" — skip timed strings */
  function parseRepRange(reps) {
    if (!reps || /วิ|นาที/.test(reps)) return null;
    const perSide = /ข้าง/.test(reps);
    const m = String(reps).match(/(\d+)\s*[-–]\s*(\d+)/);
    if (!m) {
      const single = String(reps).match(/(\d+)/);
      if (!single) return null;
      const n = Number(single[1]);
      return { lo: n, hi: n, perSide };
    }
    return { lo: Number(m[1]), hi: Number(m[2]), perSide };
  }

  function formatRepTarget(targetReps, range) {
    if (!range) return String(targetReps);
    const base = String(targetReps);
    return range.perSide ? `${base}/ข้าง` : base;
  }

  function nextDbStep(kg) {
    if (kg == null) return null;
    const steps = DATA.dbSteps;
    const idx = steps.findIndex((s) => s === kg);
    if (idx >= 0 && idx < steps.length - 1) return steps[idx + 1];
    let best = 0;
    let bestDiff = Infinity;
    steps.forEach((s, i) => {
      const diff = Math.abs(s - kg);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return best < steps.length - 1 ? steps[best + 1] : null;
  }

  /**
   * Double progression (reps-first): เพราะดัมเบลกระโดดขั้นใหญ่ (~4 kg)
   * ดีครบ → +1 rep จนถึงขอบบน → ค่อยขึ้นน้ำหนัก แล้วกลับไปขอบล่าง
   */
  function resolveRepPlan(ex, templateReps) {
    ensureTargets();
    const range = parseRepRange(templateReps);
    if (!range) {
      return { display: templateReps, targetReps: null, range: null };
    }
    let t = state.targets[ex.id];
    if (!t || t.lo !== range.lo || t.hi !== range.hi) {
      t = {
        lo: range.lo,
        hi: range.hi,
        perSide: range.perSide,
        targetReps: range.lo,
      };
      state.targets[ex.id] = t;
      saveState();
    }
    const kg = resolveWeight(ex);
    const next = nextDbStep(kg);
    const left = Math.max(0, range.hi - t.targetReps);
    let hint = `เป้า ${t.targetReps} ครั้ง · ช่วง ${range.lo}–${range.hi}`;
    if (left > 0) {
      hint += ` · เหลืออีก ${left} ขั้น reps ก่อนคิดขึ้นน้ำหนัก`;
    } else if (next != null) {
      hint += ` · ครบขอบบนแล้ว — ครั้งหน้าขึ้นเป็น ${next} kg (กระโดด ~${
        next - kg
      } kg) แล้วเริ่มที่ ${range.lo}`;
    } else if (kg != null) {
      hint += ` · ถึงน้ำหนักสูงสุดของดัมเบลแล้ว — คง reps / ช้าลง`;
    } else {
      hint += ` · ขึ้นน้ำหนักเมื่อครบขอบบน`;
    }
    return {
      display: formatRepTarget(t.targetReps, range),
      targetReps: t.targetReps,
      range,
      hint,
    };
  }

  function speak(text) {
    if (!state.sound || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "th-TH";
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  function beep() {
    if (!state.sound) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.value = 0.05;
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, 180);
    } catch (_) {}
  }

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function parseTimedSeconds(reps) {
    if (!reps) return null;
    if (/นาที/.test(reps)) {
      const nums = reps.match(/\d+/g);
      return nums ? Number(nums[0]) * 60 : 300;
    }
    if (/วิ/.test(reps)) {
      const nums = reps.match(/\d+/g);
      return nums ? Number(nums[0]) : 40;
    }
    return null;
  }

  /* ---------- Clocks ---------- */
  function updateSessionClock() {
    if (!session || !session.startedMs) return;
    const elapsed = Math.floor((Date.now() - session.startedMs) / 1000);
    const el = $("#session-clock");
    if (el) el.textContent = formatTime(elapsed);
  }

  function startSessionClock() {
    stopSessionClock();
    updateSessionClock();
    sessionTick = setInterval(updateSessionClock, 1000);
  }

  function stopSessionClock() {
    if (sessionTick) {
      clearInterval(sessionTick);
      sessionTick = null;
    }
  }

  function stopWorkTimer() {
    if (workTimer) {
      clearInterval(workTimer);
      workTimer = null;
    }
    workRunning = false;
    const box = $("#work-timer-box");
    const btn = $("#btn-timer-toggle");
    if (box) box.classList.remove("running");
    if (btn) btn.textContent = "เริ่มจับเวลา";
  }

  function paintWorkClock() {
    const t = formatTime(workSeconds);
    const workEl = $("#work-time");
    const phaseEl = $("#phase-clock");
    if (workEl) workEl.textContent = t;
    if (phaseEl && session && session.phase === "work") phaseEl.textContent = t;
  }

  function startWorkTimer() {
    if (workRunning) return;
    workRunning = true;
    const box = $("#work-timer-box");
    const btn = $("#btn-timer-toggle");
    if (box) box.classList.add("running");
    if (btn) btn.textContent = "หยุดชั่วคราว";
    workTimer = setInterval(() => {
      if (workMode === "up") {
        workSeconds += 1;
        paintWorkClock();
      } else {
        workSeconds -= 1;
        paintWorkClock();
        if (workSeconds <= 0) {
          workSeconds = 0;
          paintWorkClock();
          stopWorkTimer();
          beep();
          speak("หมดเวลาชุดนี้");
          toast("หมดเวลา — กดบันทึกชุดด้านล่างได้");
        } else if (workSeconds === 5) {
          speak("อีก 5 วินาที");
        }
      }
    }, 1000);
  }

  function toggleWorkTimer() {
    if (workRunning) {
      stopWorkTimer();
      const btn = $("#btn-timer-toggle");
      if (btn) btn.textContent = "เริ่มต่อ";
      return;
    }
    startWorkTimer();
  }

  function resetWorkTimerForStep(step) {
    stopWorkTimer();
    const ex = DATA.exercises[step.exerciseId];
    const timed = parseTimedSeconds(step.reps);
    const box = $("#work-timer-box");
    const isCountdown =
      timed != null &&
      (ex.isTimed || ex.isCardio || ex.isWarmup || /วิ|นาที/.test(step.reps));

    if (isCountdown) {
      workMode = "down";
      workSeconds = timed;
      if (box) box.classList.add("countdown");
      $("#work-timer-label").textContent = "นับถอยหลังชุดนี้";
      $("#phase-clock-label").textContent = "เหลือ";
      $("#work-timer-hint").textContent =
        "เริ่มนับถอยหลังให้อัตโนมัติ — กดหยุดได้";
      paintWorkClock();
      startWorkTimer();
    } else {
      workMode = "up";
      workSeconds = 0;
      if (box) box.classList.remove("countdown");
      $("#work-timer-label").textContent = "จับเวลาชุดนี้ (นับขึ้น)";
      $("#phase-clock-label").textContent = "ชุดนี้";
      $("#work-timer-hint").textContent = `กด “เริ่มจับเวลา” ก่อนยก · หลังชุดพัก ${
        step.restSec || 60
      } วิ อัตโนมัติ`;
      paintWorkClock();
    }
  }

  /* ---------- Navigation ---------- */
  function showView(id) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $(`#view-${id}`).classList.add("active");
    $$(".nav button").forEach((b) =>
      b.classList.toggle("on", b.dataset.view === id)
    );
    document.body.classList.toggle("coach-mode", id === "coach");
    if (id !== "coach") $(".nav").classList.remove("hidden");
    else $(".nav").classList.add("hidden");
  }

  /* ---------- Home ---------- */
  function renderHome() {
    ensureProfile();
    const day = getDay();
    const plan = getPlan(day);
    $("#home-title").textContent = day.titleEn;
    $("#home-subtitle").textContent = day.title;
    $("#home-focus").textContent = day.focus;
    $("#home-minutes").textContent = `~${plan.minutes} นาที`;
    $("#home-profile").textContent = profileSummaryText();
    renderFitdaysAdviceUI();
    $("#chip-full").classList.toggle("on", state.duration === "full");
    $("#chip-short").classList.toggle("on", state.duration === "short");
    $("#chip-long").classList.toggle("on", state.duration === "long");

    const week = $("#week-grid");
    week.innerHTML = "";
    DATA.days.forEach((d, i) => {
      const el = document.createElement("div");
      el.className = "d";
      if (i === state.dayIndex % DATA.days.length) el.classList.add("now");
      el.textContent = d.id === "rest" ? "R" : String(i + 1);
      el.title = d.title;
      week.appendChild(el);
    });

    const list = $("#home-exercises");
    list.innerHTML = "";
    plan.blocks.forEach((b) => {
      const ex = DATA.exercises[b.exerciseId];
      if (!ex) return;
      const sets = b.sets ?? ex.defaultSets;
      const templateReps = b.reps ?? ex.defaultReps;
      const planReps = resolveRepPlan(ex, templateReps);
      const li = document.createElement("li");
      li.innerHTML = `
        <img src="${ex.image}" alt="">
        <div>
          <div class="name">${ex.name}</div>
          <div class="sub">${ex.nameTh}</div>
        </div>
        <div class="sets">${sets}×${planReps.display}</div>`;
      list.appendChild(li);
    });

    $("#btn-start").textContent = day.isRest
      ? "เริ่ม Active Recovery"
      : "เริ่มโค้ช — เล่นเลย";
  }

  /* ---------- Session ---------- */
  function buildSession() {
    const day = getDay();
    const plan = getPlan(day);
    const steps = [];

    plan.blocks.forEach((b) => {
      const ex = DATA.exercises[b.exerciseId];
      if (!ex) return;
      const sets = b.sets ?? ex.defaultSets;
      const templateReps = b.reps ?? ex.defaultReps;
      const planReps = resolveRepPlan(ex, templateReps);
      const kg = resolveWeight(ex);

      if (ex.isWarmup || ex.isCardio || ex.isTimed) {
        steps.push({
          type: "block",
          exerciseId: ex.id,
          setNum: 1,
          totalSets: 1,
          reps: planReps.display,
          templateReps,
          targetReps: planReps.targetReps,
          kg,
          restSec: ex.restSec || 0,
        });
        return;
      }

      for (let s = 1; s <= sets; s++) {
        steps.push({
          type: "set",
          exerciseId: ex.id,
          setNum: s,
          totalSets: sets,
          reps: planReps.display,
          templateReps,
          targetReps: planReps.targetReps,
          kg,
          restSec: ex.restSec || 60,
        });
      }
    });

    return {
      dayId: day.id,
      dayTitle: day.titleEn,
      duration: state.duration,
      startedAt: new Date().toISOString(),
      startedMs: Date.now(),
      steps,
      index: 0,
      logs: [],
      phase: "work",
    };
  }

  function startSession() {
    stopRest();
    stopWorkTimer();
    session = buildSession();
    startSessionClock();
    showView("coach");
    renderCoach();
    const ex = DATA.exercises[session.steps[0].exerciseId];
    speak(`เริ่ม ${session.dayTitle}. ท่าแรก ${ex.nameTh}`);
  }

  function currentStep() {
    if (!session) return null;
    return session.steps[session.index] || null;
  }

  function renderCoach() {
    if (!session) return;
    const step = currentStep();
    const total = session.steps.length;
    const pct = Math.round((session.index / Math.max(total, 1)) * 100);
    $("#coach-progress").style.width = `${pct}%`;
    $("#coach-progress-label").textContent = `${session.index + 1}/${total}`;

    if (!step || session.phase === "done") {
      renderDone();
      return;
    }

    const ex = DATA.exercises[step.exerciseId];
    $("#coach-work").classList.remove("hidden");
    $("#coach-rest").classList.add("hidden");
    $("#coach-done").classList.add("hidden");

    $("#coach-img").src = ex.image;
    $("#coach-img").alt = ex.name;
    $("#coach-name").textContent = ex.name;
    $("#coach-name-th").textContent = ex.nameTh;
    $("#coach-muscle").textContent = `${ex.muscle} · ${ex.equipment}`;

    $("#coach-cues").innerHTML = ex.cues.map((c) => `<li>${c}</li>`).join("");
    $("#coach-note").textContent = ex.note || "";
    $("#coach-note").classList.toggle("hidden", !ex.note);

    $("#t-set").textContent = `${step.setNum}/${step.totalSets}`;
    $("#t-reps").textContent = step.reps;
    $("#t-weight").textContent =
      step.kg != null
        ? `${step.kg} kg`
        : ex.bandLevel
          ? `ยาง: ${ex.bandLevel}`
          : "—";

    const repHint = resolveRepPlan(ex, step.templateReps || step.reps);
    if (repHint.hint) {
      $("#prog-hint").textContent = repHint.hint;
      $("#prog-hint").classList.remove("hidden");
    } else {
      $("#prog-hint").textContent = "";
      $("#prog-hint").classList.add("hidden");
    }

    const hasKg = ex.startKg != null || state.weights[ex.id] != null;
    $("#weight-ctrl").classList.toggle("hidden", !hasKg && ex.startKg == null);
    if (hasKg || ex.startKg != null) {
      $("#weight-val").textContent = step.kg != null ? `${step.kg} kg` : "—";
    }

    const next = session.steps[session.index + 1];
    if (next) {
      const nx = DATA.exercises[next.exerciseId];
      $("#coach-next").textContent =
        next.exerciseId === step.exerciseId
          ? `ถัดไป: ชุดที่ ${next.setNum} (ท่าเดิม) · พัก ${step.restSec || 0} วิ`
          : `ถัดไป: ${nx.name} · พัก ${step.restSec || 0} วิ`;
    } else {
      $("#coach-next").textContent = "นี่คือช่วงท้ายของ session";
    }

    resetWorkTimerForStep(step);
    updateSessionClock();
  }

  function paintWeightOnly() {
    const step = currentStep();
    if (!step) return;
    const label = step.kg != null ? `${step.kg} kg` : "—";
    $("#t-weight").textContent = label;
    $("#weight-val").textContent = label;
  }

  function renderRest(seconds, nextStep) {
    stopWorkTimer();
    session.phase = "rest";
    $("#coach-work").classList.add("hidden");
    $("#coach-rest").classList.remove("hidden");
    $("#coach-done").classList.add("hidden");
    $("#phase-clock-label").textContent = "พัก";
    restLeft = seconds;
    $("#rest-time").textContent = formatTime(restLeft);
    $("#phase-clock").textContent = formatTime(restLeft);

    if (nextStep) {
      const nx = DATA.exercises[nextStep.exerciseId];
      $("#rest-next").innerHTML = `
        <img class="coach-img" src="${nx.image}" alt="${nx.name}" style="margin-bottom:10px">
        <strong>ท่าถัดไป</strong><br>
        ${nx.name}<br>
        <span class="muted">${nx.nameTh}</span><br>
        <span class="muted">ชุด ${nextStep.setNum}/${nextStep.totalSets} · ${nextStep.reps}</span>
        <div class="cues" style="margin-top:10px"><ol>${nx.cues
          .slice(0, 2)
          .map((c) => `<li>${c}</li>`)
          .join("")}</ol></div>`;
      speak(`พัก ${seconds} วินาที. ถัดไป ${nx.nameTh}`);
    } else {
      $("#rest-next").textContent = "ใกล้จบแล้ว";
    }

    stopRest();
    restTimer = setInterval(() => {
      restLeft -= 1;
      const t = formatTime(Math.max(0, restLeft));
      $("#rest-time").textContent = t;
      $("#phase-clock").textContent = t;
      if (restLeft <= 0) {
        stopRest();
        beep();
        finishRest();
      } else if (restLeft === 5) {
        speak("อีก 5 วินาที");
      }
    }, 1000);
  }

  function stopRest() {
    if (restTimer) {
      clearInterval(restTimer);
      restTimer = null;
    }
  }

  function adjustRest(delta) {
    if (!session || session.phase !== "rest") return;
    restLeft = Math.max(5, restLeft + delta);
    const t = formatTime(restLeft);
    $("#rest-time").textContent = t;
    $("#phase-clock").textContent = t;
  }

  function completeSet(quality) {
    if (!session || session.phase !== "work") return;
    const step = currentStep();
    if (!step) return;
    const ex = DATA.exercises[step.exerciseId];
    stopWorkTimer();

    session.logs.push({
      exerciseId: step.exerciseId,
      setNum: step.setNum,
      reps: step.reps,
      templateReps: step.templateReps,
      targetReps: step.targetReps,
      kg: step.kg,
      quality,
    });

    if (step.kg != null) state.weights[step.exerciseId] = step.kg;
    saveState();

    const nextIndex = session.index + 1;
    const next = session.steps[nextIndex];
    const needRest =
      step.restSec > 0 && next && !(ex.isWarmup || ex.isCardio);

    if (needRest) {
      session.index = nextIndex;
      renderRest(step.restSec, next);
    } else if (next) {
      session.index = nextIndex;
      session.phase = "work";
      renderCoach();
      const nx = DATA.exercises[next.exerciseId];
      if (next.exerciseId !== step.exerciseId) speak(`ท่าถัดไป ${nx.nameTh}`);
    } else {
      finishSession();
    }
  }

  function finishRest() {
    session.phase = "work";
    renderCoach();
    const step = currentStep();
    if (step) {
      const ex = DATA.exercises[step.exerciseId];
      speak(`เริ่ม ${ex.nameTh} ชุดที่ ${step.setNum}`);
    }
  }

  function skipRest() {
    stopRest();
    finishRest();
  }

  function finishSession() {
    stopRest();
    stopWorkTimer();
    stopSessionClock();
    session.phase = "done";
    applyProgression(session.logs);
    state.history.unshift({
      date: todayKey(),
      dayId: session.dayId,
      dayTitle: session.dayTitle,
      duration: session.duration,
      finishedAt: new Date().toISOString(),
      summary: summarizeLogs(session.logs),
      progressNotes: state._lastProgressNotes || [],
    });
    state.history = state.history.slice(0, 60);
    state.completedDays[todayKey()] = session.dayId;
    state.dayIndex = (state.dayIndex + 1) % DATA.days.length;
    saveState();
    renderDone();
    speak("จบ session แล้ว เก่งมาก");
    renderHistory();
  }

  function summarizeLogs(logs) {
    const byEx = {};
    logs.forEach((l) => {
      if (!byEx[l.exerciseId]) byEx[l.exerciseId] = [];
      byEx[l.exerciseId].push(l);
    });
    return Object.entries(byEx).map(([id, arr]) => {
      const ex = DATA.exercises[id];
      const last = arr[arr.length - 1];
      return {
        name: ex.name,
        sets: arr.length,
        kg: last.kg,
        qualities: arr.map((a) => a.quality),
      };
    });
  }

  function applyProgression(logs) {
    ensureTargets();
    const byEx = {};
    logs.forEach((l) => {
      if (!byEx[l.exerciseId]) byEx[l.exerciseId] = [];
      byEx[l.exerciseId].push(l);
    });

    const notes = [];
    Object.entries(byEx).forEach(([id, arr]) => {
      const ex = DATA.exercises[id];
      if (!ex || ex.isWarmup || ex.isCardio) return;

      const templateReps = arr[0].templateReps || arr[0].reps;
      const range = parseRepRange(templateReps);
      if (!range) return;

      const allGood = arr.every((a) => a.quality === "good");
      const anyFail = arr.some((a) => a.quality === "fail");
      const kg = arr[arr.length - 1].kg;
      if (kg != null) state.weights[id] = kg;

      let t = state.targets[id];
      if (!t || t.lo !== range.lo || t.hi !== range.hi) {
        t = {
          lo: range.lo,
          hi: range.hi,
          perSide: range.perSide,
          targetReps: range.lo,
        };
      }
      const before = { reps: t.targetReps, kg };

      if (allGood && arr.length >= 1) {
        if (t.targetReps < range.hi) {
          t.targetReps += 1;
          notes.push(
            `${ex.name}: ครั้งหน้าเป้า ${t.targetReps} ครั้ง (ยังไม่ขึ้นน้ำหนัก)`
          );
        } else if (kg != null) {
          const maxKg = DATA.dbSteps[DATA.dbSteps.length - 1];
          if (kg < maxKg) {
            const next = stepWeight(kg, +1);
            state.weights[id] = next;
            t.targetReps = range.lo;
            notes.push(
              `${ex.name}: ครบขอบบนแล้ว → ขึ้นเป็น ${next} kg แล้วเริ่มที่ ${range.lo} ครั้ง`
            );
          } else {
            notes.push(
              `${ex.name}: ถึง ${maxKg} kg แล้ว — คง ${range.hi} ครั้ง / ช้าลง (tempo) แทน`
            );
          }
        } else {
          // bodyweight e.g. pull-up: slowly allow +1 beyond hi (cap hi+3)
          const cap = range.hi + 3;
          if (t.targetReps < cap) {
            t.targetReps += 1;
            notes.push(`${ex.name}: ครั้งหน้าเป้า ${t.targetReps} ครั้ง`);
          } else {
            notes.push(`${ex.name}: reps สูงแล้ว — โฟกัสฟอร์ม / เพิ่มชุดช่วยยาง`);
          }
        }
      } else if (anyFail) {
        if (t.targetReps > range.lo) {
          t.targetReps -= 1;
          notes.push(`${ex.name}: ลดเป้าเหลือ ${t.targetReps} ครั้ง`);
        } else if (kg != null && kg > DATA.dbSteps[0]) {
          const prev = stepWeight(kg, -1);
          state.weights[id] = prev;
          t.targetReps = range.hi;
          notes.push(
            `${ex.name}: ลดน้ำหนักเป็น ${prev} kg · เป้า ${range.hi} ครั้ง`
          );
        } else {
          notes.push(`${ex.name}: คงเป้าเดิม — โฟกัสฟอร์มครั้งหน้า`);
        }
      } else {
        // hard / mixed — hold
        notes.push(
          `${ex.name}: คง ${t.targetReps} ครั้ง` +
            (kg != null ? ` @ ${kg} kg` : "")
        );
      }

      state.targets[id] = t;
      void before;
    });

    state._lastProgressNotes = notes;
    saveState();
    return notes;
  }

  function renderDone() {
    $("#coach-work").classList.add("hidden");
    $("#coach-rest").classList.add("hidden");
    $("#coach-done").classList.remove("hidden");
    const box = $("#done-summary");
    if (!session) {
      box.textContent = "ไม่มี session";
      return;
    }
    const lines = summarizeLogs(session.logs)
      .map((s) => {
        const q = s.qualities.filter((x) => x === "good").length;
        const kg = s.kg != null ? ` · ${s.kg} kg` : "";
        return `<div class="history-item"><span>${s.name}${kg}</span><span class="ok">${q}/${s.sets} ดี</span></div>`;
      })
      .join("");
    box.innerHTML =
      lines || '<p class="muted">บันทึกว่าง — อาจเป็นวันพักสั้น ๆ</p>';
    const notes = state._lastProgressNotes || [];
    if (notes.length) {
      box.innerHTML +=
        `<div style="margin-top:12px"><strong>ปรับครั้งหน้า (reps ก่อน น้ำหนักทีหลัง)</strong></div>` +
        notes
          .map((n) => `<div class="history-item"><span class="muted">${n}</span></div>`)
          .join("");
    }
    $("#done-next").textContent = `แผนถัดไป: ${getDay().titleEn}`;
  }

  function abandonSession() {
    if (!confirm("ออกจาก session นี้โดยไม่บันทึกว่าเสร็จ?")) return;
    stopRest();
    stopWorkTimer();
    stopSessionClock();
    session = null;
    showView("home");
    renderHome();
  }

  function skipDay() {
    const from = getDay();
    state.dayIndex = (state.dayIndex + 1) % DATA.days.length;
    state._lastNav = { action: "skip", fromIndex: (state.dayIndex - 1 + DATA.days.length) % DATA.days.length };
    saveState();
    toast(`ข้าม «${from.titleEn}» แล้ว — ย้อนได้ด้วยปุ่มซ้าย`);
    renderHome();
  }

  function prevDay() {
    const before = getDay();
    state.dayIndex =
      (state.dayIndex - 1 + DATA.days.length) % DATA.days.length;
    saveState();
    const now = getDay();
    toast(`ย้อนกลับมา «${now.titleEn}» (จาก ${before.titleEn})`);
    renderHome();
  }

  function renderHistory() {
    const box = $("#history-list");
    if (!state.history.length) {
      box.innerHTML =
        '<p class="muted">ยังไม่มีประวัติ — เล่น session แรกได้เลย</p>';
      return;
    }
    box.innerHTML = state.history
      .slice(0, 20)
      .map(
        (h) => `
      <div class="history-item">
        <div>
          <div>${h.dayTitle}</div>
          <div class="muted">${h.date} · ${durationLabel(h.duration)}</div>
        </div>
        <div class="ok">เสร็จ</div>
      </div>`
      )
      .join("");
  }

  function renderSettings() {
    ensureProfile();
    ensureTargets();
    $("#set-sound").checked = state.sound;
    const p = state.profile;
    $("#pf-weight").value = p.weightKg;
    $("#pf-height").value = p.heightCm;
    $("#pf-age").value = p.age;
    $("#pf-bf").value = p.bodyFatPct ?? "";
    $("#pf-summary").textContent = profileSummaryText();
    const bmi = calcBmi(p);
    $("#pf-bmi").textContent = bmi != null ? bmi.toFixed(1) : "—";

    const wbox = $("#weight-list");
    const entries = Object.keys(state.weights);
    const tKeys = Object.keys(state.targets || {});
    const ids = [...new Set([...entries, ...tKeys])];
    if (!ids.length) {
      wbox.innerHTML =
        '<p class="muted">ยังไม่มีความจำน้ำหนัก/reps — จะจำหลังเล่น</p>';
      return;
    }
    wbox.innerHTML = ids
      .map((id) => {
        const ex = DATA.exercises[id];
        const kg = state.weights[id];
        const t = state.targets[id];
        const left = ex ? ex.name : id;
        const right =
          (kg != null ? `${kg} kg` : "—") +
          (t ? ` · เป้า ${t.targetReps}/${t.hi}` : "");
        return `<div class="history-item"><span>${left}</span><span>${right}</span></div>`;
      })
      .join("");
  }

  function saveProfileFromForm() {
    ensureProfile();
    const w = Number($("#pf-weight").value);
    const h = Number($("#pf-height").value);
    const a = Number($("#pf-age").value);
    const bf = Number($("#pf-bf").value);
    if (!w || !h || !a) {
      toast("กรอกน้ำหนัก ส่วนสูง อายุให้ครบ");
      return;
    }
    state.profile.weightKg = w;
    state.profile.heightCm = h;
    state.profile.age = a;
    if (!Number.isNaN(bf) && $("#pf-bf").value !== "") {
      state.profile.bodyFatPct = bf;
    }
    state.profile.updated = todayKey();
    saveState();
    toast("บันทึกโปรไฟล์แล้ว");
    renderSettings();
    renderHome();
  }

  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "home-gym-coach",
      version: 1,
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `home-gym-coach-${todayKey()}.json`;
    a.click();
    toast("ส่งออกแล้ว — เก็บไฟล์ไว้สำรอง");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        const incoming = raw.state || raw;
        if (!incoming || typeof incoming !== "object") {
          toast("ไฟล์ไม่ใช่ข้อมูล Home Gym Coach");
          return;
        }
        if (
          !confirm(
            "นำเข้าจะทับข้อมูลแผน/น้ำหนัก/Fitdays (ตัวเลข) ในเครื่องนี้ — ทำต่อ?"
          )
        ) {
          return;
        }
        const merged = {
          ...loadState(),
          ...incoming,
          profile: { ...(loadState().profile || {}), ...(incoming.profile || {}) },
          weights: { ...(incoming.weights || {}) },
          targets: { ...(incoming.targets || {}) },
          fitdaysLogs: Array.isArray(incoming.fitdaysLogs)
            ? incoming.fitdaysLogs
            : [],
          history: Array.isArray(incoming.history) ? incoming.history : [],
        };
        localStorage.setItem(STORE_KEY, JSON.stringify(merged));
        toast("นำเข้าแล้ว — กำลังรีโหลด");
        setTimeout(() => location.reload(), 500);
      } catch (_) {
        toast("อ่านไฟล์ไม่สำเร็จ");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm("ล้างข้อมูลทั้งหมดในเครื่องนี้?")) return;
    localStorage.removeItem(STORE_KEY);
    indexedDB.deleteDatabase("hgc_fitdays");
    location.reload();
  }

  function bind() {
    $$(".nav button").forEach((b) => {
      b.addEventListener("click", () => {
        const v = b.dataset.view;
        if (v === "coach" && !session) {
          toast("กดเริ่มโค้ชจากหน้าแรกก่อน");
          showView("home");
          renderHome();
          return;
        }
        showView(v);
        if (v === "home") renderHome();
        if (v === "coach") renderCoach();
        if (v === "fitdays") renderFitdays();
        if (v === "history") renderHistory();
        if (v === "settings") renderSettings();
      });
    });

    $("#chip-full").addEventListener("click", () => {
      state.duration = "full";
      saveState();
      renderHome();
      toast("โหมด ~45+ นาที");
    });
    $("#chip-short").addEventListener("click", () => {
      state.duration = "short";
      saveState();
      renderHome();
      toast("โหมด ~30 นาที");
    });
    $("#chip-long").addEventListener("click", () => {
      state.duration = "long";
      saveState();
      renderHome();
      toast("โหมด ~60 นาที");
    });

    $("#btn-start").addEventListener("click", startSession);
    $("#btn-skip-day").addEventListener("click", skipDay);
    $("#btn-prev-day").addEventListener("click", prevDay);

    $("#btn-done-good").addEventListener("click", () => completeSet("good"));
    $("#btn-done-hard").addEventListener("click", () => completeSet("hard"));
    $("#btn-done-fail").addEventListener("click", () => completeSet("fail"));
    $("#btn-skip-rest").addEventListener("click", skipRest);
    $("#btn-abandon").addEventListener("click", abandonSession);
    $("#btn-back-home").addEventListener("click", () => {
      stopWorkTimer();
      stopSessionClock();
      session = null;
      showView("home");
      renderHome();
    });

    $("#btn-timer-toggle").addEventListener("click", toggleWorkTimer);
    $("#btn-timer-reset").addEventListener("click", () => {
      const step = currentStep();
      if (step) resetWorkTimerForStep(step);
    });
    $("#btn-rest-minus").addEventListener("click", () => adjustRest(-15));
    $("#btn-rest-plus").addEventListener("click", () => adjustRest(15));

    $("#w-minus").addEventListener("click", () => {
      const step = currentStep();
      if (!step || session?.phase !== "work") return;
      step.kg = stepWeight(step.kg ?? 8, -1);
      paintWeightOnly();
    });
    $("#w-plus").addEventListener("click", () => {
      const step = currentStep();
      if (!step || session?.phase !== "work") return;
      step.kg = stepWeight(step.kg ?? 8, +1);
      paintWeightOnly();
    });

    $("#set-sound").addEventListener("change", (e) => {
      state.sound = e.target.checked;
      saveState();
      if (state.sound) speak("เปิดเสียงโค้ชแล้ว");
    });
    $("#btn-save-profile").addEventListener("click", saveProfileFromForm);
    $("#fd-file").addEventListener("change", onFitdaysFileChange);
    $("#btn-fd-save").addEventListener("click", () => {
      saveFitdaysEntry().catch(() => toast("บันทึกไม่สำเร็จ"));
    });
    $("#btn-fd-apply").addEventListener("click", applyFitdaysDurationSuggestion);
    $("#btn-export").addEventListener("click", exportData);
    $("#btn-import").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importData(f);
      e.target.value = "";
    });
    $("#btn-reset").addEventListener("click", resetAll);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  ensureProfile();
  ensureTargets();
  ensureFitdays();
  bind();
  renderHome();
  renderHistory();
  showView("home");
})();
