const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeReply, generateReply } = require("../lib/social-replies");

test("sanitizeReply removes emoji and forbidden Persian terms", () => {
    const result = sanitizeReply("سلام 😀 گپ گروه گاردی");
    assert.equal(result, "سلام چت بازیکنان محافظت");
    assert.doesNotMatch(result, /گپ|گروه|گاردی/u);
});

test("generateReply produces a text response without emoji", async () => {
    const result = await generateReply("به TheROMZ52 پاسخ بده. این متن باید تمیز باشد: سلام");
    assert.equal(result, "سلام TheROMZ52.");
    assert.doesNotMatch(result, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
});

test("generateReply handles questions and thanks", async () => {
    assert.equal(
        await generateReply("به Player پاسخ بده. این متن باید تمیز باشد: حالت چطوره؟"),
        "سؤال خوبی بود Player."
    );
    assert.equal(
        await generateReply("به Player پاسخ بده. این متن باید تمیز باشد: ممنون"),
        "خواهش می‌کنم Player."
    );
});
