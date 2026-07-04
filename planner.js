(() => {
  const STORAGE_KEY = "superScheduleKunEvents";
  const DAY_START = 8 * 60;
  const DAY_END = 22 * 60;

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
  const candidateAddButton = document.querySelector("#candidate-add-button");
  const viewDateInput = document.querySelector("#view-date");
  const summary = document.querySelector("#planner-summary");
  const timelineBoard = document.querySelector("#timeline-board");
  const freeTimeList = document.querySelector("#free-time-list");

  if (!form || !timelineBoard) {
    return;
  }

  let events = loadEvents();
  let detectedCandidate = null;

  const today = toDateInputValue(new Date());
  dateInput.value = today;
  viewDateInput.value = today;
  startInput.value = "10:00";
  endInput.value = "11:00";
  render();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextEvent = readFormEvent();
    if (!nextEvent) {
      return;
    }
    events = [nextEvent, ...events];
    saveEvents();
    viewDateInput.value = nextEvent.date;
    form.reset();
    dateInput.value = nextEvent.date;
    startInput.value = "10:00";
    endInput.value = "11:00";
    render();
  });

  clearButton.addEventListener("click", () => {
    if (!events.length) {
      return;
    }
    const ok = window.confirm("保存済みの予定をすべて削除しますか？");
    if (!ok) {
      return;
    }
    events = [];
    saveEvents();
    render();
  });

  viewDateInput.addEventListener("change", render);

  detectForm.addEventListener("submit", (event) => {
    event.preventDefault();
    makeCandidateFromText();
  });

  if (ocrImageInput) {
    ocrImageInput.addEventListener("change", handleImageSelection);
  }

  candidateAddButton.addEventListener("click", () => {
    if (!detectedCandidate) {
      return;
    }
    events = [{ ...detectedCandidate, id: createId(), createdAt: new Date().toISOString() }, ...events];
    saveEvents();
    viewDateInput.value = detectedCandidate.date;
    detectText.value = "";
    detectedCandidate = null;
    candidateBox.hidden = true;
    render();
  });

  function readFormEvent() {
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

    return {
      id: createId(),
      title,
      date,
      start,
      end,
      location,
      travelMinutes,
      createdAt: new Date().toISOString(),
    };
  }

  function detectSchedule(rawText) {
    const text = cleanText(rawText, 240);
    if (!text) {
      showSummary("候補にしたい文章を入力してください。");
      return null;
    }

    const base = new Date();
    const date = detectDate(text, base);
    const start = detectTime(text) || "10:00";
    const startMinutes = timeToMinutes(start);
    const end = minutesToTime(Math.min(startMinutes + 60, 23 * 60 + 59));
    const location = detectLocation(text);
    const title = detectTitle(text, location);

    return {
      title,
      date,
      start,
      end,
      location,
      travelMinutes: location ? 30 : 0,
    };
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
      makeCandidateFromText();
    } catch (error) {
      setOcrStatus(`読み取れませんでした: ${getErrorText(error)}`, 0);
    }
  }

  function makeCandidateFromText() {
    detectedCandidate = detectSchedule(detectText.value);
    showCandidate(detectedCandidate);
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

    if (text.includes("明後日") || text.includes("あさって")) {
      return addDays(base, 2);
    }
    if (text.includes("明日") || text.includes("あした")) {
      return addDays(base, 1);
    }
    return toDateInputValue(base);
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
    const atPlace = text.match(/([^\s、。]{2,24})(?:で|にて)/);
    return cleanText(atPlace ? atPlace[1] : "", 48);
  }

  function detectTitle(text, location) {
    const withoutDate = text
      .replace(/20\d{2}[/-]\d{1,2}[/-]\d{1,2}/g, "")
      .replace(/\d{1,2}[/-]\d{1,2}/g, "")
      .replace(/([01]?\d|2[0-3]):[0-5]\d/g, "")
      .replace(/([01]?\d|2[0-3])時(?:[0-5]?\d分?)?/g, "")
      .replace(/明後日|あさって|明日|あした|今日|きょう/g, "")
      .replace(location, "")
      .replace(/で|にて/g, "")
      .trim();

    return cleanText(withoutDate || text, 48);
  }

  function showCandidate(candidate) {
    if (!candidate) {
      candidateBox.hidden = true;
      return;
    }
    candidateTitle.textContent = candidate.title;
    candidateMeta.textContent = [
      formatDate(candidate.date),
      `${candidate.start}-${candidate.end}`,
      candidate.location ? `場所: ${candidate.location}` : "場所未設定",
      candidate.travelMinutes ? `移動${candidate.travelMinutes}分` : "移動なし",
    ].join(" / ");
    candidateBox.hidden = false;
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
        item.location ? `場所: ${item.location}` : "場所未設定",
        false,
      ));
    });
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

  function createTimelineRow(time, title, meta, isTravel) {
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
    row.append(timeNode, item);
    return row;
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
