package cn.lizmt.cpuweb.schedule;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

// 农历日期、传统节日与法定节假日，照 iOS ios_next/CpuTime/CpuTime/ChineseCalendar.swift 移植，
// 文案、节日表、清明算法、徽标优先级都保持一致（见 docs/schedule-widget-rules.md 第 8 节）。
// 农历换算用系统自带的 android.icu.util.ChineseCalendar，节日与放假区间在此之上推导。
final class ChineseCalendarInfo {
    static final String ZONE_ID = "Asia/Shanghai";
    /** 七个法定节日的名字，服务端说明里认的就是这几个。 */
    static final String[] STATUTORY_HOLIDAY_NAMES = {"元旦", "春节", "清明节", "劳动节", "端午节", "中秋节", "国庆节"};
    /** 休息状态副文案只看这么多天内的假期（见规则第 3 节）。 */
    static final int REST_COUNTDOWN_DAYS = 120;
    static final String REST_TEXT = "今日无课";

    private static final Map<String, String> HOLIDAY_GREETINGS = new HashMap<>();
    // 农历节日：{月, 日, 名称}。闰月不算节日。
    private static final Object[][] LUNAR_FESTIVALS = {
            {1, 1, "春节"}, {1, 15, "元宵节"}, {2, 2, "龙抬头"},
            {5, 5, "端午节"}, {7, 7, "七夕"}, {7, 15, "中元节"},
            {8, 15, "中秋节"}, {9, 9, "重阳节"},
            {12, 8, "腊八节"}, {12, 23, "小年"},
    };
    // 公历节日：{月, 日, 名称}。
    private static final Object[][] SOLAR_FESTIVALS = {
            {1, 1, "元旦"}, {3, 8, "妇女节"}, {3, 12, "植树节"},
            {5, 1, "劳动节"}, {5, 4, "青年节"}, {6, 1, "儿童节"},
            {7, 1, "建党节"}, {8, 1, "建军节"}, {9, 10, "教师节"},
            {10, 1, "国庆节"}, {12, 25, "圣诞节"},
    };

    static {
        // 逐个写出来而不是机械地去掉「节」字：「劳动快乐」不成话；清明、端午道安康。
        HOLIDAY_GREETINGS.put("元旦", "元旦快乐");
        HOLIDAY_GREETINGS.put("春节", "春节快乐");
        HOLIDAY_GREETINGS.put("清明节", "清明安康");
        HOLIDAY_GREETINGS.put("劳动节", "劳动节快乐");
        HOLIDAY_GREETINGS.put("端午节", "端午安康");
        HOLIDAY_GREETINGS.put("中秋节", "中秋快乐");
        HOLIDAY_GREETINGS.put("国庆节", "国庆快乐");
    }

    private static final Object LOCK = new Object();
    private static final Map<Integer, YearData> CACHE = new HashMap<>();
    private static List<PublishedHoliday> published = new ArrayList<>();

    private ChineseCalendarInfo() {
    }

    // MARK: 数据类型

    /** 一天的农历日期。 */
    static final class LunarDate {
        private static final String[] MONTH_NAMES = {"正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"};
        private static final String[] DAY_PREFIXES = {"初", "十", "廿", "卅"};
        private static final String[] DAY_DIGITS = {"十", "一", "二", "三", "四", "五", "六", "七", "八", "九"};

        final int month;
        final int day;
        final boolean isLeapMonth;
        final int cyclicalYear;

        LunarDate(int month, int day, boolean isLeapMonth, int cyclicalYear) {
            this.month = month;
            this.day = day;
            this.isLeapMonth = isLeapMonth;
            this.cyclicalYear = cyclicalYear;
        }

        /** 「正月」「闰四月」「腊月」。 */
        String monthLabel() {
            int index = Math.min(Math.max(month, 1), 12) - 1;
            return (isLeapMonth ? "闰" : "") + MONTH_NAMES[index] + "月";
        }

        /** 「初一」「十五」「廿三」「三十」。 */
        String dayLabel() {
            int value = Math.min(Math.max(day, 1), 30);
            if (value == 10) return "初十";
            if (value == 20) return "二十";
            if (value == 30) return "三十";
            return DAY_PREFIXES[Math.min((value - 1) / 10, 3)] + DAY_DIGITS[value % 10];
        }

