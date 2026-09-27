package ir.aydream.client;

import com.mojang.brigadier.CommandDispatcher;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.FabricClientCommandSource;
import net.minecraft.client.MinecraftClient;
import static net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.literal;

public class AydreamClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) -> register(dispatcher));
    }

    private void register(CommandDispatcher<FabricClientCommandSource> dispatcher) {
        dispatcher.register(literal("dream").executes(context -> {
            MinecraftClient client = MinecraftClient.getInstance();
            client.execute(() -> client.setScreen(new AydreamScreen(null)));
            return 1;
        }));
    }
}
