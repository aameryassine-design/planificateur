// عامل الخدمة: يخزّن التطبيق محليا ليعمل بلا اتصال، ولا يتدخل أبدا في طلبات Supabase
const CACHE_VERSION = "v5";
const CACHE_NAME = "mukhattat-" + CACHE_VERSION;

// عنوان مكتبة supabase-js نفسه المستعمل في index.html (نسخة مثبّتة)
const SUPABASE_JS_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js";
const GOOGLE_FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@500;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/i18n.js",
  "./js/config.js",
  "./js/supabase-client.js",
  "./js/utils.js",
  "./js/storage.js",
  "./js/auth.js",
  "./js/sync.js",
  "./js/notifications.js",
  "./js/semaine.js",
  "./js/habitudes.js",
  "./js/budget.js",
  "./js/export-excel.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon-180.png",
  GOOGLE_FONTS_CSS,
  SUPABASE_JS_CDN
];

// لا نعترض إطلاقا طلبات Supabase (المصادقة والبيانات)؛ يجب أن تصل الشبكة دائما مباشرة
function isSupabaseRequest(url) {
  return /(^|\.)supabase\.co$/.test(url.hostname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // نخزّن كل مورد على حدة حتى لا يوقف فشل مورد واحد (مثلا عدم اتصال أثناء التثبيت) بقية التخزين المسبق
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (response.ok || response.type === "opaque") {
              await cache.put(url, response);
            }
          } catch (e) {
            // سيُخزَّن لاحقا عند أول استعمال فعلي عبر معالج fetch أدناه
          }
        })
      );
      // لا نستدعي skipWaiting هنا عمدا: ننتظر موافقة المستخدم عبر رسالة "يتوفر تحديث"
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// يستقبل أمر التفعيل الفوري من الصفحة بعد موافقة المستخدم على التحديث
self.addEventListener("message", (event) => {
  const isSkipWaiting = event.data === "SKIP_WAITING" || (event.data && event.data.type === "SKIP_WAITING");
  if (isSkipWaiting) self.skipWaiting();
});

// استراتيجية: كاش أولا، مع تحديث في الخلفية من الشبكة لكل الطلبات ما عدا Supabase
async function cacheFirstWithBackgroundRefresh(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // لا ننتظر الشبكة: نرجع النسخة المخزنة فورا وتُحدَّث الحاوية في الخلفية
    return cached;
  }

  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;

  // آخر حل عند فشل الشبكة وعدم وجود نسخة مخزنة: صفحة التطبيق نفسها لطلبات التصفح
  if (request.mode === "navigate") {
    const fallback = await cache.match("./index.html");
    if (fallback) return fallback;
  }
  return Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // مهم: طلبات Supabase (مصادقة وبيانات) يجب أن تصل الشبكة دائما مباشرة دون أي اعتراض أو تخزين
  if (isSupabaseRequest(url)) return;
  if (request.method !== "GET") return;

  event.respondWith(cacheFirstWithBackgroundRefresh(request));
});
