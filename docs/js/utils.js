// دوال مساعدة عامة: التواريخ، المعرفات، التنسيق
const Utils = (function () {
  // مولد معرف فريد بسيط
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  // يرجع مفتاح التاريخ بصيغة YYYY-MM-DD بالتوقيت المحلي (بدون انزياح توقيت)
  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // يحول مفتاح YYYY-MM-DD إلى كائن Date بمنتصف الليل المحلي
  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function todayKey() {
    return dateKey(new Date());
  }

  // يرجع فهرس اليوم: 0 = الإثنين ... 6 = الأحد
  function weekdayMon0(date) {
    const jsDay = date.getDay(); // 0 = أحد ... 6 = سبت
    return (jsDay + 6) % 7;
  }

  // يرجع تاريخ إثنين الأسبوع الذي يحتوي على date
  function mondayOf(date) {
    const d = new Date(date);
    d.setDate(d.getDate() - weekdayMon0(d));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function addMonths(date, n) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + n);
    return d;
  }

  function isSameDay(a, b) {
    return dateKey(a) === dateKey(b);
  }

  // عدد الأيام في الشهر
  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function formatDayLabel(date) {
    return `${T.weekdays[weekdayMon0(date)]} ${date.getDate()} ${T.months[date.getMonth()]}`;
  }

  function formatShortDate(date) {
    return `${date.getDate()} ${T.months[date.getMonth()]}`;
  }

  function formatMonthLabel(year, monthIndex) {
    return `${T.months[monthIndex]} ${year}`;
  }

  function monthKey(year, monthIndex) {
    return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  }

  // ينسق المبلغ بعملة الدرهم بخانتين عشريتين
  function formatAmount(n) {
    const num = Number(n) || 0;
    return `${num.toFixed(2)} ${T.currency}`;
  }

  // هل هذه العادة مبرمجة في هذا التاريخ؟ عادة بدون schedule (بيانات قديمة) = كل يوم
  // عادة "مهم جدًا" تكون دائما مبرمجة كل يوم، بغض النظر عما هو مخزَّن فعليا في schedule
  // (حماية إضافية تضمن أنها لا تختفي أبدا إلى "غير مبرمجة اليوم" حتى مع بيانات غير متسقة)
  function isHabitScheduled(habit, date) {
    if (habit && habitPriority(habit) === "high") return true;
    const schedule = habit && habit.schedule;
    if (!schedule || schedule.type === "daily") return true;
    if (schedule.type === "days") {
      return Array.isArray(schedule.days) && schedule.days.includes(weekdayMon0(date));
    }
    return true;
  }

  // مستوى أهمية العادة؛ عادة بدون priority (بيانات قديمة) = عادي
  function habitPriority(habit) {
    const p = habit && habit.priority;
    return p === "high" || p === "medium" || p === "low" ? p : "normal";
  }

  const HABIT_PRIORITY_ORDER = ["high", "medium", "normal", "low"];
  function habitPriorityLabel(p) {
    return { high: T.priorityHigh, medium: T.priorityMedium, normal: T.priorityNormal, low: T.priorityLow }[p] || T.priorityNormal;
  }

  const HABIT_MILESTONES = [7, 21, 42, 90, 180, 365];
  const HABIT_STREAK_LOOKBACK_DAYS = 400;

  // يحسب السلسلة الحالية وأفضل سلسلة لعادة معينة اعتمادا على خريطة {dateKey: habitChecks}
  // يمشي من اليوم إلى الوراء حتى HABIT_STREAK_LOOKBACK_DAYS يوما. الأيام غير المبرمجة تُتجاوز
  // بلا تأثير؛ عدم تأشير اليوم الحالي لا يكسر السلسلة (فقط لا يُحتسب بعد)
  // habitsStartDate اختياري: إن وُجد، يتوقف الحساب عنده تماما (لا يُعتبر أي يوم قبله لا فائتا
  // ولا محتسبا) - يحمي أيضا من تأشيرات قديمة قد تصل عبر المزامنة من جهاز آخر
  function computeHabitStreak(habit, checksMap, todayKey, habitsStartDate) {
    let running = 0;
    let best = 0;
    let current = null;
    let cursor = parseDateKey(todayKey);

    for (let i = 0; i < HABIT_STREAK_LOOKBACK_DAYS; i++) {
      const key = dateKey(cursor);
      if (habitsStartDate && key < habitsStartDate) break;
      if (isHabitScheduled(habit, cursor)) {
        const done = !!(checksMap[key] && checksMap[key][habit.id]);
        if (done) {
          running++;
          if (running > best) best = running;
        } else if (key !== todayKey) {
          if (current === null) current = running;
          running = 0;
        }
        // اليوم الحالي غير المؤشَّر: لا كسر، فقط لا زيادة
      }
      cursor = addDays(cursor, -1);
    }
    if (current === null) current = running;
    if (current > best) best = current;
    return { current, best };
  }

  function nextHabitMilestone(currentStreak) {
    return HABIT_MILESTONES.find((m) => m > currentStreak) || null;
  }
  function achievedHabitMilestones(bestStreak) {
    return HABIT_MILESTONES.filter((m) => bestStreak >= m);
  }

  // يتحقق من صيغة الوقت HH:MM
  function isValidTime(str) {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(str);
  }

  // يحول HH:MM إلى دقائق منذ منتصف الليل
  function timeToMinutes(str) {
    const [h, m] = str.split(":").map(Number);
    return h * 60 + m;
  }

  // يؤخر تنفيذ الدالة إلى أن يتوقف الاستدعاء المتكرر لمدة wait
  function debounce(fn, wait) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2), attrs[k]);
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  return {
    uid,
    dateKey,
    parseDateKey,
    todayKey,
    weekdayMon0,
    mondayOf,
    addDays,
    addMonths,
    isSameDay,
    daysInMonth,
    formatDayLabel,
    formatShortDate,
    formatMonthLabel,
    monthKey,
    formatAmount,
    isHabitScheduled,
    habitPriority,
    habitPriorityLabel,
    HABIT_PRIORITY_ORDER,
    computeHabitStreak,
    nextHabitMilestone,
    achievedHabitMilestones,
    HABIT_MILESTONES,
    HABIT_STREAK_LOOKBACK_DAYS,
    isValidTime,
    timeToMinutes,
    debounce,
    escapeHtml,
    el
  };
})();

