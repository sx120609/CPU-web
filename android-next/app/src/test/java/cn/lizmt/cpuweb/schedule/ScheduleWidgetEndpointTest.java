package cn.lizmt.cpuweb.schedule;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Arrays;

public class ScheduleWidgetEndpointTest {
    @Test
    public void migratesLegacyEndpointWithoutChangingTheCredential() {
        assertEquals(
                "https://cputime.cn/api/jwxt/schedule-widget?token=abc123&week=2#today",
                ScheduleWidgetEndpoint.normalize(
                        "https://cpu.lizmt.cn/api/jwxt/schedule-widget?token=abc123&week=2#today"
                )
        );
    }

    @Test
    public void retriesBothProductionHosts() {
        assertEquals(
                Arrays.asList(
                        "https://cputime.cn/api/jwxt/schedule-widget?token=abc123",
                        "https://cpu.lizmt.cn/api/jwxt/schedule-widget?token=abc123"
                ),
                ScheduleWidgetEndpoint.candidates(
                        "https://cpu.lizmt.cn/api/jwxt/schedule-widget?token=abc123"
                )
        );
    }

    @Test
    public void leavesUnknownEndpointsUntouched() {
        assertEquals(
                Arrays.asList("https://example.com/widget?token=abc123"),
                ScheduleWidgetEndpoint.candidates("https://example.com/widget?token=abc123")
        );
    }
}
