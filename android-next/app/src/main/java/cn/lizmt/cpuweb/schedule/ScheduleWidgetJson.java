package cn.lizmt.cpuweb.schedule;

import org.json.JSONObject;

/** 读小组件记录里的文本字段。 */
final class ScheduleWidgetJson {
    private ScheduleWidgetJson() {}

    /**
     * 同 {@link JSONObject#optString(String, String)}，但 JSON null 当作没有：Android 的
     * optString 会把 null 转成字符串 "null"，小组件上就会显示「null · 老师」。
     */
    static String text(JSONObject object, String key, String fallback) {
        if (object == null || object.isNull(key)) return fallback;
        return object.optString(key, fallback);
    }
}
