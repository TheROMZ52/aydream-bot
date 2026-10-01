const { getLatestRun, github, REPO } = require("./_github");

const SETTINGS = [
  "AYDREAM_HOST",
  "AYDREAM_PORT",
  "AYDREAM_USERNAME",
  "AYDREAM_VERSION",
  "AYDREAM_CONTROLLER",
  "AYDREAM_PASSWORD"
];

async function getSettings() {
  const data = await github("/repos/" + REPO + "/actions/variables?per_page=100");
  const map = Object.fromEntries((data.variables || []).map((item) => [item.name, item.value]));
  return Object.fromEntries(SETTINGS.map((name) => [name, map[name] ?? ""]));
}

async function saveSetting(name, value) {
  const body = JSON.stringify({ name, value: String(value ?? "") });
  const path = "/repos/" + REPO + "/actions/variables/" + encodeURIComponent(name);

  try {
    await github(path, {
      method: "PATCH",
      body,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    if (error.status !== 404) throw error;

    await github("/repos/" + REPO + "/actions/variables", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" }
    });
  }
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET" && req.query?.settings === "1") {
      return res.status(200).json({ settings: await getSettings() });
    }

    if (req.method === "PUT" && req.query?.settings === "1") {
      const body = typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});
      const settings = body.settings || {};

      if (!settings || typeof settings !== "object") {
        return res.status(400).json({ error: "Invalid settings payload." });
      }

      for (const name of SETTINGS) {
        if (Object.prototype.hasOwnProperty.call(settings, name)) {
          await saveSetting(name, settings[name]);
        }
      }

      const saved = await getSettings();

      return res.status(200).json({
        ok: true,
        message: "Settings saved.",
        settings: saved
      });
    }

    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const run = await getLatestRun();

    if (!run) {
      return res.status(200).json({ status: "offline", run: null });
    }

    return res.status(200).json({
      status:
        run.status === "in_progress" || run.status === "queued"
          ? "online"
          : "offline",
      run: {
        id: run.id,
        status: run.status,
        conclusion: run.conclusion,
        created_at: run.created_at,
        updated_at: run.updated_at,
        html_url: run.html_url,
        run_number: run.run_number
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};
