package ir.aydream.client;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.client.MinecraftClient;
import net.minecraft.text.Text;

import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.argument;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.literal;

public class AydreamClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) -> register(dispatcher));
    }

    private void register(CommandDispatcher<FabricClientCommandSource> dispatcher) {
        dispatcher.register(
            literal("dream")
                .executes(context -> {
                    MinecraftClient client = MinecraftClient.getInstance();
                    client.execute(() -> client.setScreen(new AydreamScreen(null)));
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
        MinecraftClient client = MinecraftClient.getInstance();
        if (client.player == null) return;

        String apiUrl = "http://127.0.0.1:31880/api/action";
        client.player.sendCommand("say");
        source.sendFeedback(Text.literal("Aydream command: " + command));
    }

    private void sendHelp(FabricClientCommandSource source) {
        source.sendFeedback(Text.literal("Aydream commands: trust, untrust, trusted, deposit, profile, pos, stripmine, patrol, farmgroup, goto, look, wander, eat, inventory, mine, farm, collect, trade, give, kill, skin, dig, place, guard, uptime, report, stats, waypoint, status, login, register, cmd, reconnect, coords, time, lookat, follow, come, scan, block, find, totem, weapon, tool, attack, stop, help, players, near, health, sethome, home, delhome, equip, armor, drop, hand, jump, sprint, sneak, move, face, distance, where, watch, autopilot, clear, say, sik");
    }
}
