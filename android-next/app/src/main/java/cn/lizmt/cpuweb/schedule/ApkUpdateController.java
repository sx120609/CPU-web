package cn.lizmt.cpuweb.schedule;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.util.concurrent.atomic.AtomicBoolean;

final class ApkUpdateController {
    private static final String TAG = "CpuApkUpdate";
    private static ApkUpdateController instance;
    private final Context context;
    private final SharedPreferences prefs;
    private final DownloadManager manager;
    private final AtomicBoolean watching = new AtomicBoolean();
    private final AtomicBoolean installing = new AtomicBoolean();
    private volatile boolean foreground;
    private WeakReference<Activity> activity = new WeakReference<>(null);

    static synchronized ApkUpdateController get(Context context) {
        if (instance == null) instance = new ApkUpdateController(context);
        return instance;
    }

    ApkUpdateController(Context context) {
        this.context = context.getApplicationContext();
        prefs = this.context.getSharedPreferences("cpu-apk-update-v1", Context.MODE_PRIVATE);
        manager = (DownloadManager) this.context.getSystemService(Context.DOWNLOAD_SERVICE);
        clearInstalledUpdate();
    }

    void attach(Activity current) {
        activity = new WeakReference<>(current);
        foreground = true;
        clearInstalledUpdate();
        if ("installing".equals(phase())) setPhase("ready", "安装尚未完成，可继续安装");
        if ("permission".equals(phase()) && canInstall()) requestInstall(current);
        watchDownload();
    }

    void detach(Activity current) {
        if (activity.get() != current) return;
        foreground = false;
        activity.clear();
    }

