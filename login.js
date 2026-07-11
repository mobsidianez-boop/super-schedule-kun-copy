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
  const enabledOAuthProviders = new Set();

  init().catch((error) => {
    setStatus(`ログイン画面の準備中にエラーが出ました: ${getErrorText(error)}`, "error");
  });

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
    await refreshOAuthProviderAvailability();

    if (client) {
      client.auth.getSession().then(({ data }) => {
        if (data.session && isEmailVerified(data.session.user)) {
          setStatus("ログイン済みです。アプリへ移動します。", "success");
          window.setTimeout(() => {
            window.location.href = "app.html";
          }, 450);
        }
      }).catch((error) => {
        setStatus(`ログイン状態を確認できませんでした: ${getErrorText(error)}`, "warning");
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
    let data = null;
    let error = null;
    try {
      ({ data, error } = await client.auth.signInWithPassword({ email, password }));
    } catch (caughtError) {
      error = caughtError;
    }
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
    let data = null;
    let error = null;
    try {
      ({ data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: authRedirectUrl },
      }));
    } catch (caughtError) {
      error = caughtError;
    }
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
    let error = null;
    try {
      ({ error } = await client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: authRedirectUrl },
      }));
    } catch (caughtError) {
      error = caughtError;
    }
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
    if (!enabledOAuthProviders.has(provider)) {
      setStatus(`${providerLabels[provider]}ログインはSupabase側でまだ有効化されていません。メールアドレス登録かおためしを使ってください。`, "warning");
      return;
    }

    setStatus(`${providerLabels[provider]}ログインへ移動します。`);
    let error = null;
    try {
      ({ error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: authRedirectUrl,
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
        },
      }));
    } catch (caughtError) {
      error = caughtError;
    }
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

  async function refreshOAuthProviderAvailability() {
    const oauthPanel = oauthButtons.length ? oauthButtons[0].closest(".oauth-actions") : null;
    if (oauthPanel) {
      oauthPanel.hidden = false;
    }
    oauthButtons.forEach((button) => {
      button.disabled = true;
      button.hidden = false;
      button.dataset.providerState = "checking";
      button.title = "ログイン方法を確認しています";
    });
    if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
      markOAuthProvidersUnavailable();
      return;
    }
    try {
      const response = await fetch(`${CONFIG.supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, {
        headers: { apikey: CONFIG.supabaseAnonKey },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const settings = await response.json();
      const external = settings && settings.external ? settings.external : {};
      let hasEnabledProvider = false;
      oauthButtons.forEach((button) => {
        const provider = button.dataset.loginOauth;
        const isEnabled = Boolean(external[provider]);
        hasEnabledProvider = hasEnabledProvider || isEnabled;
        button.disabled = !isEnabled;
        button.hidden = !isEnabled;
        button.dataset.providerState = isEnabled ? "enabled" : "disabled";
        button.title = isEnabled
          ? `${providerLabels[provider]}でログイン`
          : `${providerLabels[provider]}ログインはSupabase側で未設定です`;
        if (isEnabled) {
          enabledOAuthProviders.add(provider);
        } else {
          enabledOAuthProviders.delete(provider);
        }
      });
      if (!hasEnabledProvider) {
        if (oauthPanel) {
          oauthPanel.hidden = true;
        }
        setStatus("メールアドレス登録、またはおためしで予定管理へ進めます。", "muted");
      }
    } catch (error) {
      markOAuthProvidersUnavailable();
      setStatus(`外部ログイン設定を確認できませんでした: ${getErrorText(error)} メールアドレス登録かおためしは使えます。`, "warning");
    }
  }

  function markOAuthProvidersUnavailable() {
    const oauthPanel = oauthButtons.length ? oauthButtons[0].closest(".oauth-actions") : null;
    enabledOAuthProviders.clear();
    oauthButtons.forEach((button) => {
      const provider = button.dataset.loginOauth;
      button.disabled = true;
      button.hidden = true;
      button.dataset.providerState = "disabled";
      button.title = `${providerLabels[provider]}ログインはSupabase側で未設定です`;
    });
    if (oauthPanel) {
      oauthPanel.hidden = true;
    }
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
