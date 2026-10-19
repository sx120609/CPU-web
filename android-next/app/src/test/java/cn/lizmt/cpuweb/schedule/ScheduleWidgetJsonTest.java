package cn.lizmt.cpuweb.schedule;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import static org.junit.Assert.assertEquals;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class ScheduleWidgetJsonTest {
    @Test
    public void jsonNullIsNoTextRatherThanTheWordNull() throws Exception {
        // 本地课表记录里没有教室的课写的是 location: null（体育课就是这样）。
        JSONObject course = new JSONObject("{\"name\":\"体育（三）\",\"location\":null,\"teacher\":\"陈希讲师（高校）\"}");
        assertEquals("", ScheduleWidgetJson.text(course, "location", ""));
        assertEquals("待定", ScheduleWidgetJson.text(course, "location", "待定"));
        assertEquals("陈希讲师（高校）", ScheduleWidgetJson.text(course, "teacher", ""));
        assertEquals("", ScheduleWidgetJson.text(course, "missing", ""));
        assertEquals("", ScheduleWidgetJson.text(null, "location", ""));
    }
}
