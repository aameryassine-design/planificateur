// نصوص الواجهة بالعربية - كل النصوص مجمعة هنا لتسهيل التعديل
const T = {
  appName: "المخطط",

  // علامات التبويب الرئيسية
  tabWeek: "الأسبوع",
  tabHabits: "العادات",
  tabBudget: "الميزانية",

  // أزرار عامة
  add: "إضافة",
  save: "حفظ",
  cancel: "إلغاء",
  delete: "حذف",
  edit: "تعديل",
  close: "إغلاق",
  confirm: "تأكيد",
  export: "تصدير",
  import: "استيراد",

  // أيام الأسبوع (0 = الإثنين ... 6 = الأحد)
  weekdays: ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
  weekdaysShort: ["إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت", "أحد"],
  weekdaysTiny: ["إثن", "ثلا", "أرب", "خمي", "جمع", "سبت", "أحد"],

  // الأشهر (بالاستعمال المغربي)
  months: ["يناير", "فبراير", "مارس", "أبريل", "ماي", "يونيو", "يوليوز", "غشت", "شتنبر", "أكتوبر", "نونبر", "دجنبر"],

  // تنقل عام
  previous: "السابق",
  next: "التالي",
  thisWeek: "هذا الأسبوع",
  thisMonth: "هذا الشهر",
  today: "اليوم",
  todayTracking: "تتبع اليوم",

  // صفحة الأسبوع
  appointments: "المواعيد",
  tasks: "المهام",
  habitsToday: "العادات",
  addAppointment: "إضافة موعد",
  addTask: "إضافة مهمة",
  time: "الوقت",
  duration: "المدة (دقيقة)",
  title: "العنوان",
  category: "الفئة",
  repeatWeekly: "تكرار كل أسبوع",
  noAppointments: "لا توجد مواعيد لهذا اليوم",
  noTasks: "لا توجد مهام لهذا اليوم",
  noHabits: "لم تتم إضافة أي عادة بعد",
  postponeTasks: "تأجيل إلى الغد",
  viewList: "قائمة",
  viewAgenda: "أجندة",
  deleteRecurringTitle: "حذف الموعد المتكرر",
  deleteThisOccurrence: "هذا الموعد فقط",
  deleteAllOccurrences: "كل المواعيد المتكررة",
  recurringIcon: "↻",

  // الفئات
  categories: "الفئات",
  manageCategories: "إدارة الفئات",
  categoryName: "اسم الفئة",
  categoryColor: "اللون",
  addCategory: "إضافة فئة",
  defaultCategories: {
    work: "عمل",
    personal: "شخصي",
    health: "صحة",
    other: "أخرى"
  },

  // العادات (بطاقة إضافة)
  addHabit: "إضافة عادة",
  habitName: "اسم العادة",
  confirmDeleteHabit: "هل تريد حذف هذه العادة؟ سيتم حذف كل سجلاتها.",
  editHabit: "تعديل العادة",
  freqDaily: "كل يوم",
  freqDays: "أيام محددة",
  errorDaysRequired: "الرجاء اختيار يوم واحد على الأقل",
  freqForcedDaily: "العادات المهمة جدًا تكون كل يوم",
  habitManageTitle: "إدارة العادات",

  // أهمية العادة
  priorityLabel: "الأهمية",
  priorityHigh: "مهم جدًا",
  priorityMedium: "مهم",
  priorityNormal: "عادي",
  priorityLow: "ثانوي",
  priorityBadgeHigh: "!!",
  confirmDowngradeImportant: "هذه عادة مهمة جدًا، هل أنت متأكد؟",
  confirmForceDailyMessage: "سيتم تحويل هذه العادة إلى كل يوم. هل تريد المتابعة؟",

  // الاستمرارية
  streakSectionTitle: "الاستمرارية",
  streakBest: "الرقم القياسي",
  streakDaysUnit: "يوم",
  congratsPrefix: "أحسنت!",
  congratsSuffix: "يومًا متتالية",
  missedWarningTitle: "فاتتك",
  missedYesterday: "أمس",
  noStreakData: "لا توجد بيانات كافية بعد",

  // صفحة العادات (الشهرية)
  progress: "التقدم",
  heatmap: "خريطة الحرارة",
  trend: "منحنى التقدم",
  daysCompleted: "أيام منجزة",
  ofDaysElapsed: "من الأيام المنقضية",
  noTrendData: "لا توجد بيانات بعد لهذا الشهر",
  noHabitsToday: "لا توجد عادات مبرمجة لهذا اليوم",
  unscheduledToday: "غير مبرمجة اليوم",

  // صفحة الميزانية
  income: "دخل",
  expense: "مصروف",
  totalIncome: "مجموع الدخل",
  totalExpense: "مجموع المصاريف",
  balance: "الباقي",
  amount: "المبلغ",
  note: "ملاحظة",
  date: "التاريخ",
  addEntry: "إضافة",
  entries: "الحركات",
  noEntries: "لا توجد حركات لهذا الشهر",
  breakdown: "توزيع المصاريف حسب الفئة",
  noBreakdown: "لا توجد مصاريف بعد",
  currency: "درهم",
  categoryPlaceholder: "مثال: أكل، نقل، فواتير...",

  // الديون
  debts: "الديون",
  debtLent: "أقرضت",
  debtBorrowed: "اقترضت",
  person: "الشخص",
  totalOwedToMe: "لي عند الناس",
  totalIOwe: "علي للناس",
  addDebt: "إضافة",
  noDebts: "لا توجد ديون مسجلة",
  netBalance: "الرصيد الصافي",
  confirmDeleteDebt: "هل تريد حذف هذه الحركة؟",

  // رسائل التحقق
  errorTitleRequired: "الرجاء إدخال العنوان",
  errorTimeInvalid: "الرجاء إدخال وقت صحيح",
  errorAmountInvalid: "الرجاء إدخال مبلغ أكبر من صفر",
  errorCategoryRequired: "الرجاء إدخال الفئة",
  errorPersonRequired: "الرجاء إدخال اسم الشخص",
  errorNameRequired: "الرجاء إدخال الاسم",

  // تصدير / استيراد
  confirmImport: "سيتم استبدال كل البيانات الحالية بالبيانات المستوردة. هل تريد المتابعة؟",
  importSuccess: "تم استيراد البيانات بنجاح",
  importError: "ملف غير صالح، تعذر الاستيراد",
  exportFileName: "المخطط-بيانات",

  // تسجيل الدخول
  authEmail: "البريد الإلكتروني",
  authPassword: "كلمة المرور",
  authSignIn: "تسجيل الدخول",
  authSigningIn: "...جارٍ الدخول",
  authSignOut: "تسجيل الخروج",
  authErrorInvalidCredentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
  authErrorEmailNotConfirmed: "لم يتم تأكيد البريد الإلكتروني بعد",
  authErrorOffline: "لا يوجد اتصال بالإنترنت",
  authErrorGeneric: "حدث خطأ، حاول مرة أخرى",
  authConfigMissing: "لم يتم إعداد الاتصال بالخادم بعد. عدّل الملف js/config.js بمعطيات مشروعك في Supabase.",

  // المزامنة
  syncSynced: "متزامن",
  syncSyncing: "جارٍ المزامنة…",
  syncOffline: "غير متصل",

  // ترحيل البيانات القديمة
  migratePrompt: "رفع البيانات الحالية إلى الحساب؟",
  migrateUpload: "رفع البيانات",
  migrateSkip: "تجاهل"
};
