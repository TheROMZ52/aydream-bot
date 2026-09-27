package ir.aydream.client;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

import java.util.ArrayList;
import java.util.List;

public class AydreamScreen extends Screen {
    private final Screen parent;
    private String category = "dashboard";
    private int page = 0;
    private String apiBaseUrl = "http://127.0.0.1:31880";
    private net.minecraft.client.gui.widget.TextFieldWidget urlField;
    private String settingsMessage = "";
    private final HttpClient apiClient = HttpClient.newHttpClient();
    private volatile boolean apiOnline = false;
    private volatile String botTask = "offline";
    private volatile String botHealth = "--";
    private volatile String botFood = "--";
    private volatile String botPosition = "--";
    private volatile List<String> nearbyPlayers = List.of();
    private volatile List<String> savedHomes = List.of();
    private volatile String actionMessage = "";
    private long nextRefresh = 0L;

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
        loadConfig();

        if (category.equals("dashboard")) {
            buildDashboard();
            refreshStatus();
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

        addButton(panelX + 25, panelY + 170, 185, 30, "Quick Follow", () -> apiAction("!follow"));
        addButton(panelX + 225, panelY + 170, 185, 30, "Stop Everything", () -> apiAction("!clear"));
        addButton(panelX + 425, panelY + 170, 185, 30, "Refresh", this::forceRefresh);
        addButton(panelX + 25, panelY + 208, 285, 30, "Settings", () -> open("settings"));
        addButton(panelX + 325, panelY + 208, 285, 30, "Info", () -> open("info"));
    }

    private void buildSidebar() {
        int x = 28;
        int y = 65;

        String[] labels = {"Dashboard", "Movement", "Combat", "Homes", "Automation", "Inventory", "Info", "Settings"};
        String[] values = {"dashboard", "movement", "combat", "homes", "automation", "inventory", "info", "settings"};

        for (int i = 0; i < labels.length; i++) {
            String value = values[i];
            addButton(x, y + i * 34, 150, 28, labels[i], () -> open(value));
        }
    }

