const {
  checkPanelKey,
  getActiveRun,
  github,
  WORKFLOW
} = require("./_github");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkPanelKey(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const active = await getActiveRun();

    if (active) {
      return res.status(409).json({
        error: "Aydream is already running",
        run: { id: active.id, html_url: active.html_url }
      });
    }

    await github(
      "/repos/TheROMZ52/aydream-bot/actions/workflows/" + WORKFLOW + "/dispatches",
      {
        method: "POST",
        body: JSON.stringify({ ref: "main" }),
        headers: { "Content-Type": "application/json" }
      }
    );

    return res.status(200).json({ ok: true, message: "Aydream start requested" });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};
