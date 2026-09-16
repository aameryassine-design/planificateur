// منطق صفحة العادات: التقدم الشهري، خريطة الحرارة، منحنى الاتجاه
const Habitudes = (function () {
  let current = new Date();
  current.setDate(1);
  let trackDayKey = Utils.todayKey();

  let els = {};

  async function getDayData(dateKey) {
    return (await Storage.get("day:" + dateKey, null)) || { appointments: [], tasks: [], habitChecks: {} };
  }
  async function saveDayData(dateKey, day) {
    await Storage.set("day:" + dateKey, day);
  }
  async function getHabitsList() {
    return (await Storage.get("habits-list", [])) || [];
  }

  // يؤشر/يلغي تأشير عادة في يوم معين، ثم يحدّث كل العروض فورا
  async function toggleHabitDay(habitId, dateKey) {
    const day = await getDayData(dateKey);
    day.habitChecks = day.habitChecks || {};
    if (day.habitChecks[habitId]) delete day.habitChecks[habitId];
    else day.habitChecks[habitId] = true;
    await saveDayData(dateKey, day);
    await renderAll();
  }

  function cacheEls() {
    els = {
      label: document.getElementById("habits-month-label"),
      progressList: document.getElementById("habits-progress-list"),
      heatmap: document.getElementById("habits-heatmap"),
      trend: document.getElementById("habits-trend"),

      trackLabel: document.getElementById("track-label"),
      trackList: document.getElementById("track-list"),
      trackUnscheduledDetails: document.getElementById("track-unscheduled"),
      trackUnscheduledSummary: document.getElementById("track-unscheduled-summary"),
      trackUnscheduledList: document.getElementById("track-unscheduled-list")
    };
  }

  function bindEvents() {
    document.getElementById("habits-month-prev").addEventListener("click", () => shiftMonth(-1));
    document.getElementById("habits-month-next").addEventListener("click", () => shiftMonth(1));
    document.getElementById("habits-month-today").addEventListener("click", () => {
      current = new Date();
      current.setDate(1);
      renderAll();
    });

    document.getElementById("track-prev").addEventListener("click", () => shiftTrackDay(-1));
    document.getElementById("track-next").addEventListener("click", () => shiftTrackDay(1));
    document.getElementById("track-today").addEventListener("click", () => {
      trackDayKey = Utils.todayKey();
      renderAll();
    });
  }

  function shiftTrackDay(dir) {
    trackDayKey = Utils.dateKey(Utils.addDays(Utils.parseDateKey(trackDayKey), dir));
    renderAll();
  }

  function shiftMonth(dir) {
    current = Utils.addMonths(current, dir);
    current.setDate(1);
    renderAll();
  }

  // عدد الأيام "المنقضية" في الشهر المعروض لحساب التقدم
  function elapsedDaysInMonth() {
    const today = new Date();
    const year = current.getFullYear();
    const month = current.getMonth();
    const totalDays = Utils.daysInMonth(year, month);
    if (year === today.getFullYear() && month === today.getMonth()) {
      return today.getDate();
    }
    const isFuture = new Date(year, month, 1) > today;
    return isFuture ? 0 : totalDays;
  }

  async function renderAll() {
    els.label.textContent = Utils.formatMonthLabel(current.getFullYear(), current.getMonth());
    await renderTodayTracking();
    await renderProgress();
    await renderHeatmap();
    await renderTrend();
  }

  // ----- تتبع اليوم: تأشير العادات ليوم محدد، مع فصل المبرمجة عن غير المبرمجة -----
  function renderHabitCheckboxRows(container, habitsList, day, dateKey) {
    container.innerHTML = "";
    habitsList.forEach((h) => {
      const li = document.createElement("li");
      li.className = "habit-mini-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!day.habitChecks[h.id];
      cb.addEventListener("change", () => toggleHabitDay(h.id, dateKey));
      li.appendChild(cb);
      const nameSpan = document.createElement("span");
      nameSpan.className = "h-name";
      nameSpan.textContent = h.name;
      li.appendChild(nameSpan);
      container.appendChild(li);
    });
  }

  async function renderTodayTracking() {
    const date = Utils.parseDateKey(trackDayKey);
    els.trackLabel.textContent = Utils.formatDayLabel(date);

    const [habits, day] = await Promise.all([getHabitsList(), getDayData(trackDayKey)]);
    day.habitChecks = day.habitChecks || {};

    if (habits.length === 0) {
      els.trackList.innerHTML = `<li class="empty-msg">${T.noHabits}</li>`;
      els.trackUnscheduledDetails.hidden = true;
      return;
    }

    const scheduled = habits.filter((h) => Utils.isHabitScheduled(h, date));
    const unscheduled = habits.filter((h) => !Utils.isHabitScheduled(h, date));

    if (scheduled.length === 0) {
      els.trackList.innerHTML = `<li class="empty-msg">${T.noHabitsToday}</li>`;
    } else {
      renderHabitCheckboxRows(els.trackList, scheduled, day, trackDayKey);
    }

    if (unscheduled.length === 0) {
      els.trackUnscheduledDetails.hidden = true;
    } else {
      els.trackUnscheduledDetails.hidden = false;
      els.trackUnscheduledSummary.textContent = `${T.unscheduledToday} (${unscheduled.length})`;
      renderHabitCheckboxRows(els.trackUnscheduledList, unscheduled, day, trackDayKey);
    }
  }

  async function renderProgress() {
    const habits = await getHabitsList();
    const elapsed = elapsedDaysInMonth();
    const year = current.getFullYear();
    const month = current.getMonth();

    els.progressList.innerHTML = "";
    if (habits.length === 0) {
      els.progressList.innerHTML = `<p class="empty-msg">${T.noHabits}</p>`;
      return;
    }

    for (const h of habits) {
      let scheduledCount = 0;
      let doneCount = 0;
      for (let d = 1; d <= elapsed; d++) {
        const dateObj = new Date(year, month, d);
        if (!Utils.isHabitScheduled(h, dateObj)) continue;
        scheduledCount++;
        const key = Utils.dateKey(dateObj);
        const day = await getDayData(key);
        if (day.habitChecks && day.habitChecks[h.id]) doneCount++;
      }
      const pct = scheduledCount > 0 ? Math.round((doneCount / scheduledCount) * 100) : 0;

      const row = document.createElement("div");
      row.className = "habit-progress-row";
      row.innerHTML = `
        <div class="hp-top">
          <span>${Utils.escapeHtml(h.name)}</span>
          <span><bdi>${doneCount}/${scheduledCount}</bdi> (${pct}%)</span>
        </div>
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      `;
      els.progressList.appendChild(row);
    }
  }

  async function renderHeatmap() {
    const habits = await getHabitsList();
    const year = current.getFullYear();
    const month = current.getMonth();
    const totalDays = Utils.daysInMonth(year, month);
    const todayKey = Utils.todayKey();

    els.heatmap.innerHTML = "";
    if (habits.length === 0) {
      els.heatmap.innerHTML = `<p class="empty-msg">${T.noHabits}</p>`;
      return;
    }

    for (const h of habits) {
      const row = document.createElement("div");
      row.className = "heatmap-row";
      const label = document.createElement("div");
      label.className = "heatmap-label";
      label.textContent = h.name;
      row.appendChild(label);

      const scroll = document.createElement("div");
      scroll.className = "heatmap-scroll";
      const cells = document.createElement("div");
      cells.className = "heatmap-cells";
      for (let d = 1; d <= totalDays; d++) {
        const dateObj = new Date(year, month, d);
        const key = Utils.dateKey(dateObj);
        const cell = document.createElement("div");
        cell.title = String(d);
        const isFuture = key > todayKey;
        if (isFuture) {
          cell.className = "heatmap-cell future";
        } else {
          const day = await getDayData(key);
          const done = !!(day.habitChecks && day.habitChecks[h.id]);
          const scheduled = Utils.isHabitScheduled(h, dateObj);
          let cls = "heatmap-cell";
          if (done) cls += " done";
          else if (scheduled) cls += " scheduled-empty";
          else cls += " unscheduled";
          cell.className = cls;
          cell.addEventListener("click", () => toggleHabitDay(h.id, key));
        }
        cells.appendChild(cell);
      }
      scroll.appendChild(cells);
      row.appendChild(scroll);
      els.heatmap.appendChild(row);
    }
  }

  async function renderTrend() {
    const habits = await getHabitsList();
    const year = current.getFullYear();
    const month = current.getMonth();
    const totalDays = Utils.daysInMonth(year, month);
    const elapsed = elapsedDaysInMonth();

    els.trend.innerHTML = "";
    if (habits.length === 0) {
      els.trend.innerHTML = `<p class="empty-msg">${T.noHabits}</p>`;
      return;
    }
    if (elapsed === 0) {
      els.trend.innerHTML = `<p class="empty-msg">${T.noTrendData}</p>`;
      return;
    }

    const width = 640, height = 220;
    const padLeft = 38, padRight = 14, padTop = 14, padBottom = 28;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    const points = [];
    for (let d = 1; d <= elapsed; d++) {
      const dateObj = new Date(year, month, d);
      const scheduledHabits = habits.filter((h) => Utils.isHabitScheduled(h, dateObj));
      if (scheduledHabits.length === 0) continue; // لا عادات مبرمجة هذا اليوم: نتخطاه فلا تهبط المنحنى إلى 0
      const key = Utils.dateKey(dateObj);
      const day = await getDayData(key);
      const checks = day.habitChecks || {};
      const doneCount = scheduledHabits.filter((h) => checks[h.id]).length;
      const pct = (doneCount / scheduledHabits.length) * 100;
      points.push({ day: d, pct });
    }

    if (points.length === 0) {
      els.trend.innerHTML = `<p class="empty-msg">${T.noTrendData}</p>`;
      return;
    }

    function xForDay(d) {
      const frac = totalDays > 1 ? (d - 1) / (totalDays - 1) : 0;
      return padLeft + (1 - frac) * plotW;
    }
    function yForPct(p) {
      return padTop + (1 - p / 100) * plotH;
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "auto");
    svg.style.maxWidth = "100%";

    [0, 25, 50, 75, 100].forEach((p) => {
      const y = yForPct(p);
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", padLeft);
      line.setAttribute("x2", width - padRight);
      line.setAttribute("y1", y);
      line.setAttribute("y2", y);
      line.setAttribute("stroke", "#DAD8CF");
      line.setAttribute("stroke-width", "1");
      svg.appendChild(line);

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", padLeft - 6);
      text.setAttribute("y", y + 3);
      text.setAttribute("text-anchor", "end");
      text.setAttribute("font-size", "10");
      text.setAttribute("fill", "#55585F");
      text.textContent = p + "%";
      svg.appendChild(text);
    });

    const dayLabels = [1];
    for (let d = 5; d < totalDays; d += 5) dayLabels.push(d);
    if (dayLabels[dayLabels.length - 1] !== totalDays) dayLabels.push(totalDays);
    dayLabels.forEach((d) => {
      const x = xForDay(d);
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", x);
      text.setAttribute("y", height - padBottom + 16);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "10");
      text.setAttribute("fill", "#55585F");
      text.textContent = d;
      svg.appendChild(text);
    });

    const pathD = points
      .map((pt, i) => `${i === 0 ? "M" : "L"} ${xForDay(pt.day).toFixed(1)} ${yForPct(pt.pct).toFixed(1)}`)
      .join(" ");
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathD);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#3B6E64");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("stroke-linecap", "round");
    svg.appendChild(path);

    points.forEach((pt) => {
      const c = document.createElementNS(svgNS, "circle");
      c.setAttribute("cx", xForDay(pt.day));
      c.setAttribute("cy", yForPct(pt.pct));
      c.setAttribute("r", "3");
      c.setAttribute("fill", "#3B6E64");
      svg.appendChild(c);
    });

    els.trend.appendChild(svg);
  }

  async function init() {
    cacheEls();
    bindEvents();
    await renderAll();
  }

  return { init, refresh: renderAll };
})();