    private void buildCategory() {
        int left = 215;
        int top = 82;
        if (category.equals("settings")) {
            buildSettings();
            return;
        }

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
            addButton(left + col * 205, top + row * 34, 195, 28, entry.label, () -> apiAction(entry.command));
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

    private void buildSettings() {
        int left = 235;
        int top = 98;
        int w = Math.min(430, width - left - 40);

        urlField = new TextFieldWidget(textRenderer, left, top, w, 22, Text.literal("Bot API URL"));
        urlField.setMaxLength(200);
        urlField.setText(apiBaseUrl);
        addDrawableChild(urlField);

        addButton(left, top + 58, 130, 28, "Save", this::saveConfig);
        addButton(left + 140, top + 58, 130, 28, "Test", this::testConnection);
        addButton(left + 280, top + 58, 130, 28, "Reset", this::resetConfig);

        contextText = "Localhost only. No API token is required.";
    }

    private String contextText = "";

    private Path configPath() {
        return MinecraftClient.getInstance().runDirectory.toPath().resolve("config").resolve("aydream-client.properties");
    }

    private void loadConfig() {
        try {
            Path path = configPath();
            if (!Files.exists(path)) return;
            java.util.Properties properties = new java.util.Properties();
            try (var input = Files.newInputStream(path)) {
                properties.load(input);
            }
            apiBaseUrl = properties.getProperty("api.url", "http://127.0.0.1:31880").trim();
        } catch (Exception ignored) {
            apiBaseUrl = "http://127.0.0.1:31880";
        }
    }

    private void saveConfig() {
        if (urlField != null) apiBaseUrl = urlField.getText().trim();
        if (apiBaseUrl.isBlank()) apiBaseUrl = "http://127.0.0.1:31880";
        try {
            Path path = configPath();
            Files.createDirectories(path.getParent());
            java.util.Properties properties = new java.util.Properties();
            properties.setProperty("api.url", apiBaseUrl);
            try (var output = Files.newOutputStream(path, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING)) {
                properties.store(output, "Aydream Client");
            }
            settingsMessage = "Saved";
        } catch (Exception error) {
            settingsMessage = "Save failed";
        }
    }

    private void resetConfig() {
        apiBaseUrl = "http://127.0.0.1:31880";
        settingsMessage = "Reset";
        init();
    }

    private void testConnection() {
        saveConfig();
        refreshStatus();
        settingsMessage = "Testing...";
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

    private void apiAction(String command) {
        String json = "{\"command\":\"" + command.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(apiBaseUrl + "/api/action"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();
        apiClient.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenAccept(response -> {
            actionMessage = response.statusCode() >= 200 && response.statusCode() < 300
                ? "Sent: " + command
                : "Action failed";
        }).exceptionally(error -> {
            actionMessage = "API offline";
            return null;
        });
    }

    private void forceRefresh() {
        nextRefresh = 0L;
        refreshStatus();
        settingsMessage = "Refreshed";
    }

    private void refreshStatus() {
        long now = System.currentTimeMillis();
        if (now < nextRefresh) return;
        nextRefresh = now + 1000L;
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(apiBaseUrl + "/api/status"))
            .GET()
            .build();
        apiClient.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenAccept(response -> {
            if (response.statusCode() != 200) {
                apiOnline = false;
                return;
            }
            String body = response.body();
            apiOnline = true;
            settingsMessage = "Connected";
            nearbyPlayers = parsePlayers(body);
            savedHomes = parseHomeNames(body);
            botHealth = value(body, "health");
            botFood = value(body, "food");
            botTask = value(body, "task");
            String x = value(body, "x");
            String y = value(body, "y");
            String z = value(body, "z");
            if (!x.equals("--") && !y.equals("--") && !z.equals("--")) botPosition = x + " " + y + " " + z;
        }).exceptionally(error -> {
            apiOnline = false;
            return null;
        });
    }

    private List<String> parsePlayers(String json) {
        List<String> result = new ArrayList<>();
        int start = json.indexOf("\"players\":[");
        if (start < 0) return result;
        int end = json.indexOf("],\"homes\"", start);
        if (end < 0) end = json.length();
        String section = json.substring(start, end);
        int cursor = 0;
        while (cursor < section.length()) {
            int nameStart = section.indexOf("\"name\":\"", cursor);
            if (nameStart < 0) break;
            nameStart += 8;
            int nameEnd = section.indexOf("\"", nameStart);
            if (nameEnd < 0) break;
            String name = section.substring(nameStart, nameEnd);
            int distanceStart = section.indexOf("\"distance\":", nameEnd);
            String distance = "--";
            if (distanceStart >= 0) {
                distanceStart += 11;
                int distanceEnd = distanceStart;
                while (distanceEnd < section.length() && ",}".indexOf(section.charAt(distanceEnd)) < 0) distanceEnd++;
                distance = section.substring(distanceStart, distanceEnd).trim();
            }
            result.add(distance.equals("null") ? name : name + "  " + distance + "m");
            cursor = nameEnd + 1;
        }
        return result;
    }

    private List<String> parseHomeNames(String json) {
        List<String> result = new ArrayList<>();
        int start = json.indexOf("\"homes\":{");
        if (start < 0) return result;
        start += 8;
        int end = json.lastIndexOf("}}");
        if (end < start) end = json.length();
        String section = json.substring(start, end);
        int cursor = 0;
        while (cursor < section.length()) {
            int keyStart = section.indexOf("\"", cursor);
            if (keyStart < 0) break;
            int keyEnd = section.indexOf("\"", keyStart + 1);
            if (keyEnd < 0) break;
            int objectStart = keyEnd + 1;
            while (objectStart < section.length() && Character.isWhitespace(section.charAt(objectStart))) objectStart++;
            if (objectStart + 1 < section.length() && section.charAt(objectStart) == ':' && section.charAt(objectStart + 1) == '{') {
                result.add(section.substring(keyStart + 1, keyEnd));
            }
            cursor = keyEnd + 1;
        }
        return result;
    }

    private String value(String json, String key) {
        String pattern = "\"" + key + "\":";
        int i = json.indexOf(pattern);
        if (i < 0) return "--";
        int start = i + pattern.length();
        while (start < json.length() && Character.isWhitespace(json.charAt(start))) start++;
        if (start >= json.length()) return "--";
        if (json.charAt(start) == '"') {
            int end = json.indexOf('"', start + 1);
            return end > start ? json.substring(start + 1, end) : "--";
        }
        int end = start;
        while (end < json.length() && ",}\n".indexOf(json.charAt(end)) < 0) end++;
        return json.substring(start, end).trim();
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
        refreshStatus();

        int mainX = category.equals("dashboard") ? width / 2 - 330 : 195;
        int mainY = 48;
        int mainW = category.equals("dashboard") ? 660 : width - 225;
        int mainH = category.equals("dashboard") ? Math.min(370, height - 88) : Math.min(285, height - 88);

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
            int statusColor = apiOnline ? 0xFF7CFFB2 : 0xFFFF7777;
            context.drawText(textRenderer, Text.literal(apiOnline ? "ONLINE" : "OFFLINE"), mainX + mainW - 82, mainY + 22, statusColor, true);
            context.drawText(textRenderer, Text.literal("HP  " + botHealth), mainX + 25, mainY + 218, TEXT, false);
            context.drawText(textRenderer, Text.literal("FOOD  " + botFood), mainX + 150, mainY + 218, TEXT, false);
            context.drawText(textRenderer, Text.literal("TASK  " + botTask), mainX + 285, mainY + 218, TEXT, false);
            context.drawText(textRenderer, Text.literal("POS  " + botPosition), mainX + 25, mainY + 238, MUTED, false);

            int cardY = mainY + 258;
            int cardW = (mainW - 60) / 2;
            context.fill(mainX + 25, cardY, mainX + 25 + cardW, cardY + 70, PANEL_LIGHT);
            context.fill(mainX + 35 + cardW, cardY, mainX + 35 + cardW * 2, cardY + 70, PANEL_LIGHT);
            context.drawText(textRenderer, Text.literal("NEARBY PLAYERS  " + nearbyPlayers.size()), mainX + 35, cardY + 10, TEXT, true);
            int playerY = cardY + 27;
            for (int i = 0; i < Math.min(3, nearbyPlayers.size()); i++) {
                context.drawText(textRenderer, Text.literal(nearbyPlayers.get(i)), mainX + 35, playerY + i * 13, MUTED, false);
            }
            if (nearbyPlayers.isEmpty()) {
                context.drawText(textRenderer, Text.literal(apiOnline ? "No players detected" : "Waiting for bot..."), mainX + 35, playerY, MUTED, false);
            }

            context.drawText(textRenderer, Text.literal("HOMES  " + savedHomes.size()), mainX + 45 + cardW, cardY + 10, TEXT, true);
            int homeY = cardY + 27;
            for (int i = 0; i < Math.min(3, savedHomes.size()); i++) {
                context.drawText(textRenderer, Text.literal(savedHomes.get(i)), mainX + 45 + cardW, homeY + i * 13, MUTED, false);
            }
            if (savedHomes.isEmpty()) {
                context.drawText(textRenderer, Text.literal("No saved homes"), mainX + 45 + cardW, homeY, MUTED, false);
            }
            if (!actionMessage.isEmpty()) {
                context.drawText(textRenderer, Text.literal(actionMessage), mainX + 25, mainY + mainH - 10, ACCENT, false);
            }
        } else {
            context.drawText(textRenderer, Text.literal(category.toUpperCase()), mainX + 24, mainY + 62, MUTED, true);
            if (category.equals("settings")) {
                context.drawText(textRenderer, Text.literal("LOCAL ONLY"), mainX + 24, mainY + 82, ACCENT, true);
                context.drawText(textRenderer, Text.literal(contextText), mainX + 24, mainY + 235, MUTED, false);
                context.drawText(textRenderer, Text.literal(settingsMessage), mainX + mainW - 110, mainY + 62, apiOnline ? 0xFF7CFFB2 : MUTED, false);
            }
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
