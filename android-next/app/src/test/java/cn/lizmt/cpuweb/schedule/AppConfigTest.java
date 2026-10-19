package cn.lizmt.cpuweb.schedule;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class AppConfigTest {
    @Test
    public void defaultAppUrlOpensTheWebHome() {
        assertEquals("https://cputime.cn/home", BuildConfig.APP_URL);
    }
}
