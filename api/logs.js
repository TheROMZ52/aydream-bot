const { checkPanelKey, getLatestRun, github } = require("./_github");

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
      return res.status(200).json({ logs: [], run_url: null });
    }

    const data = await github(
      "/repos/TheROMZ52/aydream-bot/actions/runs/" + run.id + "/jobs?per_page=20"
    );

    const jobs = (data.jobs || []).map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      html_url: job.html_url
    }));

    return res.status(200).json({
      run_url: run.html_url,
      logs: jobs
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};
