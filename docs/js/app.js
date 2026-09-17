// نقطة انطلاق التطبيق: تسجيل الدخول، التنقل بين الصفحات، التصدير والاستيراد
(function () {
  let migrationChecked = false;
  let appStarted = false;

  // يعمل التطبيق كنسخة أندرويد (Capacitor) عندما يكون window.Capacitor موجودا وnativePlatform
  // على الويب (GitHub Pages) هذا الكائن غائب تماما، فترجع هذه الدالة false دائما بأمان
  function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // تنظيف دفاعي: لو وُجد عامل خدمة أو كاش من نسخة ويب سابقة على نفس الجهاز (نادر، لكن ممكن إن
  // فُتح نفس الرابط في WebView التطبيق سابقا)، نزيله تماما داخل APK فلا يتدخل أبدا في عرض الصفحة
  async function cleanupServiceWorkerIfNative() {
    if (!isNativeApp()) return;
    const banner = document.getElementById("update-banner");
    if (banner) banner.hidden = true;
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches) {
        const names = await caches.keys();
        await Promise.all(names.map((n) => caches.delete(n)));
      }
    } catch (e) {
      console.warn("[المخطط] تعذر تنظيف عامل الخدمة/الكاش داخل APK:", e);
    }
  }

  function switchTab(tabName) {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("active", view.id === "view-" + tabName);
    });
    if (tabName === "habits") Habitudes.refresh();
    if (tabName === "budget") Budget.refresh();
    if (tabName === "week") Semaine.refresh();
  }

  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function refreshAll() {
    await Semaine.refresh();
    await Habitudes.refresh();
    await Budget.refresh();
  }

  function bindExportImport() {
    document.getElementById("btn-export").addEventListener("click", async () => {
      const data = await Storage.exportAll();
      const today = Utils.todayKey();
      downloadJson(`${T.exportFileName}-${today}.json`, data);
    });

    const fileInput = document.getElementById("import-file");
    document.getElementById("btn-import").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let parsed;
        try {
          parsed = JSON.parse(reader.result);
        } catch (e) {
          alert(T.importError);
          fileInput.value = "";
          return;
        }
        Modal.confirm(T.confirmImport, async () => {
          // الاستيراد يستبدل كل البيانات محليا، وكل تغيير (تعيين أو حذف) يُدرَج تلقائيا
          // في طابور الإرسال عبر Storage.set/remove، فتصل النسخة المستوردة إلى Supabase أيضا
          await Storage.importAll(parsed);
          await refreshAll();
          Sync.flushOutbox();
          fileInput.value = "";
        });
      };
      reader.readAsText(file);
    });
  }

  function onSyncChanged() {
    refreshAll();
    Notifications.reschedule(); // بيانات جديدة واردة من جهاز آخر قد تغيّر مواعيد/عادات لها تذكيرات
  }

  // ===== PWA: تثبيت التطبيق =====
  let deferredInstallPrompt = null;

  function bindInstallPrompt() {
    const btn = document.getElementById("btn-install");
    if (!btn) return;
    if (isNativeApp()) return; // التطبيق مثبَّت أصلا كـ APK، لا معنى لاقتراح تثبيته كـ PWA
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (isStandalone) return; // التطبيق مثبت أصلا، لا داعي للزر

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      btn.hidden = false;
    });

    btn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      btn.hidden = true;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    });

    window.addEventListener("appinstalled", () => {
      btn.hidden = true;
      deferredInstallPrompt = null;
    });
  }

  // ===== PWA: عامل الخدمة والتحديث =====
  function showUpdateBanner(registration) {
    const banner = document.getElementById("update-banner");
    const reloadBtn = document.getElementById("btn-update-reload");
    if (!banner || !reloadBtn) return;
    if (banner.dataset.shown === "1") return; // تفادي ربط أكثر من مستمع لو استُدعيت مرتين لنفس registration
    banner.dataset.shown = "1";
    banner.hidden = false;
    reloadBtn.addEventListener(
      "click",
      () => {
        if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      },
      { once: true }
    );
  }

  function registerServiceWorker() {
    if (isNativeApp()) return; // داخل تطبيق أندرويد: لا عامل خدمة ولا بنر تحديث، السلوك الحالي يبقى كما هو على الويب فقط
    if (location.protocol === "file:") return; // لا معنى لعامل خدمة عند فتح الملف مباشرة
    if (!("serviceWorker" in navigator)) return;

    let reloadingAfterUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingAfterUpdate) return; // حارس مضاد للحلقة: نعيد التحميل مرة واحدة فقط
      reloadingAfterUpdate = true;
      location.reload();
    });

    window.addEventListener("load", () => {
      // نلتقط هذه القيمة فورا عند التحميل، لا نعيد قراءتها لاحقا: صفحة بلا متحكم الآن تعني
      // زيارة أولى/تثبيت أول لعامل الخدمة، ويجب ألا يظهر شريط التحديث لها أبدا. القراءة الحية
      // لاحقا (بعد وقوع أحداث غير متزامنة) كانت تلتقط أحيانا وضعا صار فيه المتحكم معيَّنا فعلا
      // (تفعيل سريع بلا عامل قديم ينتظر) فيُعرَض الشريط خطأ عند أول تثبيت - هذا هو الخلل الذي أُصلح هنا
      const hadControllerAtLoad = !!navigator.serviceWorker.controller;

      navigator.serviceWorker
        .register("./sw.js")
        .then((registration) => {
          if (hadControllerAtLoad && registration.waiting) {
            showUpdateBanner(registration);
          }
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (hadControllerAtLoad && newWorker.state === "installed") {
                showUpdateBanner(registration);
              }
            });
          });
        })
        .catch((e) => console.warn("تعذر تسجيل عامل الخدمة:", e));
    });
  }

  // عند أول اتصال لمستخدم حسابه فارغ في Supabase وله بيانات محلية قديمة (من قبل تفعيل
  // المزامنة)، نقترح رفعها. لا نطرح هذا إلا مرة واحدة لكل جلسة دخول.
  async function offerMigrationIfNeeded(pullResult) {
    if (migrationChecked) return;
    migrationChecked = true;
    if (!pullResult || !pullResult.isFirstSync || pullResult.remoteRowCount > 0) return;
    if (!Storage.hasLegacyData()) return;

    Modal.open({
      title: T.migratePrompt,
      buttons: [
        {
          label: T.migrateUpload,
          primary: true,
          onClick: async () => {
            const legacy = Storage.readLegacyData();
            await Storage.importAll(legacy);
            Storage.clearLegacyData();
            await refreshAll();
            Sync.flushOutbox();
          }
        },
        { label: T.migrateSkip, onClick: null }
      ]
    });
  }

  async function startApp(user) {
    Auth.hideLoginScreen();
    Storage.setUser(user.id);
    Sync.init();
    window.addEventListener("sync:changed", onSyncChanged);

    await Semaine.init();
    await Habitudes.init();
    await Budget.init();
    switchTab("week");

    // الاستقبال ثم الإرسال؛ لا ننتظرهما لحجب الواجهة (التطبيق محلي أولا وسريع دائما)
    const pullResult = await Sync.pullChanges();
    if (pullResult && pullResult.changed) await refreshAll();
    Sync.flushOutbox();
    offerMigrationIfNeeded(pullResult);

    // تنظيف تلقائي لمرة واحدة لتتبع العادات (habitChecks) قبل HABITS_START_DATE، بعد اكتمال
    // الاستقبال أعلاه حتى لا يفوتنا شيء قادم من جهاز آخر؛ settings.habitsPurgedBefore يمنع التكرار
    const purged = await Habitudes.runStartDateMigrationIfNeeded();
    if (purged) await refreshAll();

    await Notifications.onLogin(); // لا تأثير على الويب؛ على APK: تطلب الإذن أول مرة ثم تُجدول التذكيرات
  }

  function stopApp() {
    window.removeEventListener("sync:changed", onSyncChanged);
    Sync.stop();
    Storage.clearUserCache();
    migrationChecked = false;
    Notifications.onLogout();
    Auth.showLoginScreen();
  }

  // ملاحظة مهمة: onAuthStateChange يُستدعى في كل حدث (بما فيه TOKEN_REFRESHED الدوري)
  // وليس فقط عند تسجيل الدخول/الخروج الفعليين. نتحقق من appStarted لتفادي إعادة
  // تشغيل startApp (وبالتالي init/cacheEls/bindEvents) في كل مرة يتجدد فيها الرمز،
  // وهو ما كان يسبب تكرار عناصر DOM ومستمعي الأحداث المضافين ديناميكيا.
  async function handleAuthChange(user) {
    if (user) {
      if (!appStarted) {
        appStarted = true;
        await startApp(user);
      }
    } else if (appStarted) {
      appStarted = false;
      stopApp();
    } else {
      Auth.showLoginScreen();
    }
  }

  async function boot() {
    // تحقق فعلي (وليس افتراضا) من بيئة التشغيل عند كل إقلاع - يساعد على تشخيص مشاكل مثل
    // ظهور شريط التحديث داخل APK لو فشل اكتشاف Capacitor لأي سبب
    console.log("[المخطط] بيئة التشغيل:", isNativeApp() ? "تطبيق أندرويد (Capacitor)" : "ويب", {
      hasCapacitorGlobal: !!window.Capacitor,
      platform: window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : null
    });

    bindTabs();
    bindExportImport();
    bindInstallPrompt();
    ExcelExport.init(); // زر "تصدير Excel" يظهر فقط على الويب بعرض ≥ 768px (لا شيء على APK/الهاتف)
    await cleanupServiceWorkerIfNative();
    registerServiceWorker();
    await Notifications.init(); // لا تأثير على الويب؛ ينشئ قناة الإشعارات ويربط "العودة إلى التطبيق" على APK
    Auth.onAuthChange(handleAuthChange);
    await Auth.init();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
