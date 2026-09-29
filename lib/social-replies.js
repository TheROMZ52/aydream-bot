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

function extractReplyContext(text) {
    const value = sanitizeReply(text);
    if (!value) return { username: "", message: "" };

    const match = value.match(/^به\s+([^\s]+)\s+پاسخ\s+بده\..*?:\s*(.*)$/isu);
    if (!match) return { username: "", message: value };

    return {
        username: match[1],
        message: sanitizeReply(match[2]) || ""
    };
}

async function generateReply(text) {
    const { username, message } = extractReplyContext(text);
    if (!message) return null;

    const name = username || "دوست";
    const lower = message.toLowerCase();

    let reply;
    if (/^(hi|hello|hey|سلام|درود|salam)\b/i.test(lower)) {
        reply = "سلام " + name + ".";
    } else if (/(مرسی|ممنون|متشکرم|thanks|thank you)/i.test(lower)) {
        reply = "خواهش می‌کنم " + name + ".";
    } else if (/[؟?]$/.test(message)) {
        reply = "سؤال خوبی بود " + name + ".";
    } else {
        reply = "متوجه شدم " + name + ".";
    }

    return sanitizeReply(reply);
}

module.exports = { generateReply, sanitizeReply };
