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
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.File;

final class CpuAndroidBridge {
    private static final String TAG = "CpuAndroidBridge";
    private final MainActivity activity;
    private File pendingApk;
    private final java.util.concurrent.atomic.AtomicBoolean downloadingApk = new java.util.concurrent.atomic.AtomicBoolean();

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
    public boolean supportsStagedApkInstall() {
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
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                activity.startActivity(intent);
            } catch (Exception ignored) {
                Toast.makeText(activity, "无法打开系统浏览器", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @JavascriptInterface
    public boolean downloadAndInstallApk(String url, String fileName) {
        if (!downloadingApk.compareAndSet(false, true)) return true;
        try {
            Uri uri = Uri.parse(url == null ? "" : url.trim());
            if (!isHttpUrl(uri)) {
                downloadingApk.set(false);
                return false;
            }
            DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                downloadingApk.set(false);
                return false;
            }

            String safeName = sanitizeApkFileName(fileName == null ? "" : fileName);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("下载药大拾间更新");
            request.setDescription("下载完成后将尝试打开安装");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setMimeType("application/vnd.android.package-archive");
            String downloadName = System.currentTimeMillis() + "-" + safeName;
            request.setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, downloadName);

            long downloadId = manager.enqueue(request);
            activity.runOnUiThread(() ->
                    Toast.makeText(activity, "已开始下载更新，请稍候", Toast.LENGTH_SHORT).show()
            );
            new Thread(() -> waitAndOpenDownloadedApk(manager, downloadId, safeName)).start();
            return true;
        } catch (Exception ignored) {
            downloadingApk.set(false);
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

    private void waitAndOpenDownloadedApk(DownloadManager manager, long downloadId, String fileName) {
        try {
            for (int i = 0; i < 600; i += 1) {
                DownloadManager.Query query = new DownloadManager.Query().setFilterById(downloadId);
                try (Cursor cursor = manager.query(query)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            File apkFile = null;
                            try {
                                apkFile = stageDownloadedApk(manager, downloadId, fileName);
                                ApkUpdateValidator.validate(activity, apkFile);
                                openDownloadedApk(apkFile);
                            } catch (ApkUpdateValidator.ValidationException error) {
                                deleteQuietly(apkFile);
                                Log.w(TAG, "Downloaded APK validation failed", error);
                                showToast(error.getMessage());
                            } catch (Exception error) {
                                deleteQuietly(apkFile);
                                Log.w(TAG, "Downloaded APK staging failed", error);
                                showToast("更新包读取失败，请重新下载");
                            }
                            return;
                        }
                        if (status == DownloadManager.STATUS_FAILED) {
                            showToast("下载失败，请稍后重试");
                            return;
                        }
                    }
                }
                Thread.sleep(1000);
            }
            showToast("下载超时，请使用浏览器重新下载");
        } catch (Exception error) {
            Log.w(TAG, "Waiting for APK download failed", error);
            showToast("下载状态读取失败，请重新下载");
        } finally {
            downloadingApk.set(false);
            try {
                manager.remove(downloadId);
            } catch (Exception error) {
                Log.w(TAG, "Could not remove completed update download", error);
            }
        }
    }

    private File stageDownloadedApk(DownloadManager manager, long downloadId, String fileName) throws IOException {
        File directory = new File(activity.getCacheDir(), "apk-updates");
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("apk_cache_unavailable");
        }

        File partialFile = new File(directory, downloadId + "-" + fileName + ".part");
        File readyFile = new File(directory, downloadId + "-" + fileName);
        deleteOrThrow(partialFile);
        deleteOrThrow(readyFile);

        ParcelFileDescriptor descriptor = manager.openDownloadedFile(downloadId);
        if (descriptor == null) throw new IOException("download_descriptor_unavailable");

        try (
                InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
                FileOutputStream output = new FileOutputStream(partialFile)
        ) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            output.getFD().sync();
        } catch (Exception error) {
            deleteQuietly(partialFile);
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("apk_copy_failed", error);
        }

        if (!partialFile.renameTo(readyFile)) {
            deleteQuietly(partialFile);
            throw new IOException("apk_stage_failed");
        }
        return readyFile;
    }

    private void openDownloadedApk(File apkFile) {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
                    pendingApk = apkFile;
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settingsIntent.setData(Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(settingsIntent);
                    Toast.makeText(activity, "请允许安装应用，返回拾间后继续安装", Toast.LENGTH_LONG).show();
                    return;
                }

                activity.startActivity(ApkInstallIntent.create(activity, apkFile));
            } catch (Exception error) {
                Log.w(TAG, "Opening package installer failed", error);
                Toast.makeText(activity, "无法打开安装器，请使用更新窗口中的浏览器下载", Toast.LENGTH_LONG).show();
            }
        });
    }

    void resumePendingInstall() {
        if (pendingApk == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) return;
        File apkFile = pendingApk;
        pendingApk = null;
        openDownloadedApk(apkFile);
    }

    private void showToast(String message) {
        activity.runOnUiThread(() ->
                Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
        );
    }

    private void deleteOrThrow(File file) throws IOException {
        if (file.exists() && !file.delete()) {
            throw new IOException("stale_apk_unavailable");
        }
    }

    private void deleteQuietly(File file) {
        if (file != null && file.exists() && !file.delete()) {
            Log.w(TAG, "Could not delete staged APK: " + file.getAbsolutePath());
        }
    }
}