        /** 初一显示月名，其余显示日名。 */
        String shortLabel() {
            return day == 1 ? monthLabel() : dayLabel();
        }

        String fullLabel() {
            return monthLabel() + dayLabel();
        }
    }

    /** 服务端下发的一天法定放假（调休表里 kind == "off" 的日子，已规整成法定节日名）。 */
    static final class PublishedHoliday {
        final String date;
        final String name;

        PublishedHoliday(String date, String name) {
            this.date = date;
            this.name = name;
        }

        /**
         * 从调休表的放假行里挑出法定假日：说明里提到哪个法定节日就算哪个，
         * 「国庆节、中秋节」取先出现的「国庆节」。学校自己的停课（校运会之类）不算。
         * 每项是 {date, note}。
         */
        static List<PublishedHoliday> fromOffDays(List<String[]> days) {
            List<PublishedHoliday> result = new ArrayList<>();
            for (String[] day : days) {
                if (day == null || day.length < 2 || day[0] == null) continue;
                String note = day[1] == null ? "" : day[1];
                String best = null;
                int bestIndex = Integer.MAX_VALUE;
                for (String name : STATUTORY_HOLIDAY_NAMES) {
                    int index = note.indexOf(name);
                    if (index >= 0 && index < bestIndex) {
                        best = name;
                        bestIndex = index;
                    }
                }
                if (best != null) result.add(new PublishedHoliday(day[0], best));
            }
            Collections.sort(result, (a, b) -> a.date.compareTo(b.date));
            return result;
        }

        @Override
        public boolean equals(Object other) {
            if (!(other instanceof PublishedHoliday)) return false;
            PublishedHoliday that = (PublishedHoliday) other;
            return date.equals(that.date) && name.equals(that.name);
        }

        @Override
        public int hashCode() {
            return date.hashCode() * 31 + name.hashCode();
        }
    }

    /** 一段放假区间。 */
    static final class HolidayWindow {
        final String name;
        final String start;
        final String end;

        HolidayWindow(String name, String start, String end) {
            this.name = name;
            this.start = start;
            this.end = end;
        }

        boolean contains(String date) {
            return date.compareTo(start) >= 0 && date.compareTo(end) <= 0;
        }

        /** 这段假期一共放几天（含首尾）。 */
        int dayCount() {
            Integer gap = dayGap(start, end);
            return gap == null ? 1 : Math.max(1, gap + 1);
        }
    }

    /** 「还有几天放假」的文案。 */
    static final class HolidayCountdown {
        final HolidayWindow window;
        /** 距离假期第一天还有几天；0 表示今天就在假期里。 */
        final int daysAway;

        HolidayCountdown(HolidayWindow window, int daysAway) {
            this.window = window;
            this.daysAway = daysAway;
        }

        /** 「距中秋节还有」「今天是中秋节」。 */
        String leading() {
            return daysAway == 0 ? "今天是" + window.name : "距" + window.name + "还有";
        }

        String amount() {
            return daysAway > 0 ? String.valueOf(daysAway) : null;
        }

        String trailing() {
            return amount() == null ? "" : "天";
        }

        String phrase() {
            String amount = amount();
            if (amount == null) return leading();
            return leading() + " " + amount + " " + trailing();
        }

        /** 「9.25 周五」，连休则是「10.1 - 10.7 · 休 7 天」。 */
        String dateLabel() {
            String start = monthDayLabel(window.start);
            if (window.end.equals(window.start)) {
                String weekday = weekdayLabel(window.start);
                return weekday == null ? start : start + " " + weekday;
            }
            return start + " - " + monthDayLabel(window.end) + " · 休 " + window.dayCount() + " 天";
        }
    }

    /** 一天的农历 / 节日信息。 */
    static final class CalendarDay {
        final String date;
        final LunarDate lunar;
        /** 当天的节日，按优先级排列（农历节日在前）。 */
        final List<String> festivals;
        /** 目前只计算清明。 */
        final String solarTerm;
        /** 当天属于哪个法定假期；null 表示不放假。 */
        final String holiday;

