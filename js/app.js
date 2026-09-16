// نقطة انطلاق التطبيق: تسجيل الدخول، التنقل بين الصفحات، التصدير والاستيراد
(function () {
  let migrationChecked = false;
  let appStarted = false;

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
  }

  // ===== PWA: تثبيت التطبيق =====
  let deferredInstallPrompt = null;

  function bindInstallPrompt() {
    const btn = document.getElementById("btn-install");
    if (!btn) return;
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
    banner.hidden = false;
    reloadBtn.addEventListener(
      "click",
      () => {
        if (registration.waiting) registration.waiting.postMessage("SKIP_WAITING");
      },
      { once: true }
    );
  }

  function registerServiceWorker() {
    if (location.protocol === "file:") return; // لا معنى لعامل خدمة عند فتح الملف مباشرة
    if (!("serviceWorker" in navigator)) return;

    let reloadingAfterUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingAfterUpdate) return;
      reloadingAfterUpdate = true;
      location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((registration) => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            showUpdateBanner(registration);
          }
          registration.addEventListener("updatefound", () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
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
  }

  function stopApp() {
    window.removeEventListener("sync:changed", onSyncChanged);
    Sync.stop();
    Storage.clearUserCache();
    migrationChecked = false;
    Auth.showLoginScreen();
  }

  async function handleAuthChange(user) {
    if (user) {
      appStarted = true;
      await startApp(user);
    } else if (appStarted) {
      appStarted = false;
      stopApp();
    } else {
      Auth.showLoginScreen();
    }
  }

  async function boot() {
    bindTabs();
    bindExportImport();
    bindInstallPrompt();
    registerServiceWorker();
    Auth.onAuthChange(handleAuthChange);
    await Auth.init();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
