const API_BASE = "https://api.github.com";
const REPO = "TheROMZ52/aydream-bot";
const WORKFLOW = "aydream.yml";

function headers() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + process.env.GITHUB_TOKEN,
    "X-GitHub-Api-Version": "2026-03-10"
  };
}

function checkPanelKey(req) {
  const expected = process.env.PANEL_KEY;
  if (!expected) {
    return false;
  }

  return req.headers["x-panel-key"] === expected;
}

async function github(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && data.message
        ? data.message
        : "GitHub API returned " + response.status;

    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function getLatestRun() {
  const data = await github(
    "/repos/" + REPO + "/actions/workflows/" + WORKFLOW + "/runs?per_page=1"
  );

  return data.workflow_runs?.[0] || null;
}

async function getActiveRun() {
  const data = await github(
    "/repos/" + REPO + "/actions/workflows/" + WORKFLOW + "/runs?per_page=10"
  );

  return (data.workflow_runs || []).find((run) =>
    ["in_progress", "queued", "requested", "waiting", "pending"].includes(run.status)
  ) || null;
}

module.exports = {
  REPO,
  WORKFLOW,
  checkPanelKey,
  github,
  getLatestRun,
  getActiveRun
};
