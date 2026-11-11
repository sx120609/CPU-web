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
    /**
     * The timetable style the widget follows (iOS ScheduleWidgetStyle): classic,
     * grid and minimal draw as before; table, paper and board have their own
     * paper colour, ink, typeface and decoration.
     */
    final String style;
    /** 小组件背景: a photo under a veil of the widget's own colour; null for none. */
    android.graphics.Bitmap photo;
    float veil = 0.55f;

    ScheduleWidgetPalette(String theme, boolean dark) {
        this(theme, dark, "classic");
    }

    ScheduleWidgetPalette(String theme, boolean dark, String style) {
        this.theme = normalizeTheme(theme);
        this.dark = dark;
        this.style = normalizeStyle(style);
    }

    /** The palette the widgets draw with now: theme, style and background photo from the settings. */
    static ScheduleWidgetPalette of(android.content.Context context, String theme, boolean dark) {
        ScheduleWidgetPalette palette = new ScheduleWidgetPalette(theme, dark, ScheduleWidgetPrefs.style(context));
        palette.photo = WidgetPhoto.load(context);
        palette.veil = ScheduleWidgetPrefs.veil(context);
        return palette;
    }

    static String normalizeStyle(String value) {
        if ("table".equals(value) || "paper".equals(value) || "board".equals(value)) return value;
        return "classic";
    }

    /** A style with a look of its own, drawn over the whole widget. */
    boolean styled() {
        return !"classic".equals(style);
    }

    boolean paper() { return "paper".equals(style); }

    boolean board() { return "board".equals(style); }

    boolean table() { return "table".equals(style); }

    /** Every letter in this face (paper's serif); null keeps the system face. */
    android.graphics.Typeface face() {
        return paper() ? android.graphics.Typeface.SERIF : null;
    }

    /** Times and dates in this face (the board's monospaced figures); null keeps the text face. */
    android.graphics.Typeface figures() {
        return board() ? android.graphics.Typeface.MONOSPACE : null;
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
        if (paper()) return dark ? Color.rgb(0x20, 0x1E, 0x1B) : Color.rgb(0xF1, 0xEC, 0xE2);
        if (board()) return dark ? Color.rgb(0x17, 0x1A, 0x1C) : Color.rgb(0xF4, 0xF5, 0xF4);
        return dark ? Color.rgb(14, 20, 32) : Color.rgb(248, 251, 255);
    }

    /** SwiftUI 的 Color.primary / .secondary（系统 label 色）；素笺、站牌用自己的墨色。 */
    int primary() {
        if (paper()) return dark ? Color.rgb(0xED, 0xE6, 0xD8) : Color.rgb(0x2A, 0x25, 0x1F);
        if (board()) return dark ? Color.rgb(0xFF, 0xE4, 0xA3) : Color.rgb(0x17, 0x1A, 0x1C);
        return dark ? Color.WHITE : Color.BLACK;
    }

    /** The decoration of a styled widget: table rules, paper's margin and lines, the board's heavy rule. */
    int rule() {
        if (paper()) return dark ? Color.argb(40, 0xF3, 0x9B, 0x85) : Color.argb(46, 0xA6, 0x3F, 0x29);
        return withAlpha(primary(), board() ? 0.85f : 0.16f);
    }

    int secondary() {
        if (paper() || board()) return withAlpha(primary(), 0.62f);
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
