package ir.aydream.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

public class AydreamScreen extends Screen {
    private final Screen parent;
    private String category = "main";
    private int page = 0;
    private final List<ButtonWidget> buttons = new ArrayList<>();

    public AydreamScreen(Screen parent) {
        super(Text.literal("Aydream Client"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        clearChildren();
        buttons.clear();
        int left = this.width / 2 - 190;
        int top = 55;
        addButton(left, top, 120, 22, "Movement", () -> open("movement"));
        addButton(left + 130, top, 120, 22, "Combat", () -> open("combat"));
        addButton(left + 260, top, 120, 22, "Homes", () -> open("homes"));
        addButton(left, top + 30, 120, 22, "Automation", () -> open("automation"));
        addButton(left + 130, top + 30, 120, 22, "Inventory", () -> open("inventory"));
        addButton(left + 260, top + 30, 120, 22, "Info", () -> open("info"));
        if (!category.equals("main")) buildCategory(left, top + 75);
        addButton(this.width / 2 - 60, this.height - 35, 120, 22, "Close", () -> close());
    }

    private void open(String value) {
        category = value;
        page = 0;
        init();
    }

    private void buildCategory(int left, int top) {
        List<Entry> entries = new ArrayList<>();
        switch (category) {
            case "movement" -> entries.addAll(List.of(
                e("Come", "!come"), e("Follow", "!follow TheROMZ52"), e("Wander", "!wander"), e("Stop", "!stop"), e("Autopilot", "!autopilot on"), e("Jump", "!jump 2"), e("Sprint", "!sprint on"), e("Sneak", "!sneak on")));
            case "combat" -> entries.addAll(List.of(
                e("Guard", "!guard"), e("Hunt", "!kill TheROMZ52"), e("Stop Combat", "!stop"), e("Status", "!status")));
            case "homes" -> entries.addAll(List.of(
                e("Home", "!home"), e("Set Home", "!sethome"), e("Delete Home", "!delhome"), e("Where", "!where TheROMZ52")));
            case "automation" -> entries.addAll(List.of(
                e("Autopilot On", "!autopilot on"), e("Autopilot Off", "!autopilot off"), e("Farm", "!farm"), e("Collect", "!collect"), e("Clear Tasks", "!clear")));
            case "inventory" -> entries.addAll(List.of(
                e("Inventory", "!inventory"), e("Armor", "!armor"), e("Hand", "!hand"), e("Eat", "!eat"), e("Clear", "!clear")));
            case "info" -> entries.addAll(List.of(
                e("Players", "!players"), e("Health", "!health"), e("Near", "!near 10"), e("Status", "!status"), e("Distance", "!distance TheROMZ52"), e("Bot Position", "!where TheROMZ52")));
        }
        int perPage = 8;
        int start = page * perPage;
        int end = Math.min(start + perPage, entries.size());
        for (int i = start; i < end; i++) {
            Entry entry = entries.get(i);
            int col = (i - start) % 2;
            int row = (i - start) / 2;
            addButton(left + col * 190, top + row * 28, 180, 22, entry.label, () -> send(entry.command));
        }
        if (start > 0) addButton(left, top + 125, 80, 22, "<", () -> { page--; init(); });
        if (end < entries.size()) addButton(left + 100, top + 125, 80, 22, ">", () -> { page++; init(); });
        addButton(left + 200, top + 125, 180, 22, "Back", () -> open("main"));
    }

    private void addButton(int x, int y, int width, int height, String text, Runnable action) {
        ButtonWidget button = ButtonWidget.builder(Text.literal(text), b -> action.run()).dimensions(x, y, width, height).build();
        addDrawableChild(button);
        buttons.add(button);
    }

    private void send(String command) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null) return;
        client.player.networkHandler.sendChatMessage(command);
        client.setScreen(this);
    }

    private Entry e(String label, String command) {
        return new Entry(label, command);
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBackground(context, mouseX, mouseY, delta);
        context.drawCenteredTextWithShadow(textRenderer, Text.literal("Aydream Client"), width / 2, 20, 0xFFFFFF);
        context.drawCenteredTextWithShadow(textRenderer, Text.literal("/dream • 1.21.8"), width / 2, 36, 0xAAAAAA);
        super.render(context, mouseX, mouseY, delta);
    }

    @Override
    public boolean shouldPause() {
        return false;
    }

    private record Entry(String label, String command) {}
}
