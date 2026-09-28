const SPEAKER_URL = "https://l8pStudio.ir/apis-loop/api-speaker.php";

async function generateReply(text, mode = "polite", restric = false, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(SPEAKER_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "accept": "application/json"
            },
            body: JSON.stringify({
                text: String(text || ""),
                ...(mode ? { mode } : {}),
                ...(restric ? { restric: true } : {})
            }),
            signal: controller.signal
        });

        if (!response.ok) return null;
        const data = await response.json();
        if (!data || data.status !== true || typeof data.data !== "string") return null;
        return data.data.trim() || null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { generateReply };