        CalendarDay(String date, LunarDate lunar, List<String> festivals, String solarTerm, String holiday) {
            this.date = date;
            this.lunar = lunar;
            this.festivals = festivals;
            this.solarTerm = solarTerm;
            this.holiday = holiday;
        }

        boolean isStatutoryHoliday() {
            return holiday != null;
        }

        /** 法定假日 > 节日 > 节气 > 农历日期。 */
        String displayLabel() {
            String badge = badge();
            return badge != null ? badge : lunar.shortLabel();
        }

        /** 只有节日/假期时才有值，用来决定要不要显示提示徽标。 */
        String badge() {
            if (holiday != null) return holiday;
            if (!festivals.isEmpty()) return festivals.get(0);
            return solarTerm;
        }
    }

    // MARK: 查询

    static CalendarDay info(String date) {
        Integer year = gregorianYear(date);
        if (year == null) return null;
        return year(year).days.get(date);
    }

    /** 换上服务端下发的放假安排。和上次一样时什么都不做，不一样就丢掉缓存重算。 */
    static void usePublishedHolidays(List<PublishedHoliday> days) {
        List<PublishedHoliday> sorted = new ArrayList<>(days == null ? Collections.emptyList() : days);
        Collections.sort(sorted, (a, b) -> a.date.compareTo(b.date));
        synchronized (LOCK) {
            if (sorted.equals(published)) return;
            published = sorted;
            CACHE.clear();
        }
    }

    static List<HolidayWindow> holidays(int year) {
        return year(year).holidays;
    }

    /** 今天不上课时那句问候：法定假日说「中秋快乐」，其余返回 null，调用方改说「今日无课」。 */
    static String restGreeting(String date) {
        CalendarDay day = info(date);
        if (day == null || day.holiday == null) return null;
        String greeting = HOLIDAY_GREETINGS.get(day.holiday);
        return greeting != null ? greeting : day.holiday + "快乐";
    }

    /** 休息状态主文案。 */
    static String restMessage(String today) {
        String greeting = restGreeting(today);
        return greeting != null ? greeting : REST_TEXT;
    }

    /**
     * 休息状态副文案：还没放假就倒数，已经在假期里就改说这一段连休几天（再说一遍
     * 「今天是中秋节」跟上面那句祝福重复了）；只休一天的不写。
     */
    static String restFootnote(String today) {
        HolidayCountdown countdown = countdown(today, REST_COUNTDOWN_DAYS);
        if (countdown == null) return null;
        if (countdown.daysAway <= 0) {
            return countdown.window.dayCount() > 1 ? "假期 " + countdown.dateLabel() : null;
        }
        return countdown.phrase() + " · " + countdown.dateLabel();
    }

    static HolidayCountdown countdown(String today, int limit) {
        Integer year = gregorianYear(today);
        if (year == null) return null;
        // 跨年的连休（元旦从 12.30 放起）两年里各有一份，去掉重复的。
        Set<String> seen = new HashSet<>();
        List<HolidayWindow> windows = new ArrayList<>();
        List<HolidayWindow> candidates = new ArrayList<>(year(year).holidays);
        candidates.addAll(year(year + 1).holidays);
        for (HolidayWindow window : candidates) {
            if (seen.add(window.start)) windows.add(window);
        }
        for (HolidayWindow window : windows) {
            if (window.end.compareTo(today) < 0) continue;
            String start = window.start.compareTo(today) > 0 ? window.start : today;
            Integer days = dayGap(today, start);
            if (days == null || days > limit) return null;
            return new HolidayCountdown(window, days);
        }
        return null;
    }

    // MARK: 日期工具

    /** 「9.25」。 */
    static String monthDayLabel(String date) {
        int[] parts = parse(date);
        return parts == null ? date : parts[1] + "." + parts[2];
    }

    /** 「周五」。 */
    static String weekdayLabel(String date) {
        Calendar calendar = noon(date);
        if (calendar == null) return null;
        String[] labels = {"周日", "周一", "周二", "周三", "周四", "周五", "周六"};
        return labels[calendar.get(Calendar.DAY_OF_WEEK) - 1];
    }

