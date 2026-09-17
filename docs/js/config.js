const SUPABASE_URL = "https://wfrfjdwtjkpeyrmfyxgk.supabase.co";
const SUPABASE_KEY = "sb_publishable_ZezTNP5jI0Jfztvjt43Y4g_uIuQPLrL";

// تاريخ بدء تتبع العادات الافتراضي: يُستعمل لتنفيذ عملية تنظيف تلقائية مرة واحدة (حذف تتبع
// العادات قبل هذا التاريخ) ثم كقيمة احتياطية أينما استُعمل تاريخ البدء لاحقا. settings.habitsStartDate
// (يُضبط تلقائيا بعد التنظيف، أو يدويا عبر زر "بدء التتبع من اليوم") له الأولوية دائما على هذا الثابت
const HABITS_START_DATE = "2026-09-17";