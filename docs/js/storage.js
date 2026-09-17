// طبقة الوصول الوحيدة إلى localStorage
// كل الملفات الأخرى (بما فيها sync.js) يجب أن تمر من هنا للتعامل مع البيانات
//
// كل قراءة تأتي فورا من مخزن محلي (localStorage)، وكل كتابة تُحفظ محليا أولا
// ثم تُدرَج في طابور إرسال (outbox) يتكفل sync.js بإرساله إلى Supabase.
// البيانات مخزَّنة محليا داخل "ظرف" {value, updated_at} لكل مفتاح، مع سجل شواهد
// حذف (tombstones) يمنع أن يُحيي استقبالٌ لاحق مفتاحا حُذف محليا.
const Storage = (function () {
  const PREFIX = "planificateur:";
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  let currentUserId = null;

  // ===== مفاتيح التخزين الداخلية =====
  function envelopeKey(uid, key) { return `${PREFIX}${uid}:data:${key}`; }
  function metaKey(uid, name) { return `${PREFIX}${uid}:meta:${name}`; }

  function readJson(fullKey, fallback) {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(fullKey, value) {
    localStorage.setItem(fullKey, JSON.stringify(value));
  }

  function readEnvelope(uid, key) { return readJson(envelopeKey(uid, key), null); }
  function writeEnvelope(uid, key, envelope) { writeJson(envelopeKey(uid, key), envelope); }
  function deleteEnvelope(uid, key) { localStorage.removeItem(envelopeKey(uid, key)); }

  function readTombstones(uid) { return readJson(metaKey(uid, "tombstones"), {}); }
  function writeTombstones(uid, obj) { writeJson(metaKey(uid, "tombstones"), obj); }
  function setTombstone(uid, key, at) {
    const t = readTombstones(uid);
    t[key] = at;
    writeTombstones(uid, t);
  }
  function clearTombstone(uid, key) {
    const t = readTombstones(uid);
    if (key in t) {
      delete t[key];
      writeTombstones(uid, t);
    }
  }

  function readOutbox(uid) { return readJson(metaKey(uid, "outbox"), {}); }
  function writeOutbox(uid, obj) { writeJson(metaKey(uid, "outbox"), obj); }
  function enqueueOutbox(uid, key, type) {
    const o = readOutbox(uid);
    o[key] = { type };
    writeOutbox(uid, o);
  }

  function listKeysSync(uid, prefix) {
    if (!uid) return [];
    const dataPrefix = `${PREFIX}${uid}:data:`;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (full && full.startsWith(dataPrefix)) {
        const key = full.slice(dataPrefix.length);
        if (key.startsWith(prefix)) keys.push(key);
      }
    }
    return keys;
  }

  // يُعلم sync.js أن هناك تغييرا يجب إرساله (بدلا من استدعائه مباشرة لتفادي اعتماد دائري)
  function notifyDirty() {
    window.dispatchEvent(new Event("storage:dirty"));
  }

  // ===== واجهة عامة (غير متزامنة الشكل حفاظا على التوافق مع sync لاحقا) =====
  async function get(key, fallback) {
    if (!currentUserId) return fallback;
    const env = readEnvelope(currentUserId, key);
    if (!env || env.value === undefined) return fallback;
    return env.value;
  }

  async function set(key, value) {
    if (!currentUserId) {
      console.warn("Storage.set: لا يوجد مستخدم مسجل الدخول");
      return false;
    }
    const updated_at = new Date().toISOString();
    writeEnvelope(currentUserId, key, { value, updated_at });
    clearTombstone(currentUserId, key);
    enqueueOutbox(currentUserId, key, "set");
    notifyDirty();
    return true;
  }

  async function remove(key) {
    if (!currentUserId) return false;
    const at = new Date().toISOString();
    deleteEnvelope(currentUserId, key);
    setTombstone(currentUserId, key, at);
    enqueueOutbox(currentUserId, key, "delete");
    notifyDirty();
    return true;
  }

  async function list(prefix) {
    return listKeysSync(currentUserId, prefix);
  }

  async function exportAll() {
    const data = {};
    listKeysSync(currentUserId, "").forEach((key) => {
      const env = readEnvelope(currentUserId, key);
      if (env) data[key] = env.value;
    });
    return data;
  }

  // يستبدل كل بيانات المستخدم الحالي بالبيانات المعطاة (يحذف ما ليس موجودا فيها)
  async function importAll(data) {
    if (!currentUserId) return false;
    const existingKeys = listKeysSync(currentUserId, "");
    const newKeys = Object.keys(data);
    const newKeysSet = new Set(newKeys);
    for (const key of existingKeys) {
      if (!newKeysSet.has(key)) await remove(key);
    }
    for (const key of newKeys) {
      await set(key, data[key]);
    }
    return true;
  }

  // ===== إدارة المستخدم الحالي =====
  function setUser(uid) {
    currentUserId = uid;
  }
  function getUser() {
    return currentUserId;
  }
  // يمسح كل ما يخص المستخدم الحالي من التخزين المحلي (يُستدعى عند تسجيل الخروج)
  function clearUserCache() {
    if (!currentUserId) return;
    const prefix = `${PREFIX}${currentUserId}:`;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    currentUserId = null;
  }

  // ===== بيانات قديمة بدون بادئة مستخدم (من إصدار سابق للتطبيق قبل المزامنة) =====
  function isNewFormatKey(rest) {
    const parts = rest.split(":");
    return parts.length >= 2 && UUID_RE.test(parts[0]) && (parts[1] === "data" || parts[1] === "meta");
  }
  function legacyFullKeys() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (full && full.startsWith(PREFIX) && !isNewFormatKey(full.slice(PREFIX.length))) {
        keys.push(full);
      }
    }
    return keys;
  }
  function hasLegacyData() {
    return legacyFullKeys().length > 0;
  }
  function readLegacyData() {
    const data = {};
    legacyFullKeys().forEach((full) => {
      const key = full.slice(PREFIX.length);
      const val = readJson(full, undefined);
      if (val !== undefined) data[key] = val;
    });
    return data;
  }
  function clearLegacyData() {
    legacyFullKeys().forEach((full) => localStorage.removeItem(full));
  }

  // ===== واجهة داخلية خاصة بـ sync.js فقط =====
  const _internal = {
    getUserId: () => currentUserId,
    readOutbox: () => readOutbox(currentUserId),
    getEnvelope: (key) => readEnvelope(currentUserId, key),
    getTombstone: (key) => {
      const t = readTombstones(currentUserId);
      return t[key] || null;
    },
    writeEnvelopeFromRemote(key, value, updated_at) {
      writeEnvelope(currentUserId, key, { value, updated_at });
      clearTombstone(currentUserId, key);
    },
    getLastSyncAt: () => localStorage.getItem(metaKey(currentUserId, "lastSyncAt")) || null,
    setLastSyncAt: (iso) => localStorage.setItem(metaKey(currentUserId, "lastSyncAt"), iso),
    // يمسح من outbox فقط العمليات التي لم تتغيّر منذ إرسالها (تفاديا لفقدان تعديل حدث أثناء الإرسال)
    clearOutboxKeysIfUnchanged(sentOps) {
      const uid = currentUserId;
      if (!uid) return;
      const o = readOutbox(uid);
      let changed = false;
      sentOps.forEach(({ key, type, updated_at }) => {
        const cur = o[key];
        if (!cur || cur.type !== type) return;
        if (type === "set") {
          const env = readEnvelope(uid, key);
          if (!env || env.updated_at !== updated_at) return;
        }
        delete o[key];
        changed = true;
      });
      if (changed) writeOutbox(uid, o);
    }
  };

  return {
    get,
    set,
    remove,
    list,
    exportAll,
    importAll,
    setUser,
    getUser,
    clearUserCache,
    hasLegacyData,
    readLegacyData,
    clearLegacyData,
    _internal
  };
})();
