const { checkPanelKey, getLatestRun } = require("./_github");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkPanelKey(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
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
