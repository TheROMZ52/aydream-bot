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

    public AydreamScreen(Screen parent) {
        super(Text.literal("Aydream Client"));
        this.parent = parent;
    }

    @Override
    protected void init() {
        clearChildren();
        int left = this.width / 2 - 190;
        int top = 55;

        if (category.equals("main")) {
            addButton(left, top, 120, 22, "Movement", () -> open("movement"));
            addButton(left + 130, top, 120, 22, "Combat", () -> open("combat"));
            addButton(left + 260, top, 120, 22, "Homes", () -> open("homes"));
            addButton(left, top + 30, 120, 22, "Automation", () -> open("automation"));
            addButton(left + 130, top + 30, 120, 22, "Inventory", () -> open("inventory"));
            addButton(left + 260, top + 30, 120, 22, "Info", () -> open("info"));
        } else {
            buildCategory(left, top + 45);
            addButton(left, top + 175, 120, 22, "Back", () -> open("main"));
        }

        addButton(this.width / 2 - 60, this.height - 35, 120, 22, "Close", this::close);
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
                e("Follow", "!follow"),
                e("Come", "!come"),
                e("Wander", "!wander"),
                e("Goto", "!goto 0 0 0"),
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
                e("Scan", "!scan 16"),
                e("Look at Controller", "!lookat TheROMZ52")
            ));
        }

        int perPage = 10;
        int start = page * perPage;
        int end = Math.min(start + perPage, entries.size());

        for (int i = start; i < end; i++) {
            Entry entry = entries.get(i);
            int col = (i - start) % 2;
            int row = (i - start) / 2;
            addButton(left + col * 190, top + row * 27, 180, 22, entry.label, () -> send(entry.command));
        }

        if (start > 0) {
            addButton(left, top + 140, 80, 22, "<", () -> {
                page--;
                init();
            });
        }

        if (end < entries.size()) {
            addButton(left + 100, top + 140, 80, 22, ">", () -> {
                page++;
                init();
            });
        }
    }

    private void addButton(int x, int y, int width, int height, String text, Runnable action) {
        addDrawableChild(
            ButtonWidget.builder(Text.literal(text), b -> action.run())
                .dimensions(x, y, width, height)
                .build()
        );
    }

    private void send(String command) {
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null) return;
        client.player.networkHandler.sendChatMessage(command);
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
