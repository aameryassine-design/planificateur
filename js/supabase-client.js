// ينشئ عميل Supabase واحدا يُستعمل من auth.js و sync.js
// يعتمد على المتغيرين SUPABASE_URL / SUPABASE_KEY من js/config.js
// وعلى المتغير العام window.supabase الذي توفره مكتبة supabase-js (CDN)
const supabaseClient = (function () {
  const configured = SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes("COLLE_ICI") && !SUPABASE_KEY.includes("COLLE_ICI");
  if (!configured) {
    console.warn("Supabase غير مُهيّأ: عدّل js/config.js بمعطيات مشروعك.");
    return null;
  }
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
})();
