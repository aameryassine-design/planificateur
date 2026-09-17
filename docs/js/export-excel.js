// تصدير Excel (نسخة الويب على شاشة عريضة فقط) - يحمّل ExcelJS من CDN عند الطلب فقط، لا تأثير
// إطلاقا على APK أو الهاتف أو على حجم الحزمة المحمَّلة عند فتح التطبيق عاديا
const ExcelExport = (function () {
  const EXCELJS_CDN = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  const MIN_WIDTH = 768;

  const HEADER_ARGB = "FF4A5FA5";
  const WHITE_ARGB = "FFFFFFFF";
  const DONE_FILL = "FFC6EFCE";
  const DONE_FONT = "FF006100";
  const CRITICAL_FILL = "FFFFC7CE";
  const CRITICAL_FONT = "FF9C0006";
  const OTHER_MISS_FILL = "FFFFD9EC";
  const OTHER_MISS_FONT = "FF9C4E85";
  const NEUTRAL_FILL = "FFE7E6E6";
  const NEUTRAL_FONT = "FF808080";

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  function isWideWeb() {
    return !isNative() && window.innerWidth >= MIN_WIDTH;
  }

  // ===== تحميل ExcelJS عند الحاجة فقط =====
  let loadPromise = null;
  function ensureExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = EXCELJS_CDN;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("تعذر تحميل مكتبة Excel"));
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  // ===== قراءة البيانات (مستقلة، على نمط بقية وحدات الصفحات) =====
  async function getHabitsList() {
    return (await Storage.get("habits-list", [])) || [];
  }
  async function getRecurring() {
    return (await Storage.get("recurring-appointments", [])) || [];
  }
  async function getCategories() {
    return (await Storage.get("categories-list", [])) || [];
  }
  async function getDay(dateKey) {
    return (await Storage.get("day:" + dateKey, null)) || { appointments: [], tasks: [], habitChecks: {} };
  }
  async function getDebts() {
    return (await Storage.get("debts", [])) || [];
  }
  async function getBudgetMonth(monthKey) {
    return (await Storage.get("budget:" + monthKey, null)) || { entries: [] };
  }
  async function getHabitsStartDate() {
    const s = await Storage.get("settings", {});
    return (s && s.habitsStartDate) || (typeof HABITS_START_DATE !== "undefined" ? HABITS_START_DATE : null) || null;
  }
  async function loadAllDayChecks() {
    const keys = await Storage.list("day:");
    const map = {};
    for (const key of keys) {
      const day = await Storage.get(key, null);
      if (day && day.habitChecks && Object.keys(day.habitChecks).length > 0) {
        map[key.slice(4)] = day.habitChecks;
      }
    }
    return map;
  }

  // Date بمنتصف ليل UTC مطابق لمفتاح اليوم المحلي: ExcelJS يحوّل كائنات Date عبر مركّباتها
  // بتوقيت UTC عند الكتابة، فإن استعملنا Utils.parseDateKey (منتصف ليل محلي) في مناطق زمنية
  // موجبة (مثلا UTC+1) ينزلق التاريخ يوما إلى الوراء داخل الملف. هذه الدالة تفادي ذلك تحديدا
  // لقيم الخلايا؛ الحسابات (أيام الأسبوع، الجدولة...) تبقى تستعمل Utils.parseDateKey كالمعتاد
  function excelDate(dateKeyStr) {
    const [y, m, d] = dateKeyStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function categoryName(categories, id) {
    const c = categories.find((x) => x.id === id);
    return c ? c.name : "";
  }

  function occurrencesForDate(dateKey, recurring, day) {
    const oneOff = (day.appointments || []).map((a) => ({
      id: a.id,
      time: a.time,
      duration: a.duration || 60,
      title: a.title,
      categoryId: a.categoryId,
      recurring: false
    }));
    const date = Utils.parseDateKey(dateKey);
    const wd = Utils.weekdayMon0(date);
    const recur = recurring
      .filter((r) => r.weekday === wd && dateKey >= r.startDate && !(r.exceptions || []).includes(dateKey))
      .map((r) => ({ id: r.id, time: r.time, duration: r.duration || 60, title: r.title, categoryId: r.categoryId, recurring: true }));
    return oneOff.concat(recur).sort((a, b) => Utils.timeToMinutes(a.time) - Utils.timeToMinutes(b.time));
  }

  function eachDateKeyInRange(startKey, endKey) {
    const keys = [];
    let cur = Utils.parseDateKey(startKey);
    const end = Utils.parseDateKey(endKey);
    while (Utils.dateKey(cur) <= Utils.dateKey(end)) {
      keys.push(Utils.dateKey(cur));
      cur = Utils.addDays(cur, 1);
    }
    return keys;
  }

  // ===== واجهة اختيار الفترة =====
  function bindButton() {
    const btn = document.getElementById("btn-export-excel");
    if (!btn) return;
    function updateVisibility() {
      btn.hidden = !isWideWeb();
    }
    updateVisibility();
    window.addEventListener("resize", Utils.debounce(updateVisibility, 150));
    btn.addEventListener("click", openPeriodModal);
  }

  function openPeriodModal() {
    const body = document.createElement("div");

    const choiceWrap = document.createElement("div");
    choiceWrap.className = "freq-toggle";
    const choices = [
      { id: "month", label: T.excelPeriodThisMonth },
      { id: "lastMonth", label: T.excelPeriodLastMonth },
      { id: "custom", label: T.excelPeriodCustom }
    ];
    const btns = {};
    choices.forEach((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm" + (c.id === "month" ? " btn-primary" : "");
      b.textContent = c.label;
      btns[c.id] = b;
      choiceWrap.appendChild(b);
    });
    body.appendChild(choiceWrap);

    const customRow = document.createElement("div");
    customRow.className = "form-row";
    customRow.style.marginTop = "0.6rem";
    customRow.hidden = true;
    const fromField = document.createElement("div");
    fromField.className = "field";
    fromField.innerHTML = `<label>${T.excelFromDate}</label>`;
    const fromInput = document.createElement("input");
    fromInput.type = "date";
    fromField.appendChild(fromInput);
    const toField = document.createElement("div");
    toField.className = "field";
    toField.innerHTML = `<label>${T.excelToDate}</label>`;
    const toInput = document.createElement("input");
    toInput.type = "date";
    toField.appendChild(toInput);
    customRow.appendChild(fromField);
    customRow.appendChild(toField);
    body.appendChild(customRow);

    const errEl = document.createElement("div");
    errEl.className = "form-error";
    body.appendChild(errEl);

    let choice = "month";
    Object.keys(btns).forEach((id) => {
      btns[id].addEventListener("click", () => {
        choice = id;
        Object.keys(btns).forEach((k) => btns[k].classList.toggle("btn-primary", k === id));
        customRow.hidden = id !== "custom";
      });
    });

    const today = new Date();
    if (!fromInput.value) fromInput.value = Utils.dateKey(new Date(today.getFullYear(), today.getMonth(), 1));
    if (!toInput.value) toInput.value = Utils.todayKey();

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "btn btn-primary btn-sm";
    goBtn.style.marginTop = "0.6rem";
    goBtn.textContent = T.excelGenerate;
    goBtn.addEventListener("click", async () => {
      let range;
      const now = new Date();
      if (choice === "month") {
        range = { start: Utils.dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), end: Utils.todayKey() };
      } else if (choice === "lastMonth") {
        const lm = Utils.addMonths(new Date(now.getFullYear(), now.getMonth(), 1), -1);
        range = {
          start: Utils.dateKey(new Date(lm.getFullYear(), lm.getMonth(), 1)),
          end: Utils.dateKey(new Date(lm.getFullYear(), lm.getMonth() + 1, 0))
        };
      } else {
        if (!fromInput.value || !toInput.value || fromInput.value > toInput.value) {
          errEl.textContent = T.excelRangeInvalid;
          errEl.classList.add("show");
          return;
        }
        range = { start: fromInput.value, end: toInput.value };
      }
      errEl.classList.remove("show");
      Modal.close();
      await generateWorkbook(range, goBtn);
    });
    body.appendChild(goBtn);

    Modal.open({
      title: T.excelPeriodTitle,
      bodyNode: body,
      buttons: [{ label: T.cancel, onClick: null }]
    });
  }

  // ===== رسم مخططات بسيطة على canvas ثم تصديرها كصور PNG (ExcelJS لا يُنشئ مخططات أصلية) =====
  function makeCanvas(w, h) {
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = w * scale;
    c.height = h * scale;
    c.style.width = w + "px";
    c.style.height = h + "px";
    const ctx = c.getContext("2d");
    ctx.scale(scale, scale);
    ctx.direction = "rtl";
    return { canvas: c, ctx, w, h };
  }
  function chartBase(title, w, h) {
    const { canvas, ctx } = makeCanvas(w, h);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#22252A";
    ctx.font = "bold 15px Arial";
    ctx.textAlign = "center";
    ctx.direction = "rtl";
    ctx.fillText(title, w / 2, 22);
    return { canvas, ctx };
  }
  function toPngBase64(canvas) {
    return canvas.toDataURL("image/png").split(",")[1];
  }

  function drawLineChart(title, labels, values, w, h) {
    const { canvas, ctx } = chartBase(title, w, h);
    const padL = 40, padR = 20, padT = 36, padB = 34;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const maxV = 100;
    ctx.strokeStyle = "#DAD8CF";
    ctx.fillStyle = "#55585F";
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    [0, 25, 50, 75, 100].forEach((v) => {
      const y = padT + plotH - (v / maxV) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(v + "%", padL - 32, y + 3);
    });
    if (values.length > 0) {
      ctx.strokeStyle = "#3B6E64";
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = padL + (values.length > 1 ? (i / (values.length - 1)) * plotW : plotW / 2);
        const y = padT + plotH - (v / maxV) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = "#3B6E64";
      values.forEach((v, i) => {
        const x = padL + (values.length > 1 ? (i / (values.length - 1)) * plotW : plotW / 2);
        const y = padT + plotH - (v / maxV) * plotH;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // تسميات محور الأيام: بداية ونهاية ومنتصف فقط لتفادي الازدحام
    ctx.fillStyle = "#55585F";
    ctx.textAlign = "center";
    const idxs = labels.length > 1 ? [0, Math.floor((labels.length - 1) / 2), labels.length - 1] : [0];
    idxs.forEach((i) => {
      if (labels[i] === undefined) return;
      const x = padL + (labels.length > 1 ? (i / (labels.length - 1)) * plotW : plotW / 2);
      ctx.fillText(labels[i], x, h - padB + 14);
    });
    return canvas;
  }

  function drawBarChart(title, labels, values, w, h, color, maxV) {
    const { canvas, ctx } = chartBase(title, w, h);
    const padL = 40, padR = 20, padT = 36, padB = 60;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const max = maxV || Math.max(1, ...values);
    ctx.strokeStyle = "#DAD8CF";
    ctx.fillStyle = "#55585F";
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i;
      const y = padT + plotH - (v / max) * plotH;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillText(Math.round(v).toString(), padL - 30, y + 3);
    }
    const n = Math.max(1, values.length);
    const bw = Math.min(38, (plotW / n) * 0.6);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    values.forEach((v, i) => {
      const cx = padL + (i + 0.5) * (plotW / n);
      const bh = (v / max) * plotH;
      ctx.fillStyle = color;
      ctx.fillRect(cx - bw / 2, padT + plotH - bh, bw, bh);
      ctx.fillStyle = "#22252A";
      ctx.font = "9px Arial";
      const label = String(labels[i] || "").slice(0, 12);
      ctx.save();
      ctx.translate(cx, h - padB + 12);
      ctx.rotate((-30 * Math.PI) / 180);
      ctx.textAlign = "right";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });
    return canvas;
  }

  function drawPieChart(title, labels, values, w, h) {
    const { canvas, ctx } = chartBase(title, w, h);
    const total = values.reduce((s, v) => s + v, 0);
    const cx = w * 0.36, cy = h / 2 + 6, r = Math.min(w * 0.3, h / 2 - 20);
    const palette = ["#4A5FA5", "#B5562F", "#3B6E64", "#8A7F6B", "#B23A3A", "#D6A24A", "#6A5AAE", "#3A8FB2"];
    let start = -Math.PI / 2;
    if (total <= 0) {
      ctx.fillStyle = "#808080";
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.fillText(T.excelNoData, w / 2, h / 2);
      return canvas;
    }
    values.forEach((v, i) => {
      const angle = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = palette[i % palette.length];
      ctx.fill();
      start += angle;
    });
    // مفتاح الألوان
    const legendX = w * 0.62;
    let legendY = 44;
    ctx.font = "10px Arial";
    ctx.textAlign = "right";
    labels.forEach((lab, i) => {
      ctx.fillStyle = palette[i % palette.length];
      ctx.fillRect(w - 18, legendY - 8, 10, 10);
      ctx.fillStyle = "#22252A";
      const pct = total > 0 ? Math.round((values[i] / total) * 100) : 0;
      ctx.fillText(`${lab} (${pct}%)`, w - 22, legendY);
      legendY += 15;
      if (legendY > h - 10) return;
    });
    return canvas;
  }

  // ===== إعداد ورقة عامة: RTL، أريال، تجميد الصف الأول =====
  function setupSheet(ws, frozen) {
    ws.views = [{ rightToLeft: true, state: frozen ? "frozen" : "normal", xSplit: frozen ? frozen.x || 0 : 0, ySplit: frozen ? frozen.y || 1 : 0 }];
  }
  function styleHeaderCell(cell) {
    cell.font = { name: "Arial", bold: true, color: { argb: WHITE_ARGB } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  function applyDefaultFont(ws) {
    ws.eachRow((row) => {
      row.eachCell((cell) => {
        if (!cell.font) cell.font = { name: "Arial" };
        else if (!cell.font.name) cell.font.name = "Arial";
      });
    });
  }

  // ===== توليد الملف =====
  async function generateWorkbook(range, triggerBtn) {
    const originalText = triggerBtn ? triggerBtn.textContent : null;
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = T.excelGenerating;
    }
    try {
      await ensureExcelJS();

      const [habits, recurring, categories, debts, checksMap, habitsStartDate] = await Promise.all([
        getHabitsList(),
        getRecurring(),
        getCategories(),
        getDebts(),
        loadAllDayChecks(),
        getHabitsStartDate()
      ]);

      const allDateKeys = eachDateKeyInRange(range.start, range.end);
      const habitDateKeys = habitsStartDate ? allDateKeys.filter((k) => k >= habitsStartDate) : allDateKeys;
      const todayKey = Utils.todayKey();

      const days = {};
      for (const key of allDateKeys) days[key] = await getDay(key);

      const wb = new ExcelJS.Workbook();
      wb.creator = "المخطط";
      wb.created = new Date();

      const charts = buildHabitsSheet(wb, habits, days, habitDateKeys, todayKey);
      const streakInfo = buildStreaksSheet(wb, habits, checksMap, todayKey, habitsStartDate);
      const tasksInfo = buildTasksSheet(wb, days, allDateKeys, categories);
      buildAppointmentsSheet(wb, days, recurring, allDateKeys, categories);
      const budgetInfo = await buildBudgetSheet(wb, range, categories);
      const debtsInfo = buildDebtsSheet(wb, debts, range);
      buildDashboardSheet(wb, range, charts, streakInfo, tasksInfo, budgetInfo, debtsInfo);

      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${T.appName}_${Utils.todayKey()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.error("ExcelExport:", e);
      alert(T.excelError);
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = originalText;
      }
    }
  }

  // ----- ورقة 2: العادات - يومي -----
  function buildHabitsSheet(wb, habits, days, habitDateKeys, todayKey) {
    const ws = wb.addWorksheet(T.excelSheetHabitsDaily);
    setupSheet(ws, { x: 3, y: 1 });

    const header = [T.excelColHabit, T.excelColImportance, T.excelColFrequency].concat(
      habitDateKeys.map((k) => excelDate(k)),
      [T.excelColDone, T.excelColScheduled, T.excelColPercent]
    );
    const headerRow = ws.addRow(header);
    headerRow.eachCell((cell, colNumber) => {
      styleHeaderCell(cell);
      if (colNumber > 3 && colNumber <= 3 + habitDateKeys.length) cell.numFmt = "dd/mm";
    });
    ws.getColumn(1).width = 22;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 14;
    for (let i = 0; i < habitDateKeys.length; i++) ws.getColumn(4 + i).width = 6;
    ws.getColumn(4 + habitDateKeys.length).width = 10;
    ws.getColumn(5 + habitDateKeys.length).width = 10;
    ws.getColumn(6 + habitDateKeys.length).width = 9;

    const dayPct = habitDateKeys.map(() => ({ done: 0, scheduled: 0 }));

    habits.forEach((h) => {
      const priority = Utils.habitPriority(h);
      const freqLabel = h.schedule && h.schedule.type === "days"
        ? (h.schedule.days || []).slice().sort((a, b) => a - b).map((d) => T.weekdaysTiny[d]).join("، ") || T.freqDaily
        : T.freqDaily;
      const rowValues = [h.name, Utils.habitPriorityLabel(priority), freqLabel];
      let doneCount = 0, scheduledCount = 0;
      const cellMeta = [];
      habitDateKeys.forEach((key, i) => {
        const date = Utils.parseDateKey(key);
        const scheduled = Utils.isHabitScheduled(h, date);
        const done = !!(days[key] && days[key].habitChecks && days[key].habitChecks[h.id]);
        const isFuture = key > todayKey;
        let mark = "", kind = "neutral";
        if (isFuture) {
          mark = "";
          kind = "neutral";
        } else if (done) {
          mark = "✓";
          kind = "done";
          doneCount++;
          scheduledCount++;
          dayPct[i].done++;
          dayPct[i].scheduled++;
        } else if (scheduled) {
          mark = "✗";
          kind = priority === "high" ? "critical" : "other-miss";
          scheduledCount++;
          dayPct[i].scheduled++;
        } else {
          mark = "";
          kind = "neutral";
        }
        rowValues.push(mark);
        cellMeta.push(kind);
      });
      const pct = scheduledCount > 0 ? Math.round((doneCount / scheduledCount) * 100) : 0;
      rowValues.push(doneCount, scheduledCount, pct / 100);
      const row = ws.addRow(rowValues);
      row.getCell(1).alignment = { horizontal: "right" };
      row.getCell(1).font = { name: "Arial", bold: priority === "high" };
      cellMeta.forEach((kind, i) => {
        const cell = row.getCell(4 + i);
        cell.alignment = { horizontal: "center" };
        if (kind === "done") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DONE_FILL } };
          cell.font = { name: "Arial", color: { argb: DONE_FONT }, bold: true };
        } else if (kind === "critical") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CRITICAL_FILL } };
          cell.font = { name: "Arial", color: { argb: CRITICAL_FONT }, bold: true };
        } else if (kind === "other-miss") {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OTHER_MISS_FILL } };
          cell.font = { name: "Arial", color: { argb: OTHER_MISS_FONT }, bold: true };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NEUTRAL_FILL } };
          cell.font = { name: "Arial", color: { argb: NEUTRAL_FONT } };
        }
      });
      const pctCell = row.getCell(6 + habitDateKeys.length);
      pctCell.numFmt = "0%";
    });

    if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
    applyDefaultFont(ws);

    // بيانات المخططات: % الإنجاز اليومي عبر كل العادات، و% ولوحة لكل عادة (تُحسب أدناه بشكل منفصل)
    const dailyLabels = habitDateKeys.map((k) => Utils.formatShortDate(Utils.parseDateKey(k)));
    const dailyPct = dayPct.map((d) => (d.scheduled > 0 ? Math.round((d.done / d.scheduled) * 100) : 0));

    const perHabitLabels = habits.map((h) => h.name);
    const perHabitPct = habits.map((h) => {
      let done = 0, scheduled = 0;
      habitDateKeys.forEach((key) => {
        const date = Utils.parseDateKey(key);
        if (key > todayKey) return;
        if (!Utils.isHabitScheduled(h, date)) return;
        scheduled++;
        if (days[key] && days[key].habitChecks && days[key].habitChecks[h.id]) done++;
      });
      return scheduled > 0 ? Math.round((done / scheduled) * 100) : 0;
    });

    const overallDone = dayPct.reduce((s, d) => s + d.done, 0);
    const overallScheduled = dayPct.reduce((s, d) => s + d.scheduled, 0);

    return {
      dailyLabels,
      dailyPct,
      perHabitLabels,
      perHabitPct,
      overallCompletionPct: overallScheduled > 0 ? Math.round((overallDone / overallScheduled) * 100) : 0
    };
  }

  // ----- ورقة 3: الاستمرارية -----
  function buildStreaksSheet(wb, habits, checksMap, todayKey, habitsStartDate) {
    const ws = wb.addWorksheet(T.excelSheetStreaks);
    setupSheet(ws);
    const header = [T.excelColHabit, T.excelColCurrentStreak, T.excelColBestStreak, T.excelColNextMilestone, T.excelColProgress];
    const headerRow = ws.addRow(header);
    headerRow.eachCell(styleHeaderCell);
    ws.columns.forEach((c, i) => {
      ws.getColumn(i + 1).width = [24, 14, 14, 14, 16][i] || 14;
    });

    let maxBest = 0;
    const perHabitCurrent = [];
    habits.forEach((h) => {
      const { current, best } = Utils.computeHabitStreak(h, checksMap, todayKey, habitsStartDate);
      maxBest = Math.max(maxBest, best);
      perHabitCurrent.push(current);
      const next = Utils.nextHabitMilestone(current);
      const progress = next ? current / next : 1;
      const row = ws.addRow([h.name, current, best, next || T.excelAllMilestonesDone, progress]);
      row.getCell(1).alignment = { horizontal: "right" };
      row.getCell(5).numFmt = "0%";
    });

    if (ws.rowCount > 1) {
      ws.addConditionalFormatting({
        ref: `E2:E${ws.rowCount}`,
        rules: [{ type: "dataBar", cfvo: [{ type: "num", value: 0 }, { type: "num", value: 1 }], color: { argb: "FF3B6E64" }, priority: 1 }]
      });
    }
    applyDefaultFont(ws);

    return { longestStreak: maxBest, perHabitLabels: habits.map((h) => h.name), perHabitCurrent };
  }

  // ----- ورقة 4: المهام -----
  function buildTasksSheet(wb, days, allDateKeys, categories) {
    const ws = wb.addWorksheet(T.excelSheetTasks);
    setupSheet(ws);
    const header = [T.excelColDate, T.excelColTitle, T.excelColCategory, T.excelColDoneStatus];
    ws.addRow(header).eachCell(styleHeaderCell);
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 14;

    let done = 0, total = 0;
    allDateKeys.forEach((key) => {
      const day = days[key];
      (day.tasks || []).forEach((t) => {
        total++;
        if (t.done) done++;
        const row = ws.addRow([excelDate(key), t.title, categoryName(categories, t.categoryId), t.done ? T.excelDone : T.excelNotDone]);
        row.getCell(1).numFmt = "yyyy-mm-dd";
        row.getCell(2).alignment = { horizontal: "right" };
      });
    });
    if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
    applyDefaultFont(ws);
    return { done, total };
  }

  // ----- ورقة 5: المواعيد -----
  function buildAppointmentsSheet(wb, days, recurring, allDateKeys, categories) {
    const ws = wb.addWorksheet(T.excelSheetAppointments);
    setupSheet(ws);
    const header = [T.excelColDate, T.excelColTime, T.excelColDuration, T.excelColTitle, T.excelColCategory, T.excelColRecurring];
    ws.addRow(header).eachCell(styleHeaderCell);
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 12;
    ws.getColumn(4).width = 28;
    ws.getColumn(5).width = 16;
    ws.getColumn(6).width = 10;

    allDateKeys.forEach((key) => {
      const occs = occurrencesForDate(key, recurring, days[key]);
      occs.forEach((o) => {
        const row = ws.addRow([
          excelDate(key),
          o.time,
          o.duration,
          o.title,
          categoryName(categories, o.categoryId),
          o.recurring ? T.excelYes : T.excelNo
        ]);
        row.getCell(1).numFmt = "yyyy-mm-dd";
        row.getCell(4).alignment = { horizontal: "right" };
      });
    });
    if (ws.rowCount > 1) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };
    applyDefaultFont(ws);
  }

  // ----- ورقة 6: الميزانية -----
  async function buildBudgetSheet(wb, range, categories) {
    const ws = wb.addWorksheet(T.excelSheetBudget);
    setupSheet(ws);

    const monthKeys = new Set();
    let cur = Utils.parseDateKey(range.start);
    const end = Utils.parseDateKey(range.end);
    while (Utils.dateKey(cur) <= Utils.dateKey(end)) {
      monthKeys.add(Utils.monthKey(cur.getFullYear(), cur.getMonth()));
      cur = Utils.addMonths(cur, 1);
    }
    let entries = [];
    for (const mk of monthKeys) {
      const data = await getBudgetMonth(mk);
      entries = entries.concat(data.entries || []);
    }
    entries = entries.filter((e) => e.date >= range.start && e.date <= range.end).sort((a, b) => a.date.localeCompare(b.date));

    const header = [T.excelColDate, T.excelColType, T.excelColCategory, T.excelColAmount, T.excelColNote];
    ws.addRow(header).eachCell(styleHeaderCell);
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 26;

    let totalIncome = 0, totalExpense = 0;
    const byCategory = {};
    entries.forEach((e) => {
      const row = ws.addRow([excelDate(e.date), e.type === "income" ? T.income : T.expense, e.category, e.amount, e.note || ""]);
      row.getCell(1).numFmt = "yyyy-mm-dd";
      row.getCell(4).numFmt = '0.00 "درهم"';
      row.getCell(5).alignment = { horizontal: "right" };
      if (e.type === "income") totalIncome += e.amount;
      else {
        totalExpense += e.amount;
        byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
      }
    });
    if (entries.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };

    const startRow = ws.rowCount + 3;
    ws.getCell(startRow, 1).value = T.excelCategoryBreakdown;
    ws.getCell(startRow, 1).font = { name: "Arial", bold: true };
    const catHeaderRow = ws.getRow(startRow + 1);
    catHeaderRow.getCell(1).value = T.excelColCategory;
    catHeaderRow.getCell(2).value = T.excelColAmount;
    [1, 2].forEach((c) => styleHeaderCell(catHeaderRow.getCell(c)));

    const catRows = Object.keys(byCategory).sort((a, b) => byCategory[b] - byCategory[a]);
    catRows.forEach((cat, i) => {
      const r = ws.getRow(startRow + 2 + i);
      r.getCell(1).value = cat;
      r.getCell(1).alignment = { horizontal: "right" };
      r.getCell(2).value = byCategory[cat];
      r.getCell(2).numFmt = '0.00 "درهم"';
    });

    applyDefaultFont(ws);
    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      categoryLabels: catRows,
      categoryValues: catRows.map((c) => byCategory[c])
    };
  }

  // ----- ورقة 7: الديون -----
  function buildDebtsSheet(wb, debts, range) {
    const ws = wb.addWorksheet(T.excelSheetDebts);
    setupSheet(ws);
    const filtered = debts.filter((d) => d.date >= range.start && d.date <= range.end).sort((a, b) => a.date.localeCompare(b.date));

    const header = [T.excelColPerson, T.excelColType, T.excelColAmount, T.excelColDate, T.excelColNote];
    ws.addRow(header).eachCell(styleHeaderCell);
    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 14;
    ws.getColumn(5).width = 26;

    const byPerson = {};
    filtered.forEach((d) => {
      const row = ws.addRow([d.person, d.type === "prete" ? T.debtLent : T.debtBorrowed, d.amount, excelDate(d.date), d.note || ""]);
      row.getCell(1).alignment = { horizontal: "right" };
      row.getCell(3).numFmt = '0.00 "درهم"';
      row.getCell(4).numFmt = "yyyy-mm-dd";
      row.getCell(5).alignment = { horizontal: "right" };
      byPerson[d.person] = byPerson[d.person] || { lent: 0, borrowed: 0 };
      if (d.type === "prete") byPerson[d.person].lent += d.amount;
      else byPerson[d.person].borrowed += d.amount;
    });
    if (filtered.length > 0) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: header.length } };

    const startRow = ws.rowCount + 3;
    ws.getCell(startRow, 1).value = T.excelBalancePerPerson;
    ws.getCell(startRow, 1).font = { name: "Arial", bold: true };
    const hRow = ws.getRow(startRow + 1);
    hRow.getCell(1).value = T.excelColPerson;
    hRow.getCell(2).value = T.excelColBalance;
    [1, 2].forEach((c) => styleHeaderCell(hRow.getCell(c)));
    Object.keys(byPerson)
      .sort()
      .forEach((p, i) => {
        const r = ws.getRow(startRow + 2 + i);
        r.getCell(1).value = p;
        r.getCell(1).alignment = { horizontal: "right" };
        r.getCell(2).value = byPerson[p].lent - byPerson[p].borrowed;
        r.getCell(2).numFmt = '0.00 "درهم"';
      });

    applyDefaultFont(ws);
    return { byPerson };
  }

  // ----- ورقة 1: لوحة القيادة (تُبنى أخيرا لأنها تحتاج نتائج بقية الأوراق) -----
  function buildDashboardSheet(wb, range, charts, streakInfo, tasksInfo, budgetInfo, debtsInfo) {
    const ws = wb.addWorksheet(T.excelSheetDashboard, { views: [{ rightToLeft: true }] });
    ws.getColumn(1).width = 3;
    for (let c = 2; c <= 9; c++) ws.getColumn(c).width = 15;

    const titleCell = ws.getCell(2, 2);
    titleCell.value = T.excelSheetDashboard;
    titleCell.font = { name: "Arial", bold: true, size: 16 };
    const periodCell = ws.getCell(3, 2);
    periodCell.value = `${T.excelColDate}: ${range.start} → ${range.end}`;
    periodCell.font = { name: "Arial", italic: true, color: { argb: "FF55585F" } };

    const kpis = [
      [T.excelKpiHabitsCompletion, `${charts.overallCompletionPct}%`],
      [T.excelKpiLongestStreak, streakInfo.longestStreak],
      [T.excelKpiTasksDone, `${tasksInfo.done}/${tasksInfo.total}`],
      [T.excelKpiIncome, budgetInfo.totalIncome],
      [T.excelKpiExpense, budgetInfo.totalExpense],
      [T.excelKpiBalance, budgetInfo.balance],
      [T.excelKpiOwedToMe, Object.values(debtsInfo.byPerson).reduce((s, p) => s + Math.max(0, p.lent - p.borrowed), 0)],
      [T.excelKpiIOwe, Object.values(debtsInfo.byPerson).reduce((s, p) => s + Math.max(0, p.borrowed - p.lent), 0)]
    ];

    let kpiRow = 5;
    let kpiCol = 2;
    kpis.forEach(([label, value], i) => {
      const labelCell = ws.getCell(kpiRow, kpiCol);
      const valueCell = ws.getCell(kpiRow + 1, kpiCol);
      labelCell.value = label;
      labelCell.font = { name: "Arial", bold: true, color: { argb: WHITE_ARGB }, size: 10 };
      labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_ARGB } };
      labelCell.alignment = { horizontal: "center", wrapText: true };
      valueCell.value = value;
      valueCell.font = { name: "Arial", bold: true, size: 13 };
      valueCell.alignment = { horizontal: "center" };
      if (typeof value === "number" && [T.excelKpiIncome, T.excelKpiExpense, T.excelKpiBalance, T.excelKpiOwedToMe, T.excelKpiIOwe].includes(label)) {
        valueCell.numFmt = '0.00 "درهم"';
      }
      kpiCol += 2;
      if (kpiCol > 8) {
        kpiCol = 2;
        kpiRow += 3;
      }
    });

    let chartsTopRow = kpiRow + 4;

    // المخططات الخمسة كصور PNG (ExcelJS لا يدعم إنشاء مخططات Excel أصلية)
    const c1 = drawLineChart(T.excelChartDaily, charts.dailyLabels, charts.dailyPct, 480, 260);
    const c2 = drawBarChart(T.excelChartPerHabit, charts.perHabitLabels, charts.perHabitPct, 480, 260, "#3B6E64", 100);
    const c3 = drawBarChart(T.excelChartStreaks, streakInfo.perHabitLabels, streakInfo.perHabitCurrent, 480, 260, "#4A5FA5");
    const c4 = drawBarChart(T.excelChartIncomeExpense, [T.income, T.expense], [budgetInfo.totalIncome, budgetInfo.totalExpense], 480, 260, "#B5562F");
    const c5 = drawPieChart(T.excelChartExpenseByCategory, budgetInfo.categoryLabels, budgetInfo.categoryValues, 480, 260);

    const images = [c1, c2, c3, c4, c5];
    let row = chartsTopRow;
    let col = 2;
    images.forEach((canvas, i) => {
      const imgId = wb.addImage({ base64: toPngBase64(canvas), extension: "png" });
      ws.addImage(imgId, { tl: { col: col - 1, row: row - 1 }, ext: { width: 480, height: 260 } });
      if (i % 2 === 1) {
        row += 14;
        col = 2;
      } else {
        col = 8;
      }
    });

    applyDefaultFont(ws);
  }

  function init() {
    bindButton();
  }

  return { init };
})();
