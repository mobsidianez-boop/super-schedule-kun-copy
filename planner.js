(() => {
  const STORAGE_KEY = "superScheduleKunEvents";
  const ACCESS_KEY = "superScheduleKunPlannerAccess";
  const SUPABASE_CONFIG_KEY = "superScheduleKunSupabaseConfig";
  const CLOUD_EVENTS_TABLE = "events";
  const ACCESS_CODE = String.fromCharCode(77, 75, 84, 44, 69, 90);
  const DAY_START = 8 * 60;
  const DAY_END = 22 * 60;
  const CONFIG = { ...(window.SUPER_SCHEDULE_CONFIG || {}), ...loadSavedSupabaseConfig() };
  const plannerSupabase = window.supabase && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey
    ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
    : null;

  const plannerGate = document.querySelector("#planner-gate");
  const plannerApp = document.querySelector("#planner-app");
  const plannerAuthForm = document.querySelector("#planner-auth-form");
  const plannerAuthEmail = document.querySelector("#planner-auth-email");
  const plannerAuthPassword = document.querySelector("#planner-auth-password");
  const plannerSignupButton = document.querySelector("#planner-signup-button");
  const plannerResendButton = document.querySelector("#planner-resend-button");
  const plannerOauthButtons = document.querySelectorAll("[data-planner-oauth]");
  const plannerAccessCode = document.querySelector("#planner-access-code");
  const plannerCodeButton = document.querySelector("#planner-code-button");
  const plannerDemoButton = document.querySelector("#planner-demo-button");
  const plannerSupabaseUrlInput = document.querySelector("#planner-supabase-url");
  const plannerSupabaseKeyInput = document.querySelector("#planner-supabase-key");
  const plannerSupabaseSaveButton = document.querySelector("#planner-supabase-save-button");
  const plannerLogoutButton = document.querySelector("#planner-logout-button");
  const plannerAuthStatus = document.querySelector("#planner-auth-status");
  const form = document.querySelector("#event-form");
  const titleInput = document.querySelector("#event-title");
  const dateInput = document.querySelector("#event-date");
  const startInput = document.querySelector("#event-start");
  const endInput = document.querySelector("#event-end");
  const locationInput = document.querySelector("#event-location");
  const travelInput = document.querySelector("#event-travel");
  const clearButton = document.querySelector("#clear-events-button");
  const detectForm = document.querySelector("#detect-form");
  const detectText = document.querySelector("#detect-text");
  const ocrImageInput = document.querySelector("#ocr-image");
  const ocrPreview = document.querySelector("#ocr-preview");
  const ocrPreviewImage = document.querySelector("#ocr-preview-image");
  const ocrStatus = document.querySelector("#ocr-status");
  const ocrProgress = document.querySelector("#ocr-progress");
  const candidateBox = document.querySelector("#candidate-box");
  const candidateTitle = document.querySelector("#candidate-title");
  const candidateMeta = document.querySelector("#candidate-meta");
  const candidatePlace = document.querySelector("#candidate-place");
  const candidateAddButton = document.querySelector("#candidate-add-button");
  const viewDateInput = document.querySelector("#view-date");
  const summary = document.querySelector("#planner-summary");
  const locateRoutesButton = document.querySelector("#locate-routes-button");
  const routeStatus = document.querySelector("#route-status");
  const mapContainer = document.querySelector("#planner-map");
  const routeList = document.querySelector("#route-list");
  const scheduleTable = document.querySelector("#schedule-table");
  const scheduleTableStatus = document.querySelector("#schedule-table-status");
  const scheduleFloating = document.querySelector("#schedule-floating");
  const allEventsList = document.querySelector("#all-events-list");
  const timelineBoard = document.querySelector("#timeline-board");
  const freeTimeList = document.querySelector("#free-time-list");

  if (!form || !timelineBoard) {
    return;
  }

  let events = [];
  let detectedCandidate = null;
  let plannerUnlocked = false;
  let plannerStorageMode = "locked";
  let plannerUserId = "";
  let plannerCloudWarningShown = false;
  let cloudSyncTimer = null;
  let cloudSyncInFlight = false;
  let lastDetectMessage = "";
  const notificationTimers = new Map();
  let plannerMap = null;
  let overviewMarker = null;
  let currentMarker = null;
  let eventMarkers = [];
  let routeLines = [];
  let currentPosition = null;
  let locationWatchId = null;
  let activeRouteEventId = "";
  let expiredNotice = "";
  let animatedEventId = "";
  let expirySweepId = null;
  const placeLookupIds = new Set();

  const today = toDateInputValue(new Date());
  dateInput.value = today;
  viewDateInput.value = today;
  setDefaultEventDateTime();
  attachActionAnimations();
  initSupabaseSettingsForm();
  initPlannerAccess();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ensurePlannerAccess()) {
      return;
    }
    const permissionPromise = plannerStorageMode === "test" ? Promise.resolve("test") : prepareNotificationPermission();
    const nextEvent = await readFormEvent();
    if (!nextEvent) {
      return;
    }
    pruneExpiredEvents({ silent: true });
    events = [nextEvent, ...events];
    animatedEventId = nextEvent.id;
    saveEvents();
    if (events.some((item) => item.id === nextEvent.id)) {
      scheduleEventNotification(nextEvent, permissionPromise);
      enrichEventPlaceInBackground(nextEvent);
    }
    viewDateInput.value = nextEvent.date;
    form.reset();
    setDefaultEventDateTime(nextEvent.date);
    render();
  });

  clearButton.addEventListener("click", () => {
    if (!ensurePlannerAccess()) {
      return;
    }
    if (!events.length) {
      return;
    }
    const ok = window.confirm("保存済みの予定をすべて削除しますか？");
    if (!ok) {
      return;
    }
    events = [];
    expiredNotice = "";
    saveEvents();
    clearNotificationTimers();
    render();
  });

  viewDateInput.addEventListener("change", () => {
    if (!plannerUnlocked) {
      return;
    }
    activeRouteEventId = "";
    render();
    renderRouteList([]);
    setRouteStatus("予定場所を地図に表示しています。場所をタッチすると現在地からの移動経路を確認できます。");
  });

  detectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ensurePlannerAccess()) {
      return;
    }
    await makeCandidateFromText();
  });

  if (ocrImageInput) {
    ocrImageInput.addEventListener("change", (event) => {
      if (!ensurePlannerAccess()) {
        event.target.value = "";
        return;
      }
      handleImageSelection();
    });
  }

  if (locateRoutesButton) {
    locateRoutesButton.addEventListener("click", () => {
      if (!ensurePlannerAccess()) {
        return;
      }
      handleRouteLookup();
    });
  }

  candidateAddButton.addEventListener("click", () => {
    addDetectedCandidate();
  });

  function addDetectedCandidate() {
    if (!ensurePlannerAccess()) {
      return;
    }
    if (!detectedCandidate) {
      return;
    }
    const permissionPromise = plannerStorageMode === "test" ? Promise.resolve("test") : prepareNotificationPermission();
    const nextEvent = { ...detectedCandidate, id: createId(), createdAt: new Date().toISOString() };
    events = [nextEvent, ...events];
    animatedEventId = nextEvent.id;
    pruneExpiredEvents();
    saveEvents();
    if (events.some((item) => item.id === nextEvent.id)) {
      scheduleEventNotification(nextEvent, permissionPromise);
      enrichEventPlaceInBackground(nextEvent);
    }
    viewDateInput.value = detectedCandidate.date;
    detectText.value = "";
    detectedCandidate = null;
    candidateBox.hidden = true;
    render();
  }

  if (plannerAuthForm) {
    plannerAuthForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await loginPlanner();
    });
  }

  if (plannerSignupButton) {
    plannerSignupButton.addEventListener("click", signupPlanner);
  }

  if (plannerResendButton) {
    plannerResendButton.addEventListener("click", resendPlannerConfirmation);
  }

  plannerOauthButtons.forEach((button) => {
    button.addEventListener("click", () => loginPlannerWithOAuth(button.dataset.plannerOauth));
  });

  if (plannerCodeButton) {
    plannerCodeButton.addEventListener("click", unlockWithCode);
  }

  if (plannerDemoButton) {
    plannerDemoButton.addEventListener("click", unlockDemoMode);
  }

  if (plannerSupabaseSaveButton) {
    plannerSupabaseSaveButton.addEventListener("click", saveSupabaseSettings);
  }

  if (plannerLogoutButton) {
    plannerLogoutButton.addEventListener("click", logoutPlanner);
  }

  window.addEventListener("pagehide", () => {
    if (plannerStorageMode === "test") {
      clearTestSession();
    }
  });

  function attachActionAnimations() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("button, .button, .timeline-delete, .schedule-event, .route-list li[role='button']");
      if (!target) {
        return;
      }
      animateElement(target, "action-pop", 420);
    });
  }

  function animateGate(className) {
    if (plannerGate) {
      animateElement(plannerGate, className, 520);
    }
  }

  function animateElement(element, className, duration = 520) {
    if (!element || !element.classList) {
      return;
    }
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration);
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

  function initSupabaseSettingsForm() {
    if (plannerSupabaseUrlInput) {
      plannerSupabaseUrlInput.value = CONFIG.supabaseUrl || "";
    }
    if (plannerSupabaseKeyInput) {
      plannerSupabaseKeyInput.value = CONFIG.supabaseAnonKey || "";
    }
  }

  async function saveSupabaseSettings() {
    const supabaseUrl = normalizeSupabaseUrl(plannerSupabaseUrlInput && plannerSupabaseUrlInput.value);
    const supabaseAnonKey = String(plannerSupabaseKeyInput && plannerSupabaseKeyInput.value || "").trim();
    if (!supabaseUrl || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
      setPlannerAuthStatus("SupabaseのProject URLは https://xxxx.supabase.co の形で入力してください。", "error");
      animateGate("gate-shake");
      return;
    }
    if (!supabaseAnonKey || !/^(sb_publishable_|eyJ)/.test(supabaseAnonKey)) {
      setPlannerAuthStatus("Supabaseの公開キーを入力してください。service_roleキーは入れないでください。", "error");
      animateGate("gate-shake");
      return;
    }

    setPlannerAuthStatus("Supabase接続を確認しています。");
    try {
      const health = await fetch(`${supabaseUrl}/auth/v1/health`, {
        headers: { apikey: supabaseAnonKey },
        cache: "no-store",
      });
      if (!health.ok) {
        throw new Error(`HTTP ${health.status}`);
      }
      localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ supabaseUrl, supabaseAnonKey }));
      setPlannerAuthStatus("Supabase接続設定を保存しました。ページを再読み込みします。", "success");
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setPlannerAuthStatus(`Supabaseに接続できませんでした: ${getErrorText(error)} 正しいProject URLか確認してください。`, "error");
      animateGate("gate-shake");
    }
  }

  function normalizeSupabaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  async function initPlannerAccess() {
    lockPlanner();

    if (!plannerSupabase) {
      if (sessionStorage.getItem(ACCESS_KEY) === ACCESS_CODE) {
        unlockPlanner("開発者テストモードで開いています。", { mode: "test" });
        return;
      }
      setPlannerAuthStatus("ログイン機能を読み込めませんでした。コードなしのおためしでも開けます。", "warning");
      return;
    }

    plannerSupabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        if (isEmailVerified(session.user)) {
          unlockPlanner("ログイン中です。予定管理を使えます。", { mode: "user", session });
        } else {
          await plannerSupabase.auth.signOut();
          lockPlanner();
          setPlannerAuthStatus("メール確認が終わっていません。届いた確認メールのリンクを開いてからログインしてください。", "warning");
        }
      } else if (sessionStorage.getItem(ACCESS_KEY) !== ACCESS_CODE) {
        lockPlanner();
      }
    });

    const { data } = await plannerSupabase.auth.getSession();
    if (data.session) {
      if (!isEmailVerified(data.session.user)) {
        await plannerSupabase.auth.signOut();
        setPlannerAuthStatus("メール確認が終わっていません。届いた確認メールのリンクを開いてからログインしてください。", "warning");
        return;
      }
      unlockPlanner("ログイン中です。予定管理を使えます。", { mode: "user", session: data.session });
      return;
    }

    if (sessionStorage.getItem(ACCESS_KEY) === ACCESS_CODE) {
      unlockPlanner("開発者テストモードで開いています。", { mode: "test" });
    }
  }

  async function loginPlanner() {
    const email = plannerAuthEmail.value.trim();
    const password = plannerAuthPassword.value;
    if (!email || !password) {
      setPlannerAuthStatus("メールアドレスとパスワードを入力してください。", "warning");
      animateGate("gate-shake");
      return;
    }

    setPlannerAuthStatus("ログインしています。");
    let data = null;
    let error = null;
    if (plannerSupabase) {
      try {
        ({ data, error } = await plannerSupabase.auth.signInWithPassword({ email, password }));
      } catch (caughtError) {
        error = caughtError;
      }
      if (isFetchFailure(error)) {
        const fallback = await signInPlannerViaRest(email, password);
        data = fallback.data;
        error = fallback.error;
      }
    } else {
      error = new Error("Supabase client is unavailable");
    }
    if (error) {
      setPlannerAuthStatus(`ログインできませんでした: ${getErrorText(error)}`, "error");
      animateGate("gate-shake");
      return;
    }
    if (!isEmailVerified(data && data.session && data.session.user)) {
      if (plannerSupabase) {
        await plannerSupabase.auth.signOut();
      }
      setPlannerAuthStatus("メール確認が終わっていません。届いた確認メールのリンクを開いてからログインしてください。", "error");
      animateGate("gate-shake");
      return;
    }
    if (data && data.session) {
      unlockPlanner("ログイン中です。予定管理を使えます。", { mode: "user", session: data.session });
    }
  }

  async function loginPlannerWithOAuth(provider) {
    if (!plannerSupabase) {
      setPlannerAuthStatus("Supabase接続設定が必要です。Project URLと公開キーを保存してから試してください。", "error");
      animateGate("gate-shake");
      return;
    }
    const providerLabels = {
      google: "Google",
      twitter: "X",
      azure: "Microsoft",
      facebook: "Instagram/Meta",
    };
    if (!providerLabels[provider]) {
      setPlannerAuthStatus("このログイン方法には対応していません。", "error");
      animateGate("gate-shake");
      return;
    }

    setPlannerAuthStatus(`${providerLabels[provider]}ログインへ移動します。`);
    try {
      const { error } = await plannerSupabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: CONFIG.authRedirectUrl || window.location.href,
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined,
        },
      });
      if (error) {
        setPlannerAuthStatus(`${providerLabels[provider]}ログインを開始できませんでした: ${getErrorText(error)}`, "error");
        animateGate("gate-shake");
      }
    } catch (error) {
      setPlannerAuthStatus(`${providerLabels[provider]}ログインを開始できませんでした: ${getErrorText(error)}`, "error");
      animateGate("gate-shake");
    }
  }

  async function signupPlanner() {
    const email = plannerAuthEmail.value.trim();
    const password = plannerAuthPassword.value;
    if (!email || !password) {
      setPlannerAuthStatus("メールアドレスとパスワードを入力してください。", "warning");
      animateGate("gate-shake");
      return;
    }

    setPlannerAuthStatus("登録しています。");
    let data = null;
    let error = null;
    if (plannerSupabase) {
      try {
        ({ data, error } = await plannerSupabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: CONFIG.authRedirectUrl || window.location.href,
          },
        }));
      } catch (caughtError) {
        error = caughtError;
      }
      if (isFetchFailure(error)) {
        const fallback = await signupPlannerViaRest(email, password);
        data = fallback.data;
        error = fallback.error;
      }
    } else {
      error = new Error("Supabase client is unavailable");
    }

    if (error) {
      setPlannerAuthStatus(`登録できませんでした: ${getErrorText(error)}`, "error");
      animateGate("gate-shake");
      return;
    }

    if (data && data.session) {
      await plannerSupabase.auth.signOut();
    }

    setPlannerAuthStatus("確認メールを送信しました。メール内のリンクを開いてからログインしてください。", "success");
  }

  async function signInPlannerViaRest(email, password) {
    try {
      const response = await authFetch("/token", {
        search: { grant_type: "password" },
        body: { email, password },
      });
      if (!response.ok) {
        return { data: null, error: await readAuthError(response) };
      }
      const session = await response.json();
      if (session.access_token && session.refresh_token && plannerSupabase) {
        await plannerSupabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        });
      }
      return { data: { session }, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async function signupPlannerViaRest(email, password) {
    try {
      const response = await authFetch("/signup", {
        search: { redirect_to: CONFIG.authRedirectUrl || window.location.href },
        body: { email, password, data: {} },
      });
      if (!response.ok) {
        return { data: null, error: await readAuthError(response) };
      }
      const result = await response.json();
      if (result.access_token && result.refresh_token && plannerSupabase) {
        await plannerSupabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });
        return { data: { session: result }, error: null };
      }
      return { data: { session: null, user: result.user || result }, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  async function authFetch(path, options = {}) {
    const url = new URL(`${CONFIG.supabaseUrl.replace(/\/$/, "")}/auth/v1${path}`);
    Object.entries(options.search || {}).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, value);
      }
    });
    return fetch(url.toString(), {
      method: "POST",
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options.body || {}),
    });
  }

  async function resendPlannerConfirmation() {
    if (!plannerSupabase) {
      setPlannerAuthStatus("確認メールを送れませんでした。Supabaseの接続設定を確認してください。", "error");
      animateGate("gate-shake");
      return;
    }
    const email = plannerAuthEmail.value.trim();
    if (!email) {
      setPlannerAuthStatus("確認メールを再送するメールアドレスを入力してください。", "warning");
      animateGate("gate-shake");
      return;
    }
    setPlannerAuthStatus("確認メールを再送しています。");
    let error = null;
    try {
      ({ error } = await plannerSupabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: CONFIG.authRedirectUrl || window.location.href,
        },
      }));
    } catch (caughtError) {
      error = caughtError;
    }
    if (isFetchFailure(error)) {
      error = await resendPlannerConfirmationViaRest(email);
    }
    if (error) {
      setPlannerAuthStatus(`確認メールを再送できませんでした: ${getErrorText(error)}`, "error");
      animateGate("gate-shake");
      return;
    }
    setPlannerAuthStatus("確認メールを再送しました。メール内のリンクを開いてからログインしてください。", "success");
  }

  async function resendPlannerConfirmationViaRest(email) {
    try {
      const response = await authFetch("/resend", {
        body: {
          type: "signup",
          email,
          options: {
            email_redirect_to: CONFIG.authRedirectUrl || window.location.href,
          },
        },
      });
      return response.ok ? null : await readAuthError(response);
    } catch (error) {
      return error;
    }
  }

  function isEmailVerified(user) {
    return Boolean(user && (user.email_confirmed_at || user.confirmed_at));
  }

  async function readAuthError(response) {
    try {
      const body = await response.json();
      return new Error(body.msg || body.message || body.error_description || body.error || `HTTP ${response.status}`);
    } catch {
      return new Error(`HTTP ${response.status}`);
    }
  }

  function getRawErrorText(error) {
    if (!error) {
      return "";
    }
    return error.message || error.details || String(error);
  }

  function isFetchFailure(error) {
    return Boolean(error && /failed to fetch|fetch failed|network|load failed/i.test(getRawErrorText(error)));
  }

  function unlockWithCode() {
    if (plannerAccessCode.value.trim() !== ACCESS_CODE) {
      setPlannerAuthStatus("テストコードが違います。", "error");
      animateGate("gate-shake");
      return;
    }
    sessionStorage.setItem(ACCESS_KEY, ACCESS_CODE);
    unlockPlanner("開発者テストモードで開いています。", { mode: "test" });
  }

  function unlockDemoMode() {
    sessionStorage.setItem(ACCESS_KEY, ACCESS_CODE);
    clearTestSession({ keepAccess: true });
    unlockPlanner("おためしモードで開いています。通知は使わず、閉じると予定は消えます。", { mode: "test" });
  }

  function clearTestSession(options = {}) {
    sessionStorage.removeItem(`${STORAGE_KEY}:test`);
    localStorage.removeItem(`${STORAGE_KEY}:test`);
    if (!options.keepAccess) {
      sessionStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(ACCESS_KEY);
    }
  }

  function lockPlanner() {
    plannerUnlocked = false;
    plannerStorageMode = "locked";
    plannerUserId = "";
    plannerCloudWarningShown = false;
    events = [];
    if (plannerGate) {
      plannerGate.classList.remove("gate-unlock", "gate-shake");
      plannerGate.hidden = false;
    }
    if (plannerApp) {
      plannerApp.classList.remove("app-reveal");
      plannerApp.hidden = true;
    }
    if (plannerLogoutButton) {
      plannerLogoutButton.hidden = true;
    }
    setPlannerAuthStatus("予定管理はログイン後に使えます。", "warning");
  }

  async function unlockPlanner(message, options = {}) {
    plannerUnlocked = true;
    plannerStorageMode = options.mode === "user" ? "user" : "test";
    plannerUserId = options.session && options.session.user ? options.session.user.id : "";
    plannerCloudWarningShown = false;
    if (plannerStorageMode === "user") {
      await loadUserEvents(options.session);
    } else {
      events = loadEvents(getLocalEventsKey());
    }
    if (plannerGate) {
      animateElement(plannerGate, "gate-unlock", 520);
      window.setTimeout(() => {
        if (plannerUnlocked && plannerGate) {
          plannerGate.hidden = true;
        }
      }, 360);
    }
    if (plannerApp) {
      plannerApp.hidden = false;
      animateElement(plannerApp, "app-reveal", 620);
    }
    if (plannerLogoutButton) {
      plannerLogoutButton.hidden = false;
    }
    if (!plannerCloudWarningShown) {
      setPlannerAuthStatus(message, "success");
    }
    pruneExpiredEvents();
    render();
    initializeMapOverview();
    startCurrentLocationTracking();
    startExpirySweep();
    scheduleUpcomingNotifications();
  }

  async function logoutPlanner() {
    if (cloudSyncTimer !== null) {
      window.clearTimeout(cloudSyncTimer);
      cloudSyncTimer = null;
    }
    const shouldClearTestEvents = plannerStorageMode === "test";
    const testEventsKey = shouldClearTestEvents ? getLocalEventsKey() : "";
    if (plannerStorageMode === "user") {
      await syncCloudEventsNow();
    }
    if (plannerSupabase) {
      await plannerSupabase.auth.signOut();
    }
    if (shouldClearTestEvents && testEventsKey) {
      events = [];
    }
    if (shouldClearTestEvents) {
      clearTestSession();
    } else {
      sessionStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(ACCESS_KEY);
    }
    stopPlannerRuntime();
    lockPlanner();
    setPlannerAuthStatus("ログアウトしました。もう一度使うにはログインしてください。", "success");
  }

  function stopPlannerRuntime() {
    clearNotificationTimers();
    if (expirySweepId !== null) {
      window.clearInterval(expirySweepId);
      expirySweepId = null;
    }
    if (locationWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchId);
      locationWatchId = null;
    }
    clearMapLayers();
    activeRouteEventId = "";
    currentPosition = null;
    renderRouteList([]);
  }

  function startExpirySweep() {
    if (expirySweepId !== null) {
      window.clearInterval(expirySweepId);
    }
    expirySweepId = window.setInterval(() => {
      if (!plannerUnlocked) {
        return;
      }
      const removed = pruneExpiredEvents();
      if (removed) {
        const notice = expiredNotice || "終了済みの予定を自動削除しました。";
        render();
        renderRouteList([]);
        setRouteStatus(notice);
      } else {
        renderScheduleTable(getSelectedDayEvents(), viewDateInput.value || today);
      }
    }, 60 * 1000);
  }

  function ensurePlannerAccess() {
    if (plannerUnlocked) {
      return true;
    }
    setPlannerAuthStatus("先にログインしてください。", "warning");
    if (plannerGate) {
      plannerGate.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return false;
  }

  function setPlannerAuthStatus(message, tone = "muted") {
    if (!plannerAuthStatus) {
      return;
    }
    plannerAuthStatus.textContent = message;
    plannerAuthStatus.dataset.tone = tone;
  }

  async function readFormEvent() {
    const title = cleanText(titleInput.value, 48);
    const date = dateInput.value;
    const start = startInput.value;
    const end = endInput.value;
    let location = cleanText(locationInput.value, 48);
    const travelMinutes = clampNumber(travelInput.value, 0, 240);

    if (!title || !date || !start || !end) {
      showSummary("予定名・日付・開始・終了を入力してください。");
      return null;
    }

    if (timeToMinutes(end) <= timeToMinutes(start)) {
      showSummary("終了時刻は開始時刻より後にしてください。");
      return null;
    }

    if (isEventEnded({ date, start, end })) {
      showSummary("終了済みの予定は自動削除対象になるため追加できません。これからの日時にしてもう一度追加してください。");
      return null;
    }

    let locationConfirmed = false;
    if (!location) {
      const inferredLocation = inferLocationFromTitle(title);
      if (inferredLocation && window.confirm(`予定名から「${inferredLocation}」を場所として検出しました。この予定の場所ですか？`)) {
        location = inferredLocation;
        locationConfirmed = true;
      }
    }

    const event = {
      id: createId(),
      title,
      date,
      start,
      end,
      location,
      travelMinutes,
      createdAt: new Date().toISOString(),
    };

    if (locationConfirmed) {
      event.placePending = true;
    } else if (location) {
      const confirmed = window.confirm(`「${location}」はこの予定の場所ですか？`);
      if (confirmed) {
        event.placePending = true;
      }
    }

    return event;
  }

  function detectSchedule(rawText) {
    const preparedText = prepareScheduleSource(rawText);
    const text = cleanText(normalizeScheduleText(preparedText), 420);
    if (!text) {
      setDetectMessage("候補にしたい文章を入力してください。");
      return null;
    }

    const scheduleText = pickScheduleText(preparedText);
    if (!scheduleText) {
      setDetectMessage("予定に関する日時や用事が見つかりませんでした。予定が書かれた部分だけを貼り付けてください。");
      return null;
    }

    const base = new Date();
    const detectedDate = detectDate(scheduleText, base);
    const detectedRange = detectTimeRange(scheduleText);
    const detectedStart = detectedRange.start || detectTime(scheduleText);
    if (!detectedDate && !detectedStart) {
      setDetectMessage("予定の候補には日付か時刻が必要です。例: 明日18:30 渋谷で打ち合わせ");
      return null;
    }

    const date = detectedDate || toDateInputValue(base);
    const start = detectedStart || "10:00";
    const startMinutes = timeToMinutes(start);
    const end = detectedRange.end || minutesToTime(Math.min(startMinutes + 60, 23 * 60 + 59));
    const detectedLocation = detectLocation(scheduleText);
    let title = detectTitle(scheduleText, detectedLocation);
    const location = detectedLocation || inferLocationFromTitle(title);
    title = normalizeDetectedTitle(title, location, scheduleText);
    if (!title || title === location) {
      setDetectMessage("用事の名前を検出できませんでした。日時と用事名が分かる文章で試してください。");
      return null;
    }

    lastDetectMessage = "";
    return {
      title,
      date,
      start,
      end,
      location,
      travelMinutes: location ? 30 : 0,
      inferredDate: !detectedDate,
      inferredTime: !detectedStart,
    };
  }

  function prepareScheduleSource(rawText) {
    const lines = getUsefulMessageLines(rawText);
    if (!lines.length) {
      return cleanOcrText(rawText);
    }

    const windows = [];
    lines.forEach((line, index) => {
      windows.push(line);
      if (index + 1 < lines.length) {
        windows.push(`${line} ${lines[index + 1]}`);
      }
      if (index + 2 < lines.length) {
        windows.push(`${line} ${lines[index + 1]} ${lines[index + 2]}`);
      }
    });

    const best = windows
      .map((line) => ({ line, score: scoreScheduleLine(normalizeScheduleText(line)) }))
      .filter((item) => item.score >= 3)
      .sort((a, b) => b.score - a.score || a.line.length - b.line.length)[0];

    return best ? best.line : lines.join("\n");
  }

  function getUsefulMessageLines(rawText) {
    return String(rawText || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => normalizeMessageLine(line))
      .filter((line) => line && !isChatNoiseLine(line));
  }

  function normalizeMessageLine(line) {
    return String(line || "")
      .replace(/[|｜]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[\s:：・･、。]+|[\s:：・･、。]+$/g, "")
      .trim();
  }

  function isChatNoiseLine(line) {
    const value = normalizeScheduleText(line);
    if (!value) return true;
    if (/^(既読|未読|送信中|昨日|今日|明日|写真|画像|動画|スタンプ|アルバム|ノート|通話|不在着信|メッセージを入力|LINE)$/i.test(value)) return true;
    if (/^(OK|Ok|ok|了解|りょ|うん|はい|よろしく|ありがとう|ありがと|助かる|またね|おつかれ|お疲れ|笑|w|www)$/i.test(value)) return true;
    if (/^(午前|午後)?\s*\d{1,2}[:：]\d{2}$/.test(value)) return true;
    if (/^\d{1,2}[:：]\d{2}\s*(既読)?$/.test(value)) return true;
    if (/^(月|火|水|木|金|土|日|\d{1,2}\/\d{1,2})$/.test(value)) return true;
    if (/^https?:\/\//i.test(value)) return true;
    if (/^[^\d]{1,8}$/.test(value) && !hasEventWord(value) && !detectLocation(value)) return true;
    return false;
  }

  function pickScheduleText(text) {
    const source = prepareScheduleSource(text);
    const lines = source
      .split(/[\n。！？!?]/)
      .map((line) => normalizeScheduleText(line).trim())
      .filter(Boolean);
    const candidates = lines.length > 1 ? [normalizeScheduleText(source), ...lines] : [normalizeScheduleText(source)];

    const scored = candidates
      .map((line) => ({ line, score: scoreScheduleLine(line) }))
      .filter((item) => item.score >= 3)
      .sort((a, b) => b.score - a.score);

    return scored[0] ? scored[0].line : "";
  }

  function scoreScheduleLine(line) {
    let score = 0;
    if (hasDateSignal(line)) score += 2;
    if (hasTimeSignal(line)) score += 2;
    if (hasEventWord(line)) score += 2;
    if (detectLocation(line)) score += 1;
    if (/(行く|いく|行き|集合|集ま|待ち合わせ|予約|開始|から|まで|集合場所|場所|で|に|駅|店|会場|病院|学校|大学|ホテル|カフェ|レストラン|公園|ホール|センター|空港)/.test(line)) score += 1;
    if (/(既読|未読|スタンプ|写真|画像|動画|アルバム|通話|不在着信|メッセージを入力)/.test(line)) score -= 2;
    if (/^(午前|午後)?\s*\d{1,2}[:：]\d{2}$/.test(line)) score -= 3;
    if (line.length >= 6 && (hasDateSignal(line) || hasTimeSignal(line))) score += 1;
    if (/よろしく|ありがとう|お疲れ|確認|返信|添付|画像|スクショ/.test(line)) score -= 1;
    return score;
  }

  function hasDateSignal(text) {
    return /(20\d{2}[\/.\-年]\d{1,2}[\/.\-月]\d{1,2}日?|\d{1,2}[\/.\-]\d{1,2}|\d{1,2}月\d{1,2}日|今日|きょう|明日|あした|明後日|あさって|月曜|火曜|水曜|木曜|金曜|土曜|日曜)/.test(text);
  }

  function hasTimeSignal(text) {
    return /(?:午前|午後)?\s*([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)|(?:午前|午後)?\s*([01]?\d|2[0-3])時(?:([0-5]?\d)分?)?/.test(text);
  }

  function hasEventWord(text) {
    return /(会議|打ち合わせ|ミーティング|面談|面接|予約|集合|待ち合わせ|ランチ|飲み|食事|シフト|授業|講義|試験|テスト|提出|締切|病院|美容院|歯医者|イベント|ライブ|説明会|面会|出勤|退勤|誕生日|パーティー?)/.test(text);
  }

  function normalizeScheduleText(value) {
    let text = String(value || "")
      .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
      .replace(/[：]/g, ":")
      .replace(/[．]/g, ".")
      .replace(/[／]/g, "/")
      .replace(/\s+/g, " ")
      .trim();

    while (/(\d)\s+(?=\d)/.test(text)) {
      text = text.replace(/(\d)\s+(?=\d)/g, "$1");
    }

    while (/([一-龯ぁ-んァ-ヶー])\s+(?=[一-龯ぁ-んァ-ヶー])/.test(text)) {
      text = text.replace(/([一-龯ぁ-んァ-ヶー])\s+(?=[一-龯ぁ-んァ-ヶー])/g, "$1");
    }

    return text
      .replace(/(午前|午後)\s*(\d{1,2})\s*時\s*([0-5]?\d)\s*分/g, "$1$2時$3分")
      .replace(/(\d{1,2})\s*時\s*([0-5]?\d)\s*分/g, "$1時$2分")
      .replace(/(午前|午後)\s*(\d{1,2})\s*時/g, "$1$2時")
      .replace(/(\d{1,2})\s*時/g, "$1時")
      .replace(/(\d)\s*[:.]\s*(\d{2})/g, "$1:$2")
      .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, "$1月$2日")
      .replace(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, "$1年$2月$3日");
  }

  async function handleImageSelection() {
    const file = ocrImageInput.files && ocrImageInput.files[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setOcrStatus("画像ファイルを選択してください。", 0);
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setOcrStatus("画像は8MB以内にしてください。", 0);
      return;
    }

    if (!window.Tesseract) {
      setOcrStatus("OCRライブラリを読み込めませんでした。通信状態を確認してください。", 0);
      return;
    }

    showImagePreview(file);
    setOcrStatus("画像を読み取っています。初回は少し時間がかかります。", 0.02);

    try {
      const ocrSource = await prepareImageForOcr(file);
      const result = await window.Tesseract.recognize(ocrSource, "jpn+eng", {
        logger(message) {
          if (message.status === "recognizing text") {
            setOcrStatus(`文字を読み取り中 ${Math.round(message.progress * 100)}%`, message.progress);
          } else if (message.status) {
            setOcrStatus("OCRを準備しています。", Math.min(Number(message.progress || 0), 0.2));
          }
        },
      });

      const text = cleanOcrText(result.data && result.data.text);
      if (!text) {
        setOcrStatus("文字を検出できませんでした。明るく、文字が大きい画像で試してください。", 0);
        return;
      }

      detectText.value = text;
      setOcrStatus("読み取りました。予定候補を確認しています。", 1);
      await makeCandidateFromText({ offerAutoAdd: true });
    } catch (error) {
      setOcrStatus(`読み取れませんでした: ${getErrorText(error)}`, 0);
    }
  }

  async function makeCandidateFromText(options = {}) {
    detectedCandidate = detectSchedule(detectText.value);
    if (detectedCandidate && detectedCandidate.location) {
      const confirmed = window.confirm(`「${detectedCandidate.location}」はこの予定の場所ですか？`);
      if (confirmed) {
        detectedCandidate.placePending = true;
        showCandidate(detectedCandidate);
        enrichCandidatePlaceInBackground(detectedCandidate);
        return;
      } else {
        detectedCandidate.location = "";
        detectedCandidate.travelMinutes = 0;
      }
    }
    showCandidate(detectedCandidate);
    if (detectedCandidate && options.offerAutoAdd) {
      offerCandidateAutoAdd();
    }
  }

  function offerCandidateAutoAdd() {
    const ok = window.confirm(`画像から予定候補を検出しました。\n「${detectedCandidate.title}」を予定に追加しますか？`);
    if (ok) {
      addDetectedCandidate();
    } else {
      setOcrStatus("候補を作成しました。内容を確認して「この候補を登録」を押してください。", 1);
    }
  }

  async function enrichCandidatePlaceInBackground(candidate) {
    if (!candidate || !candidate.location) {
      return;
    }
    setCandidatePlaceStatus("住所の手がかりと固有名詞から場所候補を探しています。");
    try {
      const place = await confirmPlaceCandidate(candidate.location, candidate);
      if (detectedCandidate === candidate) {
        detectedCandidate = { ...candidate, place, placePending: false };
        showCandidate(detectedCandidate);
      }
    } catch {
      if (detectedCandidate === candidate) {
        detectedCandidate = { ...candidate, placePending: false };
        showCandidate(detectedCandidate);
      }
    }
  }

  function showImagePreview(file) {
    const url = URL.createObjectURL(file);
    ocrPreviewImage.onload = () => URL.revokeObjectURL(url);
    ocrPreviewImage.src = url;
    ocrPreview.hidden = false;
  }

  function setOcrStatus(message, progress) {
    if (!ocrPreview || !ocrStatus || !ocrProgress) {
      showSummary(message);
      return;
    }
    ocrPreview.hidden = false;
    ocrStatus.textContent = message;
    ocrProgress.value = Math.max(0, Math.min(1, Number(progress || 0)));
  }

  async function prepareImageForOcr(file) {
    if (!window.createImageBitmap || !document.createElement) {
      return file;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(3, Math.max(1.4, 2200 / Math.max(bitmap.width, bitmap.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return file;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < image.data.length; index += 4) {
        const gray = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
        const boosted = gray < 148 ? Math.max(0, gray - 28) : Math.min(255, gray + 24);
        image.data[index] = boosted;
        image.data[index + 1] = boosted;
        image.data[index + 2] = boosted;
      }
      context.putImageData(image, 0, 0);
      return canvas;
    } catch {
      return file;
    }
  }

  function cleanOcrText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n")
      .replace(/[ \t]+/g, " ")
      .slice(0, 900);
  }

  function getErrorText(error) {
    if (!error) {
      return "原因不明のエラーです。";
    }
    const message = getRawErrorText(error);
    if (/failed to fetch|fetch failed|network|load failed/i.test(message)) {
      return "Supabaseに接続できませんでした。プロジェクトURL、公開キー、プロジェクトの停止状態、ネットワーク制限を確認してください。";
    }
    return message;
  }

  async function fetchPlaceIntel(location, event) {
    const fallback = {
      query: location,
      displayName: location,
      crowd: estimateCrowd({ display_name: location, type: "" }, event),
      source: "場所検索に失敗したため、地名と時刻だけから作った混雑目安です。",
      fetchedAt: new Date().toISOString(),
    };

    try {
      const candidates = await fetchPlaceCandidates(location, event, 1);
      return candidates[0] || {
        ...fallback,
        source: "座標候補が見つからなかったため、地名と時刻だけから作った混雑目安です。",
      };
    } catch {
      return fallback;
    }
  }

  async function fetchPlaceCandidates(location, event, maxResults = 5) {
    const searchPlan = buildPlaceSearchQueries(location);
    const directCoordinates = parseCoordinatesFromText(location);
    if (directCoordinates) {
      return [makeCoordinatePlaceIntel(location, directCoordinates, event, searchPlan)];
    }
    const results = [];
    const seen = new Set();

    for (const query of searchPlan.queries) {
      const places = await searchPlacesForQuery(query, Math.min(3, Math.max(1, maxResults)));

      places.forEach((place) => {
        const key = `${place.provider || ""}:${place.osm_type || ""}:${place.osm_id || ""}:${place.lat || ""}:${place.lon || ""}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        results.push(makePlaceIntel(location, query, place, event, searchPlan));
      });

      if (maxResults <= 1 && results.length >= maxResults) {
        break;
      }
    }

    return results.slice(0, maxResults);
  }

  function parseCoordinatesFromText(value) {
    let text = String(value || "");
    try {
      text = decodeURIComponent(text);
    } catch {
      // Keep the original text when a shared URL contains malformed escapes.
    }
    const patterns = [
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /[?&]q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /緯度[:：]?\s*(-?\d+(?:\.\d+)?)[,\s、]+経度[:：]?\s*(-?\d+(?:\.\d+)?)/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) {
        continue;
      }
      const lat = Number(match[1]);
      const lon = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return { lat, lon };
      }
    }
    return null;
  }

  function makeCoordinatePlaceIntel(location, coordinates, event, searchPlan) {
    const displayName = `${location}（検出座標）`;
    return {
      query: location,
      searchQuery: location,
      searchParts: searchPlan,
      displayName,
      lat: coordinates.lat,
      lon: coordinates.lon,
      category: "detected coordinates",
      mapUrl: `https://www.openstreetmap.org/?mlat=${coordinates.lat}&mlon=${coordinates.lon}#map=16/${coordinates.lat}/${coordinates.lon}`,
      googleMapUrl: `https://www.google.com/maps/search/?api=1&query=${coordinates.lat},${coordinates.lon}`,
      crowd: estimateCrowd({ display_name: location, type: "" }, event),
      source: "文章やGoogle Maps共有URLから座標を直接検出しました。",
      fetchedAt: new Date().toISOString(),
    };
  }

  async function searchPlacesForQuery(query, limit) {
    const nominatim = await fetchNominatimPlaces(query, limit);
    if (nominatim.length) {
      return nominatim;
    }
    return fetchPhotonPlaces(query, limit);
  }

  async function fetchNominatimPlaces(query, limit) {
    try {
      const params = new URLSearchParams({
        format: "jsonv2",
        q: query,
        limit: String(limit),
        addressdetails: "1",
        extratags: "1",
        "accept-language": "ja",
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      if (!response.ok) {
        return [];
      }
      const places = await response.json();
      return Array.isArray(places) ? places.map((place) => ({ ...place, provider: "Nominatim" })) : [];
    } catch {
      return [];
    }
  }

  async function fetchPhotonPlaces(query, limit) {
    try {
      const params = new URLSearchParams({
        q: query,
        limit: String(limit),
      });
      const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const features = Array.isArray(data.features) ? data.features : [];
      return features.map((feature) => {
        const props = feature.properties || {};
        const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
          ? feature.geometry.coordinates
          : [];
        const displayName = [
          props.name,
          props.street,
          props.city || props.county,
          props.state,
          props.country,
        ].filter(Boolean).join(", ");
        return {
          provider: "Photon",
          display_name: displayName || query,
          lat: coordinates[1],
          lon: coordinates[0],
          category: props.osm_key || "",
          type: props.osm_value || props.type || "",
          osm_type: props.osm_type,
          osm_id: props.osm_id,
        };
      }).filter((place) => Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon)));
    } catch {
      return [];
    }
  }

  function makePlaceIntel(originalQuery, searchQuery, place, event, searchPlan) {
    const osmType = String(place.osm_type || "").toLowerCase();
    const osmId = place.osm_id;
    const mapUrl = osmType && osmId
      ? `https://www.openstreetmap.org/${osmType}/${osmId}`
      : `https://www.openstreetmap.org/search?query=${encodeURIComponent(place.display_name || searchQuery || originalQuery)}`;

    return {
      query: originalQuery,
      searchQuery,
      searchParts: searchPlan,
      displayName: place.display_name || originalQuery,
      lat: Number(place.lat),
      lon: Number(place.lon),
      category: [place.category, place.type].filter(Boolean).join(" / "),
      mapUrl,
      googleMapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.display_name || searchQuery || originalQuery)}`,
      crowd: estimateCrowd(place, event),
      source: `${place.provider || "OpenStreetMap"}の場所情報と予定時刻から作った混雑目安です。リアルタイム人流ではありません。`,
      fetchedAt: new Date().toISOString(),
    };
  }

  async function confirmPlaceCandidate(location, event) {
    let query = location;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const searchPlan = buildPlaceSearchQueries(query);
      setCandidatePlaceStatus(`候補を探しています: ${searchPlan.keyword || query}`);
      const candidates = await fetchPlaceCandidates(query, event, 5);

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        renderPlaceIntel(candidate, {
          status: `候補 ${index + 1}/${candidates.length}。違う場合は確認ダイアログでキャンセルしてください。`,
        });
        const ok = window.confirm(`この場所で合っていますか？\n\n${candidate.displayName}\n\n検索した固有名詞: ${candidate.searchParts.keyword || query}\n住所の手がかり: ${candidate.searchParts.context || "なし"}`);
        if (ok) {
          return candidate;
        }
      }

      const nextQuery = window.prompt("別の候補を探します。場所名や施設名、住所の手がかりを入力してください。", query);
      if (!nextQuery || !cleanText(nextQuery, 80)) {
        break;
      }
      query = cleanText(nextQuery, 80);
    }

    return {
      query: location,
      displayName: location,
      crowd: estimateCrowd({ display_name: location, type: "" }, event),
      source: "場所候補が確定されなかったため、座標なしで保存します。",
      fetchedAt: new Date().toISOString(),
    };
  }

  function buildPlaceSearchQueries(location) {
    const normalized = cleanLocation(normalizeScheduleText(location))
      .replace(/[、。]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const context = extractAddressContext(normalized);
    const keyword = extractPlaceKeyword(normalized, context);
    const queries = uniqueStrings([
      keyword && context ? `${keyword} ${context}` : "",
      keyword && context ? `${context} ${keyword}` : "",
      keyword,
      ...buildNameSearchVariants(keyword || normalized),
      normalized,
      context,
    ]).filter((query) => query.length >= 2);

    return { original: location, normalized, context, keyword, queries };
  }

  function buildNameSearchVariants(name) {
    const base = cleanText(name, 48);
    if (!base) {
      return [];
    }
    const variants = [];
    const withoutSuffix = base.replace(/(本店|支店|店|寺|神社|駅|公園|病院|会館|センター|ホール|ホテル|ビル)$/u, "");
    if (withoutSuffix && withoutSuffix !== base && withoutSuffix.length >= 2) {
      variants.push(withoutSuffix);
    }
    if (/[\s・･]/.test(base)) {
      variants.push(...base.split(/[\s・･]+/).filter((part) => part.length >= 2));
    }
    if (!/[都道府県市区町村丁目]/.test(base) && base.length >= 4) {
      variants.push(base.slice(0, Math.ceil(base.length * 0.75)));
    }
    return variants;
  }

  function extractAddressContext(text) {
    const beforeNo = text.includes("の")
      ? text.split("の").slice(0, -1).join("の")
      : "";
    if (/[都道府県市区町村丁目]/.test(beforeNo)) {
      return cleanText(beforeNo, 48);
    }

    const matched = text.match(/[^、。\sの]{1,12}[都道府県](?:[^、。\sの]{1,16}[市区町村])?(?:[^、。\sの]{1,16}(?:町|丁目|村|区|市))?|[^、。\sの]{1,16}[市区町村](?:[^、。\sの]{1,16}(?:町|丁目|村|区|市))?/);
    return cleanText(matched ? matched[0] : "", 48);
  }

  function extractPlaceKeyword(text, context) {
    let keyword = text;
    if (context) {
      keyword = keyword.replace(context, "");
    }
    keyword = keyword
      .replace(/.*の([^の\s、。]{2,32})$/, "$1")
      .replace(/^(の|に|で|へ|から|まで)+/, "")
      .replace(/(で|にて|へ|から|まで).*$/, "")
      .trim();

    if (!keyword || keyword === text) {
      const suffix = text.match(/([^、。\s]{2,32}(?:寺|神社|駅|店|カフェ|ホール|公園|病院|学校|大学|会館|センター|ビル|ホテル|スタジオ|オフィス|空港|ターミナル))/);
      if (suffix) {
        keyword = suffix[1];
      }
    }

    return cleanText(keyword, 48);
  }

  function uniqueStrings(values) {
    return [...new Set(values.map((value) => cleanText(value, 80)).filter(Boolean))];
  }

  async function enrichEventPlaceInBackground(event) {
    if (!event || !event.location || event.place || !event.placePending) {
      return;
    }

    showSummary("予定を追加しました。場所の座標と混雑目安を調べています。");
    try {
      const place = await fetchPlaceIntel(event.location, event);
      events = events.map((item) => item.id === event.id
        ? { ...item, place, placePending: false }
        : item);
      saveEvents();
      render();
      const updated = events.find((item) => item.id === event.id);
      if (updated) {
        scheduleEventNotification(updated);
      }
    } catch {
      events = events.map((item) => item.id === event.id
        ? { ...item, placePending: false }
        : item);
      saveEvents();
      render();
      showSummary("予定を追加しました。場所情報はあとで再取得できます。");
    }
  }

  function initializeMapOverview() {
    if (!mapContainer || !window.L || plannerMap) {
      if (plannerMap) {
        window.setTimeout(() => plannerMap.invalidateSize(), 80);
      }
      return;
    }

    const japan = { lat: 36.2048, lon: 138.2529 };
    plannerMap = window.L.map(mapContainer).setView([japan.lat, japan.lon], 5);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(plannerMap);

    setRouteStatus("現在地を取得しています。ブラウザの位置情報を許可してください。");
    window.setTimeout(() => {
      plannerMap.invalidateSize();
      renderScheduleMap(events);
    }, 120);
  }

  function startCurrentLocationTracking() {
    if (!navigator.geolocation) {
      setRouteStatus("このブラウザは現在地取得に対応していません。");
      return;
    }

    if (!window.L) {
      setRouteStatus("地図ライブラリを読み込めませんでした。通信状態を確認してください。");
      return;
    }

    if (locationWatchId !== null) {
      navigator.geolocation.clearWatch(locationWatchId);
    }

    setRouteStatus("現在地を取得しています。ブラウザの位置情報を許可してください。");
    locationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        currentPosition = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        initMap(currentPosition, 15, { recenter: !currentMarker });
        updateCurrentPositionMarker(currentPosition);
        renderScheduleMap(getSelectedDayEvents(), { autoFrame: false });
        setRouteStatus(`現在地を表示しています。精度目安: 約${Math.round(currentPosition.accuracy || 0)}m。予定場所をタッチすると経路を確認できます。`);
      },
      (error) => {
        setRouteStatus(`現在地を取得できませんでした: ${error.message || "位置情報が許可されていません。"}`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30 * 1000 },
    );
  }

  async function handleRouteLookup() {
    const dayEvents = getActiveEvents().filter((item) => item.location);
    if (!navigator.geolocation) {
      setRouteStatus("このブラウザは現在地取得に対応していません。");
      return;
    }

    if (!window.L) {
      setRouteStatus("地図ライブラリを読み込めませんでした。通信状態を確認してください。");
      return;
    }

    locateRoutesButton.disabled = true;
    activeRouteEventId = "";
    setRouteStatus("現在地を取得しています。");

    try {
      const current = currentPosition || await getCurrentPosition();
      currentPosition = current;
      const routeResults = [];
      initMap(current, 15, { recenter: true });
      clearRouteAndEventLayers();
      drawCurrentPosition(current);

      if (!dayEvents.length) {
        renderRouteList([]);
        plannerMap.setView([current.lat, current.lon], 15);
        setRouteStatus("現在地を地図に表示しました。登録済み予定に場所がないため、移動時間は未表示です。");
        return;
      }

      for (const event of dayEvents) {
        if (!event.place || !Number.isFinite(event.place.lat) || !Number.isFinite(event.place.lon)) {
          setRouteStatus(`${event.location} の座標を調べています。`);
          event.place = await fetchPlaceIntel(event.location, event);
        }

        if (!event.place || !Number.isFinite(event.place.lat) || !Number.isFinite(event.place.lon)) {
          routeResults.push({
            event,
            status: "座標を取得できませんでした。",
          });
          continue;
        }

        try {
          setRouteStatus(`${event.location} への移動時間を調べています。`);
          const route = await fetchRouteEstimate(current, event.place, event);
          routeResults.push({ event, route });
          drawEventRoute(event, route, true);
        } catch (error) {
          routeResults.push({
            event,
            status: `移動時間を取得できませんでした: ${getErrorText(error)}`,
          });
          drawEventRoute(event, null, true);
        }
      }

      saveEvents();
      render();
      clearRouteAndEventLayers();
      routeResults.forEach(({ event, route }) => {
        if (event.place && Number.isFinite(event.place.lat) && Number.isFinite(event.place.lon)) {
          drawEventRoute(event, route || null);
        }
      });
      renderRouteList(routeResults);
      fitMapToContent(current, routeResults);
      setRouteStatus("現在地から予定場所への移動時間を表示しています。各予定をタッチすると個別ルートに切り替わります。");
    } catch (error) {
      setRouteStatus(`移動時間を調べられませんでした: ${getErrorText(error)}`);
    } finally {
      locateRoutesButton.disabled = false;
    }
  }

  function getSelectedDayEvents() {
    const date = viewDateInput.value || today;
    return events
      .filter((item) => item.date === date)
      .sort(compareEventsByDateTime);
  }

  function getActiveEvents() {
    return [...events].sort(compareEventsByDateTime);
  }

  function getCurrentPosition() {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
        (error) => reject(new Error(error.message || "現在地の取得が許可されませんでした。")),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 5 * 60 * 1000 },
      );
    });
  }

  async function fetchRouteEstimate(current, place, event = null) {
    const params = new URLSearchParams({
      overview: "full",
      geometries: "geojson",
      alternatives: "false",
      steps: "false",
    });
    const coordinates = `${current.lon},${current.lat};${place.lon},${place.lat}`;
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?${params.toString()}`);
    if (!response.ok) {
      throw new Error("ルートAPIが応答しませんでした。");
    }
    const data = await response.json();
    const route = data.routes && data.routes[0];
    if (!route) {
      throw new Error("ルートが見つかりませんでした。");
    }

    const distanceKm = Math.round((route.distance / 1000) * 10) / 10;
    const durationMinutes = Math.max(1, Math.round(route.duration / 60));
    return {
      durationMinutes: Math.max(1, Math.round(route.duration / 60)),
      distanceKm,
      geometry: route.geometry,
      modes: buildTravelModes(distanceKm, durationMinutes),
      trafficNote: buildTrafficNote(event ? new Date(`${event.date}T${event.start || "10:00"}`) : new Date()),
    };
  }

  function buildTravelModes(distanceKm, drivingMinutes) {
    const walk = Math.max(1, Math.round((distanceKm / 4.8) * 60));
    const bicycle = Math.max(1, Math.round((distanceKm / 14) * 60));
    const transit = Math.max(5, Math.round(drivingMinutes * 1.25 + 8));
    return [
      { label: "車", minutes: drivingMinutes, note: "OSRMの車ルート" },
      { label: "徒歩", minutes: walk, note: "距離からの目安" },
      { label: "自転車", minutes: bicycle, note: "距離からの目安" },
      { label: "公共交通", minutes: transit, note: "乗換待ちを含む概算" },
    ];
  }

  function buildTrafficNote(date) {
    const hour = date.getHours();
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      return "渋滞目安: 通勤・帰宅時間帯のため混みやすい可能性があります。リアルタイム交通APIは未接続です。";
    }
    if (hour >= 11 && hour <= 14) {
      return "渋滞目安: 昼の外出時間帯です。中心部や商業施設周辺は混む可能性があります。リアルタイム交通APIは未接続です。";
    }
    return "渋滞目安: 現在は大きな混雑時間帯ではない見込みです。リアルタイム交通APIは未接続です。";
  }

  function initMap(current, zoom = 13, options = {}) {
    if (!plannerMap) {
      plannerMap = window.L.map(mapContainer).setView([current.lat, current.lon], zoom);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(plannerMap);
    } else if (options.recenter) {
      plannerMap.setView([current.lat, current.lon], zoom);
      window.setTimeout(() => plannerMap.invalidateSize(), 50);
    } else {
      window.setTimeout(() => plannerMap.invalidateSize(), 50);
    }
  }

  function clearMapLayers() {
    if (overviewMarker) {
      overviewMarker.remove();
      overviewMarker = null;
    }
    if (currentMarker) {
      currentMarker.remove();
      currentMarker = null;
    }
    eventMarkers.forEach((marker) => marker.remove());
    routeLines.forEach((line) => line.remove());
    eventMarkers = [];
    routeLines = [];
  }

  function clearRouteAndEventLayers() {
    eventMarkers.forEach((marker) => marker.remove());
    routeLines.forEach((line) => line.remove());
    eventMarkers = [];
    routeLines = [];
  }

  function drawCurrentPosition(current) {
    updateCurrentPositionMarker(current);
    if (currentMarker && typeof currentMarker.openPopup === "function") {
      currentMarker.openPopup();
    }
  }

  function updateCurrentPositionMarker(current) {
    if (!plannerMap || !current) {
      return;
    }
    if (overviewMarker) {
      overviewMarker.remove();
      overviewMarker = null;
    }
    if (currentMarker) {
      currentMarker.remove();
    }
    const circle = window.L.circleMarker([current.lat, current.lon], {
      radius: 7,
      color: "#6f4de2",
      weight: 2,
      fillColor: "#b49cff",
      fillOpacity: 0.48,
    });
    const accuracyCircle = Number.isFinite(current.accuracy)
      ? window.L.circle([current.lat, current.lon], {
          radius: Math.min(Math.max(current.accuracy, 20), 1000),
          color: "#6f4de2",
          weight: 1,
          fillColor: "#b49cff",
          fillOpacity: 0.13,
        })
      : null;
    const marker = window.L.marker([current.lat, current.lon], {
      icon: window.L.divIcon({
        className: "current-position-character-icon",
        html: '<span class="current-position-character"><i class="character-eye left"></i><i class="character-eye right"></i><i class="character-foot left"></i><i class="character-foot right"></i></span>',
        iconSize: [42, 46],
        iconAnchor: [21, 42],
      }),
    });
    currentMarker = window.L.layerGroup([accuracyCircle, circle, marker].filter(Boolean))
      .addTo(plannerMap)
      .bindPopup("現在地");
  }

  function drawEventRoute(event, route, openPopup = false) {
    const marker = window.L.marker([event.place.lat, event.place.lon])
      .addTo(plannerMap)
      .bindPopup(`${escapeHtml(event.title)}<br>${escapeHtml(event.location || "場所未設定")}<br>タッチで経路を表示`);
    marker.on("click", () => showEventRouteDetails(event.id));
    eventMarkers.push(marker);
    if (openPopup && typeof marker.openPopup === "function") {
      marker.openPopup();
    }

    if (route && route.geometry) {
      const line = window.L.geoJSON(route.geometry, {
        style: { color: "#7047eb", weight: 5, opacity: 0.75 },
      }).addTo(plannerMap);
      routeLines.push(line);
    }
  }

  function drawSchedulePlaceMarker(event) {
    if (!event.place || !Number.isFinite(event.place.lat) || !Number.isFinite(event.place.lon)) {
      return;
    }
    const marker = window.L.marker([event.place.lat, event.place.lon])
      .addTo(plannerMap)
      .bindPopup(`${escapeHtml(event.title)}<br>${escapeHtml(event.location || "場所未設定")}<br>タッチで経路を表示`);
    marker.on("click", () => showEventRouteDetails(event.id));
    eventMarkers.push(marker);
  }

  function renderScheduleMap(dayEvents, options = {}) {
    if (!window.L || !mapContainer || !plannerMap) {
      return;
    }
    if (activeRouteEventId) {
      if (currentPosition) {
        updateCurrentPositionMarker(currentPosition);
      }
      return;
    }
    clearRouteAndEventLayers();
    if (currentPosition) {
      updateCurrentPositionMarker(currentPosition);
    }

    const points = [];
    dayEvents
      .filter((event) => event.location)
      .forEach((event) => {
        if (event.place && Number.isFinite(event.place.lat) && Number.isFinite(event.place.lon)) {
          drawSchedulePlaceMarker(event);
          points.push([event.place.lat, event.place.lon]);
        } else if (!event.place) {
          enrichEventPlaceForMap(event);
        }
      });

    if (currentPosition) {
      points.push([currentPosition.lat, currentPosition.lon]);
    }

    if (options.autoFrame === false) {
      return;
    }

    if (points.length > 1) {
      plannerMap.fitBounds(window.L.latLngBounds(points), { padding: [28, 28] });
    } else if (points.length === 1) {
      plannerMap.setView(points[0], 14);
    }
  }

  async function enrichEventPlaceForMap(event) {
    if (!event || !event.location || placeLookupIds.has(event.id)) {
      return;
    }
    placeLookupIds.add(event.id);
    try {
      const place = await fetchPlaceIntel(event.location, event);
      events = events.map((item) => item.id === event.id
        ? { ...item, place, placePending: false }
        : item);
      saveEvents();
      render();
    } finally {
      placeLookupIds.delete(event.id);
    }
  }

  async function showEventRouteDetails(eventId) {
    if (!ensurePlannerAccess()) {
      return;
    }
    const event = events.find((item) => item.id === eventId);
    if (!event || !event.location) {
      setRouteStatus("この予定には場所がありません。");
      return;
    }
    if (!navigator.geolocation || !window.L) {
      setRouteStatus("現在地または地図を利用できません。");
      return;
    }

    setRouteStatus(`${event.location} への経路を調べています。`);
    try {
      activeRouteEventId = eventId;
      const current = currentPosition || await getCurrentPosition();
      currentPosition = current;
      initMap(current, 15, { recenter: true });
      updateCurrentPositionMarker(current);

      let target = event;
      if (!target.place || !Number.isFinite(target.place.lat) || !Number.isFinite(target.place.lon)) {
        const place = await fetchPlaceIntel(target.location, target);
        events = events.map((item) => item.id === target.id ? { ...item, place, placePending: false } : item);
        saveEvents();
        target = events.find((item) => item.id === eventId) || { ...event, place };
      }

      if (!target.place || !Number.isFinite(target.place.lat) || !Number.isFinite(target.place.lon)) {
        renderRouteList([{ event: target, status: "座標を取得できませんでした。" }]);
        setRouteStatus("場所の座標を取得できませんでした。");
        activeRouteEventId = "";
        return;
      }

      clearRouteAndEventLayers();
      updateCurrentPositionMarker(current);
      const route = await fetchRouteEstimate(current, target.place, target);
      drawEventRoute(target, route, true);
      renderRouteList([{ event: target, route, selected: true }]);
      fitMapToContent(current, [{ event: target }]);
      setRouteStatus(`${target.title} へのルートを表示しています。移動手段ごとの時間は目安です。`);
    } catch (error) {
      activeRouteEventId = "";
      renderRouteList([{ event, status: `経路を取得できませんでした: ${getErrorText(error)}` }]);
      setRouteStatus(`経路を取得できませんでした: ${getErrorText(error)}`);
    }
  }

  function fitMapToContent(current, routeResults) {
    const points = [[current.lat, current.lon]];
    routeResults.forEach(({ event }) => {
      if (event.place && Number.isFinite(event.place.lat) && Number.isFinite(event.place.lon)) {
        points.push([event.place.lat, event.place.lon]);
      }
    });
    if (points.length > 1) {
      plannerMap.fitBounds(window.L.latLngBounds(points), { padding: [28, 28] });
    }
  }

  function renderRouteList(results) {
    if (!routeList) {
      return;
    }
    routeList.replaceChildren();
    if (!results.length) {
      return;
    }

    results.forEach(({ event, route, status }) => {
      const item = document.createElement("li");
      if (event.location) {
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.addEventListener("click", () => showEventRouteDetails(event.id));
        item.addEventListener("keydown", (keyboardEvent) => {
          if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
            keyboardEvent.preventDefault();
            showEventRouteDetails(event.id);
          }
        });
      }
      const title = document.createElement("strong");
      title.textContent = event.title;
      item.append(title);

      if (route) {
        item.append(createTextSpan(`${event.location}: 車で約${route.durationMinutes}分 / ${route.distanceKm}km`));
        if (Array.isArray(route.modes)) {
          route.modes.forEach((mode) => {
            item.append(createTextSpan(`${mode.label}: 約${mode.minutes}分（${mode.note}）`));
          });
        }
        if (event.place && event.place.crowd) {
          item.append(createTextSpan(`混雑目安: ${event.place.crowd.level}（${event.place.crowd.reason}）`));
        }
        item.append(createTextSpan(`渋滞情報: ${route.trafficNote}`));
      } else {
        item.append(createTextSpan(`${event.location}: ${status || "移動時間を取得できませんでした。"}`));
      }

      routeList.append(item);
    });
  }

  function createTextSpan(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setRouteStatus(text) {
    if (routeStatus) {
      routeStatus.textContent = text;
      routeStatus.classList.toggle("completed-pulse", /自動削除|終了済み|終了時刻/.test(text));
      if (routeStatus.classList.contains("completed-pulse")) {
        window.setTimeout(() => routeStatus.classList.remove("completed-pulse"), 1400);
      }
    } else {
      showSummary(text);
    }
  }

  function estimateCrowd(place, event) {
    const eventDate = new Date(`${event.date}T${event.start || "10:00"}`);
    const hour = eventDate.getHours();
    const day = eventDate.getDay();
    const weekend = day === 0 || day === 6;
    const placeText = `${place.display_name || ""} ${place.category || ""} ${place.type || ""}`.toLowerCase();
    let score = 1;
    const reasons = [];

    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      score += 2;
      reasons.push("通勤・帰宅時間帯");
    } else if (hour >= 11 && hour <= 14) {
      score += 1;
      reasons.push("昼の時間帯");
    } else if (hour >= 18 && hour <= 21) {
      score += 1;
      reasons.push("夜の外出時間帯");
    }

    if (weekend) {
      score += 1;
      reasons.push("週末");
    }

    if (/station|railway|subway|train|駅/.test(placeText)) {
      score += 2;
      reasons.push("駅・交通拠点");
    } else if (/mall|shop|restaurant|cafe|bar|food|commercial|百貨店|商業|カフェ|レストラン/.test(placeText)) {
      score += 1;
      reasons.push("商業施設・飲食店");
    } else if (/park|school|university|office|building|公園|学校|大学|ビル/.test(placeText)) {
      score += 1;
      reasons.push("利用者が集まりやすい場所");
    }

    if (score >= 5) {
      return { level: "高め", reason: reasons.join("、") || "時間帯と場所の傾向" };
    }
    if (score >= 3) {
      return { level: "ふつう", reason: reasons.join("、") || "時間帯と場所の傾向" };
    }
    return { level: "低め", reason: reasons.join("、") || "混みやすい条件が少ない" };
  }

  function detectDate(text, base) {
    const ymd = text.match(/(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (ymd) {
      return toDateInputValue(new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    }

    const ymdJapanese = text.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
    if (ymdJapanese) {
      return toDateInputValue(new Date(Number(ymdJapanese[1]), Number(ymdJapanese[2]) - 1, Number(ymdJapanese[3])));
    }

    const md = text.match(/(?:^|[^\d])(\d{1,2})[\/.\-](\d{1,2})(?:[^\d]|$)/);
    if (md) {
      const month = Number(md[1]);
      const day = Number(md[2]);
      const year = base.getFullYear();
      return toDateInputValue(new Date(year, month - 1, day));
    }

    const japaneseDate = text.match(/(\d{1,2})月(\d{1,2})日/);
    if (japaneseDate) {
      return toDateInputValue(new Date(base.getFullYear(), Number(japaneseDate[1]) - 1, Number(japaneseDate[2])));
    }

    if (text.includes("明後日") || text.includes("あさって")) {
      return addDays(base, 2);
    }
    if (text.includes("明日") || text.includes("あした")) {
      return addDays(base, 1);
    }
    if (text.includes("今日") || text.includes("きょう")) {
      return toDateInputValue(base);
    }
    return "";
  }

  function detectTime(text) {
    const normalized = normalizeScheduleText(text);
    const meridiem = normalized.match(/(午前|午後)\s*([01]?\d|2[0-3])時(?:([0-5]?\d)分?)?/);
    if (meridiem) {
      return formatParsedTime(meridiem[1], meridiem[2], meridiem[3]);
    }

    const colonMeridiem = normalized.match(/(午前|午後)\s*([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)/);
    if (colonMeridiem) {
      return formatParsedTime(colonMeridiem[1], colonMeridiem[2], colonMeridiem[3]);
    }

    const colon = normalized.match(/([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)/);
    if (colon) {
      return `${colon[1].padStart(2, "0")}:${colon[2]}`;
    }

    const japanese = normalized.match(/([01]?\d|2[0-3])時(?:([0-5]?\d)分?)?/);
    if (japanese) {
      return `${japanese[1].padStart(2, "0")}:${(japanese[2] || "00").padStart(2, "0")}`;
    }

    return "";
  }

  function detectTimeRange(text) {
    const normalized = normalizeScheduleText(text);
    const japaneseRange = normalized.match(/(午前|午後)?\s*([01]?\d|2[0-3])時(?:([0-5]?\d)分?)?\s*(?:から|〜|～|-|－)\s*(午前|午後)?\s*([01]?\d|2[0-3])時(?:([0-5]?\d)分?)?/);
    if (japaneseRange) {
      const startPeriod = japaneseRange[1] || japaneseRange[4] || "";
      const endPeriod = japaneseRange[4] || japaneseRange[1] || "";
      return {
        start: formatParsedTime(startPeriod, japaneseRange[2], japaneseRange[3]),
        end: formatParsedTime(endPeriod, japaneseRange[5], japaneseRange[6]),
      };
    }

    const colonRange = normalized.match(/(午前|午後)?\s*([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)\s*(?:から|〜|～|-|－)\s*(午前|午後)?\s*([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)/);
    if (colonRange) {
      const startPeriod = colonRange[1] || colonRange[4] || "";
      const endPeriod = colonRange[4] || colonRange[1] || "";
      return {
        start: formatParsedTime(startPeriod, colonRange[2], colonRange[3]),
        end: formatParsedTime(endPeriod, colonRange[5], colonRange[6]),
      };
    }

    return { start: "", end: "" };
  }

  function formatParsedTime(period, hourValue, minuteValue) {
    let hour = Number(hourValue);
    const minute = String(minuteValue || "00").padStart(2, "0");
    if (period === "午後" && hour < 12) {
      hour += 12;
    }
    if (period === "午前" && hour === 12) {
      hour = 0;
    }
    return `${String(hour).padStart(2, "0")}:${minute}`;
  }

  function detectLocation(text) {
    const normalized = stripDateTime(text);
    const explicit = normalized.match(/(?:場所|会場|集合場所|行き先)[:：]?\s*([^\s、。]{2,32})/);
    if (explicit) {
      return cleanLocation(explicit[1]);
    }

    const addressAtPlace = normalized.match(/((?:[^、。でに]{1,16}[都道府県])?[^、。でに]{1,16}[市区町村][^、。でに]{0,24}の[^、。でに]{2,24})(?:で|にて)/);
    if (addressAtPlace) {
      return cleanLocation(addressAtPlace[1]);
    }

    const atPlace = normalized.match(/([^\s、。でに]{2,48})(?:で|にて)/);
    if (atPlace) {
      return cleanLocation(atPlace[1]);
    }

    const titleLocation = inferLocationFromTitle(normalized);
    if (titleLocation) {
      return titleLocation;
    }

    const suffixPlace = normalized.match(/([^\s、。]{1,32}(?:駅|店|カフェ|ホール|大学|高校|学校|公園|寺|神社|博物館|美術館|資料館|水族館|動物園|映画館|劇場|病院|美容院|歯医者|スタジオ|オフィス|ビル|会館|センター|空港|ターミナル))/);
    return cleanLocation(suffixPlace ? suffixPlace[1] : "");
  }

  function inferLocationFromTitle(title) {
    const text = cleanText(normalizeScheduleText(title), 80)
      .replace(/[、。]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      return "";
    }

    const destination = text.match(/^(.{2,48}?)(?:に|へ)(?:行く|いく|行き|向かう|訪問|集合|到着|出発|寄る|行って|行こ)/);
    if (destination) {
      return cleanLocation(destination[1]);
    }

    const suffixPlace = text.match(/([^\s、。]{2,48}(?:駅|店|カフェ|ホール|大学|高校|学校|公園|寺|神社|博物館|美術館|資料館|水族館|動物園|映画館|劇場|病院|美容院|歯医者|スタジオ|オフィス|ビル|会館|センター|空港|ターミナル))/);
    return cleanLocation(suffixPlace ? suffixPlace[1] : "");
  }

  function detectTitle(text, location) {
    const withoutDate = stripDateTime(text)
      .replace(/月曜|火曜|水曜|木曜|金曜|土曜|日曜|[月火水木金土日]曜日/g, "")
      .replace(location, "")
      .replace(/場所[:：]?|会場[:：]?|集合場所[:：]?|行き先[:：]?/g, "")
      .replace(/で|にて|集合|予定|予約|から|まで/g, " ")
      .replace(/^(の|に|を|が|は)+/, "")
      .replace(/をする|する|開催/g, " ")
      .replace(/よろしく|お願いします|です|ます/g, " ")
      .replace(/[、。]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const eventWord = withoutDate.match(/(誕生日パーティー?|誕生日|パーティー?|会議|打ち合わせ|ミーティング|面談|面接|ランチ|飲み|食事|シフト|授業|講義|試験|テスト|提出|締切|病院|美容院|歯医者|イベント|ライブ|説明会|面会|出勤|退勤)/);
    if (location && /^(行く|いく|行き|向かう|訪問|寄る|到着|出発)?$/.test(withoutDate)) {
      return cleanText(`${location}に行く`, 48);
    }
    return cleanText(eventWord ? eventWord[1] : withoutDate, 48);
  }

  function normalizeDetectedTitle(title, location, sourceText = "") {
    const cleanedTitle = cleanText(title, 48);
    const cleanedLocation = cleanLocation(location);
    if (!cleanedLocation) {
      return cleanedTitle;
    }

    if (!cleanedTitle || isBareTravelTitle(cleanedTitle) || cleanedTitle === cleanedLocation) {
      return cleanText(`${cleanedLocation}に行く`, 48);
    }

    const source = cleanText(normalizeScheduleText(sourceText), 120);
    if (!cleanedTitle.includes(cleanedLocation) && source.includes(cleanedLocation) && isTravelSource(source, cleanedLocation)) {
      return cleanText(`${cleanedLocation}に行く`, 48);
    }

    return cleanedTitle;
  }

  function isBareTravelTitle(title) {
    return /^(?:に|へ)?(?:行く|いく|行き|向かう|訪問|寄る|到着|出発|行って|行こ)$/.test(cleanText(title, 48));
  }

  function isTravelSource(source, location) {
    const escapedLocation = escapeRegExp(location);
    return new RegExp(`${escapedLocation}\\s*(?:に|へ)\\s*(?:行く|いく|行き|向かう|訪問|寄る|到着|出発|行って|行こ)`).test(source);
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function stripDateTime(text) {
    return String(text || "")
      .replace(/20\d{2}[\/.\-]\d{1,2}[\/.\-]\d{1,2}/g, " ")
      .replace(/20\d{2}年\d{1,2}月\d{1,2}日/g, " ")
      .replace(/\d{1,2}[\/.\-]\d{1,2}/g, " ")
      .replace(/\d{1,2}月\d{1,2}日/g, " ")
      .replace(/(?:午前|午後)?\s*([01]?\d|2[0-3])[:.][0-5]\d/g, " ")
      .replace(/(?:午前|午後)?\s*([01]?\d|2[0-3])時(?:[0-5]?\d分?)?/g, " ")
      .replace(/明後日|あさって|明日|あした|今日|きょう/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanLocation(value) {
    return cleanText(value, 48)
      .replace(/^(場所|会場|集合場所|行き先)[:：]?/, "")
      .replace(/^(は|が|を|に)/, "")
      .replace(/(で|にて|集合|予定|予約|から|まで).*$/, "")
      .trim();
  }

  function showCandidate(candidate) {
    if (!candidate) {
      candidateTitle.textContent = "候補を作れませんでした";
      candidateMeta.textContent = lastDetectMessage || "予定の日時や用事名が分かる文章で試してください。";
      candidateAddButton.hidden = true;
      candidateBox.hidden = false;
      if (candidatePlace) {
        candidatePlace.hidden = true;
        candidatePlace.replaceChildren();
      }
      return;
    }
    candidateAddButton.hidden = false;
    candidateTitle.textContent = candidate.title;
    candidateMeta.textContent = [
      formatDate(candidate.date),
      getEventTimeLabel(candidate),
      candidate.location ? `場所: ${candidate.location}` : "場所未設定",
      candidate.travelMinutes ? `移動${candidate.travelMinutes}分` : "移動なし",
      candidate.inferredDate ? "日付は今日で仮設定" : "",
      candidate.inferredTime ? "時刻が不明です。あとで編集できます" : "",
    ].filter(Boolean).join(" / ");
    renderPlaceIntel(candidate.place);
    candidateBox.hidden = false;
  }

  function setDetectMessage(message) {
    lastDetectMessage = message;
    showSummary(message);
  }

  function setCandidatePlaceStatus(text) {
    if (!candidatePlace) {
      showSummary(text);
      return;
    }
    candidatePlace.replaceChildren(createTextBlock(text));
    candidatePlace.hidden = false;
  }

  function renderPlaceIntel(place, options = {}) {
    if (!candidatePlace) {
      return;
    }
    candidatePlace.replaceChildren();
    if (!place) {
      candidatePlace.hidden = true;
      return;
    }

    const name = document.createElement("strong");
    name.textContent = place.displayName || place.query || "場所情報";
    candidatePlace.append(name);

    if (options.status) {
      candidatePlace.append(createTextBlock(options.status));
    }

    if (place.searchParts && (place.searchParts.keyword || place.searchParts.context)) {
      candidatePlace.append(createTextBlock(`検索: ${place.searchParts.keyword || place.query}${place.searchParts.context ? ` / 手がかり: ${place.searchParts.context}` : ""}`));
    }

    if (Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
      candidatePlace.append(createTextBlock(`座標目安: ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`));
    } else {
      candidatePlace.append(createTextBlock("座標目安: 取得できませんでした"));
    }

    const crowd = place.crowd ? `混雑目安: ${place.crowd.level}（${place.crowd.reason}）` : "混雑目安: 未取得";
    candidatePlace.append(createTextBlock(crowd));
    candidatePlace.append(createTextBlock(place.source || "混雑目安です。"));

    if (place.mapUrl) {
      const link = document.createElement("a");
      link.href = place.mapUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "OpenStreetMapで確認";
      candidatePlace.append(link);
    }

    if (place.googleMapUrl) {
      const link = document.createElement("a");
      link.href = place.googleMapUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Google Mapsで確認";
      candidatePlace.append(link);
    }

    candidatePlace.hidden = false;
  }

  function createTextBlock(text) {
    const block = document.createElement("div");
    block.textContent = text;
    return block;
  }

  function render() {
    const date = viewDateInput.value || today;
    const dayEvents = events
      .filter((item) => item.date === date)
      .sort(compareEventsByDateTime);

    renderTimeline(dayEvents);
    renderFreeTime(dayEvents);
    renderScheduleTable(dayEvents, date);
    renderAllEvents();
    renderScheduleMap(events);
    showSummary(expiredNotice || `${formatDate(date)}: ${dayEvents.length}件の予定`);
    expiredNotice = "";
    animatedEventId = "";
  }

  function renderAllEvents() {
    if (!allEventsList) {
      return;
    }
    allEventsList.replaceChildren();
    const sorted = [...events].sort(compareEventsByDateTime);
    if (!sorted.length) {
      allEventsList.append(createListItem("登録されている予定はありません。"));
      return;
    }

    sorted.forEach((event) => {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = event.title;
      const meta = document.createElement("span");
      meta.textContent = [
        formatDate(event.date),
        getEventTimeLabel(event),
        event.location ? `場所: ${event.location}` : "場所未設定",
      ].join(" / ");
      if (event.inferredTime) {
        const note = document.createElement("span");
        note.className = "time-missing-note";
        note.textContent = "時刻が不明です";
        meta.append(document.createElement("br"), note);
      }
      const actions = document.createElement("div");
      actions.className = "event-actions";
      const routeButton = createSmallButton("地図", () => showEventRouteDetails(event.id));
      routeButton.disabled = !event.location;
      const editButton = createSmallButton("編集", () => editEvent(event.id));
      const deleteButton = createSmallButton("削除", () => deleteEvent(event.id));
      actions.append(routeButton, editButton, deleteButton);
      if (event.id === animatedEventId) {
        item.classList.add("just-added");
      }
      item.append(title, meta, actions);
      allEventsList.append(item);
    });
  }

  function createSmallButton(label, handler) {
    const button = document.createElement("button");
    button.className = "timeline-delete";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function renderScheduleTable(dayEvents, date) {
    if (!scheduleTable || !scheduleFloating) {
      return;
    }
    scheduleTable.replaceChildren();
    scheduleFloating.replaceChildren();

    const timedEvents = dayEvents.filter((event) => hasExactTime(event));
    const floatingEvents = dayEvents.filter((event) => !hasExactTime(event));
    if (scheduleTableStatus) {
      scheduleTableStatus.textContent = `${timedEvents.length}件を時間帯に表示 / 時刻が不明な予定 ${floatingEvents.length}件`;
    }

    const rangeStart = getScheduleRangeStart(timedEvents, date);
    const rangeEnd = getScheduleRangeEnd(timedEvents, date, rangeStart);
    const totalMinutes = rangeEnd - rangeStart;

    const grid = document.createElement("div");
    grid.className = "schedule-grid";
    grid.style.setProperty("--schedule-minutes", String(totalMinutes));

    for (let minutes = rangeStart; minutes <= rangeEnd; minutes += 60) {
      const row = document.createElement("div");
      row.className = "schedule-hour-row";
      row.style.top = `${((minutes - rangeStart) / totalMinutes) * 100}%`;
      const label = document.createElement("span");
      label.textContent = minutesToTime(minutes);
      row.append(label);
      grid.append(row);
    }

    timedEvents.forEach((event) => {
      const start = clampNumber(timeToMinutes(event.start), rangeStart, rangeEnd - 5);
      const end = Math.max(start + 15, Math.min(timeToMinutes(event.end), rangeEnd));
      const block = document.createElement("button");
      block.type = "button";
      block.className = "schedule-event";
      if (event.id === animatedEventId) {
        block.classList.add("just-added");
      }
      block.style.top = `${((start - rangeStart) / totalMinutes) * 100}%`;
      block.style.height = `${Math.max(5, ((end - start) / totalMinutes) * 100)}%`;
      block.addEventListener("click", () => editEvent(event.id));
      const title = document.createElement("strong");
      title.textContent = event.title;
      const meta = document.createElement("span");
      meta.textContent = `${event.start}-${event.end}${event.location ? ` / ${event.location}` : ""}`;
      block.append(title, meta);
      grid.append(block);
    });

    if (date === toDateInputValue(new Date())) {
      const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
      if (nowMinutes >= rangeStart && nowMinutes <= rangeEnd) {
        const marker = document.createElement("div");
        marker.className = "schedule-now-marker";
        marker.style.top = `${((nowMinutes - rangeStart) / totalMinutes) * 100}%`;
        marker.innerHTML = "<span>今ここ！</span>";
        grid.append(marker);
      }
    }

    if (!timedEvents.length) {
      const empty = document.createElement("div");
      empty.className = "schedule-empty";
      empty.textContent = "時間が分かる予定はありません。";
      grid.append(empty);
    }

    scheduleTable.append(grid);

    if (floatingEvents.length) {
      const title = document.createElement("strong");
      title.textContent = "時刻が不明な予定";
      const list = document.createElement("ul");
      floatingEvents.forEach((event) => {
        const item = document.createElement("li");
        item.textContent = `${event.title} / 時刻が不明です${event.location ? ` / 場所: ${event.location}` : ""}`;
        item.addEventListener("click", () => editEvent(event.id));
        list.append(item);
      });
      scheduleFloating.append(title, list);
    }
  }

  function hasExactTime(event) {
    return Boolean(event.start && event.end && !event.inferredTime && timeToMinutes(event.end) > timeToMinutes(event.start));
  }

  function getEventTimeLabel(event) {
    if (event && event.inferredTime) {
      return "時刻未定";
    }
    if (event && event.start && event.end) {
      return `${event.start}-${event.end}`;
    }
    return "時刻未定";
  }

  function compareEventsByDateTime(a, b) {
    const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
    if (dateCompare) {
      return dateCompare;
    }
    const aTime = hasExactTime(a) ? timeToMinutes(a.start) : 24 * 60;
    const bTime = hasExactTime(b) ? timeToMinutes(b.start) : 24 * 60;
    return aTime - bTime;
  }

  function getScheduleRangeStart(timedEvents, date) {
    const starts = timedEvents.map((event) => timeToMinutes(event.start)).filter(Number.isFinite);
    if (date === toDateInputValue(new Date())) {
      starts.push(new Date().getHours() * 60 + new Date().getMinutes());
    }
    return Math.max(0, Math.min(DAY_START, starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : DAY_START));
  }

  function getScheduleRangeEnd(timedEvents, date, rangeStart) {
    const ends = timedEvents.map((event) => timeToMinutes(event.end)).filter(Number.isFinite);
    if (date === toDateInputValue(new Date())) {
      ends.push(new Date().getHours() * 60 + new Date().getMinutes());
    }
    const baseEnd = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : DAY_END;
    return Math.min(24 * 60, Math.max(DAY_END, baseEnd, rangeStart + 60));
  }

  function renderTimeline(dayEvents) {
    timelineBoard.innerHTML = "";
    if (!dayEvents.length) {
      timelineBoard.append(createEmptyState("この日の予定はまだありません。"));
      return;
    }

    dayEvents.forEach((item) => {
      if (item.travelMinutes > 0 && hasExactTime(item)) {
        timelineBoard.append(createTimelineRow(
          minutesToTime(Math.max(DAY_START, timeToMinutes(item.start) - item.travelMinutes)),
          `${item.title} まで移動`,
          item.location ? `行き先: ${item.location}` : "移動時間メモ",
          true,
        ));
      }
      timelineBoard.append(createTimelineRow(
        getEventTimeLabel(item),
        item.title,
        makeEventMeta(item),
        false,
        item.id,
      ));
    });
  }

  function makeEventMeta(item) {
    const parts = [item.location ? `場所: ${item.location}` : "場所未設定"];
    if (item.inferredTime) {
      parts.unshift("時刻が不明です");
    }
    if (item.place && Number.isFinite(item.place.lat) && Number.isFinite(item.place.lon)) {
      parts.push(`座標: ${item.place.lat.toFixed(4)}, ${item.place.lon.toFixed(4)}`);
    }
    if (item.place && item.place.crowd) {
      parts.push(`混雑目安: ${item.place.crowd.level}`);
    }
    if (item.placePending) {
      parts.push("場所情報を取得中");
    }
    return parts.join(" / ");
  }

  function renderFreeTime(dayEvents) {
    freeTimeList.innerHTML = "";
    const busyBlocks = dayEvents
      .filter((item) => hasExactTime(item))
      .map((item) => ({
        start: Math.max(DAY_START, timeToMinutes(item.start) - Number(item.travelMinutes || 0)),
        end: Math.min(DAY_END, timeToMinutes(item.end)),
      }))
      .filter((item) => item.end > DAY_START && item.start < DAY_END)
      .sort((a, b) => a.start - b.start);

    const merged = [];
    busyBlocks.forEach((block) => {
      const last = merged[merged.length - 1];
      if (!last || block.start > last.end) {
        merged.push({ ...block });
      } else {
        last.end = Math.max(last.end, block.end);
      }
    });

    const gaps = [];
    let cursor = DAY_START;
    merged.forEach((block) => {
      if (block.start - cursor >= 15) {
        gaps.push({ start: cursor, end: block.start });
      }
      cursor = Math.max(cursor, block.end);
    });
    if (DAY_END - cursor >= 15) {
      gaps.push({ start: cursor, end: DAY_END });
    }

    if (!gaps.length) {
      freeTimeList.append(createListItem("8:00-22:00の間に15分以上の空き時間はありません。"));
      return;
    }

    gaps.forEach((gap) => {
      const minutes = gap.end - gap.start;
      freeTimeList.append(createListItem(`${minutesToTime(gap.start)}-${minutesToTime(gap.end)} / ${minutes}分`));
    });
  }

  function createTimelineRow(time, title, meta, isTravel, eventId = "") {
    const row = document.createElement("div");
    row.className = "timeline-row";

    const timeNode = document.createElement("div");
    timeNode.className = "timeline-time";
    timeNode.textContent = time;

    const item = document.createElement("div");
    item.className = `timeline-item${isTravel ? " travel" : ""}`;
    if (!isTravel && eventId && eventId === animatedEventId) {
      item.classList.add("just-added");
    }

    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = meta;

    item.append(strong, span);
    if (!isTravel && eventId) {
      const editButton = document.createElement("button");
      editButton.className = "timeline-delete";
      editButton.type = "button";
      editButton.textContent = "編集";
      editButton.addEventListener("click", () => editEvent(eventId));
      const deleteButton = document.createElement("button");
      deleteButton.className = "timeline-delete";
      deleteButton.type = "button";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", () => deleteEvent(eventId));
      item.append(editButton, deleteButton);
    }
    row.append(timeNode, item);
    return row;
  }

  function deleteEvent(eventId) {
    const target = events.find((item) => item.id === eventId);
    if (!target) {
      return;
    }
    const ok = window.confirm(`「${target.title}」を削除しますか？`);
    if (!ok) {
      return;
    }
    if (notificationTimers.has(eventId)) {
      window.clearTimeout(notificationTimers.get(eventId));
      notificationTimers.delete(eventId);
    }
    events = events.filter((item) => item.id !== eventId);
    saveEvents();
    render();
    renderRouteList([]);
    setRouteStatus("予定を削除しました。必要なら現在地から移動時間を調べ直してください。");
  }

  function editEvent(eventId) {
    const target = events.find((item) => item.id === eventId);
    if (!target) {
      return;
    }

    const title = promptClean("予定名", target.title, 48);
    if (title === null) return;
    const date = promptDate("日付", target.date);
    if (date === null) return;
    const start = promptTime("開始時刻", target.start || "10:00");
    if (start === null) return;
    const end = promptTime("終了時刻", target.end || minutesToTime(Math.min(timeToMinutes(start) + 60, 23 * 60 + 59)));
    if (end === null) return;
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      showSummary("終了時刻は開始時刻より後にしてください。編集をやり直してください。");
      return;
    }
    let location = promptClean("場所", target.location || "", 48);
    if (location === null) return;
    if (!location) {
      const inferredLocation = inferLocationFromTitle(title);
      if (inferredLocation && window.confirm(`予定名から「${inferredLocation}」を場所として検出しました。この予定の場所ですか？`)) {
        location = inferredLocation;
      }
    }
    const travelMinutes = promptNumber("移動時間（分）", Number(target.travelMinutes || 0), 0, 240);
    if (travelMinutes === null) return;

    const locationChanged = location !== (target.location || "");
    const updated = {
      ...target,
      title,
      date,
      start,
      end,
      location,
      travelMinutes,
      place: locationChanged ? null : target.place,
      placePending: Boolean(location && locationChanged),
      updatedAt: new Date().toISOString(),
    };

    events = events.map((item) => item.id === eventId ? updated : item);
    pruneExpiredEvents();
    saveEvents();
    if (notificationTimers.has(eventId)) {
      window.clearTimeout(notificationTimers.get(eventId));
      notificationTimers.delete(eventId);
    }
    const stillExists = events.some((item) => item.id === eventId);
    if (stillExists) {
      scheduleEventNotification(updated);
    }
    if (stillExists && updated.placePending) {
      enrichEventPlaceInBackground(updated);
    }
    viewDateInput.value = updated.date;
    activeRouteEventId = "";
    renderRouteList([]);
    render();
    setRouteStatus("予定を編集しました。場所を変えた場合は候補を探し直します。");
  }

  function promptClean(label, currentValue, maxLength) {
    const value = window.prompt(`${label}を入力してください。`, currentValue || "");
    if (value === null) {
      return null;
    }
    return cleanText(value, maxLength);
  }

  function promptDate(label, currentValue) {
    const value = window.prompt(`${label}を YYYY-MM-DD で入力してください。`, currentValue || today);
    if (value === null) {
      return null;
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  function promptTime(label, currentValue) {
    const value = window.prompt(`${label}を HH:MM で入力してください。`, currentValue || "10:00");
    if (value === null) {
      return null;
    }
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
  }

  function promptNumber(label, currentValue, min, max) {
    const value = window.prompt(`${label}を入力してください。`, String(currentValue || 0));
    if (value === null) {
      return null;
    }
    return clampNumber(value, min, max);
  }

  function pruneExpiredEvents(options = {}) {
    const now = new Date();
    const before = events.length;
    const expired = [];
    events = events.filter((event) => {
      if (!isEventEnded(event, now)) {
        return true;
      }
      expired.push(event);
      if (notificationTimers.has(event.id)) {
        window.clearTimeout(notificationTimers.get(event.id));
        notificationTimers.delete(event.id);
      }
      return false;
    });

    if (!expired.length) {
      return 0;
    }

    saveEvents();
    if (!options.silent) {
      const names = expired.slice(0, 3).map((event) => event.title).join("、");
      const extra = expired.length > 3 ? ` ほか${expired.length - 3}件` : "";
      expiredNotice = `終了時刻を過ぎた予定を${expired.length}件、自動削除しました: ${names}${extra}`;
    }
    if (before !== events.length) {
      activeRouteEventId = "";
    }
    return expired.length;
  }

  function isEventEnded(event, now = new Date()) {
    if (!event || !event.date) {
      return false;
    }
    const endAt = new Date(`${event.date}T${event.end || event.start || "23:59"}`);
    return !Number.isNaN(endAt.getTime()) && endAt <= now;
  }

  function createEmptyState(text) {
    const node = document.createElement("div");
    node.className = "empty-state";
    node.textContent = text;
    return node;
  }

  function createListItem(text) {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }

  function getLocalEventsKey() {
    if (plannerStorageMode === "user" && plannerUserId) {
      return `${STORAGE_KEY}:user:${plannerUserId}`;
    }
    if (plannerStorageMode === "test") {
      return `${STORAGE_KEY}:test`;
    }
    return STORAGE_KEY;
  }

  function loadEvents(key = getLocalEventsKey()) {
    try {
      const storage = plannerStorageMode === "test" ? sessionStorage : localStorage;
      const parsed = JSON.parse(storage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveEvents() {
    const storage = plannerStorageMode === "test" ? sessionStorage : localStorage;
    storage.setItem(getLocalEventsKey(), JSON.stringify(events));
    if (plannerStorageMode === "user" && plannerUserId) {
      scheduleCloudSync();
    }
  }

  async function loadUserEvents(session) {
    if (!session || !session.user) {
      events = [];
      return;
    }
    plannerUserId = session.user.id;
    events = loadEvents(getLocalEventsKey());
    if (!plannerSupabase) {
      showCloudStorageWarning("クラウド保存を読み込めませんでした。この端末内の予定だけを表示しています。");
      return;
    }

    const { data, error } = await plannerSupabase
      .from(CLOUD_EVENTS_TABLE)
      .select("id,payload,updated_at,created_at")
      .eq("user_id", plannerUserId)
      .order("created_at", { ascending: false });

    if (error) {
      showCloudStorageWarning(`クラウド予定を読み込めませんでした: ${getErrorText(error)}`);
      return;
    }

    events = (Array.isArray(data) ? data : [])
      .map((row) => normalizeCloudEvent(row))
      .filter(Boolean);
    localStorage.setItem(getLocalEventsKey(), JSON.stringify(events));
  }

  function normalizeCloudEvent(row) {
    if (!row) {
      return null;
    }
    const payload = row.payload && typeof row.payload === "object" ? row.payload : row;
    if (!payload.title || !payload.date) {
      return null;
    }
    return {
      ...payload,
      id: payload.id || row.id || createId(),
    };
  }

  function scheduleCloudSync() {
    if (cloudSyncTimer !== null) {
      window.clearTimeout(cloudSyncTimer);
    }
    cloudSyncTimer = window.setTimeout(syncCloudEventsNow, 500);
  }

  async function syncCloudEventsNow() {
    cloudSyncTimer = null;
    if (cloudSyncInFlight || plannerStorageMode !== "user" || !plannerUserId || !plannerSupabase) {
      return;
    }
    cloudSyncInFlight = true;
    try {
      const rows = events.map((event) => ({
        id: event.id,
        user_id: plannerUserId,
        payload: event,
        created_at: event.createdAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { data: existing, error: selectError } = await plannerSupabase
        .from(CLOUD_EVENTS_TABLE)
        .select("id")
        .eq("user_id", plannerUserId);
      if (selectError) {
        throw selectError;
      }

      const currentIds = new Set(events.map((event) => event.id));
      const staleIds = (Array.isArray(existing) ? existing : [])
        .map((row) => row.id)
        .filter((id) => !currentIds.has(id));
      if (staleIds.length) {
        const { error: deleteError } = await plannerSupabase
          .from(CLOUD_EVENTS_TABLE)
          .delete()
          .eq("user_id", plannerUserId)
          .in("id", staleIds);
        if (deleteError) {
          throw deleteError;
        }
      }

      if (rows.length) {
        const { error: upsertError } = await plannerSupabase
          .from(CLOUD_EVENTS_TABLE)
          .upsert(rows, { onConflict: "id" });
        if (upsertError) {
          throw upsertError;
        }
      }
    } catch (error) {
      showCloudStorageWarning(`クラウド予定を保存できませんでした: ${getErrorText(error)}`);
    } finally {
      cloudSyncInFlight = false;
    }
  }

  function showCloudStorageWarning(message) {
    if (plannerCloudWarningShown) {
      return;
    }
    plannerCloudWarningShown = true;
    setPlannerAuthStatus(message, "warning");
  }

  function scheduleUpcomingNotifications() {
    if (plannerStorageMode === "test") {
      clearNotificationTimers();
      return;
    }
    clearNotificationTimers();
    events.forEach(scheduleEventNotification);
  }

  function prepareNotificationPermission() {
    if (!("Notification" in window)) {
      return Promise.resolve("unsupported");
    }
    if (Notification.permission === "default") {
      return Notification.requestPermission();
    }
    return Promise.resolve(Notification.permission);
  }

  async function scheduleEventNotification(event, permissionPromise) {
    if (plannerStorageMode === "test") {
      return;
    }
    if (!event || !event.date || !event.start || event.inferredTime || !event.place) {
      return;
    }
    if (!("Notification" in window)) {
      showSummary("このブラウザは通知に対応していません。");
      return;
    }

    const permission = permissionPromise ? await permissionPromise : Notification.permission;
    if (permission !== "granted") {
      showSummary("通知が許可されていないため、予定前の通知は表示できません。");
      return;
    }

    const eventAt = new Date(`${event.date}T${event.start}`);
    const notifyLeadMinutes = Math.max(15, Math.min(120, Number(event.travelMinutes || 30)));
    const notifyAt = new Date(eventAt.getTime() - notifyLeadMinutes * 60 * 1000);
    const delay = notifyAt.getTime() - Date.now();

    if (delay < -60 * 1000 || delay > 24 * 60 * 60 * 1000) {
      return;
    }

    const timerDelay = Math.max(1000, delay);
    if (notificationTimers.has(event.id)) {
      window.clearTimeout(notificationTimers.get(event.id));
    }

    const timerId = window.setTimeout(() => {
      const crowd = event.place && event.place.crowd ? event.place.crowd.level : "未取得";
      const reason = event.place && event.place.crowd ? event.place.crowd.reason : "場所情報なし";
      new Notification("予定が近づいています", {
        body: `${event.start} ${event.title} / ${event.location || "場所未設定"} / 混雑目安: ${crowd}（${reason}）`,
      });
      notificationTimers.delete(event.id);
    }, timerDelay);

    notificationTimers.set(event.id, timerId);
  }

  function clearNotificationTimers() {
    notificationTimers.forEach((timerId) => window.clearTimeout(timerId));
    notificationTimers.clear();
  }

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `event-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function showSummary(text) {
    summary.textContent = text;
  }

  function cleanText(value, maxLength) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function clampNumber(value, min, max) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) {
      return min;
    }
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function timeToMinutes(value) {
    const [hours, minutes] = String(value).split(":").map(Number);
    return hours * 60 + minutes;
  }

  function minutesToTime(value) {
    const minutes = Math.max(0, Math.min(23 * 60 + 59, value));
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }

  function setDefaultEventDateTime(preferredDate) {
    const now = new Date();
    let date = preferredDate || toDateInputValue(now);
    let startMinutes = Math.ceil((now.getHours() * 60 + now.getMinutes() + 20) / 15) * 15;
    if (preferredDate && preferredDate !== toDateInputValue(now)) {
      startMinutes = 10 * 60;
    } else if (startMinutes < 8 * 60) {
      startMinutes = 10 * 60;
    } else if (startMinutes + 60 > 23 * 60 + 59) {
      date = addDays(now, 1);
      startMinutes = 10 * 60;
    }
    dateInput.value = date;
    startInput.value = minutesToTime(startMinutes);
    endInput.value = minutesToTime(Math.min(startMinutes + 60, 23 * 60 + 59));
  }

  function toDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return toDateInputValue(next);
  }

  function formatDate(value) {
    const [year, month, day] = value.split("-");
    return `${year}/${month}/${day}`;
  }
})();
