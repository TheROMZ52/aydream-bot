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
    private String apiToken = "";
    private net.minecraft.client.gui.widget.TextFieldWidget urlField;
    private net.minecraft.client.gui.widget.TextFieldWidget tokenField;
    private volatile String settingsMessage = "";
    private final HttpClient apiClient = HttpClient.newHttpClient();
    private volatile boolean apiOnline = false;
    private volatile String botTask = "offline";
    private volatile String botHealth = "--";
    private volatile String botFood = "--";
    private volatile String botPosition = "--";
    private volatile List<String> nearbyPlayers = List.of();
    private volatile List<String> savedHomes = List.of();
    private volatile List<String> inventoryItems = List.of();
    private volatile String heldItem = "empty";
    private volatile String actionMessage = "";
    private volatile List<String> actionResponses = List.of();
    private volatile String lastActivity = "--";
    private volatile String botBusy = "--";
    private volatile AydreamUpdater.UpdateInfo updateInfo = AydreamUpdater.UpdateInfo.none();
    private volatile String updateMessage = "";
    private long nextRefresh = 0L;
    private long nextUpdateCheck = 0L;

    private static final int PANEL = 0xD91A1D26;
    private static final int PANEL_LIGHT = 0xE0262935;
    private static final int GLASS = 0xB82A2E3A;
    private static final int ACCENT = 0xFF8B5CF6;
    private static final int ACCENT_SOFT = 0x338B5CF6;
    private static final int TEXT = 0xFFF5F5F7;
    private static final int MUTED = 0xFF9FA3B2;

    private static final String[] SIDEBAR_LABELS = {"Dashboard", "Players", "Movement", "Combat", "Homes", "Automation", "Activity", "Inventory", "Info", "Settings"};
    private static final String[] SIDEBAR_VALUES = {"dashboard", "players", "movement", "combat", "homes", "automation", "activity", "inventory", "info", "settings"};

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
            checkForUpdates();
            refreshStatus();
        } else {
            buildSidebar();
            buildCategory();
        }

        addButton(Math.max(10, width - 105), Math.max(8, height - 32), 95, 24, "Close", this::close);
    }

    private void buildDashboard() {
        int panelW = Math.min(660, width - 40);
        int panelX = (width - panelW) / 2;
        int panelY = 48;
        int buttonW = (panelW - 75) / 3;

        int[] columns = {panelX + 25, panelX + 25 + buttonW + 15, panelX + 25 + (buttonW + 15) * 2};

        addButton(columns[0], panelY + 78, buttonW, 30, "Movement", () -> open("movement"));
        addButton(columns[1], panelY + 78, buttonW, 30, "Combat", () -> open("combat"));
        addButton(columns[2], panelY + 78, buttonW, 30, "Homes", () -> open("homes"));

        addButton(columns[0], panelY + 116, buttonW, 30, "Automation", () -> open("automation"));
        addButton(columns[1], panelY + 116, buttonW, 30, "Inventory", () -> open("inventory"));
        addButton(columns[2], panelY + 116, buttonW, 30, "Info", () -> open("info"));

        if (!nearbyPlayers.isEmpty()) {
            String quickFollowPlayer = extractPlayerName(nearbyPlayers.get(0));
            addButton(columns[0], panelY + 170, buttonW, 30, "Quick Follow", () -> apiAction("!follow " + quickFollowPlayer));
        } else {
            addButton(columns[0], panelY + 170, buttonW, 30, "Quick Follow", () -> {});
        }
        addButton(columns[1], panelY + 170, buttonW, 30, "Stop Everything", () -> apiAction("!clear"));
        addButton(columns[2], panelY + 170, buttonW, 30, "Refresh", this::forceRefresh);
        addButton(columns[0], panelY + 208, buttonW, 30, "Settings", () -> open("settings"));
        addButton(columns[1], panelY + 246, buttonW, 30, updateInfo.available() ? "Update Available" : "Updates", this::openUpdates);
        addButton(columns[1], panelY + 208, buttonW, 30, "Players", () -> open("players"));
        if (!nearbyPlayers.isEmpty()) {
            String player = extractPlayerName(nearbyPlayers.get(0));
            addButton(columns[2], panelY + 208, buttonW, 30, "Follow " + player, () -> apiAction("!follow " + player));
        } else {
            addButton(columns[2], panelY + 208, buttonW, 30, "No Players", () -> {});
        }

        if (!savedHomes.isEmpty()) {
            int homeY = panelY + 246;
            for (int i = 0; i < Math.min(3, savedHomes.size()); i++) {
                String home = savedHomes.get(i);
                addButton(columns[i], homeY, buttonW, 26, "Go: " + home, () -> apiAction("!home " + home));
            }
        }
    }

    private void buildSidebar() {
        int x = 20;
        int y = 58;
        int spacing = sidebarSpacing();

        for (int i = 0; i < SIDEBAR_LABELS.length; i++) {
            String value = SIDEBAR_VALUES[i];
            addButton(x, y + i * spacing, sidebarWidth() - 30, 28, SIDEBAR_LABELS[i], () -> open(value));
        }
    }

    private int sidebarSpacing() {
        int available = Math.max(280, height - 120);
        return Math.max(29, Math.min(38, available / SIDEBAR_LABELS.length));
    }

    private int sidebarWidth() {
        return Math.max(145, Math.min(185, width / 4));
    }

    private int contentLeft() {
        return sidebarWidth() + 15;
    }

    private int contentWidth() {
        return Math.max(220, width - contentLeft() - 20);
    }

    private void buildCategory() {
        int left = contentLeft() + 15;
        int top = 82;
        if (category.startsWith("player:")) {
            buildPlayerDetail(category.substring(7));
            return;
        }
        if (category.equals("settings")) {
            buildSettings();
            return;
        }
        if (category.equals("updates")) {
            buildUpdates();
            return;
        }
        if (category.equals("players")) {
            buildPlayers();
            return;
        }
        if (category.equals("inventory")) {
            buildInventory();
            return;
        }
        if (category.equals("homes")) {
            buildHomes();
            return;
        }
        if (category.equals("automation")) {
            buildAutomation();
            return;
        }
        if (category.equals("activity")) {
            buildActivity();
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

    private void buildPlayers() {
        int left = contentLeft() + 15;
        int top = 92;

        if (nearbyPlayers.isEmpty()) {
            contextText = apiOnline ? "No players detected." : "Bot API is offline.";
            return;
        }

        int start = page * 6;
        int end = Math.min(start + 6, nearbyPlayers.size());

        for (int i = start; i < end; i++) {
            String display = nearbyPlayers.get(i);
            String player = extractPlayerName(display);
            int index = i - start;
            int col = index % 2;
            int row = index / 2;
            int x = left + col * 215;
            int y = top + row * 64;

            addButton(x, y, 200, 28, player, () -> openPlayer(player));
            addButton(x, y + 32, 62, 24, "Follow", () -> apiAction("!follow " + player));
            addButton(x + 68, y + 32, 62, 24, "Come", () -> apiAction("!come " + player));
            addButton(x + 136, y + 32, 64, 24, "Attack", () -> apiAction("!attack " + player));
        }

        if (start > 0) {
            addButton(left, top + 200, 80, 24, "<", () -> {
                page--;
                init();
            });
        }
        if (end < nearbyPlayers.size()) {
            addButton(left + 90, top + 200, 80, 24, ">", () -> {
                page++;
                init();
            });
        }
    }

    private void openPlayer(String player) {
        category = "player:" + player;
        page = 0;
        init();
    }

    private void buildPlayerDetail(String player) {
        int left = contentLeft() + 35;
        int top = 98;
        contextText = findPlayerDisplay(player);

        addButton(left, top, 185, 30, "Follow", () -> apiAction("!follow " + player));
        addButton(left + 200, top, 185, 30, "Come", () -> apiAction("!come " + player));
        addButton(left, top + 40, 185, 30, "Attack", () -> apiAction("!attack " + player));
        addButton(left + 200, top + 40, 185, 30, "Look At", () -> apiAction("!look " + player));
        addButton(left, top + 80, 185, 30, "Stop", () -> apiAction("!stop"));
        addButton(left + 200, top + 80, 185, 30, "Back", () -> open("players"));
    }

    private String findPlayerDisplay(String player) {
        for (String value : nearbyPlayers) {
            if (extractPlayerName(value).equalsIgnoreCase(player)) return value;
        }
        return player;
    }

    private void buildHomes() {
        int left = contentLeft() + 15;
        int top = 92;
        addButton(left, top, 185, 28, "Save Current", () -> apiAction("!sethome"));
        addButton(left + 195, top, 185, 28, "Refresh", this::forceRefresh);
        addButton(left + 390, top, 185, 28, "Home", () -> apiAction("!home"));

        if (savedHomes.isEmpty()) {
            contextText = apiOnline ? "No saved homes." : "Bot API is offline.";
            return;
        }

        for (int i = 0; i < savedHomes.size(); i++) {
            String home = savedHomes.get(i);
            int col = i % 2;
            int row = i / 2;
            int x = left + col * 290;
            int y = top + 42 + row * 48;
            addButton(x, y, 185, 28, "Go: " + home, () -> apiAction("!home " + home));
            addButton(x + 190, y, 75, 28, "Delete", () -> apiAction("!delhome " + home));
        }
    }

    private void buildAutomation() {
        int left = contentLeft() + 15;
        int top = 92;
        addButton(left, top, 185, 28, "Auto Eat", () -> apiAction("!eat"));
        addButton(left + 195, top, 185, 28, "Autopilot On", () -> apiAction("!autopilot on"));
        addButton(left + 390, top, 185, 28, "Autopilot Off", () -> apiAction("!autopilot off"));
        addButton(left, top + 40, 185, 28, "Wander", () -> apiAction("!wander"));
        addButton(left + 195, top + 40, 185, 28, "Clear Tasks", () -> apiAction("!clear"));
        addButton(left + 390, top + 40, 185, 28, "Stop Everything", () -> apiAction("!stop"));
        addButton(left, top + 80, 185, 28, "Refresh Status", this::forceRefresh);
        contextText = "Task: " + botTask + "  |  Busy: " + botBusy;
    }

    private void buildActivity() {
        int left = contentLeft() + 15;
        int top = 92;
        addButton(left, top, 185, 28, "Refresh", this::forceRefresh);
        addButton(left + 195, top, 185, 28, "Stop", () -> apiAction("!stop"));
        addButton(left + 390, top, 185, 28, "Clear", () -> apiAction("!clear"));
        contextText = "Last activity: " + lastActivity;
    }

    private void buildInventory() {
        if (inventoryItems.isEmpty()) refreshInventory();
        int left = contentLeft() + 15;
        int top = 92;

        addButton(left, top, 190, 28, "Refresh Inventory", this::refreshInventory);
        addButton(left + 200, top, 190, 28, "Equip Armor", () -> apiAction("!armor"));
        addButton(left + 400, top, 190, 28, "Best Tool", () -> apiAction("!tool"));

        contextText = "Held: " + heldItem;
        int start = page * 12;
        int end = Math.min(start + 12, inventoryItems.size());
        for (int i = start; i < end; i++) {
            int index = i - start;
            int col = index % 3;
            int row = index / 3;
            addButton(left + col * 200, top + 45 + row * 34, 190, 28, inventoryItems.get(i), () -> {});
        }
        if (start > 0) addButton(left, top + 190, 80, 24, "<", () -> { page--; init(); });
        if (end < inventoryItems.size()) addButton(left + 90, top + 190, 80, 24, ">", () -> { page++; init(); });
    }

    private void refreshInventory() {
        HttpRequest request = buildRequest("/api/inventory", "GET", null);
        if (request == null) {
            inventoryItems = List.of();
            return;
        }
        apiClient.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenAccept(response -> {
            if (response.statusCode() != 200) return;
            String body = response.body();
            List<String> items = new ArrayList<>();
            int cursor = 0;
            while (true) {
                int n = body.indexOf("\"name\":\"", cursor);
                if (n < 0) break;
                n += 9;
                int e = body.indexOf("\"", n);
                if (e < 0) break;
                String name = body.substring(n, e);
                int countStart = body.indexOf("\"count\":", e);
                String count = "--";
                if (countStart >= 0) {
                    countStart += 8;
                    int countEnd = countStart;
                    while (countEnd < body.length() && ",}".indexOf(body.charAt(countEnd)) < 0) countEnd++;
                    count = body.substring(countStart, countEnd).trim();
                }
                items.add(name + " x" + count);
                cursor = e + 1;
            }
            inventoryItems = items;
            int heldStart = body.indexOf("\"held\":");
            heldItem = heldStart >= 0 && body.indexOf("\"name\":\"", heldStart) >= 0
                ? value(body.substring(heldStart), "name") : "empty";
            MinecraftClient.getInstance().execute(() -> {
                if (MinecraftClient.getInstance().currentScreen == this) init();
            });
        }).exceptionally(error -> null);
    }

    private void checkForUpdates() {
        long now = System.currentTimeMillis();
        if (now < nextUpdateCheck) return;
        nextUpdateCheck = now + 300000L;
        AydreamUpdater.check(apiClient, info -> {
            updateInfo = info;
            MinecraftClient.getInstance().execute(() -> {
                if (MinecraftClient.getInstance().currentScreen == this) init();
            });
        });
    }

    private void openUpdates() {
        category = "updates";
        page = 0;
        updateMessage = "";
        AydreamUpdater.check(apiClient, updateInfo -> {
            this.updateInfo = updateInfo;
            MinecraftClient.getInstance().execute(() -> {
                if (MinecraftClient.getInstance().currentScreen == this) init();
            });
        });
        init();
    }

    private void buildUpdates() {
        int left = contentLeft() + 35;
        int top = 98;
        contextText = "Automatic update check uses the Aydream GitHub release.";
        if (updateInfo.available()) {
            addButton(left, top + 70, 180, 30, "Download Update", this::downloadUpdate);
            addButton(left + 190, top + 70, 180, 30, "Restart & Update", this::restartAndUpdate);
            addButton(left + 380, top + 70, 120, 30, "Later", () -> open("dashboard"));
        } else {
            addButton(left, top + 70, 180, 30, "Check Again", this::openUpdates);
        }
    }

    private void downloadUpdate() {
        updateMessage = "Downloading...";
        AydreamUpdater.download(apiClient, updateInfo, result -> {
            updateMessage = result;
            if (result.equals("Update downloaded")) {
                AydreamUpdater.markDownloaded(updateInfo.version());
            }
            MinecraftClient.getInstance().execute(() -> {
                if (MinecraftClient.getInstance().currentScreen == this) init();
            });
        });
    }

    private void restartAndUpdate() {
        updateMessage = "Preparing update...";
        AydreamUpdater.download(apiClient, updateInfo, result -> {
            if (!result.equals("Update downloaded")) {
                updateMessage = result;
                return;
            }
            MinecraftClient.getInstance().execute(() -> {
                try {
                    AydreamUpdater.scheduleReplacement(MinecraftClient.getInstance().runDirectory.toPath(), updateInfo.version());
                    MinecraftClient.getInstance().scheduleStop();
                } catch (Exception error) {
                    updateMessage = "Restart failed";
                }
            });
        });
    }

    private void buildSettings() {
        int left = contentLeft() + 35;
        int top = 98;
        int w = Math.min(430, width - left - 40);

        urlField = new net.minecraft.client.gui.widget.TextFieldWidget(textRenderer, left, top, w, 22, Text.literal("Bot API URL"));
        urlField.setMaxLength(200);
        urlField.setText(apiBaseUrl);
        addDrawableChild(urlField);

        tokenField = new net.minecraft.client.gui.widget.TextFieldWidget(textRenderer, left, top + 30, w, 22, Text.literal("API Token"));
        tokenField.setMaxLength(200);
        tokenField.setText(apiToken);
        addDrawableChild(tokenField);

        addButton(left, top + 70, 130, 28, "Save", this::saveConfig);
        addButton(left + 140, top + 70, 130, 28, "Test", this::testConnection);
        addButton(left + 280, top + 70, 130, 28, "Reset", this::resetConfig);

        contextText = "Use the token from api-token.txt.";
    }

    private String contextText = "";

    private Path configPath() {
        return MinecraftClient.getInstance().runDirectory.toPath().resolve("config").resolve("aydream-client.properties");
    }

    private String normalizeApiUrl(String value) {
        if (value == null || value.isBlank()) return "http://127.0.0.1:31880";
        try {
            URI uri = URI.create(value.trim());
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (!"http".equalsIgnoreCase(scheme)) return "http://127.0.0.1:31880";
            if (!"127.0.0.1".equals(host) && !"localhost".equalsIgnoreCase(host)) return "http://127.0.0.1:31880";
            if (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath())) return "http://127.0.0.1:31880";
            int port = uri.getPort();
            if (port < 1 || port > 65535) return "http://127.0.0.1:31880";
            return "http://" + host + ":" + port;
        } catch (Exception ignored) {
            return "http://127.0.0.1:31880";
        }
    }

    private HttpRequest buildRequest(String path, String method, String body) {
        try {
            HttpRequest.Builder builder = HttpRequest.newBuilder()
                .uri(URI.create(apiBaseUrl + path));
            if (apiToken.isBlank()) {
                apiOnline = false;
                return null;
            }
            builder.header("Authorization", "Bearer " + apiToken);
            if ("POST".equals(method)) {
                builder.header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(body == null ? "" : body));
            } else {
                builder.GET();
            }
            return builder.build();
        } catch (Exception error) {
            apiOnline = false;
            return null;
        }
    }

    private void loadConfig() {
        try {
            Path path = configPath();
            if (!Files.exists(path)) return;
            java.util.Properties properties = new java.util.Properties();
            try (var input = Files.newInputStream(path)) {
                properties.load(input);
            }
            apiBaseUrl = normalizeApiUrl(properties.getProperty("api.url", "http://127.0.0.1:31880"));
            apiToken = properties.getProperty("api.token", "");
        } catch (Exception ignored) {
            apiBaseUrl = "http://127.0.0.1:31880";
        }
    }

    private void saveConfig() {
        if (urlField != null) apiBaseUrl = normalizeApiUrl(urlField.getText());
        if (tokenField != null) apiToken = tokenField.getText().trim();
        try {
            Path path = configPath();
            Files.createDirectories(path.getParent());
            java.util.Properties properties = new java.util.Properties();
            properties.setProperty("api.url", apiBaseUrl);
            properties.setProperty("api.token", apiToken);
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
        apiToken = "";
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
        HttpRequest request = buildRequest("/api/action", "POST", json);
        if (request == null) {
            actionMessage = "Invalid API URL";
            actionResponses = List.of();
            return;
        }
        actionMessage = "Running: " + command;
        apiClient.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenAccept(response -> {
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                List<String> messages = extractJsonStringArray(response.body(), "messages");
                actionResponses = messages;
                actionMessage = "Done: " + command;
                if (!messages.isEmpty()) {
                    MinecraftClient.getInstance().execute(() -> {
                        if (MinecraftClient.getInstance().player != null) {
                            for (String message : messages) {
                                MinecraftClient.getInstance().player.sendMessage(Text.literal("[Aydream] " + message), false);
                            }
                        }
                    });
                }
            } else {
                actionResponses = List.of();
                actionMessage = "Action failed";
            }
        }).exceptionally(error -> {
            actionResponses = List.of();
            actionMessage = "API offline";
            return null;
        });
    }

    private List<String> extractJsonStringArray(String json, String key) {
        List<String> values = new ArrayList<>();
        String marker = "\"" + key + "\":[";
        int start = json.indexOf(marker);
        if (start < 0) return values;
        start += marker.length();
        int end = json.indexOf("]", start);
        if (end < 0) return values;

        String array = json.substring(start, end);
        boolean escaped = false;
        StringBuilder current = null;

        for (int i = 0; i < array.length(); i++) {
            char ch = array.charAt(i);
            if (current == null) {
                if (ch == '"') current = new StringBuilder();
                continue;
            }
            if (escaped) {
                current.append(switch (ch) {
                    case '\\' -> '\\';
                    case '"' -> '"';
                    case 'n' -> '\n';
                    case 'r' -> '\r';
                    case 't' -> '\t';
                    default -> ch;
                });
                escaped = false;
            } else if (ch == '\\') {
                escaped = true;
            } else if (ch == '"') {
                values.add(current.toString());
                current = null;
            } else {
                current.append(ch);
            }
        }

        return values;
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
        HttpRequest request = buildRequest("/api/status", "GET", null);
        if (request == null) return;
        apiClient.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenAccept(response -> {
            if (response.statusCode() != 200) {
                apiOnline = false;
                return;
            }
            String body = response.body();
            apiOnline = true;
            settingsMessage = "Connected";
            List<String> newPlayers = parsePlayers(body);
            List<String> newHomes = parseHomeNames(body);
            boolean changed = !newPlayers.equals(nearbyPlayers) || !newHomes.equals(savedHomes);
            nearbyPlayers = newPlayers;
            savedHomes = newHomes;
            if (changed && category.equals("dashboard")) {
                MinecraftClient.getInstance().execute(() -> {
                    if (MinecraftClient.getInstance().currentScreen == this) init();
                });
            }
            botHealth = value(body, "health");
            botFood = value(body, "food");
            botTask = value(body, "task");
            botBusy = value(body, "busy");
            lastActivity = value(body, "lastActivity");
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
        start += 9;
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

    private String extractPlayerName(String value) {
        int separator = value.indexOf("  ");
        return separator > 0 ? value.substring(0, separator) : value;
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

    @Override
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        context.fill(0, 0, width, height, 0xFF0B0D12);
        refreshStatus();

        int mainY = 38;
        int mainX;
        int mainW;
        if (category.equals("dashboard")) {
            mainW = Math.min(760, Math.max(320, width - 40));
            mainX = (width - mainW) / 2;
        } else {
            mainX = contentLeft();
            mainW = contentWidth();
        }
        int mainH = Math.max(220, height - 58);

        context.fill(mainX, mainY, mainX + mainW, mainY + mainH, PANEL);
        context.fill(mainX + 1, mainY + 1, mainX + mainW - 1, mainY + 55, GLASS);
        context.fill(mainX, mainY, mainX + mainW, mainY + 2, ACCENT);
        context.fill(mainX + 24, mainY + 56, mainX + mainW - 24, mainY + 57, ACCENT_SOFT);

        if (!category.equals("dashboard")) {
            int sideW = sidebarWidth();
            context.fill(10, mainY, sideW, height - 8, PANEL);
            context.fill(11, mainY + 1, sideW - 1, mainY + 38, GLASS);
            context.fill(10, mainY, sideW, mainY + 2, ACCENT);

            // highlight the active sidebar tab (drawn behind the buttons)
            String activeValue = category.startsWith("player:") ? "players" : category;
            for (int i = 0; i < SIDEBAR_VALUES.length; i++) {
                if (SIDEBAR_VALUES[i].equals(activeValue)) {
                    int tabY = 58 + i * sidebarSpacing();
                    context.fill(16, tabY - 2, sideW - 3, tabY + 30, ACCENT_SOFT);
                    context.fill(16, tabY - 2, 19, tabY + 30, ACCENT);
                    break;
                }
            }
        }

        context.drawText(textRenderer, Text.literal("Aydream"), mainX + 24, mainY + 18, TEXT, true);
        context.drawText(textRenderer, Text.literal("CONTROL CENTER"), mainX + 24, mainY + 34, MUTED, false);

        if (category.equals("dashboard")) {
            context.drawText(textRenderer, Text.literal("Bot Control"), mainX + 25, mainY + 62, MUTED, false);
            int statusColor = apiOnline ? 0xFF7CFFB2 : 0xFFFF7777;
            context.drawText(textRenderer, Text.literal(apiOnline ? "ONLINE" : "OFFLINE"), mainX + mainW - 82, mainY + 22, statusColor, true);
            context.drawText(textRenderer, Text.literal("HP  " + botHealth), mainX + 25, mainY + 296, TEXT, false);
            context.drawText(textRenderer, Text.literal("FOOD  " + botFood), mainX + 150, mainY + 296, TEXT, false);
            context.drawText(textRenderer, Text.literal("TASK  " + botTask), mainX + 285, mainY + 296, TEXT, false);
            context.drawText(textRenderer, Text.literal("POS  " + botPosition), mainX + 25, mainY + 316, MUTED, false);

            int cardY = mainY + 326;
            int cardW = (mainW - 60) / 2;
            int rightCardX = mainX + 35 + cardW;
            context.fill(mainX + 25, cardY, mainX + 25 + cardW, cardY + 70, PANEL_LIGHT);
            context.fill(rightCardX, cardY, rightCardX + cardW, cardY + 70, PANEL_LIGHT);
            context.drawText(textRenderer, Text.literal("NEARBY PLAYERS  " + nearbyPlayers.size()), mainX + 35, cardY + 10, TEXT, true);
            int playerY = cardY + 27;
            for (int i = 0; i < Math.min(3, nearbyPlayers.size()); i++) {
                context.drawText(textRenderer, Text.literal(nearbyPlayers.get(i)), mainX + 35, playerY + i * 13, MUTED, false);
            }
            if (nearbyPlayers.isEmpty()) {
                context.drawText(textRenderer, Text.literal(apiOnline ? "No players detected" : "Waiting for bot..."), mainX + 35, playerY, MUTED, false);
            }

            context.drawText(textRenderer, Text.literal("HOMES  " + savedHomes.size()), rightCardX + 10, cardY + 10, TEXT, true);
            int homeY = cardY + 27;
            for (int i = 0; i < Math.min(3, savedHomes.size()); i++) {
                context.drawText(textRenderer, Text.literal(savedHomes.get(i)), rightCardX + 10, homeY + i * 13, MUTED, false);
            }
            if (savedHomes.isEmpty()) {
                context.drawText(textRenderer, Text.literal("No saved homes"), rightCardX + 10, homeY, MUTED, false);
            }
            if (!actionMessage.isEmpty()) {
                context.drawText(textRenderer, Text.literal(actionMessage), mainX + 25, mainY + mainH - 10, ACCENT, false);
            }
            if (!actionResponses.isEmpty()) {
                int responseY = mainY + 240;
                context.fill(mainX + 25, responseY, mainX + mainW - 25, responseY + 48, PANEL_LIGHT);
                context.drawText(textRenderer, Text.literal("BOT RESPONSE"), mainX + 35, responseY + 8, TEXT, true);
                int lineY = responseY + 23;
                for (int i = Math.max(0, actionResponses.size() - 2); i < actionResponses.size(); i++) {
                    String message = actionResponses.get(i);
                    if (message.length() > 82) message = message.substring(0, 82) + "...";
                    context.drawText(textRenderer, Text.literal(message), mainX + 35, lineY, MUTED, false);
                    lineY += 13;
                }
            }
        } else {
            String title = category.startsWith("player:") ? "PLAYER / " + category.substring(7).toUpperCase() : category.toUpperCase();
            context.drawText(textRenderer, Text.literal(title), mainX + 24, mainY + 62, MUTED, true);
            if (category.startsWith("player:")) {
                context.drawText(textRenderer, Text.literal("TARGET"), mainX + 24, mainY + 82, ACCENT, true);
                context.drawText(textRenderer, Text.literal(contextText), mainX + 24, mainY + 108, MUTED, false);
            }
            if (category.equals("automation") || category.equals("activity")) {
                context.fill(mainX + 24, mainY + 92, mainX + mainW - 24, mainY + 145, PANEL_LIGHT);
                context.drawText(textRenderer, Text.literal(contextText), mainX + 36, mainY + 110, TEXT, false);
                context.drawText(textRenderer, Text.literal("LIVE STATUS"), mainX + 36, mainY + 128, MUTED, false);
            }
            if (category.equals("settings")) {
                context.drawText(textRenderer, Text.literal("LOCAL ONLY"), mainX + 24, mainY + 82, ACCENT, true);
                context.drawText(textRenderer, Text.literal(contextText), mainX + 24, mainY + 235, MUTED, false);
                context.drawText(textRenderer, Text.literal(settingsMessage), mainX + mainW - 110, mainY + 62, apiOnline ? 0xFF7CFFB2 : MUTED, false);
            }
        }

        if (category.equals("updates")) {
            context.drawText(textRenderer, Text.literal("Current: " + AydreamUpdater.currentVersion()), mainX + 24, mainY + 82, TEXT, false);
            if (updateInfo.available()) {
                context.drawText(textRenderer, Text.literal("Latest: " + updateInfo.version()), mainX + 24, mainY + 104, ACCENT, true);
                context.drawText(textRenderer, Text.literal("Update available!"), mainX + 24, mainY + 126, TEXT, false);
            } else if (updateInfo.checked()) {
                context.drawText(textRenderer, Text.literal("You are up to date."), mainX + 24, mainY + 104, TEXT, false);
            } else {
                context.drawText(textRenderer, Text.literal("Checking for updates..."), mainX + 24, mainY + 104, MUTED, false);
            }
            context.drawText(textRenderer, Text.literal(updateMessage), mainX + 24, mainY + 150, MUTED, false);
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

