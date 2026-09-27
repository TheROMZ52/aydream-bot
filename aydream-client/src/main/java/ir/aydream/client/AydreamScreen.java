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
    private String category = "dashboard";
    private int page = 0;

    private static final int PANEL = 0xD91A1D26;
    private static final int PANEL_LIGHT = 0xE0262935;
    private static final int GLASS = 0xB82A2E3A;
    private static final int ACCENT = 0xFF8B5CF6;
    private static final int TEXT = 0xFFF5F5F7;
    private static final int MUTED = 0xFF9FA3B2;

    public AydreamScreen(Screen parent) {
        super(Text.literal("Aydream Client"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        clearChildren();

        if (category.equals("dashboard")) {
            buildDashboard();
        } else {
            buildSidebar();
            buildCategory();
        }

        addButton(width - 115, height - 38, 95, 24, "Close", this::close);
    }

    private void buildDashboard() {
        int panelX = width / 2 - 330;
        int panelY = 48;
        int panelW = 660;
        int panelH = Math.min(260, height - 95);

        addButton(panelX + 25, panelY + 78, 185, 30, "Movement", () -> open("movement"));
        addButton(panelX + 225, panelY + 78, 185, 30, "Combat", () -> open("combat"));
        addButton(panelX + 425, panelY + 78, 185, 30, "Homes", () -> open("homes"));

        addButton(panelX + 25, panelY + 116, 185, 30, "Automation", () -> open("automation"));
        addButton(panelX + 225, panelY + 116, 185, 30, "Inventory", () -> open("inventory"));
        addButton(panelX + 425, panelY + 116, 185, 30, "Info", () -> open("info"));

        addButton(panelX + 25, panelY + 170, 285, 30, "Quick Follow", () -> send("!follow"));
        addButton(panelX + 325, panelY + 170, 285, 30, "Stop Everything", () -> send("!clear"));
    }

    private void buildSidebar() {
        int x = 28;
        int y = 65;

        String[] labels = {"Dashboard", "Movement", "Combat", "Homes", "Automation", "Inventory", "Info"};
        String[] values = {"dashboard", "movement", "combat", "homes", "automation", "inventory", "info"};

        for (int i = 0; i < labels.length; i++) {
            String value = values[i];
            addButton(x, y + i * 34, 150, 28, labels[i], () -> open(value));
        }
    }

    private void buildCategory() {
        int left = 215;
        int top = 82;
        List<Entry> entries = new ArrayList<>();

        switch (category) {
            case "movement" -> entries.addAll(List.of(
                e("Follow", "!follow"),
                e("Come", "!come"),
                e("Wander", "!wander"),
                e("Autopilot On", "!autopilot on"),
                e("Autopilot Off", "!autopilot off"),
                e("Sprint On", "!sprint on"),
                e("Sprint Off", "!sprint off"),
                e("Sneak On", "!sneak on"),
                e("Sneak Off", "!sneak off"),
                e("Jump", "!jump 2"),
                e("Stop", "!stop")
            ));
            case "combat" -> entries.addAll(List.of(
                e("Weapon", "!weapon"),
                e("Totem", "!totem"),
                e("Attack", "!attack"),
                e("Status", "!status"),
                e("Stop Combat", "!stop")
            ));
            case "homes" -> entries.addAll(List.of(
                e("Home", "!home"),
                e("Set Home", "!sethome"),
                e("Delete Home", "!delhome"),
                e("Where", "!coords")
            ));
            case "automation" -> entries.addAll(List.of(
                e("Auto Eat", "!eat"),
                e("Autopilot On", "!autopilot on"),
                e("Autopilot Off", "!autopilot off"),
                e("Clear Tasks", "!clear"),
                e("Stop", "!stop")
            ));
            case "inventory" -> entries.addAll(List.of(
                e("Inventory", "!inv"),
                e("Armor", "!armor"),
                e("Best Weapon", "!weapon"),
                e("Best Tool", "!tool"),
                e("Eat", "!eat"),
                e("Hand", "!hand"),
                e("Clear", "!clear")
            ));
            case "info" -> entries.addAll(List.of(
                e("Players", "!players"),
                e("Health", "!health"),
                e("Near", "!near 10"),
                e("Status", "!status"),
                e("Position", "!coords"),
                e("Time", "!time"),
                e("Look", "!look"),
                e("Scan", "!scan 16")
            ));
        }

        int perPage = 10;
        int start = page * perPage;
        int end = Math.min(start + perPage, entries.size());

        for (int i = start; i < end; i++) {
            Entry entry = entries.get(i);
            int col = (i - start) % 2;
            int row = (i - start) / 2;
            addButton(left + col * 205, top + row * 34, 195, 28, entry.label, () -> send(entry.command));
        }

        if (start > 0) {
            addButton(left, top + 178, 80, 24, "<", () -> {
                page--;
                init();
            });
        }

        if (end < entries.size()) {
            addButton(left + 90, top + 178, 80, 24, ">", () -> {
                page++;
                init();
            });
        }
    }

    private void open(String value) {
        category = value;
        page = 0;
        init();
    }

    private void addButton(int x, int y, int w, int h, String label, Runnable action) {
        addDrawableChild(
            ButtonWidget.builder(Text.literal(label), b -> action.run())
                .dimensions(x, y, w, h)
                .build()
        );
    }

    private void send(String command) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player != null) {
            client.player.networkHandler.sendChatMessage(command);
        }
    }

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        renderBackground(context, mouseX, mouseY, delta);

        int mainX = category.equals("dashboard") ? width / 2 - 330 : 195;
        int mainY = 48;
        int mainW = category.equals("dashboard") ? 660 : width - 225;
        int mainH = Math.min(285, height - 88);

        context.fill(mainX, mainY, mainX + mainW, mainY + mainH, PANEL);
        context.fill(mainX + 1, mainY + 1, mainX + mainW - 1, mainY + 55, GLASS);

        if (!category.equals("dashboard")) {
            context.fill(20, 48, 185, mainY + mainH, PANEL);
            context.fill(21, 49, 184, 86, GLASS);
        }

        context.drawText(textRenderer, Text.literal("Aydream"), mainX + 24, mainY + 18, TEXT, true);
        context.drawText(textRenderer, Text.literal("CONTROL CENTER"), mainX + 24, mainY + 34, MUTED, false);

        if (category.equals("dashboard")) {
            context.drawText(textRenderer, Text.literal("Bot Control"), mainX + 25, mainY + 62, MUTED, false);
            context.drawText(textRenderer, Text.literal("READY"), mainX + mainW - 75, mainY + 22, 0xFF7CFFB2, true);
        } else {
            context.drawText(textRenderer, Text.literal(category.toUpperCase()), mainX + 24, mainY + 62, MUTED, true);
        }

        context.drawText(textRenderer, Text.literal("/dream"), 24, height - 28, MUTED, false);

        super.render(context, mouseX, mouseY, delta);
    }

    @Override
    public boolean shouldPause() {
        return false;
    }

    private Entry e(String label, String command) {
        return new Entry(label, command);
    }

    private record Entry(String label, String command) {}
}
