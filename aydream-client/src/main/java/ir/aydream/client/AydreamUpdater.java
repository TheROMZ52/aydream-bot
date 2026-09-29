package ir.aydream.client;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.function.Consumer;
import java.util.Optional;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.metadata.ModOrigin;

public final class AydreamUpdater {
    private static final String RELEASE_URL = "https://api.github.com/repos/TheROMZ52/aydream-bot/releases/latest";
    private static final String ASSET_NAME = "AydreamClient.jar";

    private AydreamUpdater() {}

    public record UpdateInfo(String version, String url, String digest, boolean checked) {
        public static UpdateInfo none() {
            return new UpdateInfo("", "", "", false);
        }

        public boolean available() {
            return checked && compare(currentVersion(), version) < 0 && !url.isBlank();
        }
    }

    public static String currentVersion() {
        try (InputStream input = AydreamUpdater.class.getResourceAsStream("/aydream.version")) {
            if (input == null) return "0.0.0";
            return new String(input.readAllBytes()).trim();
        } catch (Exception ignored) {
            return "0.0.0";
        }
    }

    public static void check(HttpClient client, Consumer<UpdateInfo> callback) {
        Thread.startVirtualThread(() -> {
            try {
                HttpRequest request = HttpRequest.newBuilder(URI.create(RELEASE_URL))
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", "AydreamClient")
                    .GET()
                    .build();
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() != 200) throw new IllegalStateException("Release check failed");
                String body = response.body();
                String version = extractReleaseVersion(body);
                String url = extractAssetField(body, "browser_download_url");
                String digest = extractAssetField(body, "digest");
                callback.accept(new UpdateInfo(version, url, digest, true));
            } catch (Exception error) {
                callback.accept(new UpdateInfo("", "", "", true));
            }
        });
    }

    public static void download(HttpClient client, UpdateInfo info, Consumer<String> callback) {
        if (!info.available()) {
            callback.accept("No update available");
            return;
        }
        Thread.startVirtualThread(() -> {
            try {
                Path runDir = net.minecraft.client.MinecraftClient.getInstance().runDirectory.toPath();
                Path updateDir = runDir.resolve("mods").resolve(".aydream-update");
                Files.createDirectories(updateDir);
                Path target = updateDir.resolve(ASSET_NAME);
                HttpRequest request = HttpRequest.newBuilder(URI.create(info.url()))
                    .header("User-Agent", "AydreamClient")
                    .GET()
                    .build();
                HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
                if (response.statusCode() != 200) throw new IllegalStateException("Download failed");
                try (InputStream input = response.body(); OutputStream output = Files.newOutputStream(target)) {
                    input.transferTo(output);
                }
                if (!info.digest().isBlank() && !info.digest().equalsIgnoreCase("sha256:" + sha256(target))) {
                    Files.deleteIfExists(target);
                    throw new IllegalStateException("Checksum mismatch");
                }
                callback.accept("Update downloaded");
            } catch (Exception error) {
                callback.accept("Update failed");
            }
        });
    }

    public static void markDownloaded(String version) {
        try {
            Path runDir = net.minecraft.client.MinecraftClient.getInstance().runDirectory.toPath();
            Files.writeString(runDir.resolve("mods").resolve(".aydream-update").resolve("version.txt"), version);
        } catch (Exception ignored) {}
    }

    public static void scheduleReplacement(Path runDir, String version) throws Exception {
        Path updateDir = runDir.resolve("mods").resolve(".aydream-update");
        Path source = updateDir.resolve(ASSET_NAME);
        Path target = FabricLoader.getInstance().getModContainer("aydream-client")
            .flatMap(container -> {
                if (container.getOrigin().getKind() != ModOrigin.Kind.PATH) return Optional.empty();
                return container.getOrigin().getPaths().stream().filter(path -> path.toString().endsWith(".jar")).findFirst();
            })
            .orElse(runDir.resolve("mods").resolve(ASSET_NAME));
        if (!Files.exists(source)) throw new IllegalStateException("Update not downloaded");
        Path script = updateDir.resolve("apply-update.bat");
        String sourcePath = source.toAbsolutePath().toString().replace("'", "''");
        String targetPath = target.toAbsolutePath().toString().replace("'", "''");
        String scriptPath = script.toAbsolutePath().toString().replace("'", "''");
        String targetPath = target.toAbsolutePath().toString().replace("'", "''");
        String scriptPath = script.toAbsolutePath().toString().replace("'", "''");
        String content = "@echo off\r\n"
            + "timeout /t 3 /nobreak >nul\r\n"
            + "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Copy-Item -LiteralPath '" + sourcePath + "' -Destination '" + targetPath + "' -Force\"\r\n"
            + "del /f /q \"" + scriptPath + "\"\r\n";
        Files.writeString(script, content);
        new ProcessBuilder("cmd", "/c", "start", "", "/b", script.toAbsolutePath().toString()).start();
    }

    private static String extractReleaseVersion(String body) {
        int index = body.indexOf("\"version=");
        if (index >= 0) {
            int start = index + 9;
            int end = body.indexOf("\"", start);
            if (end > start) return body.substring(start, end);
        }
        String tag = extractField(body, "tag_name");
        return tag.startsWith("v") ? tag.substring(1) : tag;
    }

    private static String extractAssetField(String body, String field) {
        int asset = body.indexOf(ASSET_NAME);
        if (asset < 0) return "";
        int objectStart = body.lastIndexOf("{", asset);
        if (objectStart < 0) objectStart = 0;
        return extractField(body.substring(objectStart), field);
    }

    private static String extractField(String body, String field) {
        String marker = "\"" + field + "\":\"";
        int index = body.indexOf(marker);
        if (index < 0) {
            marker = "\"" + field + "\": \"";
            index = body.indexOf(marker);
        }
        if (index < 0) return "";
        int start = index + marker.length();
        int end = body.indexOf("\"", start);
        return end > start ? body.substring(start, end) : "";
    }

    private static int compare(String left, String right) {
        try {
            String[] a = left.split("\\.");
            String[] b = right.split("\\.");
            for (int i = 0; i < Math.max(a.length, b.length); i++) {
                int av = i < a.length ? Integer.parseInt(a[i].replaceAll("[^0-9].*", "")) : 0;
                int bv = i < b.length ? Integer.parseInt(b[i].replaceAll("[^0-9].*", "")) : 0;
                if (av != bv) return Integer.compare(av, bv);
            }
        } catch (Exception ignored) {}
        return left.compareToIgnoreCase(right);
    }

    private static String sha256(Path path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = Files.newInputStream(path)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) > 0) digest.update(buffer, 0, read);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : digest.digest()) result.append(String.format("%02x", value));
        return result.toString();
    }
}
