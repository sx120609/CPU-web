package cn.lizmt.cpuweb.schedule;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

// android.icu 在 Robolectric 的 android-all 里是真实实现，所以农历换算可以直接测。
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class ChineseCalendarInfoTest {
    @Before
    public void resetPublishedHolidays() {
        ChineseCalendarInfo.usePublishedHolidays(new ArrayList<>());
    }

    @After
    public void cleanUp() {
        ChineseCalendarInfo.usePublishedHolidays(new ArrayList<>());
    }

    @Test
    public void midAutumnAndNationalDayIn2026() {
        ChineseCalendarInfo.CalendarDay midAutumn = ChineseCalendarInfo.info("2026-09-25");
        assertEquals(8, midAutumn.lunar.month);
        assertEquals(15, midAutumn.lunar.day);
        assertEquals("八月十五", midAutumn.lunar.fullLabel());
        assertEquals("中秋节", midAutumn.holiday);
        assertEquals("中秋节", midAutumn.badge());
        assertEquals("中秋快乐", ChineseCalendarInfo.restGreeting("2026-09-25"));

        ChineseCalendarInfo.CalendarDay nationalDay = ChineseCalendarInfo.info("2026-10-01");
        assertEquals("国庆节", nationalDay.holiday);
        assertTrue(nationalDay.isStatutoryHoliday());
        assertEquals("国庆快乐", ChineseCalendarInfo.restMessage("2026-10-01"));
    }

    @Test
    public void lunarLabelsFollowTheIosFormat() {
        // 2026-02-17 是丙午年正月初一。
        ChineseCalendarInfo.CalendarDay springFestival = ChineseCalendarInfo.info("2026-02-17");
        assertEquals("正月", springFestival.lunar.shortLabel());
        assertEquals("正月初一", springFestival.lunar.fullLabel());
        assertEquals(Arrays.asList("春节"), springFestival.festivals);
        assertEquals("春节", springFestival.badge());
        assertEquals("除夕", ChineseCalendarInfo.info("2026-02-16").festivals.get(0));
        assertEquals("初十", new ChineseCalendarInfo.LunarDate(3, 10, false, 43).dayLabel());
        assertEquals("二十", new ChineseCalendarInfo.LunarDate(3, 20, false, 43).dayLabel());
        assertEquals("廿三", new ChineseCalendarInfo.LunarDate(3, 23, false, 43).dayLabel());
        assertEquals("三十", new ChineseCalendarInfo.LunarDate(3, 30, false, 43).dayLabel());
        assertEquals("闰四月", new ChineseCalendarInfo.LunarDate(4, 1, true, 43).shortLabel());
        assertEquals("腊月", new ChineseCalendarInfo.LunarDate(12, 1, false, 43).monthLabel());
        // 普通日子没有徽标，日期栏只写农历。
        ChineseCalendarInfo.CalendarDay plain = ChineseCalendarInfo.info("2026-09-26");
        assertNull(plain.badge());
        assertEquals("十六", plain.displayLabel());
    }

    @Test
    public void springFestivalHolidayStartsOnNewYearsEve() {
        ChineseCalendarInfo.HolidayWindow spring = find(ChineseCalendarInfo.holidays(2026), "春节");
        assertEquals("2026-02-16", spring.start);
        assertEquals("2026-02-19", spring.end);
        assertEquals(4, spring.dayCount());
    }

    @Test
    public void correctsIcuLateNewMoons() {
        // ICU 把 2027、2030 年正月初一算晚了一天，实际是 2.6、2.3。
        assertEquals("春节", ChineseCalendarInfo.info("2027-02-06").festivals.get(0));
        assertEquals("除夕", ChineseCalendarInfo.info("2027-02-05").festivals.get(0));
        assertEquals("腊月廿九", ChineseCalendarInfo.info("2027-02-05").lunar.fullLabel());
        assertEquals("正月三十", ChineseCalendarInfo.info("2027-03-07").lunar.fullLabel());
        assertEquals("二月初一", ChineseCalendarInfo.info("2027-03-08").lunar.fullLabel());
        assertEquals(ChineseCalendarInfo.info("2027-02-07").lunar.cyclicalYear,
                ChineseCalendarInfo.info("2027-02-06").lunar.cyclicalYear);
        assertEquals("正月初一", ChineseCalendarInfo.info("2030-02-03").lunar.fullLabel());
        assertEquals("腊月三十", ChineseCalendarInfo.info("2030-02-02").lunar.fullLabel());
        ChineseCalendarInfo.HolidayWindow spring = find(ChineseCalendarInfo.holidays(2027), "春节");
        assertEquals("2027-02-05", spring.start);
    }

    @Test
    public void qingmingFollowsTheFourYearCycle() {
        assertEquals(4, ChineseCalendarInfo.qingmingDay(2024));
        assertEquals(4, ChineseCalendarInfo.qingmingDay(2025));
        assertEquals(5, ChineseCalendarInfo.qingmingDay(2026));
        assertEquals(5, ChineseCalendarInfo.qingmingDay(2027));
        ChineseCalendarInfo.CalendarDay qingming = ChineseCalendarInfo.info("2026-04-05");
        assertEquals("清明", qingming.solarTerm);
        assertEquals("清明节", qingming.badge());
        assertEquals("清明安康", ChineseCalendarInfo.restGreeting("2026-04-05"));
    }

    @Test
    public void festivalsThatAreNotHolidaysKeepTheOrdinaryRestText() {
        ChineseCalendarInfo.CalendarDay teachers = ChineseCalendarInfo.info("2026-09-10");
        assertEquals("教师节", teachers.badge());
        assertFalse(teachers.isStatutoryHoliday());
        assertEquals("今日无课", ChineseCalendarInfo.restMessage("2026-09-10"));
    }

    @Test
    public void countdownPhrasesMatchIos() {
        ChineseCalendarInfo.HolidayCountdown countdown = ChineseCalendarInfo.countdown("2026-09-20", 120);
        assertEquals("中秋节", countdown.window.name);
        assertEquals(5, countdown.daysAway);
        assertEquals("距中秋节还有 5 天", countdown.phrase());
        assertEquals("9.25 周五", countdown.dateLabel());
        assertEquals("距中秋节还有 5 天 · 9.25 周五", ChineseCalendarInfo.restFootnote("2026-09-20"));

        ChineseCalendarInfo.HolidayCountdown today = ChineseCalendarInfo.countdown("2026-09-25", 120);
        assertEquals(0, today.daysAway);
        assertEquals("今天是中秋节", today.phrase());
        // 只休一天的假期当天不写副文案。
        assertNull(ChineseCalendarInfo.restFootnote("2026-09-25"));

        // 离线推算的国庆 10.1 - 10.3，正在假期里时说这一段连休。
        assertEquals("假期 10.1 - 10.3 · 休 3 天", ChineseCalendarInfo.restFootnote("2026-10-02"));
        assertNull(ChineseCalendarInfo.countdown("2026-09-20", 3));
    }

    @Test
    public void publishedHolidaysOverrideTheOfflineWindows() {
        List<String[]> offDays = new ArrayList<>();
        offDays.add(new String[]{"2026-09-25", "中秋节"});
        offDays.add(new String[]{"2026-09-26", "中秋节放假"});
        offDays.add(new String[]{"2026-09-27", "中秋节"});
        for (int day = 1; day <= 7; day++) {
            offDays.add(new String[]{"2026-10-0" + day, "国庆节、中秋节"});
        }
        offDays.add(new String[]{"2026-10-20", "校运会停课"});
        List<ChineseCalendarInfo.PublishedHoliday> published = ChineseCalendarInfo.PublishedHoliday.fromOffDays(offDays);
        assertEquals(10, published.size());
        assertEquals("国庆节", published.get(3).name);

        ChineseCalendarInfo.usePublishedHolidays(published);

        assertEquals("中秋节", ChineseCalendarInfo.info("2026-09-26").holiday);
        assertEquals("国庆节", ChineseCalendarInfo.info("2026-10-07").holiday);
        assertNull(ChineseCalendarInfo.info("2026-10-20").holiday);
        assertEquals("距中秋节还有 5 天 · 9.25 - 9.27 · 休 3 天", ChineseCalendarInfo.restFootnote("2026-09-20"));
        assertEquals("假期 9.25 - 9.27 · 休 3 天", ChineseCalendarInfo.restFootnote("2026-09-26"));
        assertEquals("距国庆节还有 3 天 · 10.1 - 10.7 · 休 7 天", ChineseCalendarInfo.restFootnote("2026-09-28"));
        assertEquals("假期 10.1 - 10.7 · 休 7 天", ChineseCalendarInfo.restFootnote("2026-10-03"));
        // 没发布的节日照旧离线推算。
        assertEquals("春节", ChineseCalendarInfo.info("2026-02-17").holiday);
        assertEquals("劳动节", ChineseCalendarInfo.info("2026-05-02").holiday);
    }

    @Test
    public void countdownCrossesIntoNextYear() {
        ChineseCalendarInfo.HolidayCountdown countdown = ChineseCalendarInfo.countdown("2026-12-20", 120);
        assertEquals("元旦", countdown.window.name);
        assertEquals(12, countdown.daysAway);
        assertEquals("1.1 周五", countdown.dateLabel());
    }

    private static ChineseCalendarInfo.HolidayWindow find(List<ChineseCalendarInfo.HolidayWindow> windows, String name) {
        for (ChineseCalendarInfo.HolidayWindow window : windows) {
            if (window.name.equals(name)) return window;
        }
        throw new AssertionError("missing " + name);
    }
}
