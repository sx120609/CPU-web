package cn.lizmt.cpuweb.schedule;

import android.app.AlarmManager;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlarmManager;
import org.robolectric.shadows.ShadowLooper;

import java.util.Calendar;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class ScheduleWidgetRefreshAlarmsTest {
    @Test
    public void dayRolloverIsOneMinutePastTheNextMidnight() {
        Calendar now = Calendar.getInstance();
        now.set(2026, Calendar.NOVEMBER, 3, 21, 6, 0);
        Calendar expected = Calendar.getInstance();
        expected.setTimeInMillis(now.getTimeInMillis());
        expected.set(2026, Calendar.NOVEMBER, 4, 0, 1, 0);
        expected.set(Calendar.MILLISECOND, 0);

        assertEquals(expected.getTimeInMillis(),
                ScheduleWidgetProvider.nextDayRolloverAt(now.getTimeInMillis()));
    }

    @Test
    public void setsAWakingDayAlarmBesideTheCourseAlarm() {
        Context context = RuntimeEnvironment.getApplication();
        ShadowAlarmManager alarms = Shadows.shadowOf(
                (AlarmManager) context.getSystemService(Context.ALARM_SERVICE));
        long before = System.currentTimeMillis();

        ScheduleWidgetProvider.scheduleRefreshAlarms(context, null);

        List<ShadowAlarmManager.ScheduledAlarm> scheduled = alarms.getScheduledAlarms();
        assertEquals(2, scheduled.size());
        boolean sawDayAlarm = false;
        boolean sawCourseAlarm = false;
        for (ShadowAlarmManager.ScheduledAlarm alarm : scheduled) {
            if (alarm.getType() == AlarmManager.RTC_WAKEUP) {
                sawDayAlarm = true;
                assertEquals(ScheduleWidgetProvider.nextDayRolloverAt(before), alarm.getTriggerAtMs());
            } else if (alarm.getType() == AlarmManager.RTC) {
                sawCourseAlarm = true;
                assertTrue(alarm.getTriggerAtMs() <= before + 30L * 60L * 1000L + 1000L);
            }
        }
        assertTrue(sawDayAlarm);
        assertTrue(sawCourseAlarm);
    }

    @Test
    public void settingTheAlarmsAgainReplacesThemInsteadOfStacking() {
        Context context = RuntimeEnvironment.getApplication();
        ShadowAlarmManager alarms = Shadows.shadowOf(
                (AlarmManager) context.getSystemService(Context.ALARM_SERVICE));

        ScheduleWidgetProvider.scheduleRefreshAlarms(context, null);
        ScheduleWidgetProvider.scheduleRefreshAlarms(context, null);

        assertEquals(2, alarms.getScheduledAlarms().size());
    }

    @Test
    public void bootSetsTheAlarmsBeforeAnyRenderRuns() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        ShadowAlarmManager alarms = Shadows.shadowOf(
                (AlarmManager) context.getSystemService(Context.ALARM_SERVICE));
        Shadows.shadowOf(AppWidgetManager.getInstance(context))
                .bindAppWidgetId(7, new ComponentName(context, ScheduleWidgetProviderTodayWide.class));

        new ScheduleWidgetProvider().onReceive(context, new Intent(Intent.ACTION_BOOT_COMPLETED));

        assertEquals(2, alarms.getScheduledAlarms().size());
        ScheduleWidgetProvider.afterQueuedRenders().get(30, TimeUnit.SECONDS);
        ShadowLooper.idleMainLooper();
    }

    @Test
    public void bootWithoutAnyWidgetSetsNoAlarmAndClearsOldOnes() {
        Context context = RuntimeEnvironment.getApplication();
        ShadowAlarmManager alarms = Shadows.shadowOf(
                (AlarmManager) context.getSystemService(Context.ALARM_SERVICE));
        ScheduleWidgetProvider.scheduleRefreshAlarms(context, null);

        new ScheduleWidgetProvider().onReceive(context, new Intent(Intent.ACTION_BOOT_COMPLETED));

        assertEquals(0, alarms.getScheduledAlarms().size());
    }

    @Test
    public void rebootClockChangesAndTicksRedrawTheWidgets() {
        assertTrue(ScheduleWidgetProvider.redrawsWidgets(Intent.ACTION_BOOT_COMPLETED));
        assertTrue(ScheduleWidgetProvider.redrawsWidgets(Intent.ACTION_TIME_CHANGED));
        assertTrue(ScheduleWidgetProvider.redrawsWidgets(Intent.ACTION_TIMEZONE_CHANGED));
        assertTrue(ScheduleWidgetProvider.redrawsWidgets(Intent.ACTION_MY_PACKAGE_REPLACED));
        assertTrue(ScheduleWidgetProvider.redrawsWidgets(ScheduleWidgetProvider.ACTION_WIDGET_TICK));
        assertFalse(ScheduleWidgetProvider.redrawsWidgets(ScheduleWidgetCelebration.ACTION));
        assertFalse(ScheduleWidgetProvider.redrawsWidgets(null));
    }
}
