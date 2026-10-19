package cn.lizmt.cpuweb.schedule;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class ScheduleWidgetWeekResolverTest {
    @Test
    public void displayedDayWeekWinsOverPayloadWeek() {
        assertEquals("1", ScheduleWidgetWeekResolver.resolve(true, 1, 0));
    }

    @Test
    public void zeroWeekIsNeverRendered() {
        assertEquals("", ScheduleWidgetWeekResolver.resolve(false, null, 0));
        assertEquals("", ScheduleWidgetWeekResolver.resolve(true, 0, 8));
    }

    @Test
    public void payloadWeekIsUsedWhenDisplayedDayHasNoWeekField() {
        assertEquals("8", ScheduleWidgetWeekResolver.resolve(false, null, 8));
    }
}
