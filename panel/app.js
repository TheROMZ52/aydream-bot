const keyInput = document.getElementById("keyInput");
const saveKey = document.getElementById("saveKey");
const setup = document.getElementById("setup");
const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const runNumber = document.getElementById("runNumber");
const timerValue = document.getElementById("timerValue");
const runStatus = document.getElementById("runStatus");
const runConclusion = document.getElementById("runConclusion");
const runStarted = document.getElementById("runStarted");
const runUpdated = document.getElementById("runUpdated");
const githubLink = document.getElementById("githubLink");
const logs = document.getElementById("logs");
const toast = document.getElementById("toast");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const restartButton = document.getElementById("restartButton");
const refreshButton = document.getElementById("refreshButton");
const saveSettings = document.getElementById("saveSettings");
const loadSettings = document.getElementById("loadSettings");

const settingFields = {
  AYDREAM_HOST: document.getElementById("settingHost"),
  AYDREAM_PORT: document.getElementById("settingPort"),
  AYDREAM_USERNAME: document.getElementById("settingUsername"),
  AYDREAM_VERSION: document.getElementById("settingVersion"),
  AYDREAM_CONTROLLER: document.getElementById("settingController"),
  AYDREAM_PASSWORD: document.getElementById("settingPassword")
};

let runStartedAt = null;

keyInput.value = localStorage.getItem("aydream_panel_key") || "";

function panelKey() {
  return keyInput.value.trim();
}

function showSetup() {
  setup.style.display = panelKey() ? "none" : "flex";
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "x-panel-key": panelKey(),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed (" + response.status + ")");
  }

  return data;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatElapsed(value) {
  if (!value) return "—";

  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const totalSeconds = Math.floor(elapsed / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function setBusy(busy) {
  startButton.disabled = busy;
  stopButton.disabled = busy;
  restartButton.disabled = busy;
  refreshButton.disabled = busy;
  saveSettings.disabled = busy;
  loadSettings.disabled = busy;
}

function render(data) {
  const run = data.run;

  if (!run) {
    statusPill.className = "pill offline";
    statusPill.textContent = "OFFLINE";
    statusText.textContent = "Offline";
    runNumber.textContent = "—";
    timerValue.textContent = "—";
    runStatus.textContent = "—";
    runConclusion.textContent = "—";
    runStarted.textContent = "—";
    runUpdated.textContent = "—";
    githubLink.style.display = "none";
    runStartedAt = null;
    return;
  }

  const online = data.status === "online";
  statusPill.className = "pill " + (online ? "online" : "offline");
  statusPill.textContent = online ? "ONLINE" : "OFFLINE";
  statusText.textContent =
    run.status === "queued"
      ? "Starting…"
      : online
        ? "Running"
        : "Stopped";

  runNumber.textContent = "#" + run.run_number;
  timerValue.textContent = formatElapsed(run.created_at);
  runStatus.textContent = run.status;
  runConclusion.textContent = run.conclusion || "—";
  runStarted.textContent = formatDate(run.created_at);
  runUpdated.textContent = formatDate(run.updated_at);
  githubLink.href = run.html_url;
  githubLink.style.display = "inline-block";
  runStartedAt = run.created_at;
}

async function refresh() {
  if (!panelKey()) {
    showSetup();
    return;
  }

  try {
    const data = await api("/api/status");
    render(data);

    const logData = await api("/api/logs");

    if (!logData.logs.length) {
      logs.innerHTML = '<div class="empty">No jobs yet.</div>';
      return;
    }

    logs.innerHTML = logData.logs.map((job) => {
      const conclusion = job.conclusion ? " · " + job.conclusion : "";
      return '<div class="log-row">' +
        '<span>' + job.name + '</span>' +
        '<small>' + job.status + conclusion + '</small>' +
        '<a href="' + job.html_url + '" target="_blank" rel="noreferrer">Open</a>' +
        '</div>';
    }).join("");
  } catch (error) {
    notify(error.message);
  }
}

async function refreshSettings() {
  if (!panelKey()) return;

  try {
    const data = await api("/api/status?settings=1");
    for (const [name, field] of Object.entries(settingFields)) {
      field.value = data.settings?.[name] ?? "";
    }
  } catch (error) {
    notify("Settings: " + error.message);
  }
}

async function saveSettingsNow() {
  setBusy(true);

  try {
    const settings = {};
    for (const [name, field] of Object.entries(settingFields)) {
      settings[name] = field.value;
    }

    await api("/api/status?settings=1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings })
    });

    notify("Settings saved.");
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
  }
}

async function action(path, label) {
  setBusy(true);

  try {
    await api(path, { method: "POST" });
    notify(label);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await refresh();
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
  }
}

saveKey.addEventListener("click", () => {
  const value = panelKey();

  if (!value) {
    notify("Enter a panel key first.");
    return;
  }

  localStorage.setItem("aydream_panel_key", value);
  showSetup();
  refresh();
  refreshSettings();
});

keyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    saveKey.click();
  }
});

startButton.addEventListener("click", () => action("/api/start", "Start requested."));
stopButton.addEventListener("click", () => action("/api/stop", "Stop requested."));

restartButton.addEventListener("click", async () => {
  setBusy(true);

  try {
    await api("/api/stop", { method: "POST" });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await api("/api/start", { method: "POST" });
    notify("Restart requested.");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await refresh();
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
  }
});

refreshButton.addEventListener("click", refresh);
saveSettings.addEventListener("click", saveSettingsNow);
loadSettings.addEventListener("click", refreshSettings);

setInterval(() => {
  if (runStartedAt) {
    timerValue.textContent = formatElapsed(runStartedAt);
  }
}, 1000);

showSetup();
refresh();
refreshSettings();