    static Integer dayGap(String start, String end) {
        Calendar from = noon(start);
        Calendar to = noon(end);
        if (from == null || to == null) return null;
        // 两个都是当地中午，差值除以一天四舍五入，夏令时（历史上有过）也不会差一天。
        return (int) Math.round((to.getTimeInMillis() - from.getTimeInMillis()) / 86_400_000d);
    }

    static String dateString(Calendar calendar) {
        return String.format(Locale.US, "%04d-%02d-%02d",
                calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH));
    }

    static String addDays(String date, int days) {
        Calendar calendar = noon(date);
        if (calendar == null) return null;
        calendar.add(Calendar.DAY_OF_MONTH, days);
        return dateString(calendar);
    }

    // MARK: 内部实现

    private static int[] parse(String value) {
        if (value == null) return null;
        String[] pieces = value.split("-");
        if (pieces.length != 3) return null;
        try {
            return new int[]{Integer.parseInt(pieces[0]), Integer.parseInt(pieces[1]), Integer.parseInt(pieces[2])};
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static Calendar noon(String date) {
        int[] parts = parse(date);
        if (parts == null) return null;
        Calendar calendar = new GregorianCalendar(TimeZone.getTimeZone(ZONE_ID), Locale.US);
        calendar.clear();
        calendar.set(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
        return calendar;
    }

    private static Integer gregorianYear(String date) {
        if (date == null || date.length() < 4) return null;
        try {
            return Integer.parseInt(date.substring(0, 4));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    // ICU 的中国农历在朔落在北京时间午夜前后的几个月把初一算错一天，和国家授时中心、iOS 都对不上：
    // 2027 年春节晚一天、2030 年春节早一天。每行是一段日子的正确农历：从第一列那天起、到第二列那天，
    // 是第三列的月份，第一天是第四列的日子，逐日往后数。2000–2100 年逐日和 iOS 比对得出（2057、2097
    // 年那两处是 iOS 自己算错了，不收）。这几个月都不是闰月。
    private static final String[][] ICU_LUNAR_OVERRIDES = {
            {"2012-08-17", "2012-09-15", "7", "1"},
            {"2018-11-07", "2018-11-07", "9", "30"},
            {"2018-11-08", "2018-12-06", "10", "1"},
            {"2027-02-06", "2027-03-07", "1", "1"},
            {"2030-02-02", "2030-02-02", "12", "30"},
            {"2030-02-03", "2030-03-03", "1", "1"},
            {"2070-03-12", "2070-04-10", "2", "1"},
    };
    private static final long DAY_MILLIS = 24L * 60 * 60 * 1000;
    private static final long SHANGHAI_OFFSET_MILLIS = 8L * 60 * 60 * 1000;

    static LunarDate lunarDate(long millis) {
        long day = Math.floorDiv(millis + SHANGHAI_OFFSET_MILLIS, DAY_MILLIS);
        for (String[] item : ICU_LUNAR_OVERRIDES) {
            long from = epochDay(item[0]);
            if (day < from || day > epochDay(item[1])) continue;
            int firstDay = Integer.parseInt(item[3]);
            // 年份取这个月十五前后的一天：离 ICU 算错的月初月末都远，正月、腊月也不会串年。
            long reference = from + 15 - firstDay;
            int cyclicalYear = icuLunarDate(reference * DAY_MILLIS - SHANGHAI_OFFSET_MILLIS + DAY_MILLIS / 2).cyclicalYear;
            return new LunarDate(Integer.parseInt(item[2]), firstDay + (int) (day - from), false, cyclicalYear);
        }
        return icuLunarDate(millis);
    }

    private static long epochDay(String date) {
        java.util.Calendar utc = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
        utc.clear();
        utc.set(Integer.parseInt(date.substring(0, 4)), Integer.parseInt(date.substring(5, 7)) - 1,
                Integer.parseInt(date.substring(8, 10)));
        return Math.floorDiv(utc.getTimeInMillis(), DAY_MILLIS);
    }

    private static LunarDate icuLunarDate(long millis) {
        android.icu.util.ChineseCalendar chinese =
                new android.icu.util.ChineseCalendar(android.icu.util.TimeZone.getTimeZone(ZONE_ID));
        chinese.setTimeInMillis(millis);
        return new LunarDate(
                chinese.get(android.icu.util.ChineseCalendar.MONTH) + 1,
                chinese.get(android.icu.util.ChineseCalendar.DAY_OF_MONTH),
                chinese.get(android.icu.util.ChineseCalendar.IS_LEAP_MONTH) == 1,
                chinese.get(android.icu.util.ChineseCalendar.YEAR)
        );
    }

    /** 清明在 21 世纪前中段按四年一轮的 4/4、4/4、4/5、4/5 排列。 */
    static int qingmingDay(int year) {
        int remainder = ((year % 4) + 4) % 4;
        return remainder <= 1 ? 4 : 5;
    }

    /** 服务端放假日按「同名且日期相连」并成一段段假期，挑出和这一年沾边的。 */
    private static List<HolidayWindow> publishedWindows(List<PublishedHoliday> days, int year) {
        List<HolidayWindow> windows = new ArrayList<>();
        for (PublishedHoliday day : days) {
            HolidayWindow last = windows.isEmpty() ? null : windows.get(windows.size() - 1);
            Integer gap = last == null ? null : dayGap(last.end, day.date);
            if (last != null && last.name.equals(day.name) && gap != null && gap == 1) {
                windows.set(windows.size() - 1, new HolidayWindow(last.name, last.start, day.date));
            } else {
                windows.add(new HolidayWindow(day.name, day.date, day.date));
            }
        }
        String prefix = year + "-";
        List<HolidayWindow> result = new ArrayList<>();
        for (HolidayWindow window : windows) {
            if (window.start.startsWith(prefix) || window.end.startsWith(prefix)) result.add(window);
        }
        return result;
    }

    private static final class YearData {
        final Map<String, CalendarDay> days = new HashMap<>();
        final List<HolidayWindow> holidays = new ArrayList<>();
    }

    private static YearData year(int year) {
        List<PublishedHoliday> snapshot;
        synchronized (LOCK) {
            YearData cached = CACHE.get(year);
            if (cached != null) return cached;
            snapshot = published;
        }
        YearData built = build(year, snapshot);
        synchronized (LOCK) {
            // 期间换了放假安排就别把旧结果存进去。
            if (snapshot == published) {
                CACHE.put(year, built);
                if (CACHE.size() > 8) {
                    Integer farthest = null;
                    for (Integer key : CACHE.keySet()) {
                        if (farthest == null || Math.abs(key - year) > Math.abs(farthest - year)) farthest = key;
                    }
                    CACHE.remove(farthest);
                }
            }
        }
        return built;
    }

    /** 按公历年整体算一次再缓存：一次扫描 365 天，之后每个日期都是字典查询。 */
    private static YearData build(int year, List<PublishedHoliday> publishedDays) {
        Map<String, LunarDate> lunarByDate = new LinkedHashMap<>();
        Map<String, List<String>> festivalsByDate = new HashMap<>();
        List<String> dates = new ArrayList<>();

        Calendar cursor = noon(String.format(Locale.US, "%04d-01-01", year));
        while (cursor.get(Calendar.YEAR) == year) {
            String key = dateString(cursor);
            LunarDate lunar = lunarDate(cursor.getTimeInMillis());
            lunarByDate.put(key, lunar);
            dates.add(key);
            if (!lunar.isLeapMonth) {
                String festival = festivalFor(LUNAR_FESTIVALS, lunar.month, lunar.day);
                if (festival != null) festivalsOf(festivalsByDate, key).add(festival);
            }
            String solar = festivalFor(SOLAR_FESTIVALS, cursor.get(Calendar.MONTH) + 1, cursor.get(Calendar.DAY_OF_MONTH));
            if (solar != null) festivalsOf(festivalsByDate, key).add(solar);
            cursor.add(Calendar.DAY_OF_MONTH, 1);
        }

        String qingming = String.format(Locale.US, "%04d-04-%02d", year, qingmingDay(year));
        Map<String, String> solarTermByDate = new HashMap<>();
        solarTermByDate.put(qingming, "清明");

        // 除夕是正月初一的前一天，长短月都对：腊月可能只有廿九天。
        String springFestival = lunarDateIn(dates, lunarByDate, 1, 1);
        String newYearEve = null;
        if (springFestival != null) {
            int index = dates.indexOf(springFestival);
            if (index > 0) {
                newYearEve = dates.get(index - 1);
                festivalsOf(festivalsByDate, newYearEve).add(0, "除夕");
            }
        }

        List<HolidayWindow> holidays = new ArrayList<>();
        holidays.add(new HolidayWindow("元旦", year + "-01-01", year + "-01-01"));
        if (springFestival != null) {
            // 2024 年修订后的《全国年节及纪念日放假办法》：春节自除夕起放假 4 天。
            String third = lunarDateIn(dates, lunarByDate, 1, 3);
            holidays.add(new HolidayWindow("春节",
                    newYearEve != null ? newYearEve : springFestival,
                    third != null ? third : springFestival));
        }
        holidays.add(new HolidayWindow("清明节", qingming, qingming));
        holidays.add(new HolidayWindow("劳动节", year + "-05-01", year + "-05-02"));
        String dragonBoat = lunarDateIn(dates, lunarByDate, 5, 5);
        if (dragonBoat != null) holidays.add(new HolidayWindow("端午节", dragonBoat, dragonBoat));
        String midAutumn = lunarDateIn(dates, lunarByDate, 8, 15);
        if (midAutumn != null) holidays.add(new HolidayWindow("中秋节", midAutumn, midAutumn));
        holidays.add(new HolidayWindow("国庆节", year + "-10-01", year + "-10-03"));

        List<HolidayWindow> fromServer = publishedWindows(publishedDays, year);
        if (!fromServer.isEmpty()) {
            // 服务端给了哪个节日就用哪个：同名的、以及被连休盖住的法定假日都让位
            // （2025 年中秋落在国庆连休里，服务端只写一段「国庆节、中秋节」）。
            String prefix = year + "-";
            List<HolidayWindow> kept = new ArrayList<>();
            for (HolidayWindow window : holidays) {
                boolean replaced = false;
                for (HolidayWindow server : fromServer) {
                    if ((server.name.equals(window.name) && server.start.startsWith(prefix))
                            || (server.start.compareTo(window.end) <= 0 && window.start.compareTo(server.end) <= 0)) {
                        replaced = true;
                        break;
                    }
                }
                if (!replaced) kept.add(window);
            }
            kept.addAll(fromServer);
            holidays = kept;
        }
        Collections.sort(holidays, (a, b) -> a.start.compareTo(b.start));

        Map<String, String> holidayByDate = new HashMap<>();
        for (HolidayWindow window : holidays) {
            String day = window.start;
            while (day != null && day.compareTo(window.end) <= 0) {
                if (!holidayByDate.containsKey(day)) holidayByDate.put(day, window.name);
                day = addDays(day, 1);
            }
        }

        YearData data = new YearData();
        data.holidays.addAll(holidays);
        for (String key : dates) {
            List<String> festivals = festivalsByDate.get(key);
            data.days.put(key, new CalendarDay(
                    key,
                    lunarByDate.get(key),
                    festivals == null ? Collections.emptyList() : festivals,
                    solarTermByDate.get(key),
                    holidayByDate.get(key)
            ));
        }
        return data;
    }

    private static List<String> festivalsOf(Map<String, List<String>> map, String key) {
        List<String> list = map.get(key);
        if (list == null) {
            list = new ArrayList<>();
            map.put(key, list);
        }
        return list;
    }

    private static String festivalFor(Object[][] table, int month, int day) {
        for (Object[] row : table) {
            if ((Integer) row[0] == month && (Integer) row[1] == day) return (String) row[2];
        }
        return null;
    }

    private static String lunarDateIn(List<String> dates, Map<String, LunarDate> lunarByDate, int month, int day) {
        for (String key : dates) {
            LunarDate lunar = lunarByDate.get(key);
            if (lunar != null && !lunar.isLeapMonth && lunar.month == month && lunar.day == day) return key;
        }
        return null;
    }
}
