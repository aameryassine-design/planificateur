// إشعارات محلية (APK فقط عبر Capacitor.Plugins.LocalNotifications)
// لا يُحمَّل أي شيء عبر حزمة بناء: الاعتماد فقط على window.Capacitor المُحقَن تلقائيا من
// الجسر الأصلي داخل تطبيق أندرويد. على الويب window.Capacitor غائب تماما، فكل دالة هنا
// ترجع فورا بلا أي تأثير أو خطأ (isNative()/plugin() ترجعان قيمة كاذبة).
const Notifications = (function () {
  const SETTINGS_KEY = "notif-settings";
  const CHANNEL_ID = "reminders";
  const LOOKAHEAD_DAYS = 7;
  const EVENING_HOUR = 21; // موعد تذكير "مهم جدًا" غير المؤشَّرة
  const DEFAULT_SETTINGS = {
    habitsEnabled: true,
    eveningReminderEnabled: true,
    appointmentsEnabled: true,
    appointmentLeadMinutes: 15,
    permissionFlowShown: false
  };

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  function plugin() {
    return isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications
      ? window.Capacitor.Plugins.LocalNotifications
      : null;
  }

  async function getSettings() {
    const s = await Storage.get(SETTINGS_KEY, null);
    return Object.assign({}, DEFAULT_SETTINGS, s || {});
  }
  async function saveSettings(patch) {
    const s = await getSettings();
    Object.assign(s, patch);
    await Storage.set(SETTINGS_KEY, s);
    return s;
  }

  // مُعرِّف عددي ثابت من نص (djb2) يُستعمل كـ id للإشعار حتى يمكن إلغاؤه لاحقا بنفس المعرف
  // بين -2147483648 و2147483647 كما يتطلب Android؛ نبقيه موجبا دائما لتبسيط الأمر
  function stableId(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h % 2000000000;
  }

  // ===== القناة والإذن =====
  async function ensureChannel() {
    const p = plugin();
    if (!p) return;
    try {
      await p.createChannel({
        id: CHANNEL_ID,
        name: "تذكيرات",
        description: "تذكيرات العادات والمواعيد",
        importance: 5,
        visibility: 1,
        vibration: true
      });
    } catch (e) {
      console.warn("Notifications.ensureChannel:", e);
    }
  }

  async function hasPermission() {
    const p = plugin();
    if (!p) return false;
    try {
      const res = await p.checkPermissions();
      return res.display === "granted";
    } catch (e) {
      return false;
    }
  }

  // تُعرض مرة واحدة فقط (settings.permissionFlowShown) - تفسير بالعربية قبل نافذة النظام
  async function requestPermissionFlow() {
    const p = plugin();
    if (!p) return;
    const settings = await getSettings();
    if (settings.permissionFlowShown) return;
    if (await hasPermission()) {
      await saveSettings({ permissionFlowShown: true });
      return;
    }
    await new Promise((resolve) => {
      Modal.open({
        title: T.notifPermTitle,
        message: T.notifPermExplain,
        buttons: [
          { label: T.notifPermLater, onClick: () => resolve() },
          {
            label: T.notifPermEnable,
            primary: true,
            onClick: async () => {
              await saveSettings({ permissionFlowShown: true });
              try {
                const res = await p.requestPermissions();
                if (res.display !== "granted") showSettingsPrompt();
              } catch (e) {
                console.warn("Notifications.requestPermissionFlow:", e);
              }
              resolve();
            }
          }
        ]
      });
    });
  }

  function showSettingsPrompt() {
    Modal.open({
      title: T.notifDeniedTitle,
      message: T.notifDeniedMessage,
      buttons: [
        {
          label: T.notifOpenSettings,
          primary: true,
          onClick: () => {
            const appSettings = window.Capacitor.Plugins.AppSettings;
            if (appSettings && appSettings.open) appSettings.open();
          }
        },
        { label: T.close, onClick: null }
      ]
    });
  }

  // ===== قراءة البيانات (مستقلة، على نمط بقية وحدات الصفحات) =====
  async function getHabitsList() {
    return (await Storage.get("habits-list", [])) || [];
  }
  async function getRecurring() {
    return (await Storage.get("recurring-appointments", [])) || [];
  }
  async function getDay(dateKey) {
    return (await Storage.get("day:" + dateKey, null)) || { appointments: [], tasks: [], habitChecks: {} };
  }
  async function getHabitsStartDate() {
    const s = await Storage.get("settings", {});
    return (s && s.habitsStartDate) || null;
  }

  function getOccurrencesForDate(dateKey, recurring, day) {
    const oneOff = (day.appointments || []).map((a) => ({ id: a.id, time: a.time, title: a.title }));
    const date = Utils.parseDateKey(dateKey);
    const wd = Utils.weekdayMon0(date);
    const recurOccurrences = recurring
      .filter((r) => r.weekday === wd && dateKey >= r.startDate && !(r.exceptions || []).includes(dateKey))
      .map((r) => ({ id: r.id, time: r.time, title: r.title }));
    return oneOff.concat(recurOccurrences);
  }

  // ===== بناء قائمة الإشعارات المرغوبة للأيام السبعة القادمة =====
  async function buildDesiredNotifications() {
    const settings = await getSettings();
    const habits = await getHabitsList();
    const recurring = await getRecurring();
    const habitsStartDate = await getHabitsStartDate();
    const now = new Date();
    const list = [];

    for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
      const date = Utils.addDays(new Date(), i);
      const dateKey = Utils.dateKey(date);
      if (habitsStartDate && dateKey < habitsStartDate) continue;
      const day = await getDay(dateKey);

      if (settings.habitsEnabled) {
        habits.forEach((h) => {
          if (!h.reminderTime || !Utils.isValidTime(h.reminderTime)) return;
          if (!Utils.isHabitScheduled(h, date)) return;
          const done = !!(day.habitChecks && day.habitChecks[h.id]);
          if (done) return;
          const [hh, mm] = h.reminderTime.split(":").map(Number);
          const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0, 0);
          if (at <= now) return;
          list.push({
            id: stableId("habit:" + h.id + ":" + dateKey),
            title: T.appName,
            body: `${T.notifHabitPrefix} ${h.name}`,
            at,
            extra: { page: "habits" }
          });
        });
      }

      if (settings.eveningReminderEnabled) {
        habits
          .filter((h) => Utils.habitPriority(h) === "high")
          .forEach((h) => {
            if (!Utils.isHabitScheduled(h, date)) return;
            const done = !!(day.habitChecks && day.habitChecks[h.id]);
            if (done) return;
            const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), EVENING_HOUR, 0, 0, 0);
            if (at <= now) return;
            list.push({
              id: stableId("habit-evening:" + h.id + ":" + dateKey),
              title: T.appName,
              body: `${T.notifEveningPrefix} ${h.name} — ${T.notifEveningSuffix}`,
              at,
              extra: { page: "habits" }
            });
          });
      }

      if (settings.appointmentsEnabled && settings.appointmentLeadMinutes > 0) {
        const occurrences = getOccurrencesForDate(dateKey, recurring, day);
        occurrences.forEach((occ) => {
          if (!occ.time || !Utils.isValidTime(occ.time)) return;
          const [hh, mm] = occ.time.split(":").map(Number);
          const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0, 0);
          at.setMinutes(at.getMinutes() - settings.appointmentLeadMinutes);
          if (at <= now) return;
          list.push({
            id: stableId("appt:" + occ.id + ":" + dateKey),
            title: T.appName,
            body: `${T.notifApptPrefix} ${occ.title} — ${T.notifApptSuffix} ${settings.appointmentLeadMinutes} ${T.notifApptMinutesUnit}`,
            at,
            extra: { page: "week", dayKey: dateKey }
          });
        });
      }
    }

    return list;
  }

  let rescheduling = false;
  let rescheduleQueued = false;

  // يُلغي كل الإشعارات المُجدولة حاليا ثم يعيد بناءها من الصفر بناء على البيانات الحالية.
  // يُستدعى عند الإقلاع، عند العودة إلى التطبيق، بعد أي تعديل لعادة/موعد، وبعد كل مزامنة
  async function reschedule() {
    const p = plugin();
    if (!p) return; // لا شيء على الويب
    if (rescheduling) {
      rescheduleQueued = true;
      return;
    }
    rescheduling = true;
    try {
      if (!(await hasPermission())) return;
      await ensureChannel();

      const pending = await p.getPending();
      const pendingIds = ((pending && pending.notifications) || []).map((n) => n.id);
      if (pendingIds.length > 0) {
        await p.cancel({ notifications: pendingIds.map((id) => ({ id })) });
      }

      const settings = await getSettings();
      if (!settings.habitsEnabled && !settings.eveningReminderEnabled && !settings.appointmentsEnabled) return;

      const desired = await buildDesiredNotifications();
      if (desired.length === 0) return;

      const notifications = desired.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        channelId: CHANNEL_ID,
        schedule: { at: n.at, allowWhileIdle: true },
        extra: n.extra
      }));

      // شرائح من 50 تفاديا لأي رفض من النظام عند إرسال عدد كبير دفعة واحدة
      for (let i = 0; i < notifications.length; i += 50) {
        await p.schedule({ notifications: notifications.slice(i, i + 50) });
      }
    } catch (e) {
      console.warn("Notifications.reschedule:", e);
    } finally {
      rescheduling = false;
      if (rescheduleQueued) {
        rescheduleQueued = false;
        reschedule();
      }
    }
  }

  // إلغاء فوري لتذكير 21:00 عند تأشير عادة "مهم جدًا" اليوم (بدل انتظار إعادة الجدولة الكاملة)
  async function cancelEveningReminderIfChecked(habitId, dateKey) {
    const p = plugin();
    if (!p) return;
    if (dateKey !== Utils.todayKey()) return;
    try {
      await p.cancel({ notifications: [{ id: stableId("habit-evening:" + habitId + ":" + dateKey) }] });
    } catch (e) {
      // لا مشكلة: ستُعاد الجدولة بالكامل لاحقا وتصحح أي تعارض
    }
  }

  function bindNotificationTap() {
    const p = plugin();
    if (!p) return;
    p.addListener("localNotificationActionPerformed", (event) => {
      const extra = event && event.notification && event.notification.extra;
      if (!extra) return;
      const tab = extra.page === "week" ? "week" : extra.page === "budget" ? "budget" : "habits";
      const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
      if (btn) btn.click();
    });
  }

  // ===== دورة الحياة =====
  async function init() {
    if (!isNative()) return; // لا تأثير إطلاقا على الويب
    await ensureChannel();
    bindNotificationTap();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reschedule();
    });
    bindSettingsButton();
  }

  async function onLogin() {
    if (!isNative()) return;
    await requestPermissionFlow();
    await reschedule();
  }

  async function onLogout() {
    const p = plugin();
    if (!p) return;
    try {
      const pending = await p.getPending();
      const ids = ((pending && pending.notifications) || []).map((n) => n.id);
      if (ids.length > 0) await p.cancel({ notifications: ids.map((id) => ({ id })) });
    } catch (e) {
      // لا مشكلة
    }
  }

  async function sendTestNotification() {
    const p = plugin();
    if (!p) return;
    if (!(await hasPermission())) {
      await requestPermissionFlow();
      if (!(await hasPermission())) return;
    }
    await ensureChannel();
    try {
      await p.schedule({
        notifications: [
          {
            id: 999999999,
            title: T.appName,
            body: T.notifTestBody,
            channelId: CHANNEL_ID,
            schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true }
          }
        ]
      });
    } catch (e) {
      console.warn("Notifications.sendTestNotification:", e);
    }
  }

  // ===== زر وإعدادات (يظهران فقط داخل APK؛ الزر مخفي افتراضيا في index.html) =====
  function bindSettingsButton() {
    const btn = document.getElementById("btn-notif-settings");
    if (!btn) return;
    btn.hidden = false;
    btn.addEventListener("click", openSettingsModal);
  }

  async function openSettingsModal() {
    const settings = await getSettings();
    const body = document.createElement("div");

    function toggleRow(labelText, checked, onChange) {
      const row = document.createElement("label");
      row.className = "checkbox-inline";
      row.style.display = "flex";
      row.style.marginBlockEnd = "0.6rem";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      cb.addEventListener("change", () => onChange(cb.checked));
      const span = document.createElement("span");
      span.textContent = labelText;
      row.appendChild(cb);
      row.appendChild(span);
      body.appendChild(row);
      return cb;
    }

    toggleRow(T.notifSettingsHabits, settings.habitsEnabled, async (v) => {
      await saveSettings({ habitsEnabled: v });
      reschedule();
    });
    toggleRow(T.notifSettingsEvening, settings.eveningReminderEnabled, async (v) => {
      await saveSettings({ eveningReminderEnabled: v });
      reschedule();
    });
    toggleRow(T.notifSettingsAppointments, settings.appointmentsEnabled, async (v) => {
      await saveSettings({ appointmentsEnabled: v });
      reschedule();
    });

    const leadField = document.createElement("div");
    leadField.className = "field";
    leadField.style.marginBlockEnd = "0.6rem";
    const leadLabel = document.createElement("label");
    leadLabel.textContent = T.notifSettingsLead;
    const leadInput = document.createElement("input");
    leadInput.type = "number";
    leadInput.min = "0";
    leadInput.step = "5";
    leadInput.value = settings.appointmentLeadMinutes;
    leadInput.addEventListener("change", async () => {
      const v = Math.max(0, parseInt(leadInput.value, 10) || 0);
      leadInput.value = v;
      await saveSettings({ appointmentLeadMinutes: v });
      reschedule();
    });
    leadField.appendChild(leadLabel);
    leadField.appendChild(leadInput);
    body.appendChild(leadField);

    const testBtn = document.createElement("button");
    testBtn.type = "button";
    testBtn.className = "btn btn-sm";
    testBtn.textContent = T.notifTestBtn;
    testBtn.addEventListener("click", async () => {
      await sendTestNotification();
      testBtn.textContent = T.notifTestSent;
      setTimeout(() => (testBtn.textContent = T.notifTestBtn), 2500);
    });
    body.appendChild(testBtn);

    Modal.open({
      title: T.notifSettingsTitle,
      bodyNode: body,
      buttons: [{ label: T.close, onClick: null }]
    });
  }

  return { init, onLogin, onLogout, reschedule, cancelEveningReminderIfChecked, sendTestNotification };
})();
