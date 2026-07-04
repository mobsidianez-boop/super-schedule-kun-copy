(() => {
  const STORAGE_KEY = "superScheduleKunEvents";
  const ACCESS_KEY = "superScheduleKunPlannerAccess";
  const ACCESS_CODE = String.fromCharCode(78, 111, 67, 111, 100, 101, 84, 101, 115, 116);
  const DAY_START = 8 * 60;
  const DAY_END = 22 * 60;
  const CONFIG = window.SUPER_SCHEDULE_CONFIG || {};
  const plannerSupabase = window.supabase && CONFIG.supabaseUrl && CONFIG.supabaseAnonKey
    ? window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
    : null;

  const plannerGate = document.querySelector("#planner-gate");
  const plannerApp = document.querySelector("#planner-app");
  const plannerAuthForm = document.querySelector("#planner-auth-form");
  const plannerAuthEmail = document.querySelector("#planner-auth-email");
  const plannerAuthPassword = document.querySelector("#planner-auth-password");
  const plannerSignupButton = document.querySelector("#planner-signup-button");
  const plannerAccessCode = document.querySelector("#planner-access-code");
  const plannerCodeButton = document.querySelector("#planner-code-button");
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
  const timelineBoard = document.querySelector("#timeline-board");
  const freeTimeList = document.querySelector("#free-time-list");

  if (!form || !timelineBoard) {
    return;
  }

  let events = loadEvents();
  let detectedCandidate = null;
  let plannerUnlocked = false;
  const notificationTimers = new Map();
  let plannerMap = null;
  let overviewMarker = null;
  let currentMarker = null;
  let eventMarkers = [];
  let routeLines = [];
  let currentPosition = null;
  let locationWatchId = null;

  const today = toDateInputValue(new Date());
  dateInput.value = today;
  viewDateInput.value = today;
  startInput.value = "10:00";
  endInput.value = "11:00";
  initPlannerAccess();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ensurePlannerAccess()) {
      return;
    }
    const permissionPromise = prepareNotificationPermission();
    const nextEvent = await readFormEvent();
    if (!nextEvent) {
      return;
    }
    events = [nextEvent, ...events];
    saveEvents();
    scheduleEventNotification(nextEvent, permissionPromise);
    enrichEventPlaceInBackground(nextEvent);
    viewDateInput.value = nextEvent.date;
    form.reset();
    dateInput.value = nextEvent.date;
    startInput.value = "10:00";
    endInput.value = "11:00";
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
    saveEvents();
    clearNotificationTimers();
    render();
  });

  viewDateInput.addEventListener("change", () => {
    if (!plannerUnlocked) {
      return;
    }
    render();
    renderRouteList([]);
    setRouteStatus("現在地と予定場所を地図で確認できます。");
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
    if (!ensurePlannerAccess()) {
      return;
    }
    if (!detectedCandidate) {
      return;
    }
    const permissionPromise = prepareNotificationPermission();
    const nextEvent = { ...detectedCandidate, id: createId(), createdAt: new Date().toISOString() };
    events = [nextEvent, ...events];
    saveEvents();
    scheduleEventNotification(nextEvent, permissionPromise);
    enrichEventPlaceInBackground(nextEvent);
    viewDateInput.value = detectedCandidate.date;
    detectText.value = "";
    detectedCandidate = null;
    candidateBox.hidden = true;
    render();
  });

  if (plannerAuthForm) {
    plannerAuthForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await loginPlanner();
    });
  }

  if (plannerSignupButton) {
    plannerSignupButton.addEventListener("click", signupPlanner);
  }

  if (plannerCodeButton) {
    plannerCodeButton.addEventListener("click", unlockWithCode);
  }

  async function initPlannerAccess() {
    lockPlanner();

    if (localStorage.getItem(ACCESS_KEY) === ACCESS_CODE) {
      unlockPlanner("開発者テストモードで開いています。");
      return;
    }

    if (!plannerSupabase) {
      setPlannerAuthStatus("ログイン機能を読み込めませんでした。開発者テストコードでも開けます。", "warning");
      return;
    }

    plannerSupabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        unlockPlanner("ログイン中です。予定アプリを使えます。");
      } else if (localStorage.getItem(ACCESS_KEY) !== ACCESS_CODE) {
        lockPlanner();
      }
    });

    const { data } = await plannerSupabase.auth.getSession();
    if (data.session) {
      unlockPlanner("ログイン中です。予定アプリを使えます。");
    }
  }

  async function loginPlanner() {
    if (!plannerSupabase) {
      setPlannerAuthStatus("ログイン機能を読み込めませんでした。開発者テストコードでも開けます。", "error");
      return;
    }

    const email = plannerAuthEmail.value.trim();
    const password = plannerAuthPassword.value;
    if (!email || !password) {
      setPlannerAuthStatus("メールアドレスとパスワードを入力してください。", "warning");
      return;
    }

    setPlannerAuthStatus("ログインしています。");
    const { data, error } = await plannerSupabase.auth.signInWithPassword({ email, password });
    if (error) {
      setPlannerAuthStatus(`ログインできませんでした: ${getErrorText(error)}`, "error");
      return;
    }
    if (data.session) {
      unlockPlanner("ログイン中です。予定アプリを使えます。");
    }
  }

  async function signupPlanner() {
    if (!plannerSupabase) {
      setPlannerAuthStatus("ログイン機能を読み込めませんでした。開発者テストコードでも開けます。", "error");
      return;
    }

    const email = plannerAuthEmail.value.trim();
    const password = plannerAuthPassword.value;
    if (!email || !password) {
      setPlannerAuthStatus("メールアドレスとパスワードを入力してください。", "warning");
      return;
    }

    setPlannerAuthStatus("登録しています。");
    const { data, error } = await plannerSupabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: CONFIG.authRedirectUrl || window.location.href,
      },
    });

    if (error) {
      setPlannerAuthStatus(`登録できませんでした: ${getErrorText(error)}`, "error");
      return;
    }

    if (data.session) {
      unlockPlanner("登録してログインしました。予定アプリを使えます。");
      return;
    }

    setPlannerAuthStatus("登録しました。確認メールが必要な設定の場合は、メール内のリンクを開いてからログインしてください。", "success");
  }

  function unlockWithCode() {
    if (plannerAccessCode.value.trim() !== ACCESS_CODE) {
      setPlannerAuthStatus("テストコードが違います。", "error");
      return;
    }
    localStorage.setItem(ACCESS_KEY, ACCESS_CODE);
    unlockPlanner("開発者テストモードで開いています。");
  }

  function lockPlanner() {
    plannerUnlocked = false;
    if (plannerGate) {
      plannerGate.hidden = false;
    }
    if (plannerApp) {
      plannerApp.hidden = true;
    }
    setPlannerAuthStatus("予定アプリはログイン後に使えます。", "warning");
  }

  function unlockPlanner(message) {
    plannerUnlocked = true;
    if (plannerGate) {
      plannerGate.hidden = true;
    }
    if (plannerApp) {
      plannerApp.hidden = false;
    }
    setPlannerAuthStatus(message, "success");
    render();
    initializeMapOverview();
    startCurrentLocationTracking();
    scheduleUpcomingNotifications();
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
    const location = cleanText(locationInput.value, 48);
    const travelMinutes = clampNumber(travelInput.value, 0, 240);

    if (!title || !date || !start || !end) {
      showSummary("予定名・日付・開始・終了を入力してください。");
      return null;
    }

    if (timeToMinutes(end) <= timeToMinutes(start)) {
      showSummary("終了時刻は開始時刻より後にしてください。");
      return null;
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

    if (location) {
      const confirmed = window.confirm(`「${location}」はこの予定の場所ですか？`);
      if (confirmed) {
        event.placePending = true;
      }
    }

    return event;
  }

  function detectSchedule(rawText) {
    const text = cleanText(rawText, 280);
    if (!text) {
      showSummary("候補にしたい文章を入力してください。");
      return null;
    }

    const scheduleText = pickScheduleText(text);
    if (!scheduleText) {
      showSummary("予定に関する日時や用事が見つかりませんでした。予定が書かれた部分だけを貼り付けてください。");
      return null;
    }

    const base = new Date();
    const date = detectDate(scheduleText, base);
    const start = detectTime(scheduleText);
    if (!date || !start) {
      showSummary("予定の候補には日付と時刻が必要です。例: 明日18:30 渋谷で打ち合わせ");
      return null;
    }

    const startMinutes = timeToMinutes(start);
    const end = minutesToTime(Math.min(startMinutes + 60, 23 * 60 + 59));
    const location = detectLocation(scheduleText);
    const title = detectTitle(scheduleText, location);
    if (!title || title === location) {
      showSummary("用事の名前を検出できませんでした。日時と用事名が分かる文章で試してください。");
      return null;
    }

    return {
      title,
      date,
      start,
      end,
      location,
      travelMinutes: location ? 30 : 0,
    };
  }

  function pickScheduleText(text) {
    const lines = text
      .split(/[\n。！？!?]/)
      .map((line) => line.trim())
      .filter(Boolean);
    const candidates = lines.length ? lines : [text];

    const scored = candidates
      .map((line) => ({ line, score: scoreScheduleLine(line) }))
      .filter((item) => item.score >= 4)
      .sort((a, b) => b.score - a.score);

    return scored[0] ? scored[0].line : "";
  }

  function scoreScheduleLine(line) {
    let score = 0;
    if (hasDateSignal(line)) score += 2;
    if (hasTimeSignal(line)) score += 2;
    if (hasEventWord(line)) score += 2;
    if (detectLocation(line)) score += 1;
    if (/よろしく|ありがとう|お疲れ|確認|返信|添付|画像|スクショ/.test(line)) score -= 1;
    return score;
  }

  function hasDateSignal(text) {
    return /(20\d{2}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}|\d{1,2}月\d{1,2}日|今日|きょう|明日|あした|明後日|あさって|月曜|火曜|水曜|木曜|金曜|土曜|日曜)/.test(text);
  }

  function hasTimeSignal(text) {
    return /([01]?\d|2[0-3]):[0-5]\d|([01]?\d|2[0-3])時(?:[0-5]?\d分?)?/.test(text);
  }

  function hasEventWord(text) {
    return /(会議|打ち合わせ|ミーティング|面談|面接|予約|集合|待ち合わせ|ランチ|飲み|食事|シフト|授業|講義|試験|テスト|提出|締切|病院|美容院|歯医者|イベント|ライブ|説明会|面会|出勤|退勤)/.test(text);
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
      const result = await window.Tesseract.recognize(file, "jpn+eng", {
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
      setOcrStatus("読み取りました。候補を作成しました。", 1);
      await makeCandidateFromText();
    } catch (error) {
      setOcrStatus(`読み取れませんでした: ${getErrorText(error)}`, 0);
    }
  }

  async function makeCandidateFromText() {
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
  }

  async function enrichCandidatePlaceInBackground(candidate) {
    if (!candidate || !candidate.location) {
      return;
    }
    setCandidatePlaceStatus("場所の座標と混雑目安を調べています。");
    try {
      const place = await fetchPlaceIntel(candidate.location, candidate);
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

  function cleanOcrText(value) {
    return String(value || "")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 280);
  }

  function getErrorText(error) {
    if (!error) {
      return "原因不明のエラーです。";
    }
    return error.message || String(error);
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
      const params = new URLSearchParams({
        format: "jsonv2",
        q: location,
        limit: "1",
        addressdetails: "1",
        extratags: "1",
        "accept-language": "ja",
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
      if (!response.ok) {
        return fallback;
      }

      const places = await response.json();
      const place = Array.isArray(places) ? places[0] : null;
      if (!place) {
        return {
          ...fallback,
          source: "座標候補が見つからなかったため、地名と時刻だけから作った混雑目安です。",
        };
      }

      const osmType = String(place.osm_type || "").toLowerCase();
      const osmId = place.osm_id;
      const mapUrl = osmType && osmId ? `https://www.openstreetmap.org/${osmType}/${osmId}` : "";

      return {
        query: location,
        displayName: place.display_name || location,
        lat: Number(place.lat),
        lon: Number(place.lon),
        category: [place.category, place.type].filter(Boolean).join(" / "),
        mapUrl,
        crowd: estimateCrowd(place, event),
        source: "OpenStreetMapの場所情報と予定時刻から作った混雑目安です。リアルタイム人流ではありません。",
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return fallback;
    }
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
    window.setTimeout(() => plannerMap.invalidateSize(), 120);
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
        initMap(currentPosition, 15);
        updateCurrentPositionMarker(currentPosition);
        setRouteStatus(`現在地を表示しています。精度目安: 約${Math.round(currentPosition.accuracy || 0)}m`);
      },
      (error) => {
        setRouteStatus(`現在地を取得できませんでした: ${error.message || "位置情報が許可されていません。"}`);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30 * 1000 },
    );
  }

  async function handleRouteLookup() {
    const dayEvents = getSelectedDayEvents().filter((item) => item.location);
    if (!navigator.geolocation) {
      setRouteStatus("このブラウザは現在地取得に対応していません。");
      return;
    }

    if (!window.L) {
      setRouteStatus("地図ライブラリを読み込めませんでした。通信状態を確認してください。");
      return;
    }

    locateRoutesButton.disabled = true;
    setRouteStatus("現在地を取得しています。");

    try {
      const current = currentPosition || await getCurrentPosition();
      currentPosition = current;
      const routeResults = [];
      initMap(current, 15);
      clearMapLayers();
      drawCurrentPosition(current);

      if (!dayEvents.length) {
        renderRouteList([]);
        plannerMap.setView([current.lat, current.lon], 15);
        setRouteStatus("現在地を地図に表示しました。表示日の予定に場所がないため、移動時間は未表示です。");
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
          const route = await fetchRouteEstimate(current, event.place);
          routeResults.push({ event, route });
          drawEventRoute(event, route);
        } catch (error) {
          routeResults.push({
            event,
            status: `移動時間を取得できませんでした: ${getErrorText(error)}`,
          });
          drawEventRoute(event, null);
        }
      }

      saveEvents();
      render();
      renderRouteList(routeResults);
      fitMapToContent(current, routeResults);
      setRouteStatus("現在地から予定場所への移動時間を表示しています。渋滞情報はリアルタイム交通API未設定のため目安です。");
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
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
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

  async function fetchRouteEstimate(current, place) {
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

    return {
      durationMinutes: Math.max(1, Math.round(route.duration / 60)),
      distanceKm: Math.round((route.distance / 1000) * 10) / 10,
      geometry: route.geometry,
      trafficNote: "OSRMはリアルタイム渋滞情報に非対応です。渋滞確認には交通情報APIの追加が必要です。",
    };
  }

  function initMap(current, zoom = 13) {
    if (!plannerMap) {
      plannerMap = window.L.map(mapContainer).setView([current.lat, current.lon], zoom);
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(plannerMap);
    } else {
      plannerMap.setView([current.lat, current.lon], zoom);
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
      radius: 10,
      color: "#1769aa",
      weight: 3,
      fillColor: "#42a5f5",
      fillOpacity: 0.85,
    });
    const accuracyCircle = Number.isFinite(current.accuracy)
      ? window.L.circle([current.lat, current.lon], {
          radius: Math.min(Math.max(current.accuracy, 20), 1000),
          color: "#1769aa",
          weight: 1,
          fillColor: "#42a5f5",
          fillOpacity: 0.08,
        })
      : null;
    const marker = window.L.marker([current.lat, current.lon]);
    currentMarker = window.L.layerGroup([accuracyCircle, circle, marker].filter(Boolean))
      .addTo(plannerMap)
      .bindPopup("現在地");
  }

  function drawEventRoute(event, route) {
    const marker = window.L.marker([event.place.lat, event.place.lon])
      .addTo(plannerMap)
      .bindPopup(`${event.title}<br>${event.location}`);
    eventMarkers.push(marker);

    if (route && route.geometry) {
      const line = window.L.geoJSON(route.geometry, {
        style: { color: "#2f7f83", weight: 5, opacity: 0.75 },
      }).addTo(plannerMap);
      routeLines.push(line);
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
      const title = document.createElement("strong");
      title.textContent = event.title;
      item.append(title);

      if (route) {
        item.append(createTextSpan(`${event.location}: 約${route.durationMinutes}分 / ${route.distanceKm}km`));
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

  function setRouteStatus(text) {
    if (routeStatus) {
      routeStatus.textContent = text;
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
    const ymd = text.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
    if (ymd) {
      return toDateInputValue(new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    }

    const md = text.match(/(?:^|[^\d])(\d{1,2})[/-](\d{1,2})(?:[^\d]|$)/);
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
    const colon = text.match(/([01]?\d|2[0-3]):([0-5]\d)/);
    if (colon) {
      return `${colon[1].padStart(2, "0")}:${colon[2]}`;
    }

    const japanese = text.match(/([01]?\d|2[0-3])時(?:([0-5]?\d)分?)?/);
    if (japanese) {
      return `${japanese[1].padStart(2, "0")}:${(japanese[2] || "00").padStart(2, "0")}`;
    }

    return "";
  }

  function detectLocation(text) {
    const normalized = stripDateTime(text);
    const explicit = normalized.match(/(?:場所|会場|集合場所|行き先)[:：]?\s*([^\s、。]{2,32})/);
    if (explicit) {
      return cleanLocation(explicit[1]);
    }

    const atPlace = normalized.match(/([^\s、。でに]{2,32})(?:で|にて)/);
    if (atPlace) {
      return cleanLocation(atPlace[1]);
    }

    const suffixPlace = normalized.match(/([^\s、。]{1,24}(?:駅|店|カフェ|ホール|大学|高校|学校|公園|病院|美容院|歯医者|スタジオ|オフィス|ビル|会館|センター|空港|ターミナル))/);
    return cleanLocation(suffixPlace ? suffixPlace[1] : "");
  }

  function detectTitle(text, location) {
    const withoutDate = stripDateTime(text)
      .replace(/月曜|火曜|水曜|木曜|金曜|土曜|日曜|[月火水木金土日]曜日/g, "")
      .replace(location, "")
      .replace(/場所[:：]?|会場[:：]?|集合場所[:：]?|行き先[:：]?/g, "")
      .replace(/で|にて|集合|予定|予約/g, " ")
      .replace(/よろしく|お願いします|です|ます/g, " ")
      .replace(/[、。]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const eventWord = withoutDate.match(/(会議|打ち合わせ|ミーティング|面談|面接|ランチ|飲み|食事|シフト|授業|講義|試験|テスト|提出|締切|病院|美容院|歯医者|イベント|ライブ|説明会|面会|出勤|退勤)/);
    return cleanText(eventWord ? eventWord[1] : withoutDate, 48);
  }

  function stripDateTime(text) {
    return String(text || "")
      .replace(/20\d{2}[/-]\d{1,2}[/-]\d{1,2}/g, " ")
      .replace(/\d{1,2}[/-]\d{1,2}/g, " ")
      .replace(/\d{1,2}月\d{1,2}日/g, " ")
      .replace(/([01]?\d|2[0-3]):[0-5]\d/g, " ")
      .replace(/([01]?\d|2[0-3])時(?:[0-5]?\d分?)?/g, " ")
      .replace(/明後日|あさって|明日|あした|今日|きょう/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanLocation(value) {
    return cleanText(value, 48)
      .replace(/^(場所|会場|集合場所|行き先)[:：]?/, "")
      .replace(/^(は|が|を|に)/, "")
      .replace(/(で|にて|集合|予定|予約).*$/, "")
      .trim();
  }

  function showCandidate(candidate) {
    if (!candidate) {
      candidateBox.hidden = true;
      if (candidatePlace) {
        candidatePlace.hidden = true;
        candidatePlace.replaceChildren();
      }
      return;
    }
    candidateTitle.textContent = candidate.title;
    candidateMeta.textContent = [
      formatDate(candidate.date),
      `${candidate.start}-${candidate.end}`,
      candidate.location ? `場所: ${candidate.location}` : "場所未設定",
      candidate.travelMinutes ? `移動${candidate.travelMinutes}分` : "移動なし",
    ].join(" / ");
    renderPlaceIntel(candidate.place);
    candidateBox.hidden = false;
  }

  function setCandidatePlaceStatus(text) {
    if (!candidatePlace) {
      showSummary(text);
      return;
    }
    candidatePlace.replaceChildren(createTextBlock(text));
    candidatePlace.hidden = false;
  }

  function renderPlaceIntel(place) {
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
      link.textContent = "地図で確認";
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
      .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    renderTimeline(dayEvents);
    renderFreeTime(dayEvents);
    showSummary(`${formatDate(date)}: ${dayEvents.length}件の予定`);
  }

  function renderTimeline(dayEvents) {
    timelineBoard.innerHTML = "";
    if (!dayEvents.length) {
      timelineBoard.append(createEmptyState("この日の予定はまだありません。"));
      return;
    }

    dayEvents.forEach((item) => {
      if (item.travelMinutes > 0) {
        timelineBoard.append(createTimelineRow(
          minutesToTime(Math.max(DAY_START, timeToMinutes(item.start) - item.travelMinutes)),
          `${item.title} まで移動`,
          item.location ? `行き先: ${item.location}` : "移動時間メモ",
          true,
        ));
      }
      timelineBoard.append(createTimelineRow(
        `${item.start}-${item.end}`,
        item.title,
        makeEventMeta(item),
        false,
        item.id,
      ));
    });
  }

  function makeEventMeta(item) {
    const parts = [item.location ? `場所: ${item.location}` : "場所未設定"];
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

    const strong = document.createElement("strong");
    strong.textContent = title;
    const span = document.createElement("span");
    span.textContent = meta;

    item.append(strong, span);
    if (!isTravel && eventId) {
      const deleteButton = document.createElement("button");
      deleteButton.className = "timeline-delete";
      deleteButton.type = "button";
      deleteButton.textContent = "削除";
      deleteButton.addEventListener("click", () => deleteEvent(eventId));
      item.append(deleteButton);
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

  function loadEvents() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveEvents() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }

  function scheduleUpcomingNotifications() {
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
    if (!event || !event.date || !event.start || !event.place) {
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
