package cn.lizmt.cpuweb.schedule;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
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
    public boolean supportsScheduleWidget() {
        return true;
    }

    @JavascriptInterface
    public void openExternalUrl(String url) {
        activity.runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
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
                manager.requestPinAppWidget(provider, null, null);
                Toast.makeText(activity, "请选择添加课表小组件", Toast.LENGTH_SHORT).show();
                return;
            }
        }

        Toast.makeText(activity, "配置已保存，请长按桌面添加课表小组件", Toast.LENGTH_LONG).show();
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
