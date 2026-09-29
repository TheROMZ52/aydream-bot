const SPEAKER_URL = "https://l8pStudio.ir/apis-loop/api-speaker.php";

function sanitizeReply(value) {
    let text = String(value || "");

    text = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\uFE0F\u200D]/gu, "");

    text = text
        .replace(/گاردی/giu, "محافظت")
        .replace(/گروه/giu, "بازیکنان")
        .replace(/گپ/giu, "چت");

    text = text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();

    return text || null;
}

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

        return sanitizeReply(data.data);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { generateReply, sanitizeReply };