    synchronized boolean start(String url, String fileName) {
        if (manager == null) return false;
        Uri uri = Uri.parse(url == null ? "" : url.trim());
        if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) return false;
        if (isActiveDownload() || readyFile() != null) {
            watchDownload();
            return true;
        }
        try {
            long staleId = prefs.getLong("downloadId", -1);
            if (staleId >= 0) manager.remove(staleId);
            cleanupCache();
            String name = sanitizeName(fileName);
            DownloadManager.Request request = new DownloadManager.Request(uri);
            request.setTitle("药大拾间客户端更新");
            request.setDescription("下载完成后可返回拾间继续安装");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, System.currentTimeMillis() + "-" + name);
            long id = manager.enqueue(request);
            boolean saved = prefs.edit().clear().putLong("downloadId", id).putString("url", uri.toString())
                    .putString("fileName", name).putString("phase", "downloading").putString("message", "正在下载更新")
                    .putLong("updatedAt", System.currentTimeMillis()).commit();
            if (!saved) {
                manager.remove(id);
                return false;
            }
            watchDownload();
            return true;
        } catch (Exception error) {
            fail("download_start", "无法开始下载，请使用浏览器下载", error);
            return false;
        }
    }

    boolean retry() {
        if (!"failed".equals(phase())) return false;
        return start(prefs.getString("url", ""), prefs.getString("fileName", "CPU-Web.apk"));
    }

    String stateJson() {
        try {
            long downloaded = prefs.getLong("downloadedBytes", 0);
            long total = prefs.getLong("totalBytes", 0);
            boolean validatingInstaller = installing.get() && "ready".equals(phase());
            return new JSONObject().put("phase", validatingInstaller ? "validating" : phase())
                    .put("message", validatingInstaller ? "正在校验安装包" : prefs.getString("message", ""))
                    .put("fileName", prefs.getString("fileName", "")).put("downloadId", prefs.getLong("downloadId", -1))
                    .put("downloadedBytes", downloaded).put("totalBytes", total)
                    .put("progress", total > 0 ? Math.min(100, Math.max(0, downloaded * 100 / total)) : 0)
                    .put("errorCode", prefs.getString("errorCode", "")).toString();
        } catch (Exception ignored) {
            return "{\"phase\":\"idle\"}";
        }
    }

    boolean requestInstall(Activity current) {
        File file = readyFile();
        if (file == null || !installing.compareAndSet(false, true)) return false;
        new Thread(() -> {
            try {
                ApkUpdateValidator.validate(context, file);
                current.runOnUiThread(() -> {
                    try {
                        if (current.isFinishing() || current.isDestroyed()) return;
                        if (!canInstall()) {
                            setPhase("permission", "请允许安装应用，返回拾间后继续安装");
                            current.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + context.getPackageName())));
                        } else {
                            setPhase("installing", "请在系统安装器中完成安装");
                            current.startActivity(ApkInstallIntent.create(current, file));
                        }
                    } catch (Exception error) {
                        setPhase("ready", "安装器未能打开，可重试或使用浏览器下载");
                        Log.w(TAG, "Installer launch failed", error);
                    } finally {
                        installing.set(false);
                    }
                });
            } catch (Exception error) {
                installing.set(false);
                fail("validation", error.getMessage() == null ? "更新包校验失败，请重新下载" : error.getMessage(), error);
            }
        }, "cpu-apk-install").start();
        return true;
    }

    private void watchDownload() {
        if (!foreground || !isActiveDownload() || !watching.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                while (foreground && isActiveDownload()) {
                    long id = prefs.getLong("downloadId", -1);
                    try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
                        if (cursor == null || !cursor.moveToFirst()) {
                            fail("download_missing", "下载任务已失效，请点击重试", null);
                            break;
                        }
                        int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        if (status == DownloadManager.STATUS_SUCCESSFUL) {
                            stage(id);
                            break;
                        }
                        if (status == DownloadManager.STATUS_FAILED) {
                            int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                            fail("download_" + reason, reason == DownloadManager.ERROR_INSUFFICIENT_SPACE
                                    ? "存储空间不足，清理后可重试" : "下载失败，可点击重试或使用浏览器下载", null);
                            break;
                        }
                        long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        boolean paused = status == DownloadManager.STATUS_PAUSED;
                        prefs.edit().putString("phase", paused ? "paused" : "downloading")
                                .putString("message", paused ? "等待网络恢复，下载任务已保留" : "正在下载更新")
                                .putLong("downloadedBytes", Math.max(0, downloaded)).putLong("totalBytes", Math.max(0, total)).apply();
                    }
                    Thread.sleep(1500);
                }
            } catch (Exception error) {
                fail("download_read", "读取下载状态失败，可点击重试", error);
            } finally {
                watching.set(false);
                if (foreground && isActiveDownload()) watchDownload();
            }
        }, "cpu-apk-download").start();
    }

    private void stage(long id) throws Exception {
        setPhase("validating", "正在校验安装包");
        File directory = new File(context.getCacheDir(), "apk-updates");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new java.io.IOException("无法创建安装缓存");
        File ready = new File(directory, id + "-" + sanitizeName(prefs.getString("fileName", "CPU-Web.apk")));
        File partial = new File(directory, ready.getName() + ".part");
        try {
            ParcelFileDescriptor descriptor = manager.openDownloadedFile(id);
            if (descriptor == null) throw new java.io.IOException("无法读取下载文件");
            try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor);
                 FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[32768];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.getFD().sync();
            }
            if (ready.exists() && !ready.delete()) throw new java.io.IOException("无法替换安装缓存");
            if (!partial.renameTo(ready)) throw new java.io.IOException("无法保存安装缓存");
            ApkUpdateValidator.validate(context, ready);
            PackageInfo archive = context.getPackageManager().getPackageArchiveInfo(ready.getPath(), 0);
            if (archive == null) throw new java.io.IOException("无法读取安装包版本");
            long target = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
            if (!prefs.edit().putString("path", ready.getCanonicalPath()).putLong("targetVersion", target)
                    .putLong("downloadId", -1).putString("phase", "ready").putString("message", "下载完成，可继续安装")
                    .putString("errorCode", "").commit()) throw new java.io.IOException("无法保存安装状态");
            try { manager.remove(id); } catch (Exception error) { Log.w(TAG, "Download cleanup failed", error); }
            Activity current = activity.get();
            if (foreground && current != null) current.runOnUiThread(() -> {
                if (current.hasWindowFocus()) requestInstall(current);
            });
        } catch (Exception error) {
            partial.delete();
            ready.delete();
            throw error;
        }
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || context.getPackageManager().canRequestPackageInstalls();
    }

    private String phase() { return prefs.getString("phase", "idle"); }

    private boolean isActiveDownload() {
        String state = phase();
        return manager != null && prefs.getLong("downloadId", -1) >= 0
                && ("downloading".equals(state) || "paused".equals(state) || "validating".equals(state));
    }

    private File readyFile() {
        if (!("ready".equals(phase()) || "permission".equals(phase()) || "installing".equals(phase()))) return null;
        try {
            File file = new File(prefs.getString("path", ""));
            File directory = new File(context.getCacheDir(), "apk-updates").getCanonicalFile();
            if (file.isFile() && directory.equals(file.getCanonicalFile().getParentFile())) return file;
        } catch (Exception ignored) { }
        fail("staged_missing", "安装缓存已失效，请重新下载", null);
        return null;
    }

    private void clearInstalledUpdate() {
        long target = prefs.getLong("targetVersion", 0);
        if (target <= 0 || target > BuildConfig.VERSION_CODE) return;
        File file = readyFile();
        if (file != null) file.delete();
        prefs.edit().clear().commit();
    }

    private void cleanupCache() {
        File[] files = new File(context.getCacheDir(), "apk-updates").listFiles();
        if (files == null) return;
        String active = prefs.getString("path", "");
        long oldest = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000;
        for (File file : files) {
            if (file.isFile() && !file.getAbsolutePath().equals(active) && file.lastModified() < oldest) file.delete();
        }
    }

    private void setPhase(String state, String message) {
        prefs.edit().putString("phase", state).putString("message", message).putLong("updatedAt", System.currentTimeMillis()).commit();
    }

    private void fail(String code, String message, Exception error) {
        if (error != null) Log.w(TAG, code, error);
        prefs.edit().putString("phase", "failed").putString("errorCode", code).putString("message", message).commit();
        Activity current = activity.get();
        if (foreground && current != null) current.runOnUiThread(() -> Toast.makeText(current, message, Toast.LENGTH_LONG).show());
    }

    private String sanitizeName(String value) {
        String name = value == null ? "CPU-Web.apk" : value.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        return name.toLowerCase(java.util.Locale.ROOT).endsWith(".apk") ? name : "CPU-Web.apk";
    }
}
