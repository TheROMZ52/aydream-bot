const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const runNumber = document.getElementById("runNumber");
const runStatus = document.getElementById("runStatus");
const runConclusion = document.getElementById("runConclusion");
const runStarted = document.getElementById("runStarted");
const runUpdated = document.getElementById("runUpdated");
const githubLink = document.getElementById("githubLink");
const logs = document.getElementById("logs");
const toast = document.getElementById("toast");
const runButton = document.getElementById("runButton");
const stopButton = document.getElementById("stopButton");
const refreshButton = document.getElementById("refreshButton");

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
  return data;
}

function date(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function setBusy(busy) {
  runButton.disabled = busy;
  stopButton.disabled = busy;
  refreshButton.disabled = busy;
}

function render(data) {
  const run = data.run;
  if (!run) {
    statusPill.className = "pill offline";
    statusPill.textContent = "OFFLINE";
    statusText.textContent = "No workflow runs";
    runNumber.textContent = "—";
    runStatus.textContent = "—";
    runConclusion.textContent = "—";
    runStarted.textContent = "—";
    runUpdated.textContent = "—";
    githubLink.style.display = "none";
    return;
  }
  const active = run.status === "in_progress" || run.status === "queued" || run.status === "requested";
  statusPill.className = "pill " + (active ? "online" : "offline");
  statusPill.textContent = active ? "RUNNING" : "STOPPED";
  statusText.textContent = active ? "Workflow active" : "Workflow idle";
  runNumber.textContent = "#" + run.run_number;
  runStatus.textContent = run.status || "—";
  runConclusion.textContent = run.conclusion || "—";
  runStarted.textContent = date(run.created_at);
  runUpdated.textContent = date(run.updated_at);
  githubLink.href = run.html_url;
  githubLink.style.display = "inline-block";
}

async function refresh() {
  try {
    const data = await api("/api/status");
    render(data);
    const logData = await api("/api/logs");
    if (!logData.logs?.length) {
      logs.innerHTML = '<div class="empty">No workflow jobs yet.</div>';
      return;
    }
    logs.replaceChildren();
    for (const job of logData.logs) {
      const row = document.createElement("div");
      row.className = "log-row";
      const name = document.createElement("span");
      name.textContent = job.name || "Job";
      const status = document.createElement("small");
      status.textContent = [job.status, job.conclusion].filter(Boolean).join(" · ");
      const link = document.createElement("a");
      link.href = job.html_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Open";
      row.append(name, status, link);
      logs.append(row);
    }
  } catch (error) {
    notify(error.message);
  }
}

async function action(path, label) {
  setBusy(true);
  try {
    const result = await api(path, { method: "POST" });
    notify(result.message || label);
    await new Promise(resolve => setTimeout(resolve, 1000));
    await refresh();
  } catch (error) {
    notify(error.message);
  } finally {
    setBusy(false);
  }
}

runButton.addEventListener("click", () => action("/api/start", "Run requested."));
stopButton.addEventListener("click", () => action("/api/stop", "Stop requested."));
refreshButton.addEventListener("click", refresh);
refresh();
setInterval(refresh, 10000);
