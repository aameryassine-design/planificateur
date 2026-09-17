// المزامنة مع Supabase: إرسال طابور التغييرات (outbox) واستقبال التغييرات الواردة
// يعتمد فقط على الواجهة الداخلية Storage._internal، لا يلمس localStorage مباشرة
const Sync = (function () {
  const FLUSH_DEBOUNCE_MS = 800;

  let isFlushing = false;
  let dirtyTimer = null;
  let statusEl = null;

  function cacheEls() {
    statusEl = document.getElementById("sync-status");
  }

  function computeStatus() {
    const pendingCount = Object.keys(Storage._internal.readOutbox() || {}).length;
    if (!navigator.onLine) {
      return {
        state: "offline",
        text: pendingCount > 0 ? `${T.syncOffline} (${pendingCount})` : T.syncOffline
      };
    }
    if (isFlushing || pendingCount > 0) {
      return { state: "syncing", text: T.syncSyncing };
    }
    return { state: "synced", text: T.syncSynced };
  }

  function updateIndicator() {
    if (!statusEl) return;
    const { state, text } = computeStatus();
    statusEl.textContent = text;
    statusEl.className = "sync-status sync-status--" + state;
  }

  // ===== إرسال التغييرات المحلية المعلقة =====
  async function flushOutbox() {
    if (!supabaseClient) return;
    const uid = Storage._internal.getUserId();
    if (!uid || !navigator.onLine || isFlushing) {
      updateIndicator();
      return;
    }
    const outbox = Storage._internal.readOutbox();
    const keys = Object.keys(outbox);
    if (keys.length === 0) {
      updateIndicator();
      return;
    }

    isFlushing = true;
    updateIndicator();

    const upserts = [];
    const deletes = [];
    const sentOps = [];
    keys.forEach((key) => {
      const op = outbox[key];
      if (op.type === "delete") {
        deletes.push(key);
        sentOps.push({ key, type: "delete" });
      } else {
        const env = Storage._internal.getEnvelope(key);
        if (env) {
          upserts.push({ user_id: uid, key, value: env.value, updated_at: env.updated_at });
          sentOps.push({ key, type: "set", updated_at: env.updated_at });
        }
      }
    });

    try {
      if (upserts.length) {
        const { error } = await supabaseClient.from("kv").upsert(upserts, { onConflict: "user_id,key" });
        if (error) throw error;
      }
      if (deletes.length) {
        const { error } = await supabaseClient.from("kv").delete().eq("user_id", uid).in("key", deletes);
        if (error) throw error;
      }
      // نزيل من outbox فقط ما أُرسل بنجاح ولم يتغيّر أثناء الإرسال؛ الباقي يُعاد لاحقا تلقائيا
      Storage._internal.clearOutboxKeysIfUnchanged(sentOps);
    } catch (e) {
      console.warn("Sync.flushOutbox:", e);
    } finally {
      isFlushing = false;
      updateIndicator();
    }
  }

  // ===== استقبال التغييرات الواردة من Supabase منذ آخر مزامنة =====
  async function pullChanges() {
    if (!supabaseClient) return { changed: false };
    const uid = Storage._internal.getUserId();
    if (!uid || !navigator.onLine) return { changed: false };

    const lastSync = Storage._internal.getLastSyncAt();
    const isFirstSync = !lastSync;

    let query = supabaseClient.from("kv").select("key,value,updated_at").eq("user_id", uid);
    if (lastSync) query = query.gt("updated_at", lastSync);

    let data = [];
    try {
      const res = await query;
      if (res.error) throw res.error;
      data = res.data || [];
    } catch (e) {
      console.warn("Sync.pullChanges:", e);
      updateIndicator();
      return { changed: false, error: e };
    }

    let newest = lastSync;
    let changed = false;
    data.forEach((row) => {
      // لا تُحيِ مفتاحا حُذف محليا بتاريخ أحدث من أو يساوي هذا الصف الوارد
      const tomb = Storage._internal.getTombstone(row.key);
      if (tomb && tomb >= row.updated_at) return;
      // نسختنا المحلية أحدث أو مساوية (تعديل محلي لم يُرسل بعد) فله الأولوية: نتجاهل الوارد
      const localEnv = Storage._internal.getEnvelope(row.key);
      if (localEnv && localEnv.updated_at >= row.updated_at) return;

      Storage._internal.writeEnvelopeFromRemote(row.key, row.value, row.updated_at);
      changed = true;
      if (!newest || row.updated_at > newest) newest = row.updated_at;
    });

    if (newest) Storage._internal.setLastSyncAt(newest);
    updateIndicator();
    if (changed) window.dispatchEvent(new CustomEvent("sync:changed"));
    return { changed, isFirstSync, remoteRowCount: data.length };
  }

  function onDirty() {
    updateIndicator();
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(flushOutbox, FLUSH_DEBOUNCE_MS);
  }

  function onOnline() {
    updateIndicator();
    pullChanges();
    flushOutbox();
  }

  function onVisible() {
    if (document.visibilityState !== "visible") return;
    pullChanges();
    flushOutbox();
  }

  let bound = false;
  function bindGlobalEvents() {
    if (bound) return;
    bound = true;
    window.addEventListener("storage:dirty", onDirty);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", updateIndicator);
    document.addEventListener("visibilitychange", onVisible);
  }

  function init() {
    cacheEls();
    bindGlobalEvents();
    updateIndicator();
  }

  function stop() {
    clearTimeout(dirtyTimer);
    if (statusEl) {
      statusEl.textContent = "";
      statusEl.className = "sync-status";
    }
  }

  return { init, stop, pullChanges, flushOutbox, updateIndicator };
})();
