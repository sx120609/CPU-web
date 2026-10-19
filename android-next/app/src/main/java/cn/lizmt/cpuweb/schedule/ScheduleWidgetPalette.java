package cn.lizmt.cpuweb.schedule;

import android.graphics.Color;

/**
 * 小组件配色，照 iOS ScheduleWidgets.swift 的 WidgetPalette：九套主题、浅色/深色两套底色和文字色，
 * 课程颜色按课名哈希取，同一门课在两个平台上颜色一样。
 */
final class ScheduleWidgetPalette {
    static final String DEFAULT_THEME = "color-glass";
    static final String[] THEMES = {
            "green", "blue", "teal", "indigo", "violet", "orange", "rose", "slate", DEFAULT_THEME,
    };

    private static final int[] COLOR_GLASS_ACCENTS = {
            Color.rgb(232, 91, 75),
            Color.rgb(74, 120, 242),
            Color.rgb(139, 92, 246),
            Color.rgb(23, 166, 154),
            Color.rgb(224, 162, 36),
            Color.rgb(236, 112, 161),
    };
    private static final int[] COLOR_GLASS_TINTS = {
            Color.rgb(253, 236, 233),
            Color.rgb(234, 240, 255),
            Color.rgb(242, 236, 255),
            Color.rgb(229, 248, 245),
            Color.rgb(255, 247, 224),
            Color.rgb(253, 235, 244),
    };

    final String theme;
    final boolean dark;

    ScheduleWidgetPalette(String theme, boolean dark) {
        this.theme = normalizeTheme(theme);
        this.dark = dark;
    }

    /** 网页端的主题名，老名字和 web/src/components/jwxt/scheduleTheme.ts 的 normalizeScheduleTheme 一样归并。 */
    static String normalizeTheme(String value) {
        String next = value == null ? "" : value.trim();
        switch (next) {
            case "simple":
            case "lime":
                return "green";
            case "colorful":
                return DEFAULT_THEME;
            case "cyan":
                return "teal";
            case "sky":
                return "blue";
            case "purple":
                return "violet";
            case "amber":
                return "orange";
            case "pink":
            case "red":
                return "rose";
            default:
                for (String theme : THEMES) {
                    if (theme.equals(next)) return theme;
                }
                return DEFAULT_THEME;
        }
    }

    int background() {
        return dark ? Color.rgb(14, 20, 32) : Color.rgb(248, 251, 255);
    }

    /** SwiftUI 的 Color.primary / .secondary（系统 label 色）。 */
    int primary() {
        return dark ? Color.WHITE : Color.BLACK;
    }

    int secondary() {
        return dark ? Color.argb(153, 235, 235, 245) : Color.argb(153, 60, 60, 67);
    }

    /** secondary 再乘 0.72。 */
    int muted() {
        return withAlpha(secondary(), 0.72f);
    }

    /** 日期栏里的竖线：muted 再乘 0.45。 */
    int columnDivider() {
        return withAlpha(muted(), 0.45f);
    }

    /** SwiftUI Divider（系统 separator 色）。 */
    int separator() {
        return dark ? Color.argb(153, 84, 84, 88) : Color.argb(74, 60, 60, 67);
    }

    /** SwiftUI 的 Color.pink：周末、法定假日。 */
    int pink() {
        return dark ? Color.rgb(255, 55, 95) : Color.rgb(255, 45, 85);
    }

    int accent() {
        switch (theme) {
            case "green": return Color.rgb(22, 135, 118);
            case "blue": return Color.rgb(37, 99, 235);
            case "teal": return Color.rgb(8, 145, 178);
            case "indigo": return Color.rgb(219, 39, 119);
            case "violet": return Color.rgb(124, 58, 237);
            case "orange": return Color.rgb(234, 88, 12);
            case "rose": return Color.rgb(225, 29, 72);
            case "slate": return Color.rgb(71, 85, 105);
            default: return Color.rgb(15, 143, 127);
        }
    }

    int accent(String courseName) {
        return DEFAULT_THEME.equals(theme) ? COLOR_GLASS_ACCENTS[colorIndex(courseName)] : accent();
    }

    /** 课程色块底色。深色模式是课程色 18% 叠在底色上，浅色模式每套主题一个浅底。 */
    int tint(String courseName) {
        if (dark) return withAlpha(accent(courseName), 0.18f);
        switch (theme) {
            case "green": return Color.rgb(244, 251, 248);
            case "blue": return Color.rgb(243, 248, 255);
            case "teal": return Color.rgb(240, 251, 255);
            case "indigo": return Color.rgb(255, 245, 250);
            case "violet": return Color.rgb(250, 247, 255);
            case "orange": return Color.rgb(255, 247, 241);
            case "rose": return Color.rgb(255, 245, 247);
            case "slate": return Color.rgb(248, 250, 252);
            default: return COLOR_GLASS_TINTS[colorIndex(courseName)];
        }
    }

    /** 课名（去掉首尾空白，空的算「课程」）按 Unicode 码点做 31 进制哈希，和 iOS 的 index(for:) 一致。 */
    static int colorIndex(String courseName) {
        String name = displayName(courseName);
        long hash = 0;
        for (int offset = 0; offset < name.length(); ) {
            int codePoint = name.codePointAt(offset);
            hash = (hash * 31 + codePoint) & 0x7fffffffL;
            offset += Character.charCount(codePoint);
        }
        return (int) (hash % COLOR_GLASS_ACCENTS.length);
    }

    static String displayName(String courseName) {
        String name = courseName == null ? "" : courseName.trim();
        return name.isEmpty() ? "课程" : name;
    }

    static int withAlpha(int color, float factor) {
        int alpha = Math.round(Color.alpha(color) * factor);
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }
}
