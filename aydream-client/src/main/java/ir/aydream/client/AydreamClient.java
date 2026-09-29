package ir.aydream.client;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.argument;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.literal;

public class AydreamClient implements ClientModInitializer {
    private final HttpClient apiClient = HttpClient.newHttpClient();
    private String apiBaseUrl = "http://127.0.0.1:31880";
    private String apiToken = "";

    @Override
    public void onInitializeClient() {
        loadConfig();
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) -> register(dispatcher));
    }

    private void register(CommandDispatcher<FabricClientCommandSource> dispatcher) {
        dispatcher.register(
            literal("dream")
                .executes(context -> {
                    MinecraftClient client = MinecraftClient.getInstance();
                    // IMPORTANT: client.send() queues the task for the NEXT tick.
                    // client.execute() runs immediately when already on the render thread,
                    // and then the chat screen closes itself and wipes our screen
                    // (that was why /dream showed nothing, with no error).
                    client.send(() -> client.setScreen(new AydreamScreen(null)));
                    return 1;
                })
                .then(literal("help").executes(context -> {
                    sendHelp(context.getSource());
                    return 1;
                }))
                .then(argument("command", StringArgumentType.greedyString()).executes(context -> {
                    String command = StringArgumentType.getString(context, "command").trim();
                    if (command.isEmpty()) {
                        sendHelp(context.getSource());
                        return 1;
                    }
                    sendCommand(context.getSource(), command);
                    return 1;
                }))
        );
    }

    private void sendCommand(FabricClientCommandSource source, String command) {
        loadConfig();
        if (apiToken.isBlank()) {
            source.sendFeedback(Text.literal("Aydream API token is not configured. Open /dream and set it in Settings."));
            return;
        }

        String botCommand = command.startsWith("!") ? command : "!" + command;
        String json = "{\"command\":\"" + escapeJson(botCommand) + "\"}";

        try {
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(apiBaseUrl + "/api/action"))
                .header("Authorization", "Bearer " + apiToken)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json))
                .build();

            apiClient.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenAccept(response -> {
                MinecraftClient client = MinecraftClient.getInstance();
                client.execute(() -> {
                    if (response.statusCode() >= 200 && response.statusCode() < 300) {
                        source.sendFeedback(Text.literal("Aydream: " + botCommand));
                    } else {
                        source.sendFeedback(Text.literal("Aydream command failed: HTTP " + response.statusCode()));
                    }
                });
            }).exceptionally(error -> {
                MinecraftClient client = MinecraftClient.getInstance();
                client.execute(() -> source.sendFeedback(Text.literal("Aydream API offline.")));
                return null;
            });
        } catch (Exception error) {
            source.sendFeedback(Text.literal("Aydream API URL is invalid."));
        }
    }

    private void sendHelp(FabricClientCommandSource source) {
        source.sendFeedback(Text.literal("Use /dream <command> to control AyDream. Example: /dream follow TheROMZ53"));
        source.sendFeedback(Text.literal("Commands: trust, untrust, trusted, deposit, profile, pos, stripmine, patrol, farmgroup, goto, look, wander, eat, inventory, mine, farm, collect, trade, give, kill, skin, dig, place, guard, uptime, report, stats, waypoint, status, login, register, cmd, reconnect, coords, time, lookat, follow, come, scan, block, find, totem, weapon, tool, attack, stop, players, near, health, sethome, home, delhome, equip, armor, drop, hand, jump, sprint, sneak, move, face, distance, where, watch, autopilot, clear, say, sik"));
    }

    private void loadConfig() {
        try {
            Path path = MinecraftClient.getInstance().runDirectory.toPath()
                .resolve("config")
                .resolve("aydream-client.properties");
            if (!Files.exists(path)) return;

            Properties properties = new Properties();
            try (var input = Files.newInputStream(path)) {
                properties.load(input);
            }

            String configuredUrl = properties.getProperty("api.url", "http://127.0.0.1:31880").trim();
            if (!configuredUrl.isEmpty()) {
                apiBaseUrl = configuredUrl.endsWith("/")
                    ? configuredUrl.substring(0, configuredUrl.length() - 1)
                    : configuredUrl;
            }

            apiToken = properties.getProperty("api.token", "").trim();
        } catch (Exception ignored) {
            apiBaseUrl = "http://127.0.0.1:31880";
            apiToken = "";
        }
    }

    private String escapeJson(String value) {
        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"");
    }
}
