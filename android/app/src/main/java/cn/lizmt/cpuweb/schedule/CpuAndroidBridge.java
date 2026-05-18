package cn.lizmt.cpuweb.schedule;

import android.app.Activity;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONObject;

final class CpuAndroidBridge {
    private final Activity activity;

    CpuAndroidBridge(Activity activity) {
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
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                activity.startActivity(intent);
            } catch (Exception ignored) {
                Toast.makeText(activity, "无法打开系统浏览器", Toast.LENGTH_SHORT).show();
            }
        });
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
}