// نافذة منبثقة بسيطة قابلة لإعادة الاستخدام (تأكيد، خيارات متعددة...)
const Modal = (function () {
  let overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.className = "modal-overlay";
    overlayEl.addEventListener("click", (e) => {
      if (e.target === overlayEl) close();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function close() {
    if (overlayEl) overlayEl.classList.remove("show");
  }

  // options: { title, message, buttons: [{label, primary, danger, onClick}] }
  function open(options) {
    const overlay = ensureOverlay();
    overlay.innerHTML = "";
    const box = document.createElement("div");
    box.className = "modal-box";

    if (options.title) {
      const h = document.createElement("h3");
      h.textContent = options.title;
      box.appendChild(h);
    }
    if (options.message) {
      const p = document.createElement("p");
      p.textContent = options.message;
      box.appendChild(p);
    }
    if (options.bodyNode) {
      box.appendChild(options.bodyNode);
    }

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    (options.buttons || []).forEach((btn) => {
      const b = document.createElement("button");
      b.textContent = btn.label;
      b.className = "btn" + (btn.primary ? " btn-primary" : "") + (btn.danger ? " btn-danger" : "");
      b.addEventListener("click", () => {
        close();
        if (btn.onClick) btn.onClick();
      });
      actions.appendChild(b);
    });
    box.appendChild(actions);

    overlay.appendChild(box);
    overlay.classList.add("show");
  }

  // تأكيد بسيط بنعم/لا
  function confirm(message, onConfirm, title) {
    open({
      title: title,
      message: message,
      buttons: [
        { label: T.cancel, onClick: null },
        { label: T.confirm, primary: true, onClick: onConfirm }
      ]
    });
  }

  return { open, close, confirm };
})();
