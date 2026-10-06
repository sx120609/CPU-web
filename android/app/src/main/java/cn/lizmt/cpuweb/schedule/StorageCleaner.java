package cn.lizmt.cpuweb.schedule;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.HashSet;
import java.util.Set;

/**
 * 网页“存储与缓存”页用到的原生部分：WebView 的网络缓存和临时文件。
 * 网页自己能清的（Cache Storage、页面数据缓存）不在这里；登录状态、课表、
 * 小组件数据放在 app_webview、files 和 shared_prefs 里，这里从不触碰。
 */
final class StorageCleaner {
    static final String NETWORK = "network";
    static final String TEMP = "temp";

    /** Chromium 的 HTTP 缓存目录，新旧 WebView 各用一个名字；只能通过 WebView.clearCache 清理。 */
    private static final String[] WEBVIEW_CACHE_DIRECTORIES = {"WebView", "org.chromium.android_webview"};
    /** 更新安装包由 ApkUpdateController 自己管理，清掉会打断等待安装的更新。 */
    private static final String APK_UPDATE_DIRECTORY = "apk-updates";

    private StorageCleaner() {}

    static String usageJson(Context context) {
        File cacheDir = context.getCacheDir();
        File externalCacheDir = context.getExternalCacheDir();
        try {
            JSONArray categories = new JSONArray()
                    .put(new JSONObject().put("id", NETWORK).put("bytes", networkBytes(cacheDir)))
                    .put(new JSONObject().put("id", TEMP).put("bytes", tempBytes(cacheDir, externalCacheDir)));
            long total = sizeOf(context.getDataDir()) + sizeOf(externalCacheDir);
            return new JSONObject().put("categories", categories).put("totalBytes", total).toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    static Set<String> parseCategories(String json) {
        Set<String> categories = new HashSet<>();
        try {
            JSONArray values = new JSONArray(json == null ? "[]" : json);
            for (int index = 0; index < values.length(); index++) categories.add(values.optString(index));
        } catch (Exception ignored) {
            // 参数无法识别时什么都不清。
        }
        return categories;
    }

    static long networkBytes(File cacheDir) {
        long total = 0;
        for (String name : WEBVIEW_CACHE_DIRECTORIES) total += sizeOf(new File(cacheDir, name));
        return total;
    }

    static long tempBytes(File cacheDir, File externalCacheDir) {
        long total = sizeOf(externalCacheDir);
        for (File child : temporaryChildren(cacheDir)) total += sizeOf(child);
        return total;
    }

    static void clearTemp(File cacheDir, File externalCacheDir) {
        for (File child : temporaryChildren(cacheDir)) delete(child);
        File[] external = externalCacheDir == null ? null : externalCacheDir.listFiles();
        if (external != null) for (File child : external) delete(child);
    }

    private static File[] temporaryChildren(File cacheDir) {
        File[] children = cacheDir == null ? null : cacheDir.listFiles(file -> {
            if (APK_UPDATE_DIRECTORY.equals(file.getName())) return false;
            for (String name : WEBVIEW_CACHE_DIRECTORIES) if (name.equals(file.getName())) return false;
            return true;
        });
        return children == null ? new File[0] : children;
    }

    static long sizeOf(File file) {
        if (file == null || !file.exists()) return 0;
        if (file.isFile()) return file.length();
        long total = 0;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) total += sizeOf(child);
        return total;
    }

    private static void delete(File file) {
        File[] children = file.isDirectory() ? file.listFiles() : null;
        if (children != null) for (File child : children) delete(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
