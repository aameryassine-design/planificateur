// تسجيل الدخول/الخروج عبر Supabase Auth (بريد إلكتروني + كلمة مرور فقط)
const Auth = (function () {
  let currentUser = null;
  const listeners = [];

  function mapAuthError(error) {
    if (!navigator.onLine) return T.authErrorOffline;
    const msg = ((error && error.message) || "").toLowerCase();
    if (msg.includes("invalid login credentials") || msg.includes("invalid_credentials")) {
      return T.authErrorInvalidCredentials;
    }
    if (msg.includes("email not confirmed")) return T.authErrorEmailNotConfirmed;
    if (msg.includes("failed to fetch") || msg.includes("network")) return T.authErrorOffline;
    return T.authErrorGeneric;
  }

  function showConfigMissing() {
    const box = document.querySelector(".auth-box");
    if (box) {
      box.innerHTML =
        `<h1 class="auth-title">${T.appName}</h1>` +
        `<p class="form-error show">${T.authConfigMissing}</p>`;
    }
    showLoginScreen();
  }

  function showLoginScreen() {
    const authEl = document.getElementById("auth-screen");
    const appEl = document.getElementById("app");
    if (authEl) authEl.style.display = "";
    if (appEl) appEl.style.display = "none";
  }

  function hideLoginScreen() {
    const authEl = document.getElementById("auth-screen");
    const appEl = document.getElementById("app");
    if (authEl) authEl.style.display = "none";
    if (appEl) appEl.style.display = "";
    const form = document.getElementById("auth-form");
    if (form) form.reset();
    const errEl = document.getElementById("auth-error");
    if (errEl) errEl.classList.remove("show");
  }

  async function signIn(email, password) {
    if (!supabaseClient) return { error: T.authConfigMissing };
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) return { error: mapAuthError(error) };
      return { error: null };
    } catch (e) {
      return { error: mapAuthError(e) };
    }
  }

  async function signOut() {
    if (!supabaseClient) return;
    try {
      await supabaseClient.auth.signOut();
    } catch (e) {
      console.warn("Auth.signOut:", e);
    }
  }

  function bindForm() {
    const form = document.getElementById("auth-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      const errEl = document.getElementById("auth-error");
      const submitBtn = document.getElementById("auth-submit");

      errEl.classList.remove("show");
      submitBtn.disabled = true;
      const prevText = submitBtn.textContent;
      submitBtn.textContent = T.authSigningIn;

      const { error } = await signIn(email, password);

      submitBtn.disabled = false;
      submitBtn.textContent = prevText;
      if (error) {
        errEl.textContent = error;
        errEl.classList.add("show");
      }
      // في حال النجاح، onAuthStateChange سيستدعي المستمعين ويُخفي شاشة الدخول
    });
  }

  function bindLogout() {
    const btn = document.getElementById("btn-logout");
    if (btn) btn.addEventListener("click", () => signOut());
  }

  function onAuthChange(cb) {
    listeners.push(cb);
  }

  // يُنادى مرة واحدة عند الإقلاع؛ يهيئ الاستماع لحالة الجلسة (تُستدعى المستمعات فورا بالحالة الحالية)
  function init() {
    bindForm();
    bindLogout();
    if (!supabaseClient) {
      showConfigMissing();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let resolved = false;
      supabaseClient.auth.onAuthStateChange((_event, session) => {
        currentUser = session ? session.user : null;
        listeners.forEach((cb) => cb(currentUser));
        if (!resolved) {
          resolved = true;
          resolve();
        }
      });
    });
  }

  return {
    init,
    onAuthChange,
    signIn,
    signOut,
    showLoginScreen,
    hideLoginScreen,
    getCurrentUser: () => currentUser
  };
})();
