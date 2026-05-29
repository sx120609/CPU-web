package cn.lizmt.cpuweb.schedule;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ContentValues;
import android.app.DownloadManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.io.File;

final class CpuAndroidBridge {
    private final MainActivity activity;

    CpuAndroidBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public int getVersionCode() {
        return BuildConfig.VERSION_CODE;
    }

    @JavascriptInterface
    public String getVersionName() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public boolean supportsScheduleWidget() {
        return true;
    }

    @JavascriptInterface
    public boolean supportsInAppApkDownload() {
        return true;
    }

    @JavascriptInterface
    public boolean copyText(String text) {
        try {
            ClipboardManager manager = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
            if (manager == null) return false;
            manager.setPrimaryClip(ClipData.newPlainText("CPU Web", text == null ? "" : text));
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public void openExternalUrl(String url) {
        activity.runOnUiThread(() -> {
            try {
                Uri uri = Uri.parse(url == null ? "" : url.trim());
                if (looksLikeApkDownload(uri) && downloadAndInstallApk(uri.toString(), "")) {
                    return;
                }
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                activity.startActivity(intent);
            } catch (Exception ignored) {
                Toast.makeText(activity, "无法打开系统浏览器", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public boolean downloadAndInstallApk(String url, String fileName) {
        try {
            Uri uri = Uri.parse(url == null ? "" : url.trim());
            if (!isHttpUrl(uri)) {
                return false;
            }
            DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) return false;

            String safeName = sanitizeApkFileName(fileName == null ? "" : fileName);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("下载药大拾间更新");
            request.setDescription("下载完成后将尝试打开安装");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setMimeType("application/vnd.android.package-archive");
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeName);

            long downloadId = manager.enqueue(request);
            activity.runOnUiThread(() ->
                    Toast.makeText(activity, "已开始下载更新，请稍候", Toast.LENGTH_SHORT).show()
            );
            new Thread(() -> waitAndOpenDownloadedApk(manager, downloadId)).start();
            return true;
        } catch (Exception ignored) {
            activity.runOnUiThread(() ->
                    Toast.makeText(activity, "应用内下载失败，请使用浏览器更新", Toast.LENGTH_SHORT).show()
            );
            return false;
        }
    }

    @JavascriptInterface
    public boolean previewImages(String payload) {
        try {
            JSONObject json = new JSONObject(payload == null ? "{}" : payload);
            JSONArray images = json.optJSONArray("images");
            if (images == null || images.length() == 0) return false;
            int index = Math.max(0, Math.min(json.optInt("index", 0), images.length() - 1));
            JSONObject image = images.optJSONObject(index);
            String url = image == null ? "" : image.optString("url", "").trim();
            Uri uri = Uri.parse(url);
            if (!isHttpUrl(uri)) return false;
            activity.runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                    intent.addCategory(Intent.CATEGORY_BROWSABLE);
                    intent.setDataAndType(uri, "image/*");
                    activity.startActivity(intent);
                } catch (Exception ignored) {
                    Toast.makeText(activity, "无法打开系统图片查看器", Toast.LENGTH_SHORT).show();
                }
            });
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean saveImage(String dataUrl, String fileName) {
        try {
            if (!activity.ensureLegacyStoragePermission()) {
                activity.runOnUiThread(() ->
                        Toast.makeText(activity, "请先允许存储权限后再保存图片", Toast.LENGTH_SHORT).show()
                );
                return false;
            }
            String safeName = sanitizeFileName(fileName == null ? "" : fileName);
            String raw = dataUrl == null ? "" : dataUrl.trim();
            int comma = raw.indexOf(',');
            String payload = comma >= 0 ? raw.substring(comma + 1) : raw;
            byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) return false;

            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, safeName);
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/CPU-web");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
            }

            Uri uri = activity.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) return false;

            try (OutputStream output = activity.getContentResolver().openOutputStream(uri)) {
                if (output == null) return false;
                boolean ok = bitmap.compress(Bitmap.CompressFormat.PNG, 100, output);
                if (!ok) return false;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.Images.Media.IS_PENDING, 0);
                activity.getContentResolver().update(uri, done, null, null);
            }

            activity.runOnUiThread(() ->
                    Toast.makeText(activity, "图片已保存到相册", Toast.LENGTH_SHORT).show()
            );
            return true;
        } catch (Exception ignored) {
            activity.runOnUiThread(() ->
                    Toast.makeText(activity, "保存图片失败", Toast.LENGTH_SHORT).show()
            );
            return false;
        }
    }

    @JavascriptInterface
    public void installScheduleWidget(String payload) {
        activity.runOnUiThread(() -> installOnUiThread(payload));
    }

    private void installOnUiThread(String payload) {
        String endpoint = parseEndpoint(payload);
        if (endpoint.isEmpty()) {
            Toast.makeText(activity, "小组件配置无效，请重新添加", Toast.LENGTH_SHORT).show();
            return;
        }

        ScheduleWidgetPrefs.saveEndpoint(activity, endpoint);
        ScheduleWidgetProvider.updateAll(activity);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AppWidgetManager manager = activity.getSystemService(AppWidgetManager.class);
            ComponentName provider = new ComponentName(activity, ScheduleWidgetProvider.class);
            if (manager != null && manager.isRequestPinAppWidgetSupported()) {
                boolean requestSent = manager.requestPinAppWidget(provider, null, widgetPinnedCallback());
                if (requestSent) {
                    Toast.makeText(activity, "已请求系统添加小组件；如未弹出，请长按桌面手动添加", Toast.LENGTH_LONG).show();
                    return;
                }
            }
        }

        Toast.makeText(activity, "配置已保存，请长按桌面添加课表小组件", Toast.LENGTH_LONG).show();
    }

    private PendingIntent widgetPinnedCallback() {
        Intent intent = new Intent(activity, ScheduleWidgetProvider.class)
                .setAction(ScheduleWidgetProvider.ACTION_WIDGET_PINNED);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(activity, 1001, intent, flags);
    }

    private String parseEndpoint(String payload) {
        if (payload == null) return "";
        String raw = payload.trim();
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
        try {
            JSONObject json = new JSONObject(raw);
            return json.optString("endpoint", "").trim();
        } catch (Exception ignored) {
            return "";
        }
    }

    private String sanitizeFileName(String fileName) {
        String raw = fileName.trim();
        if (raw.isEmpty()) raw = "cpu-share";
        raw = raw.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (!raw.toLowerCase().endsWith(".png")) {
            raw += ".png";
        }
        return raw;
    }

    private String sanitizeApkFileName(String fileName) {
        String raw = fileName.trim();
        if (raw.isEmpty()) raw = "CPU-Web.apk";
        raw = raw.replaceAll("[\\\\/:*?\"<>|]", "_");
        if (!raw.toLowerCase().endsWith(".apk")) {
            raw += ".apk";
        }
        return raw;
    }

    private boolean isHttpUrl(Uri uri) {
        String scheme = uri.getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    private boolean looksLikeApkDownload(Uri uri) {
        if (!isHttpUrl(uri)) return false;
        String path = uri.getPath();
        if (path == null) return false;
        return path.endsWith(".apk") || path.contains("/downloads/");
    }

    private void waitAndOpenDownloadedApk(DownloadManager manager, long downloadId) {
        try {
            for (int i = 0; i < 120; i += 1) {
                DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
                try (Cursor cursor = manager.query(query)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            String localUri = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
                            if (localUri != null && !localUri.isEmpty()) {
                                openDownloadedApk(Uri.parse(localUri));
                            }
                            return;
                        }
                        if (status == DownloadManager.STATUS_FAILED) {
                            activity.runOnUiThread(() ->
                                    Toast.makeText(activity, "下载失败，请稍后重试", Toast.LENGTH_SHORT).show()
                            );
                            return;
                        }
                    }
                }
                Thread.sleep(1000);
            }
        } catch (Exception ignored) {
            activity.runOnUiThread(() ->
                    Toast.makeText(activity, "下载完成后请在系统下载列表中安装", Toast.LENGTH_SHORT).show()
            );
        }
    }

    private void openDownloadedApk(Uri localUri) {
        activity.runOnUiThread(() -> {
            try {
                Uri installUri = resolveInstallUri(localUri);
                if (installUri == null) throw new IllegalStateException("apk_uri_invalid");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settingsIntent.setData(Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(settingsIntent);
                    Toast.makeText(activity, "请先允许安装未知来源应用，然后重新点击更新", Toast.LENGTH_LONG).show();
                    return;
                }

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(installUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(installIntent);
            } catch (Exception ignored) {
                Toast.makeText(activity, "无法打开安装器，请到系统下载列表中手动安装", Toast.LENGTH_LONG).show();
            }
        });
    }

    private Uri resolveInstallUri(Uri localUri) {
        if ("content".equalsIgnoreCase(localUri.getScheme())) {
            return localUri;
        }
        if (!"file".equalsIgnoreCase(localUri.getScheme())) {
            return null;
        }
        File file = new File(localUri.getPath() == null ? "" : localUri.getPath());
        if (!file.exists()) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            return FileProvider.getUriForFile(
                    activity,
                    activity.getPackageName() + ".fileprovider",
                    file
            );
        }
        return Uri.fromFile(file);
    }
}
