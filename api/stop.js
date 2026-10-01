const { getActiveRun, github } = require("./_github");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const active = await getActiveRun();

    if (!active) {
      return res.status(200).json({ ok: true, message: "Aydream is already offline" });
    }

    await github(
      "/repos/TheROMZ52/aydream-bot/actions/runs/" + active.id + "/cancel",
      { method: "POST" }
    );

    return res.status(200).json({
      ok: true,
      message: "Aydream stop requested",
      run_id: active.id
    });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
};
