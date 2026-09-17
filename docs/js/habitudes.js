// منطق صفحة العادات: تتبع اليوم، الاستمرارية، التقدم الشهري، خريطة الحرارة، منحنى الاتجاه
// التنقل الرئيسي بالصفحة أصبح باليوم فقط؛ إحصائيات الشهر (التقدم/الخريطة/المنحنى) تتبع
// تلقائيا شهر اليوم المحدد حاليا (trackDayKey) - لا يوجد تنقل شهري منفصل بعد الآن.
const Habitudes = (function () {
  let trackDayKey = Utils.todayKey();
  let eventsBound = false;
  // تاريخ بدء التتبع (settings.habitsStartDate)؛ null = لا حد (كل التاريخ محتسب كما كان دائما)
  // يُعاد قراءته في بداية كل renderAll حتى ينعكس فورا أي تغيير وارد من جهاز آخر عبر المزامنة
  let habitsStartDate = null;

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
  async function getSettings() {
    return (await Storage.get("settings", {})) || {};
  }
  async function saveSettings(settings) {
    await Storage.set("settings", settings);
  }
  // تاريخ بدء التتبع الفعلي: settings.habitsStartDate له الأولوية دائما؛ HABITS_START_DATE
  // (من js/config.js) قيمة احتياطية تجعل الواجهة تتجاهل كل ما قبلها فورا حتى قبل اكتمال
  // التنظيف التلقائي لمرة واحدة (runStartDateMigrationIfNeeded)
  async function getHabitsStartDate() {
    const s = await getSettings();
    return s.habitsStartDate || (typeof HABITS_START_DATE !== "undefined" ? HABITS_START_DATE : null) || null;
  }

  // يجمع habitChecks كل الأيام المخزَّنة في خريطة واحدة {dateKey: habitChecks}
  // تُستعمل لحساب الاستمرارية (قد تحتاج الرجوع لغاية 400 يوم) وتنبيهات الأيام الفائتة
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

  // شهر الإحصائيات مشتق دائما من اليوم المحدد حاليا في "تتبع اليوم"
  function statsMonthDate() {
    const d = Utils.parseDateKey(trackDayKey);
    d.setDate(1);
    return d;
  }

  // يؤشر/يلغي تأشير عادة في يوم معين، يكتشف بلوغ عتبة استمرارية جديدة، ثم يحدّث كل العروض فورا
  // حراسة دفاعية: يرفض بصمت أي محاولة تأشير ليوم مستقبلي، أو قبل تاريخ بدء التتبع، أو يوم
  // فات لعادة "مهم جدًا" (حتى لو استُدعيت هذه الدالة من مكان لا يطبّق هذه القيود في واجهته)
  async function toggleHabitDay(habitId, dateKey) {
    const habits = await getHabitsList();
    const habit = habits.find((h) => h.id === habitId);
    const todayKey = Utils.todayKey();

    if (habitsStartDate && dateKey < habitsStartDate) return;
    if (dateKey > todayKey) return;
    if (habit && Utils.habitPriority(habit) === "high" && dateKey < todayKey) return;

    const beforeMap = habit ? await loadAllDayChecks() : null;
    const beforeStreak = habit ? Utils.computeHabitStreak(habit, beforeMap, todayKey, habitsStartDate).current : 0;

    const day = await getDayData(dateKey);
    day.habitChecks = day.habitChecks || {};
    const willCheck = !day.habitChecks[habitId];
    if (day.habitChecks[habitId]) delete day.habitChecks[habitId];
    else day.habitChecks[habitId] = true;
    await saveDayData(dateKey, day);

    if (habit && willCheck) {
      const afterMap = await loadAllDayChecks();
      const afterStreak = Utils.computeHabitStreak(habit, afterMap, todayKey, habitsStartDate).current;
      if (afterStreak > beforeStreak && Utils.HABIT_MILESTONES.includes(afterStreak)) {
        showCongratsToast(`${T.congratsPrefix} ${afterStreak} ${T.congratsSuffix}`);
      }
      // إلغاء فوري لتذكير الساعة 21:00 (لا تأثير على الويب)؛ إعادة الجدولة الكاملة تتكفل بالباقي
      Notifications.cancelEveningReminderIfChecked(habitId, dateKey);
    }

    await renderAll();
  }

  function showCongratsToast(message) {
    const existing = document.querySelector(".habit-toast");
    if (existing) existing.remove();
    const wrap = document.createElement("div");
    wrap.className = "habit-toast";
    const inner = document.createElement("div");
    inner.className = "habit-toast-inner";
    inner.textContent = message;
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 3000);
  }

  function cacheEls() {
    els = {
      statsMonthLabel: document.getElementById("stats-month-label"),
      progressList: document.getElementById("habits-progress-list"),
      heatmap: document.getElementById("habits-heatmap"),
      trend: document.getElementById("habits-trend"),

      trackPrev: document.getElementById("track-prev"),
      trackNext: document.getElementById("track-next"),
      trackLabel: document.getElementById("track-label"),
      trackList: document.getElementById("track-list"),
      trackUnscheduledDetails: document.getElementById("track-unscheduled"),
      trackUnscheduledSummary: document.getElementById("track-unscheduled-summary"),
      trackUnscheduledList: document.getElementById("track-unscheduled-list"),

      streaksList: document.getElementById("habits-streaks-list"),

      missedPanel: document.getElementById("habits-missed-panel"),
      missedList: document.getElementById("habits-missed-list"),

      resetBtn: document.getElementById("habits-reset-btn")
    };
  }

  function bindEvents() {
    if (eventsBound) return; // حماية من ازدواج الاستماع لو استُدعيت init أكثر من مرة
    eventsBound = true;

    els.trackPrev.addEventListener("click", () => shiftTrackDay(-1));
    els.trackNext.addEventListener("click", () => shiftTrackDay(1));
    document.getElementById("track-today").addEventListener("click", () => {
      trackDayKey = Utils.todayKey();
      renderAll();
    });

    els.resetBtn.addEventListener("click", () => {
      Modal.confirm(T.confirmResetTracking, onResetTrackingConfirmed);
    });

    bindSwipeGesture();
  }

  // ----- بدء التتبع من اليوم: يحذف تتبع العادات (habitChecks) لكل الأيام قبل اليوم -----
  async function onResetTrackingConfirmed() {
    const btn = els.resetBtn;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = T.resettingTracking;
    try {
      await resetTrackingFromToday();
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // يحذف حقل habitChecks فقط (يُبقي المواعيد والمهام) من كل يوم قبل cutoffDate، ويحذف المفتاح
  // كليا إن صارت الجولة فارغة تماما؛ كل تعديل يمر عبر Storage فيُرسَل تلقائيا إلى Supabase
  async function purgeHabitChecksBefore(cutoffDate) {
    const dayKeys = (await Storage.list("day:")).filter((k) => k.slice(4) < cutoffDate);
    for (let i = 0; i < dayKeys.length; i++) {
      const key = dayKeys[i];
      const day = await Storage.get(key, null);
      if (day && day.habitChecks && Object.keys(day.habitChecks).length > 0) {
        delete day.habitChecks;
        const hasAppointments = Array.isArray(day.appointments) && day.appointments.length > 0;
        const hasTasks = Array.isArray(day.tasks) && day.tasks.length > 0;
        if (!hasAppointments && !hasTasks) {
          await Storage.remove(key);
        } else {
          await Storage.set(key, day);
        }
      }
      // نُنفّس كل 20 عملية حتى لا تتجمد الواجهة عند وجود عدد كبير من الأيام
      if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
    }
  }

  async function resetTrackingFromToday() {
    const today = Utils.todayKey();

    const settings = await getSettings();
    settings.habitsStartDate = today;
    await saveSettings(settings);

    await purgeHabitChecksBefore(today);

    habitsStartDate = today;
    trackDayKey = today;
    await renderAll();
    Notifications.reschedule(); // لا تأثير على الويب
  }

  // تنظيف تلقائي لمرة واحدة (يُستدعى من app.js بعد اكتمال أول استقبال من Supabase في كل إقلاع):
  // يحذف تتبع العادات قبل HABITS_START_DATE ويعلّم العملية منجزة عبر settings.habitsPurgedBefore
  // (مفتاح متزامن) حتى لا تتكرر على هذا الجهاز أو أي جهاز آخر لنفس الحساب. يرجع true إن نفّذ فعلا
  // (حتى يعيد app.js رسم الصفحات)
  async function runStartDateMigrationIfNeeded() {
    if (typeof HABITS_START_DATE === "undefined" || !HABITS_START_DATE) return false;
    const settings = await getSettings();
    if (settings.habitsPurgedBefore) return false; // نُفِّذت من قبل (هنا أو على جهاز آخر عبر المزامنة)

    await purgeHabitChecksBefore(HABITS_START_DATE);

    settings.habitsPurgedBefore = HABITS_START_DATE;
    if (!settings.habitsStartDate || settings.habitsStartDate < HABITS_START_DATE) {
      settings.habitsStartDate = HABITS_START_DATE;
    }
    await saveSettings(settings);
    habitsStartDate = await getHabitsStartDate();
    return true;
  }

  // سحب أفقي لتغيير اليوم على الهاتف، بما يطابق اتجاه RTL المستعمل في زري السابق/التالي
  // (السابق › يمينا، التالي ‹ يسارا): سحب نحو اليمين = اليوم السابق، نحو اليسار = التالي
  function bindSwipeGesture() {
    const panel = document.getElementById("panel-today-tracking");
    if (!panel) return;
    let startX = null;
    const THRESHOLD = 40;
    panel.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
      },
      { passive: true }
    );
    panel.addEventListener(
      "touchend",
      (e) => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        startX = null;
        if (Math.abs(dx) < THRESHOLD) return;
        if (dx > 0) shiftTrackDay(-1);
        else shiftTrackDay(1);
      },
      { passive: true }
    );
  }

  function shiftTrackDay(dir) {
    let next = Utils.dateKey(Utils.addDays(Utils.parseDateKey(trackDayKey), dir));
    if (habitsStartDate && next < habitsStartDate) next = habitsStartDate;
    trackDayKey = next;
    renderAll();
  }

  // عدد الأيام "المنقضية" في شهر الإحصائيات (المشتق من اليوم المحدد) لحساب التقدم
  function elapsedDaysInMonth() {
    const today = new Date();
    const monthDate = statsMonthDate();
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const totalDays = Utils.daysInMonth(year, month);
    if (year === today.getFullYear() && month === today.getMonth()) {
      return today.getDate();
    }
    const isFuture = new Date(year, month, 1) > today;
    return isFuture ? 0 : totalDays;
  }

  async function renderAll() {
    // نعيد قراءة تاريخ بدء التتبع في كل مرة حتى ينعكس فورا أي تعديل وارد من جهاز آخر (مزامنة)
    habitsStartDate = await getHabitsStartDate();
    if (habitsStartDate && trackDayKey < habitsStartDate) trackDayKey = habitsStartDate;
    els.trackPrev.disabled = !!(habitsStartDate && trackDayKey <= habitsStartDate);

    await renderMissedWarnings();
    await renderTodayTracking();
    await renderStreaks();

    const monthDate = statsMonthDate();
    els.statsMonthLabel.textContent = Utils.formatMonthLabel(monthDate.getFullYear(), monthDate.getMonth());
    await renderProgress();
    await renderHeatmap();
    await renderTrend();
  }

  // غير المؤشَّرة أولا (مرتبة بالأهمية من الأعلى)، ثم المؤشَّرة في الأسفل
  function sortHabitsForTracking(list, day) {
    const order = { high: 0, medium: 1, normal: 2, low: 3 };
    return list.slice().sort((a, b) => {
      const aDone = !!(day.habitChecks && day.habitChecks[a.id]);
      const bDone = !!(day.habitChecks && day.habitChecks[b.id]);
      if (aDone !== bDone) return aDone ? 1 : -1;
      return order[Utils.habitPriority(a)] - order[Utils.habitPriority(b)];
    });
  }

  // ----- تنبيه: عادات "مهم جدًا" فاتت خلال آخر 7 أيام (إعلامي بحت، بلا إمكانية تأشير) -----
  // لا يمكن تدارك يوم فات لعادة مهم جدًا (قاعدة القفل)؛ هذا التنبيه إخباري فقط
  async function renderMissedWarnings() {
    const habits = await getHabitsList();
    const highHabits = habits.filter((h) => Utils.habitPriority(h) === "high");
    if (highHabits.length === 0) {
      els.missedPanel.hidden = true;
      return;
    }
    const checksMap = await loadAllDayChecks();
    const today = new Date();
    const yesterdayKey = Utils.dateKey(Utils.addDays(today, -1));
    const missed = [];
    for (let i = 1; i <= 7; i++) {
      const d = Utils.addDays(today, -i);
      const key = Utils.dateKey(d);
      if (habitsStartDate && key < habitsStartDate) continue;
      highHabits.forEach((h) => {
        const done = !!(checksMap[key] && checksMap[key][h.id]);
        if (!done) missed.push({ habit: h, dateKey: key, date: d });
      });
    }
    if (missed.length === 0) {
      els.missedPanel.hidden = true;
      return;
    }
    els.missedPanel.hidden = false;
    els.missedList.innerHTML = "";
    missed.forEach(({ habit, dateKey, date }) => {
      const li = document.createElement("li");
      li.className = "habit-mini-row priority-high";
      const label = document.createElement("span");
      label.className = "h-name";
      const dayLabel = dateKey === yesterdayKey ? T.missedYesterday : Utils.formatShortDate(date);
      label.textContent = `${T.missedWarningTitle}: ${habit.name} — ${dayLabel}`;
      li.appendChild(label);
      els.missedList.appendChild(li);
    });
  }

  // ----- تتبع اليوم: تأشير العادات ليوم محدد، مع فصل المبرمجة عن غير المبرمجة -----
  // عادة "مهم جدًا": تُقفل نهائيا بمجرد مرور يومها (سواء أُشِّرت أم لا) - لا يمكن تعديلها بعد ذلك
  function renderHabitCheckboxRows(container, habitsList, day, dateKey, checksMap) {
    container.innerHTML = "";
    const todayKey = Utils.todayKey();
    const isFuture = dateKey > todayKey;
    const isBeforeStart = !!(habitsStartDate && dateKey < habitsStartDate);
    habitsList.forEach((h) => {
      const priority = Utils.habitPriority(h);
      const done = !!day.habitChecks[h.id];
      const isPastLockedHigh = priority === "high" && dateKey < todayKey;
      const locked = isFuture || isBeforeStart || isPastLockedHigh;

      const li = document.createElement("li");
      li.className = "habit-mini-row priority-" + priority;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = done;
      cb.disabled = locked;
      if (!locked) cb.addEventListener("change", () => toggleHabitDay(h.id, dateKey));
      li.appendChild(cb);
      const nameSpan = document.createElement("span");
      nameSpan.className = "h-name";
      nameSpan.textContent = (priority === "high" ? T.priorityBadgeHigh + " " : "") + h.name;
      li.appendChild(nameSpan);

      if (isPastLockedHigh) {
        const lockSpan = document.createElement("span");
        lockSpan.className = "h-lock";
        lockSpan.textContent = "🔒";
        lockSpan.title = T.lockedHighTooltip;
        li.appendChild(lockSpan);
        if (!done) {
          const missedSpan = document.createElement("span");
          missedSpan.className = "h-missed-tag";
          missedSpan.textContent = T.missedTagInline;
          li.appendChild(missedSpan);
        }
      }

      const { current } = Utils.computeHabitStreak(h, checksMap, todayKey, habitsStartDate);
      if (current > 0) {
        const streakSpan = document.createElement("span");
        streakSpan.className = "h-streak";
        streakSpan.textContent = `🔥 ${current}`;
        li.appendChild(streakSpan);
      }
      container.appendChild(li);
    });
  }

  async function renderTodayTracking() {
    const date = Utils.parseDateKey(trackDayKey);
    els.trackLabel.textContent = Utils.formatDayLabel(date);

    const [habits, day, checksMap] = await Promise.all([getHabitsList(), getDayData(trackDayKey), loadAllDayChecks()]);
    day.habitChecks = day.habitChecks || {};

    if (habits.length === 0) {
      els.trackList.innerHTML = `<li class="empty-msg">${T.noHabits}</li>`;
      els.trackUnscheduledDetails.hidden = true;
      return;
    }

    const scheduled = sortHabitsForTracking(habits.filter((h) => Utils.isHabitScheduled(h, date)), day);
    const unscheduled = sortHabitsForTracking(habits.filter((h) => !Utils.isHabitScheduled(h, date)), day);

    if (scheduled.length === 0) {
      els.trackList.innerHTML = `<li class="empty-msg">${T.noHabitsToday}</li>`;
    } else {
      renderHabitCheckboxRows(els.trackList, scheduled, day, trackDayKey, checksMap);
    }

    if (unscheduled.length === 0) {
      els.trackUnscheduledDetails.hidden = true;
    } else {
      els.trackUnscheduledDetails.hidden = false;
      els.trackUnscheduledSummary.textContent = `${T.unscheduledToday} (${unscheduled.length})`;
      renderHabitCheckboxRows(els.trackUnscheduledList, unscheduled, day, trackDayKey, checksMap);
    }
  }

  // ----- الاستمرارية: بطاقة لكل عادة (السلسلة الحالية، الرقم القياسي، العتبة التالية، الأوسمة) -----
  async function renderStreaks() {
    const habits = await getHabitsList();
    els.streaksList.innerHTML = "";
    if (habits.length === 0) {
      els.streaksList.innerHTML = `<p class="empty-msg">${T.noHabits}</p>`;
      return;
    }
    const checksMap = await loadAllDayChecks();
    const todayKey = Utils.todayKey();
    const order = { high: 0, medium: 1, normal: 2, low: 3 };

    const rows = habits.map((h) => {
      const priority = Utils.habitPriority(h);
      const { current, best } = Utils.computeHabitStreak(h, checksMap, todayKey, habitsStartDate);
      return { habit: h, priority, current, best };
    });
    rows.sort((a, b) => order[a.priority] - order[b.priority] || b.current - a.current);

    rows.forEach(({ habit, priority, current, best }) => {
      const card = document.createElement("div");
      card.className = "streak-card priority-" + priority;

      const head = document.createElement("div");
      head.className = "streak-card-head";
      const nameEl = document.createElement("span");
      nameEl.className = "streak-card-name";
      nameEl.textContent = (priority === "high" ? T.priorityBadgeHigh + " " : "") + habit.name;
      const numbers = document.createElement("span");
      numbers.className = "streak-card-numbers";
      numbers.innerHTML = `<span class="streak-card-current">🔥 <bdi>${current}</bdi></span><span class="streak-card-best">${T.streakBest}: <bdi>${best}</bdi></span>`;
      head.appendChild(nameEl);
      head.appendChild(numbers);
      card.appendChild(head);

      const next = Utils.nextHabitMilestone(current);
      if (next) {
        const pct = Math.max(0, Math.min(100, Math.round((current / next) * 100)));
        const label = document.createElement("div");
        label.className = "streak-progress-label";
        label.innerHTML = `<span><bdi>${current}/${next}</bdi></span>`;
        card.appendChild(label);
        const bar = document.createElement("div");
        bar.className = "progress-bar";
        bar.innerHTML = `<div class="progress-bar-fill" style="width:${pct}%"></div>`;
        card.appendChild(bar);
      }

      const achieved = Utils.achievedHabitMilestones(best);
      if (achieved.length > 0) {
        const badges = document.createElement("div");
        badges.className = "streak-badges";
        achieved.forEach((m) => {
          const b = document.createElement("span");
          b.className = "streak-badge";
          b.textContent = `${m} ${T.streakDaysUnit}`;
          badges.appendChild(b);
        });
        card.appendChild(badges);
      }

      els.streaksList.appendChild(card);
    });
  }

  async function renderProgress() {
    const habits = await getHabitsList();
    const elapsed = elapsedDaysInMonth();
    const monthDate = statsMonthDate();
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();

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
        const dKey = Utils.dateKey(dateObj);
        if (habitsStartDate && dKey < habitsStartDate) continue;
        if (!Utils.isHabitScheduled(h, dateObj)) continue;
        scheduledCount++;
        const day = await getDayData(dKey);
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
    const monthDate = statsMonthDate();
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const totalDays = Utils.daysInMonth(year, month);
    const todayKey = Utils.todayKey();

    els.heatmap.innerHTML = "";
    if (habits.length === 0) {
      els.heatmap.innerHTML = `<p class="empty-msg">${T.noHabits}</p>`;
      return;
    }

    for (const h of habits) {
      const priority = Utils.habitPriority(h);
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
        const isBeforeStart = !!(habitsStartDate && key < habitsStartDate);
        if (isFuture) {
          cell.className = "heatmap-cell future";
        } else if (isBeforeStart) {
          cell.className = "heatmap-cell before-start";
        } else {
          const day = await getDayData(key);
          const done = !!(day.habitChecks && day.habitChecks[h.id]);
          const scheduled = Utils.isHabitScheduled(h, dateObj);
          const isPast = key < todayKey;
          const lockedHigh = priority === "high" && isPast; // مقفلة بغض النظر عن التأشير
          let cls = "heatmap-cell";
          if (done) cls += " done";
          else if (priority === "high" && isPast) cls += " missed-critical";
          else if (scheduled) cls += " scheduled-empty";
          else cls += " unscheduled";
          if (lockedHigh) {
            cls += " locked";
            cell.title = T.lockedHighTooltip;
            cell.textContent = "🔒";
          }
          cell.className = cls;
          // النقر يختار هذا اليوم في "تتبع اليوم"، ويبدّل تأشيره فقط إن لم يكن مقفلا
          cell.addEventListener("click", () => {
            trackDayKey = key;
            if (lockedHigh) renderAll();
            else toggleHabitDay(h.id, key);
          });
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
    const monthDate = statsMonthDate();
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
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
      const key = Utils.dateKey(dateObj);
      if (habitsStartDate && key < habitsStartDate) continue; // قبل تاريخ بدء التتبع: يُتجاهل تماما
      const scheduledHabits = habits.filter((h) => Utils.isHabitScheduled(h, dateObj));
      if (scheduledHabits.length === 0) continue; // لا عادات مبرمجة هذا اليوم: نتخطاه فلا تهبط المنحنى إلى 0
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

  return { init, refresh: renderAll, runStartDateMigrationIfNeeded };
})();
