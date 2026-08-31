package cn.lizmt.cpuweb.schedule;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;

final class ScheduleWidgetEndpoint {
    private static final String PRIMARY_HOST = "cputime.cn";
    private static final String LEGACY_HOST = "cpu.lizmt.cn";

    private ScheduleWidgetEndpoint() {
    }

    static String normalize(String endpoint) {
        String source = endpoint == null ? "" : endpoint.trim();
        if (source.isEmpty()) return "";
        return replaceKnownHost(source, PRIMARY_HOST);
    }

    static List<String> candidates(String endpoint) {
        ArrayList<String> values = new ArrayList<>();
        String primary = normalize(endpoint);
        if (primary.isEmpty()) return values;
        values.add(primary);

        String alternate = replaceKnownHost(primary, LEGACY_HOST);
        if (!alternate.equals(primary)) values.add(alternate);
        return values;
    }

    private static String replaceKnownHost(String endpoint, String targetHost) {
        try {
            URI uri = new URI(endpoint);
            String host = uri.getHost();
            if (host == null || (!host.equalsIgnoreCase(PRIMARY_HOST) && !host.equalsIgnoreCase(LEGACY_HOST))) {
                return endpoint;
            }
            return new URI(
                    "https",
                    null,
                    targetHost,
                    -1,
                    uri.getPath(),
                    uri.getQuery(),
                    uri.getFragment()
            ).toString();
        } catch (Exception ignored) {
            return endpoint;
        }
    }
}
