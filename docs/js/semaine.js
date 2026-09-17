// منطق صفحة الأسبوع: المواعيد (عادية ومتكررة)، المهام، العادات اليومية، الفئات
const Semaine = (function () {
  const AGENDA_START_HOUR = 7;
  const AGENDA_END_HOUR = 22; // نهاية (غير متضمنة كصف بذاتها)
  const PX_PER_HOUR = 48;
  const AGENDA_MOBILE_WIDTH = 768; // تحت هذا العرض: عمود يوم واحد فقط في الأجندة افتراضيا
  const TINY_LABEL_WIDTH = 480; // تحت هذا العرض: أسماء الأيام المختصرة جدا
  const HABIT_MANAGE_OPEN_KEY = "mukhattat:ui:habit-manage-open"; // تفضيل محلي بحت، لا يمر عبر Storage/المزامنة

  function isAgendaMobile() {
    return window.innerWidth < AGENDA_MOBILE_WIDTH;
  }
  function isTinyLabel() {
    return window.innerWidth < TINY_LABEL_WIDTH;
  }
  // على الحاسوب الأسبوع كامل دائما؛ على الهاتف يعتمد على زر يوم/أسبوع
  function agendaShowFullWeek() {
    return !isAgendaMobile() || agendaMobileFullWeek;
  }

  let currentMonday = Utils.mondayOf(new Date());
  let selectedDayKey = Utils.todayKey();
  let currentView = "list"; // 'list' | 'agenda'
  let agendaMobileFullWeek = false; // حالة زر "أسبوع" على الهاتف
  let addHabitFreqType = "daily"; // حالة نموذج إضافة عادة: 'daily' | 'days'
  let addHabitPriority = "normal"; // حالة نموذج إضافة عادة: أهمية العادة
  let addHabitDaysToggle = null; // مكوّن أزرار أيام الأسبوع لنموذج الإضافة
  let eventsBound = false; // يمنع ربط الأحداث أكثر من مرة إن استُدعي init مجددا

  let els = {};

  // ===== وصول للبيانات (كل قراءة/كتابة تمر عبر Storage، محليا أولا) =====
  async function getDay(dateKey) {
    return (await Storage.get("day:" + dateKey, null)) || { appointments: [], tasks: [], habitChecks: {} };
  }
  async function saveDay(dateKey, day) {
    await Storage.set("day:" + dateKey, day);
  }

  async function getCategories() {
    let cats = await Storage.get("categories-list", null);
    if (!cats || !Array.isArray(cats) || cats.length === 0) {
      cats = [
        { id: Utils.uid(), name: T.defaultCategories.work, color: "#4A5FA5" },
        { id: Utils.uid(), name: T.defaultCategories.personal, color: "#B5562F" },
        { id: Utils.uid(), name: T.defaultCategories.health, color: "#3B6E64" },
        { id: Utils.uid(), name: T.defaultCategories.other, color: "#8A7F6B" }
      ];
      await Storage.set("categories-list", cats);
    }
    return cats;
  }
  async function saveCategories(list) {
    await Storage.set("categories-list", list);
  }

  async function getRecurring() {
    return (await Storage.get("recurring-appointments", [])) || [];
  }
  async function saveRecurring(list) {
    await Storage.set("recurring-appointments", list);
  }

  async function getHabitsList() {
    return (await Storage.get("habits-list", [])) || [];
  }
  async function saveHabitsList(list) {
    await Storage.set("habits-list", list);
  }

  // ===== دمج المواعيد العادية والمتكررة ليوم معين =====
  async function getOccurrencesForDate(dateKey) {
    const day = await getDay(dateKey);
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
    const recurring = await getRecurring();
    const recurOccurrences = recurring
      .filter((r) => r.weekday === wd && dateKey >= r.startDate && !(r.exceptions || []).includes(dateKey))
      .map((r) => ({
        id: r.id,
        time: r.time,
        duration: r.duration || 60,
        title: r.title,
        categoryId: r.categoryId,
        recurring: true
      }));

    const merged = oneOff.concat(recurOccurrences);
    merged.sort((a, b) => Utils.timeToMinutes(a.time) - Utils.timeToMinutes(b.time));
    return merged;
  }

  // ===== أدوات مشتركة لتكرار وأهمية العادات (تُستعمل في نموذج الإضافة ونافذة التعديل) =====
  // ينشئ بنك 7 أزرار أيام قابلة للتبديل بترتيب RTL (الإثنين يمينا)
  function createDayToggleGroup(initialDays) {
    const selected = new Set(initialDays || []);
    const el = document.createElement("div");
    el.className = "day-toggle-group";
    const buttons = [];
    for (let i = 0; i < 7; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-toggle-btn" + (selected.has(i) ? " active" : "");
      btn.textContent = T.weekdaysTiny[i];
      btn.addEventListener("click", () => {
        if (selected.has(i)) selected.delete(i);
        else selected.add(i);
        btn.classList.toggle("active");
      });
      buttons.push(btn);
      el.appendChild(btn);
    }
    return {
      el,
      getDays: () => Array.from(selected).sort((a, b) => a - b),
      setDays: (days) => {
        selected.clear();
        (days || []).forEach((d) => selected.add(d));
        buttons.forEach((btn, i) => btn.classList.toggle("active", selected.has(i)));
      }
    };
  }

  const PRIORITY_ORDER = Utils.HABIT_PRIORITY_ORDER;
  const priorityLabel = Utils.habitPriorityLabel;

  // نص تكرار العادة المعروض في القائمة: "كل يوم" أو أسماء الأيام المختارة
  function formatHabitFrequency(habit) {
    const schedule = habit.schedule;
    if (!schedule || schedule.type !== "days") return T.freqDaily;
    const days = (schedule.days || []).slice().sort((a, b) => a - b);
    if (days.length === 0) return T.freqDaily;
    return days.map((d) => T.weekdaysTiny[d]).join("، ");
  }

  // ===== تهيئة عناصر DOM =====
  function cacheEls() {
    els = {
      weekRange: document.getElementById("week-range"),
      dayTabs: document.getElementById("day-tabs"),

      apptForm: document.getElementById("appointment-form"),
      apptError: document.getElementById("appointment-error"),
      apptTime: document.getElementById("appt-time"),
      apptDuration: document.getElementById("appt-duration"),
      apptTitle: document.getElementById("appt-title"),
      apptCategory: document.getElementById("appt-category"),
      apptRepeat: document.getElementById("appt-repeat"),

      listViewBtn: document.getElementById("view-list-btn"),
      agendaViewBtn: document.getElementById("view-agenda-btn"),
      listViewWrap: document.getElementById("appointment-list-view"),
      agendaSection: document.getElementById("agenda-section"),
      agendaViewWrap: document.getElementById("appointment-agenda-view"),
      agendaDayBtn: document.getElementById("agenda-day-btn"),
      agendaWeekBtn: document.getElementById("agenda-week-btn"),
      apptList: document.getElementById("appointment-list"),

      manageCategoriesBtn: document.getElementById("manage-categories-btn"),

      taskForm: document.getElementById("task-form"),
      taskError: document.getElementById("task-error"),
      taskTitle: document.getElementById("task-title"),
      taskCategory: document.getElementById("task-category"),
      taskList: document.getElementById("task-list"),
      postponeBtn: document.getElementById("postpone-btn"),

      habitAddForm: document.getElementById("habit-add-form"),
      habitError: document.getElementById("habit-error"),
      habitName: document.getElementById("habit-name"),
      habitFreqToggle: document.getElementById("habit-freq-toggle"),
      habitDaysRow: document.getElementById("habit-days-row"),
      habitDaysToggleContainer: document.getElementById("habit-days-toggle"),
      habitPriorityToggle: document.getElementById("habit-priority-toggle"),
      habitPriorityHint: document.getElementById("habit-priority-hint"),
      habitReminderTime: document.getElementById("habit-reminder-time"),
      habitMiniList: document.getElementById("habit-mini-list"),
      habitManageDetails: document.getElementById("habit-manage-details"),
      habitManageSummary: document.getElementById("habit-manage-summary")
    };

    // مُضمَّن حماية: نفرّغ الحاوية دائما قبل إنشاء بنك الأيام حتى لو أُعيد استدعاء cacheEls
    els.habitDaysToggleContainer.innerHTML = "";
    addHabitDaysToggle = createDayToggleGroup([]);
    els.habitDaysToggleContainer.appendChild(addHabitDaysToggle.el);

    // استرجاع حالة طي/فتح قائمة إدارة العادات من تفضيل محلي بحت (بدون مزامنة)
    const savedOpen = localStorage.getItem(HABIT_MANAGE_OPEN_KEY);
    els.habitManageDetails.open = savedOpen === "1";
    els.habitManageDetails.addEventListener("toggle", () => {
      localStorage.setItem(HABIT_MANAGE_OPEN_KEY, els.habitManageDetails.open ? "1" : "0");
    });
  }

  function bindEvents() {
    if (eventsBound) return; // حماية من ازدواج الاستماع لو استُدعيت init أكثر من مرة
    eventsBound = true;

    document.getElementById("week-prev").addEventListener("click", () => shiftWeek(-1));
    document.getElementById("week-next").addEventListener("click", () => shiftWeek(1));
    document.getElementById("week-today").addEventListener("click", goToday);

    els.listViewBtn.addEventListener("click", () => setView("list"));
    els.agendaViewBtn.addEventListener("click", () => setView("agenda"));
    els.agendaDayBtn.addEventListener("click", () => {
      agendaMobileFullWeek = false;
      renderAgenda();
    });
    els.agendaWeekBtn.addEventListener("click", () => {
      agendaMobileFullWeek = true;
      renderAgenda();
    });

    els.apptForm.addEventListener("submit", onSubmitAppointment);
    els.taskForm.addEventListener("submit", onSubmitTask);
    els.habitAddForm.addEventListener("submit", onSubmitHabit);
    els.postponeBtn.addEventListener("click", onPostponeTasks);
    els.manageCategoriesBtn.addEventListener("click", openCategoryManager);

    els.habitFreqToggle.querySelectorAll("button[data-freq]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        addHabitFreqType = btn.dataset.freq;
        els.habitFreqToggle.querySelectorAll("button[data-freq]").forEach((b) => {
          b.classList.toggle("btn-primary", b === btn);
        });
        els.habitDaysRow.hidden = addHabitFreqType !== "days";
      });
    });

    els.habitPriorityToggle.querySelectorAll("button[data-priority]").forEach((btn) => {
      btn.addEventListener("click", () => {
        addHabitPriority = btn.dataset.priority;
        els.habitPriorityToggle.querySelectorAll("button[data-priority]").forEach((b) => {
          b.classList.toggle("btn-primary", b === btn);
        });
        applyAddFormForcedDaily();
      });
    });
  }

  // عادة "مهم جدًا" تُفرض عليها فرequency = كل يوم (نموذج الإضافة، بلا تأكيد - لا توجد عادة قائمة لفقدانها)
  function applyAddFormForcedDaily() {
    const forced = addHabitPriority === "high";
    const daysBtn = els.habitFreqToggle.querySelector('button[data-freq="days"]');
    daysBtn.disabled = forced;
    els.habitPriorityHint.hidden = !forced;
    if (forced && addHabitFreqType !== "daily") {
      addHabitFreqType = "daily";
      els.habitFreqToggle.querySelectorAll("button[data-freq]").forEach((b) => {
        b.classList.toggle("btn-primary", b.dataset.freq === "daily");
      });
      els.habitDaysRow.hidden = true;
    }
  }

  // ===== تنقل الأسبوع =====
  function shiftWeek(dir) {
    currentMonday = Utils.addDays(currentMonday, dir * 7);
    // إبقاء اليوم المحدد ضمن الأسبوع الجديد (نفس فهرس اليوم)
    const idx = Math.min(6, Math.max(0, Utils.weekdayMon0(Utils.parseDateKey(selectedDayKey)) || 0));
    selectedDayKey = Utils.dateKey(Utils.addDays(currentMonday, idx));
    renderAll();
  }

  function goToday() {
    currentMonday = Utils.mondayOf(new Date());
    selectedDayKey = Utils.todayKey();
    renderAll();
  }

  function selectDay(dateKey) {
    selectedDayKey = dateKey;
    renderAll();
  }

  function setView(view) {
    currentView = view;
    renderAll();
  }

  // ===== الرسم =====
  async function renderAll() {
    renderWeekRange();
    renderDayTabs();
    await renderCategorySelects();
    if (currentView === "list") {
      els.listViewWrap.style.display = "";
      els.agendaSection.style.display = "none";
      els.listViewBtn.classList.add("btn-primary");
      els.agendaViewBtn.classList.remove("btn-primary");
      await renderAppointmentList();
    } else {
      els.listViewWrap.style.display = "none";
      els.agendaSection.style.display = "";
      els.agendaViewBtn.classList.add("btn-primary");
      els.listViewBtn.classList.remove("btn-primary");
      await renderAgenda();
    }
    await renderTasks();
    await renderHabitsMini();
  }

  function renderWeekRange() {
    const sunday = Utils.addDays(currentMonday, 6);
    els.weekRange.innerHTML = `<bdi>${Utils.formatShortDate(currentMonday)} - ${Utils.formatShortDate(sunday)}</bdi>`;
  }

  function renderDayTabs() {
    els.dayTabs.innerHTML = "";
    const todayKey = Utils.todayKey();
    const labels = isTinyLabel() ? T.weekdaysTiny : T.weekdaysShort;
    for (let i = 0; i < 7; i++) {
      const d = Utils.addDays(currentMonday, i);
      const key = Utils.dateKey(d);
      const btn = document.createElement("button");
      btn.className = "day-tab";
      if (key === todayKey) btn.classList.add("today");
      if (key === selectedDayKey) btn.classList.add("selected");
      btn.innerHTML = `<span class="dow">${labels[i]}</span><span class="dnum">${d.getDate()}</span>`;
      btn.addEventListener("click", () => selectDay(key));
      els.dayTabs.appendChild(btn);
    }
  }

  async function renderCategorySelects() {
    const cats = await getCategories();
    [els.apptCategory, els.taskCategory].forEach((sel) => {
      const prevValue = sel.value;
      sel.innerHTML = "";
      cats.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        sel.appendChild(opt);
      });
      if (cats.some((c) => c.id === prevValue)) sel.value = prevValue;
    });
  }

  // دالة تركيبية (غير متزامنة الشكل) تُستعمل بعد جلب قائمة الفئات مسبقا لتفادي طلب متكرر داخل الحلقات
  function catTag(categories, categoryId) {
    const cat = categories.find((c) => c.id === categoryId);
    const span = document.createElement("span");
    span.className = "item-cat-tag";
    span.style.background = cat ? cat.color : "#999";
    span.textContent = cat ? cat.name : "";
    return span;
  }

  // ----- قائمة المواعيد (اليوم المحدد) -----
  async function renderAppointmentList() {
    const [items, categories] = await Promise.all([getOccurrencesForDate(selectedDayKey), getCategories()]);
    els.apptList.innerHTML = "";
    if (items.length === 0) {
      els.apptList.innerHTML = `<li class="empty-msg">${T.noAppointments}</li>`;
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "item-row";
      const cat = categories.find((c) => c.id === item.categoryId);
      li.innerHTML = `
        <span class="badge" style="background:${cat ? cat.color : "#999"}"></span>
        <span class="item-time"><bdi>${item.recurring ? T.recurringIcon + " " : ""}${item.time}</bdi></span>
        <span class="item-title">${Utils.escapeHtml(item.title)}</span>
      `;
      li.appendChild(catTag(categories, item.categoryId));
      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger";
      delBtn.textContent = T.delete;
      delBtn.addEventListener("click", () => handleDeleteAppointment(item, selectedDayKey));
      li.appendChild(delBtn);
      els.apptList.appendChild(li);
    });
  }

  async function handleDeleteAppointment(item, dateKey) {
    if (!item.recurring) {
      const day = await getDay(dateKey);
      day.appointments = (day.appointments || []).filter((a) => a.id !== item.id);
      await saveDay(dateKey, day);
      await renderAll();
      Notifications.reschedule();
      return;
    }
    Modal.open({
      title: T.deleteRecurringTitle,
      buttons: [
        {
          label: T.deleteThisOccurrence,
          onClick: async () => {
            const list = await getRecurring();
            const rule = list.find((r) => r.id === item.id);
            if (rule) {
              rule.exceptions = rule.exceptions || [];
              if (!rule.exceptions.includes(dateKey)) rule.exceptions.push(dateKey);
              await saveRecurring(list);
            }
            await renderAll();
            Notifications.reschedule();
          }
        },
        {
          label: T.deleteAllOccurrences,
          danger: true,
          onClick: async () => {
            const list = await getRecurring();
            await saveRecurring(list.filter((r) => r.id !== item.id));
            await renderAll();
            Notifications.reschedule();
          }
        },
        { label: T.cancel, onClick: null }
      ]
    });
  }

  // ----- إضافة موعد -----
  async function onSubmitAppointment(e) {
    e.preventDefault();
    const time = els.apptTime.value;
    const duration = parseInt(els.apptDuration.value, 10) || 60;
    const title = els.apptTitle.value.trim();
    const categoryId = els.apptCategory.value;

    if (!title) return showError(els.apptError, T.errorTitleRequired);
    if (!Utils.isValidTime(time)) return showError(els.apptError, T.errorTimeInvalid);
    hideError(els.apptError);

    if (els.apptRepeat.checked) {
      const wd = Utils.weekdayMon0(Utils.parseDateKey(selectedDayKey));
      const list = await getRecurring();
      list.push({
        id: Utils.uid(),
        weekday: wd,
        time,
        duration,
        title,
        categoryId,
        startDate: selectedDayKey,
        exceptions: []
      });
      await saveRecurring(list);
    } else {
      const day = await getDay(selectedDayKey);
      day.appointments = day.appointments || [];
      day.appointments.push({ id: Utils.uid(), time, duration, title, categoryId });
      await saveDay(selectedDayKey, day);
    }

    els.apptTitle.value = "";
    els.apptRepeat.checked = false;
    await renderAll();
    Notifications.reschedule();
  }

  function showError(el, msg) {
    el.textContent = msg;
    el.classList.add("show");
  }
  function hideError(el) {
    el.classList.remove("show");
    el.textContent = "";
  }

  // ----- عرض الأجندة الأسبوعية -----
  async function renderAgenda() {
    const wrap = els.agendaViewWrap;
    wrap.innerHTML = "";

    const mobile = isAgendaMobile();
    const fullWeek = agendaShowFullWeek();
    const scrollable = mobile && fullWeek; // هاتف + وضع الأسبوع = تمرير أفقي داخل الحاوية

    // أزرار يوم/أسبوع تظهر فقط على الهاتف (عبر CSS)؛ نحدّث الحالة النشطة منها
    els.agendaDayBtn.classList.toggle("btn-primary", !agendaMobileFullWeek);
    els.agendaWeekBtn.classList.toggle("btn-primary", agendaMobileFullWeek);

    let gridClass = "agenda-grid";
    if (!fullWeek) gridClass += " is-single";
    else if (scrollable) gridClass += " is-scrollable";

    const grid = document.createElement("div");
    grid.className = gridClass;

    const todayKey = Utils.todayKey();
    const dayIndices = fullWeek ? [0, 1, 2, 3, 4, 5, 6] : [Utils.weekdayMon0(Utils.parseDateKey(selectedDayKey))];
    const categories = await getCategories();

    // صف الرأس بأكمله أولا (زاوية فارغة + رأس كل يوم): يضمن أن كل رؤوس الأعمدة
    // بما فيها زاوية عمود الساعات تكون بنفس ارتفاع الصف تلقائيا (لا تراكب مع 07:00)
    const corner = document.createElement("div");
    corner.className = "agenda-corner";
    grid.appendChild(corner);

    dayIndices.forEach((i) => {
      const d = Utils.addDays(currentMonday, i);
      const key = Utils.dateKey(d);
      const headClasses = ["agenda-day-head"];
      if (key === todayKey) headClasses.push("today");
      if (key === selectedDayKey) headClasses.push("selected");
      const head = document.createElement("div");
      head.className = headClasses.join(" ");
      head.innerHTML = `<span class="dh-name">${T.weekdaysShort[i]}</span><span class="dh-num">${d.getDate()}</span>`;
      grid.appendChild(head);
    });

    // ثم صف الجسم بأكمله (عمود الساعات + جسم كل يوم) يبدأ مباشرة تحت صف الرأس
    const hoursCol = document.createElement("div");
    hoursCol.className = "agenda-hours";
    for (let h = AGENDA_START_HOUR; h < AGENDA_END_HOUR; h++) {
      const lbl = document.createElement("div");
      lbl.className = "agenda-hour-label";
      lbl.innerHTML = `<bdi>${String(h).padStart(2, "0")}:00</bdi>`;
      hoursCol.appendChild(lbl);
    }
    grid.appendChild(hoursCol);

    for (const i of dayIndices) {
      const d = Utils.addDays(currentMonday, i);
      const key = Utils.dateKey(d);
      const body = document.createElement("div");
      body.className = "agenda-day-body";
      body.style.height = (AGENDA_END_HOUR - AGENDA_START_HOUR) * PX_PER_HOUR + "px";

      const occurrences = await getOccurrencesForDate(key);
      const items = occurrences.map((item) => {
        const start = Utils.timeToMinutes(item.time);
        return { ...item, start, end: start + (item.duration || 60) };
      });
      layoutAndRenderBlocks(body, items, key, categories);

      grid.appendChild(body);
    }

    wrap.appendChild(grid);

    if (scrollable) {
      // ملاحظة RTL: في متصفح حديث، scrollLeft=0 هو موضع "البداية" (اليمين) أي الإثنين وعمود الساعات
      wrap.scrollLeft = 0;
    }
  }

  function layoutAndRenderBlocks(container, items, dateKey, categories) {
    if (items.length === 0) return;
    items.sort((a, b) => a.start - b.start || a.end - b.end);

    // تجميع الأحداث المتداخلة في مجموعات
    let clusters = [];
    let current = [];
    let clusterMaxEnd = -1;
    items.forEach((item) => {
      if (current.length === 0 || item.start < clusterMaxEnd) {
        current.push(item);
        clusterMaxEnd = Math.max(clusterMaxEnd, item.end);
      } else {
        clusters.push(current);
        current = [item];
        clusterMaxEnd = item.end;
      }
    });
    if (current.length) clusters.push(current);

    clusters.forEach((cluster) => {
      // توزيع الأعمدة داخل المجموعة (خوارزمية جشعة)
      const colEnds = []; // نهاية آخر حدث في كل عمود
      const itemCol = [];
      cluster.forEach((item) => {
        let placed = false;
        for (let c = 0; c < colEnds.length; c++) {
          if (colEnds[c] <= item.start) {
            colEnds[c] = item.end;
            itemCol.push(c);
            placed = true;
            break;
          }
        }
        if (!placed) {
          colEnds.push(item.end);
          itemCol.push(colEnds.length - 1);
        }
      });
      const totalCols = colEnds.length;

      cluster.forEach((item, idx) => {
        const col = itemCol[idx];
        const dayStart = AGENDA_START_HOUR * 60;
        const dayEnd = AGENDA_END_HOUR * 60;
        const clampedStart = Math.max(item.start, dayStart);
        const clampedEnd = Math.min(item.end, dayEnd);
        if (clampedEnd <= dayStart || clampedStart >= dayEnd) return;

        const top = ((clampedStart - dayStart) / 60) * PX_PER_HOUR;
        const height = Math.max(18, ((clampedEnd - clampedStart) / 60) * PX_PER_HOUR - 2);
        const widthPct = 100 / totalCols;

        const cat = categories.find((c) => c.id === item.categoryId);
        const block = document.createElement("div");
        block.className = "agenda-block";
        block.style.top = top + "px";
        block.style.height = height + "px";
        block.style.insetInlineStart = `calc(${col * widthPct}% + 2px)`;
        block.style.width = `calc(${widthPct}% - 4px)`;
        block.style.background = cat ? cat.color : "#999";
        block.title = `${item.time} — ${item.title}`;
        block.innerHTML = `<span class="b-time"><bdi>${item.recurring ? T.recurringIcon + " " : ""}${item.time}</bdi></span><span class="b-title">${Utils.escapeHtml(item.title)}</span>`;
        block.addEventListener("click", () => showAgendaBlockDetails(item, dateKey, cat));
        container.appendChild(block);
      });
    });
  }

  function showAgendaBlockDetails(item, dateKey, cat) {
    Modal.open({
      title: item.title,
      message: `${item.time} · ${item.duration || 60} دقيقة · ${cat ? cat.name : ""}`,
      buttons: [
        {
          label: T.delete,
          danger: true,
          onClick: () => handleDeleteAppointment(item, dateKey)
        },
        { label: T.close, onClick: null }
      ]
    });
  }

  // ----- المهام -----
  async function onSubmitTask(e) {
    e.preventDefault();
    const title = els.taskTitle.value.trim();
    const categoryId = els.taskCategory.value;
    if (!title) return showError(els.taskError, T.errorTitleRequired);
    hideError(els.taskError);

    const day = await getDay(selectedDayKey);
    day.tasks = day.tasks || [];
    day.tasks.push({ id: Utils.uid(), title, done: false, categoryId });
    await saveDay(selectedDayKey, day);
    els.taskTitle.value = "";
    await renderTasks();
  }

  async function renderTasks() {
    const [day, categories] = await Promise.all([getDay(selectedDayKey), getCategories()]);
    const tasks = day.tasks || [];
    els.taskList.innerHTML = "";
    if (tasks.length === 0) {
      els.taskList.innerHTML = `<li class="empty-msg">${T.noTasks}</li>`;
      return;
    }
    tasks.forEach((task) => {
      const li = document.createElement("li");
      li.className = "item-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = task.done;
      cb.addEventListener("change", () => toggleTask(task.id, cb.checked));
      li.appendChild(cb);
      const titleSpan = document.createElement("span");
      titleSpan.className = "item-title" + (task.done ? " done" : "");
      titleSpan.textContent = task.title;
      li.appendChild(titleSpan);
      li.appendChild(catTag(categories, task.categoryId));
      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger";
      delBtn.textContent = T.delete;
      delBtn.addEventListener("click", () => deleteTask(task.id));
      li.appendChild(delBtn);
      els.taskList.appendChild(li);
    });
  }

  async function toggleTask(taskId, done) {
    const day = await getDay(selectedDayKey);
    const task = (day.tasks || []).find((t) => t.id === taskId);
    if (task) task.done = done;
    await saveDay(selectedDayKey, day);
    await renderTasks();
  }

  async function deleteTask(taskId) {
    const day = await getDay(selectedDayKey);
    day.tasks = (day.tasks || []).filter((t) => t.id !== taskId);
    await saveDay(selectedDayKey, day);
    await renderTasks();
  }

  async function onPostponeTasks() {
    const day = await getDay(selectedDayKey);
    const tasks = day.tasks || [];
    const unfinished = tasks.filter((t) => !t.done);
    if (unfinished.length === 0) return;
    day.tasks = tasks.filter((t) => t.done);
    await saveDay(selectedDayKey, day);

    const nextKey = Utils.dateKey(Utils.addDays(Utils.parseDateKey(selectedDayKey), 1));
    const nextDay = await getDay(nextKey);
    nextDay.tasks = (nextDay.tasks || []).concat(unfinished);
    await saveDay(nextKey, nextDay);

    await renderTasks();
  }

  // ----- العادات (إضافة وحذف وتعديل التكرار/الأهمية؛ التأشير اليومي يتم في صفحة العادات) -----
  function resetAddHabitForm() {
    addHabitFreqType = "daily";
    addHabitPriority = "normal";
    addHabitDaysToggle.setDays([]);
    els.habitDaysRow.hidden = true;
    els.habitFreqToggle.querySelectorAll("button[data-freq]").forEach((b) => {
      b.classList.toggle("btn-primary", b.dataset.freq === "daily");
      b.disabled = false;
    });
    els.habitPriorityToggle.querySelectorAll("button[data-priority]").forEach((b) => {
      b.classList.toggle("btn-primary", b.dataset.priority === "normal");
    });
    els.habitPriorityHint.hidden = true;
    els.habitReminderTime.value = "";
  }

  async function onSubmitHabit(e) {
    e.preventDefault();
    const name = els.habitName.value.trim();
    if (!name) return showError(els.habitError, T.errorNameRequired);

    let schedule;
    if (addHabitFreqType === "days") {
      const days = addHabitDaysToggle.getDays();
      if (days.length === 0) return showError(els.habitError, T.errorDaysRequired);
      schedule = { type: "days", days };
    } else {
      schedule = { type: "daily", days: [] };
    }
    hideError(els.habitError);

    const reminderTime = els.habitReminderTime.value || null;
    const list = await getHabitsList();
    list.push({ id: Utils.uid(), name, schedule, priority: addHabitPriority, reminderTime });
    await saveHabitsList(list);
    els.habitName.value = "";
    resetAddHabitForm();
    await renderHabitsMini();
    Notifications.reschedule();
  }

  async function renderHabitsMini() {
    const habits = await getHabitsList();
    els.habitManageSummary.textContent = `${T.habitManageTitle} (${habits.length})`;
    els.habitMiniList.innerHTML = "";
    if (habits.length === 0) {
      els.habitMiniList.innerHTML = `<li class="empty-msg">${T.noHabits}</li>`;
      return;
    }
    habits.forEach((h) => {
      const priority = Utils.habitPriority(h);
      const li = document.createElement("li");
      li.className = "habit-mini-row priority-" + priority;

      const info = document.createElement("div");
      info.className = "h-info";
      const nameSpan = document.createElement("span");
      nameSpan.className = "h-name";
      nameSpan.textContent = (priority === "high" ? T.priorityBadgeHigh + " " : "") + h.name;
      const freqSpan = document.createElement("span");
      freqSpan.className = "h-freq";
      freqSpan.textContent = formatHabitFrequency(h);
      const prioritySpan = document.createElement("span");
      prioritySpan.className = "h-freq";
      prioritySpan.textContent = priorityLabel(priority);
      info.appendChild(nameSpan);
      info.appendChild(freqSpan);
      info.appendChild(prioritySpan);
      li.appendChild(info);

      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-sm";
      editBtn.type = "button";
      editBtn.textContent = T.edit;
      editBtn.addEventListener("click", () => openEditHabitModal(h));
      li.appendChild(editBtn);

      const delBtn = document.createElement("button");
      delBtn.className = "btn-danger";
      delBtn.textContent = T.delete;
      delBtn.addEventListener("click", () => confirmDeleteHabit(h));
      li.appendChild(delBtn);

      els.habitMiniList.appendChild(li);
    });
  }

  // ----- تعديل عادة (الاسم والتكرار والأهمية) -----
  function openEditHabitModal(habit) {
    const body = document.createElement("div");
    const errEl = document.createElement("div");
    errEl.className = "form-error";

    const nameField = document.createElement("div");
    nameField.className = "field";
    const nameLabel = document.createElement("label");
    nameLabel.textContent = T.habitName;
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = habit.name;
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    body.appendChild(nameField);

    // ----- تكرار -----
    const freqWrap = document.createElement("div");
    freqWrap.className = "freq-toggle";
    freqWrap.style.marginTop = "0.6rem";
    const dailyBtn = document.createElement("button");
    dailyBtn.type = "button";
    dailyBtn.className = "btn btn-sm";
    dailyBtn.textContent = T.freqDaily;
    const daysBtn = document.createElement("button");
    daysBtn.type = "button";
    daysBtn.className = "btn btn-sm";
    daysBtn.textContent = T.freqDays;
    freqWrap.appendChild(dailyBtn);
    freqWrap.appendChild(daysBtn);
    body.appendChild(freqWrap);

    const initialType = habit.schedule && habit.schedule.type === "days" ? "days" : "daily";
    const initialDays = habit.schedule && habit.schedule.type === "days" ? habit.schedule.days : [];
    const dayToggle = createDayToggleGroup(initialDays);
    const daysRow = document.createElement("div");
    daysRow.style.marginTop = "0.6rem";
    daysRow.appendChild(dayToggle.el);
    body.appendChild(daysRow);

    // ----- أهمية -----
    const priorityWrap = document.createElement("div");
    priorityWrap.className = "priority-toggle";
    priorityWrap.style.marginTop = "0.6rem";
    const priorityBtns = {};
    PRIORITY_ORDER.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-sm";
      b.textContent = priorityLabel(p);
      priorityBtns[p] = b;
      priorityWrap.appendChild(b);
    });
    body.appendChild(priorityWrap);

    const priorityHint = document.createElement("p");
    priorityHint.className = "hint-text";
    priorityHint.textContent = T.freqForcedDaily;
    priorityHint.hidden = true;
    body.appendChild(priorityHint);

    // ----- تذكير (اختياري) -----
    const reminderField = document.createElement("div");
    reminderField.className = "field";
    reminderField.style.marginTop = "0.6rem";
    const reminderLabel = document.createElement("label");
    reminderLabel.textContent = T.reminderTimeLabel;
    const reminderInput = document.createElement("input");
    reminderInput.type = "time";
    reminderInput.value = habit.reminderTime || "";
    reminderField.appendChild(reminderLabel);
    reminderField.appendChild(reminderInput);
    body.appendChild(reminderField);

    // ----- تأكيد مضمَّن (بدل نافذة متداخلة) لتغييرات حساسة -----
    const inlineConfirm = document.createElement("div");
    inlineConfirm.className = "hint-text";
    inlineConfirm.style.cssText = "background:var(--priority-high-bg);color:var(--priority-high);padding:0.5rem;border-radius:8px;margin-top:0.5rem;";
    inlineConfirm.hidden = true;
    const inlineConfirmText = document.createElement("p");
    inlineConfirmText.style.margin = "0 0 0.4rem";
    const inlineConfirmYes = document.createElement("button");
    inlineConfirmYes.type = "button";
    inlineConfirmYes.className = "btn btn-sm btn-primary";
    inlineConfirmYes.textContent = T.confirm;
    const inlineConfirmNo = document.createElement("button");
    inlineConfirmNo.type = "button";
    inlineConfirmNo.className = "btn btn-sm";
    inlineConfirmNo.textContent = T.cancel;
    inlineConfirm.appendChild(inlineConfirmText);
    inlineConfirm.appendChild(inlineConfirmYes);
    inlineConfirm.appendChild(inlineConfirmNo);
    body.appendChild(inlineConfirm);

    function showInlineConfirm(message, onYes) {
      inlineConfirmText.textContent = message;
      inlineConfirm.hidden = false;
      const yesHandler = () => {
        inlineConfirm.hidden = true;
        cleanup();
        onYes();
      };
      const noHandler = () => {
        inlineConfirm.hidden = true;
        cleanup();
      };
      function cleanup() {
        inlineConfirmYes.removeEventListener("click", yesHandler);
        inlineConfirmNo.removeEventListener("click", noHandler);
      }
      inlineConfirmYes.addEventListener("click", yesHandler);
      inlineConfirmNo.addEventListener("click", noHandler);
    }

    let currentType = initialType;
    function setFreqActive(type) {
      currentType = type;
      dailyBtn.classList.toggle("btn-primary", type === "daily");
      daysBtn.classList.toggle("btn-primary", type === "days");
      daysRow.hidden = type !== "days";
    }
    setFreqActive(initialType);
    dailyBtn.addEventListener("click", () => setFreqActive("daily"));
    daysBtn.addEventListener("click", () => {
      if (daysBtn.disabled) return;
      setFreqActive("days");
    });

    const initialPriority = Utils.habitPriority(habit);
    let currentPriority = initialPriority;
    function applyPriority(p) {
      currentPriority = p;
      PRIORITY_ORDER.forEach((k) => priorityBtns[k].classList.toggle("btn-primary", k === p));
      const forced = p === "high";
      daysBtn.disabled = forced;
      priorityHint.hidden = !forced;
      if (forced) setFreqActive("daily");
    }
    applyPriority(initialPriority);

    PRIORITY_ORDER.forEach((p) => {
      priorityBtns[p].addEventListener("click", () => {
        if (p === currentPriority) return;
        if (p === "high" && currentType === "days") {
          showInlineConfirm(T.confirmForceDailyMessage, () => applyPriority(p));
          return;
        }
        if (initialPriority === "high" && p !== "high") {
          showInlineConfirm(T.confirmDowngradeImportant, () => applyPriority(p));
          return;
        }
        applyPriority(p);
      });
    });

    body.appendChild(errEl);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-primary btn-sm";
    saveBtn.style.marginTop = "0.6rem";
    saveBtn.textContent = T.save;
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      if (!name) return showError(errEl, T.errorNameRequired);
      let schedule;
      if (currentType === "days") {
        const days = dayToggle.getDays();
        if (days.length === 0) return showError(errEl, T.errorDaysRequired);
        schedule = { type: "days", days };
      } else {
        schedule = { type: "daily", days: [] };
      }
      hideError(errEl);

      const list = await getHabitsList();
      const item = list.find((x) => x.id === habit.id);
      if (item) {
        item.name = name;
        item.schedule = schedule;
        item.priority = currentPriority;
        item.reminderTime = reminderInput.value || null;
      }
      await saveHabitsList(list);
      Modal.close();
      await renderHabitsMini();
      Notifications.reschedule();
    });
    body.appendChild(saveBtn);

    Modal.open({
      title: T.editHabit,
      bodyNode: body,
      buttons: [{ label: T.cancel, onClick: null }]
    });
  }

  function confirmDeleteHabit(habit) {
    const isHigh = Utils.habitPriority(habit) === "high";
    const message = isHigh ? T.confirmDowngradeImportant : T.confirmDeleteHabit;
    Modal.confirm(message, async () => {
      const list = await getHabitsList();
      await saveHabitsList(list.filter((h) => h.id !== habit.id));
      // تنظيف السجلات المرتبطة بهذه العادة في كل الأيام
      const dayKeys = await Storage.list("day:");
      for (const key of dayKeys) {
        const day = await Storage.get(key, null);
        if (day && day.habitChecks && day.habitChecks[habit.id] !== undefined) {
          delete day.habitChecks[habit.id];
          await Storage.set(key, day);
        }
      }
      await renderAll();
      Notifications.reschedule();
    });
  }

  // ----- إدارة الفئات -----
  function openCategoryManager() {
    const body = document.createElement("div");

    const listEl = document.createElement("div");
    listEl.className = "cat-list-edit";
    body.appendChild(listEl);

    async function renderCatList() {
      listEl.innerHTML = "";
      const cats = await getCategories();
      cats.forEach((cat) => {
        const wrap = document.createElement("span");
        wrap.className = "cat-swatch";

        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.value = cat.color;
        colorInput.addEventListener("input", async () => {
          const list = await getCategories();
          const c = list.find((x) => x.id === cat.id);
          c.color = colorInput.value;
          await saveCategories(list);
          await renderCategorySelects();
          await renderAll();
        });

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = cat.name;
        nameInput.style.border = "none";
        nameInput.style.background = "transparent";
        nameInput.style.width = "6rem";
        nameInput.addEventListener("change", async () => {
          const val = nameInput.value.trim();
          if (!val) {
            nameInput.value = cat.name;
            return;
          }
          const list = await getCategories();
          const c = list.find((x) => x.id === cat.id);
          c.name = val;
          await saveCategories(list);
          await renderCategorySelects();
          await renderAll();
        });

        wrap.appendChild(colorInput);
        wrap.appendChild(nameInput);
        listEl.appendChild(wrap);
      });
    }
    renderCatList();

    const addRow = document.createElement("div");
    addRow.className = "form-row";
    addRow.innerHTML = `
      <div class="field"><label>${T.categoryName}</label><input type="text" id="new-cat-name"></div>
      <div class="field"><label>${T.categoryColor}</label><input type="color" id="new-cat-color" value="#4A5FA5"></div>
    `;
    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-primary btn-sm";
    addBtn.textContent = T.addCategory;
    addBtn.type = "button";
    addBtn.addEventListener("click", async () => {
      const nameInput = document.getElementById("new-cat-name");
      const colorInput = document.getElementById("new-cat-color");
      const name = nameInput.value.trim();
      if (!name) return;
      const list = await getCategories();
      list.push({ id: Utils.uid(), name, color: colorInput.value });
      await saveCategories(list);
      nameInput.value = "";
      await renderCatList();
      await renderCategorySelects();
      await renderAll();
    });
    addRow.appendChild(addBtn);
    body.appendChild(addRow);

    Modal.open({
      title: T.manageCategories,
      bodyNode: body,
      buttons: [{ label: T.close, onClick: null }]
    });
  }

  // ===== التهيئة =====
  async function init() {
    await getCategories(); // بذر الفئات الافتراضية عند الحاجة
    cacheEls();
    bindEvents();
    await renderAll();
    // إعادة الرسم عند تغيير حجم النافذة (تبديل أجندة الهاتف/الحاسوب وأسماء الأيام)
    window.addEventListener("resize", Utils.debounce(renderAll, 150));
  }

  return { init, refresh: renderAll };
})();
