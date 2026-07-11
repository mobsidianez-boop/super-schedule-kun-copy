(() => {
  const ACCESS_KEY = "superScheduleKunPlannerAccess";
  const STORAGE_KEY = "superScheduleKunEvents";
  const SUPABASE_CONFIG_KEY = "superScheduleKunSupabaseConfig";
  const ACCESS_CODE = String.fromCharCode(77, 75, 84, 44, 69, 90);
  const DEFAULT_CONFIG = window.SUPER_SCHEDULE_CONFIG || {};
  clearSavedSupabaseConfig();
  const CONFIG = { ...loadSavedSupabaseConfig(), ...DEFAULT_CONFIG };
  const APP_URL = new URL("app.html", window.location.href).href;
  const authRedirectUrl = CONFIG.authRedirectUrl || APP_URL;
  let client = null;

  const form = document.querySelector("#login-auth-form");
  const emailInput = document.querySelector("#login-auth-email");
  const passwordInput = document.querySelector("#login-auth-password");
  const signupButton = document.querySelector("#login-signup-button");
  const resendButton = document.querySelector("#login-resend-button");
  const demoButton = document.querySelector("#login-demo-button");
  const oauthButtons = document.querySelectorAll("[data-login-oauth]");
  const status = document.querySelector("#login-auth-status");
  const supabaseUrlInput = document.querySelector("#login-supabase-url");
  const supabaseKeyInput = document.querySelector("#login-supabase-key");
  const supabaseSaveButton = document.querySelector("#login-supabase-save-button");

  const providerLabels = {
    google: "Google",
    twitter: "X",
    azure: "Microsoft",
    facebook: "Instagram/Meta",
  };

  init();

  async function init() {
    client = await getSupabaseClient();

    if (supabaseUrlInput) {
      supabaseUrlInput.value = CONFIG.supabaseUrl || "";
    }
    if (supabaseKeyInput) {
      supabaseKeyInput.value = CONFIG.supabaseAnonKey || "";
    }

    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        loginWithPassword();
      });
    }
    if (signupButton) {
      signupButton.addEventListener("click", signupWithEmail);
    }
    if (resendButton) {
      resendButton.addEventListener("click", resendConfirmation);
    }
    if (demoButton) {
      demoButton.addEventListener("click", startDemo);
    }
    if (supabaseSaveButton) {
      supabaseSaveButton.addEventListener("click", saveSupabaseSettings);
    }
    oauthButtons.forEach((button) => {
      button.addEventListener("click", () => loginWithOAuth(button.dataset.loginOauth));
    });

    if (client) {
      client.auth.getSession().then(({ data }) => {
        if (data.session && isEmailVerified(data.session.user)) {
          setStatus("ログイン済みです。アプリへ移動します。", "success");
          window.setTimeout(() => {
            window.location.href = "app.html";
          }, 450);
        }
      });
    } else {
      setStatus("ログイン機能の接続準備ができていません。おためしはこのまま使えます。", "warning");
    }
  }

  async function getSupabaseClient() {
    if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
      return null;
    }
    for (let index = 0; index < 30; index += 1) {
      if (window.supabase && typeof window.supabase.createClient === "function") {
        return window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
      }
      await delay(100);
    }
    return null;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function loginWithPassword() {
    if (!client) {
      setStatus("ログイン機能に接続できません。時間を置いてもう一度試してください。", "error");
      return;
    }
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setStatus("メールアドレスとパスワードを入力してください。", "warning");
      return;
    }

    setStatus("ログインしています。");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(`ログインできませんでした: ${getErrorText(error)}`, "error");
      return;
    }
    if (!isEmailVerified(data && data.session && data.session.user)) {
      await client.auth.signOut();
      setStatus("メール認証が終わっていません。届いた確認メールのリンクを開いてからログインしてください。", "error");
      return;
    }
    setStatus("ログインできました。アプリへ移動します。", "success");
    window.location.href = "app.html";
  }

  async function signupWithEmail() {
    if (!client) {
      setStatus("ログイン機能に接続できません。時間を置いてもう一度試してください。", "error");
      return;
    }
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setStatus("メールアドレスとパスワードを入力してください。", "warning");
      return;
    }

    setStatus("登録しています。");
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: authRedirectUrl },
    });
    if (error) {
      setStatus(`登録できませんでした: ${getErrorText(error)}`, "error");
      return;
    }
    if (data.session) {
      await client.auth.signOut();
    }
    setStatus("確認メールを送りました。メール内のリンクを開いてからログインしてください。", "success");
  }

  async function resendConfirmation() {
    if (!client) {
      setStatus("ログイン機能に接続できません。時間を置いてもう一度試してください。", "error");
      return;
    }
    const email = emailInput.value.trim();
    if (!email) {
      setStatus("確認メールを送るメールアドレスを入力してください。", "warning");
      return;
    }

    setStatus("確認メールを再送しています。");
    const { error } = await client.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: authRedirectUrl },
    });
    if (error) {
      setStatus(`確認メールを送れませんでした: ${getErrorText(error)}`, "error");
      return;
    }
    setStatus("確認メールを再送しました。", "success");
  }

  async function loginWithOAuth(provider) {
    if (!client) {
      setStatus("ログイン機能に接続できません。時間を置いてもう一度試してください。", "error");
      return;
    }
    if (!providerLabels[provider]) {
      setStatus("このログイン方法には対応していません。", "error");
      return;
    }

    setStatus(`${providerLabels[provider]}ログインへ移動します。`);
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: authRedirectUrl,
        queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
      },
    });
    if (error) {
      setStatus(`${providerLabels[provider]}ログインを開始できませんでした: ${getErrorText(error)}`, "error");
    }
  }

  function startDemo() {
    sessionStorage.setItem(ACCESS_KEY, ACCESS_CODE);
    sessionStorage.removeItem(`${STORAGE_KEY}:test`);
    localStorage.removeItem(`${STORAGE_KEY}:test`);
    setStatus("おためし版を開きます。", "success");
    window.location.href = "app.html";
  }

  async function saveSupabaseSettings() {
    const supabaseUrl = normalizeSupabaseUrl(supabaseUrlInput && supabaseUrlInput.value);
    const supabaseAnonKey = String(supabaseKeyInput && supabaseKeyInput.value || "").trim();
    if (!supabaseUrl || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
      setStatus("Project URLは https://xxxx.supabase.co の形で入力してください。", "error");
      return;
    }
    if (!supabaseAnonKey || !/^(sb_publishable_|eyJ)/.test(supabaseAnonKey)) {
      setStatus("公開キーを入力してください。秘密鍵やservice_roleキーは入れないでください。", "error");
      return;
    }

    setStatus("Supabase接続を確認しています。");
    try {
      const health = await fetch(`${supabaseUrl}/auth/v1/health`, {
        headers: { apikey: supabaseAnonKey },
        cache: "no-store",
      });
      if (!health.ok) {
        throw new Error(`HTTP ${health.status}`);
      }
      localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ supabaseUrl, supabaseAnonKey }));
      setStatus("Supabase接続設定を保存しました。ページを読み込み直します。", "success");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setStatus(`Supabaseに接続できませんでした: ${getErrorText(error)}`, "error");
    }
  }

  function loadSavedSupabaseConfig() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SUPABASE_CONFIG_KEY) || "{}");
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return {
        supabaseUrl: typeof parsed.supabaseUrl === "string" ? parsed.supabaseUrl : "",
        supabaseAnonKey: typeof parsed.supabaseAnonKey === "string" ? parsed.supabaseAnonKey : "",
      };
    } catch {
      return {};
    }
  }

  function clearSavedSupabaseConfig() {
    try {
      localStorage.removeItem(SUPABASE_CONFIG_KEY);
    } catch {
      // Ignore storage access failures; the bundled app config is enough.
    }
  }

  function normalizeSupabaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function isEmailVerified(user) {
    return Boolean(user && (user.email_confirmed_at || user.confirmed_at));
  }

  function getErrorText(error) {
    if (!error) {
      return "原因不明のエラーです";
    }
    const message = error.message || error.details || String(error);
    if (/failed to fetch|fetch failed|network|load failed/i.test(message)) {
      return "Supabaseに接続できませんでした。Project URL、公開キー、プロジェクト状態を確認してください。";
    }
    return message;
  }

  function setStatus(message, tone = "muted") {
    if (!status) {
      return;
    }
    status.textContent = message;
    status.dataset.tone = tone;
  }
})();
