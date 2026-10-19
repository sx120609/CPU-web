package cn.lizmt.cpuweb.schedule;

final class ScheduleWidgetWeekResolver {
    private ScheduleWidgetWeekResolver() {
    }

    static String resolve(boolean dayHasWeek, Object dayWeek, Object payloadWeek) {
        Object value = dayHasWeek ? dayWeek : payloadWeek;
        if (value == null) return "";
        String week = String.valueOf(value).trim();
        return "0".equals(week) ? "" : week;
    }
}
