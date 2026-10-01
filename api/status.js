const { getLatestRun } = require("./_github");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const run = await getLatestRun();

    if (!run) {
      return res.status(200).json({ status: "offline", run: null });
    }

    const active = ["in_progress", "queued", "requested", "waiting", "pending"].includes(run.status);

    return res.status(200).json({
      status: active ? "online" : "offline",
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
