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
  function isHabitScheduled(habit, date) {
    const schedule = habit && habit.schedule;
    if (!schedule || schedule.type === "daily") return true;
    if (schedule.type === "days") {
      return Array.isArray(schedule.days) && schedule.days.includes(weekdayMon0(date));
    }
    return true;
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
