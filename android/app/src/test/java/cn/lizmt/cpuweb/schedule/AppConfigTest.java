package cn.lizmt.cpuweb.schedule;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class AppConfigTest {
    @Test
    public void defaultAppUrlOpensSchedule() {
        assertEquals("https://cputime.cn/schedule", BuildConfig.APP_URL);
    }
}
