package cn.lizmt.cpuweb.schedule;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35, manifest = Config.NONE)
public class StorageCleanerTest {
    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    @Test
    public void networkCountsOnlyTheWebViewCacheDirectories() throws Exception {
        File cache = folder.newFolder("cache");
        write(new File(cache, "WebView/Default/HTTP Cache/data_1"), 4096);
        write(new File(cache, "org.chromium.android_webview/index"), 1024);
        write(new File(cache, "share/schedule.png"), 2048);

        assertEquals(5120, StorageCleaner.networkBytes(cache));
    }

    @Test
    public void tempSkipsTheWebViewCacheAndPendingUpdates() throws Exception {
        File cache = folder.newFolder("cache");
        File external = folder.newFolder("external");
        write(new File(cache, "WebView/Default/HTTP Cache/data_1"), 4096);
        File update = write(new File(cache, "apk-updates/CPU-Web.apk"), 8192);
        File shared = write(new File(cache, "share/schedule.png"), 2048);
        File loose = write(new File(cache, "preview.tmp"), 512);
        File exported = write(new File(external, "export/week.png"), 1024);

        assertEquals(3584, StorageCleaner.tempBytes(cache, external));

        StorageCleaner.clearTemp(cache, external);

        assertFalse(shared.exists());
        assertFalse(loose.exists());
        assertFalse(exported.exists());
        assertTrue(external.exists());
        assertTrue(update.exists());
        assertEquals(4096, StorageCleaner.networkBytes(cache));
        assertEquals(0, StorageCleaner.tempBytes(cache, external));
    }

    @Test
    public void missingDirectoriesCountAsEmpty() {
        File missing = new File(folder.getRoot(), "missing");

        assertEquals(0, StorageCleaner.networkBytes(missing));
        assertEquals(0, StorageCleaner.tempBytes(missing, null));
        StorageCleaner.clearTemp(missing, null);
    }

    @Test
    public void onlyAJsonArrayOfNamesSelectsCategories() {
        assertTrue(StorageCleaner.parseCategories("[\"network\",\"temp\"]").contains(StorageCleaner.TEMP));
        assertEquals(1, StorageCleaner.parseCategories("[\"network\"]").size());
        assertTrue(StorageCleaner.parseCategories("network").isEmpty());
        assertTrue(StorageCleaner.parseCategories(null).isEmpty());
    }

    @Test
    public void usageReportsBothCategoriesAndTheAppTotal() throws Exception {
        File cache = RuntimeEnvironment.getApplication().getCacheDir();
        write(new File(cache, "WebView/Default/HTTP Cache/data_1"), 4096);
        write(new File(cache, "share/schedule.png"), 2048);

        JSONObject usage = new JSONObject(StorageCleaner.usageJson(RuntimeEnvironment.getApplication()));

        assertEquals("network", usage.getJSONArray("categories").getJSONObject(0).getString("id"));
        assertEquals(4096, usage.getJSONArray("categories").getJSONObject(0).getLong("bytes"));
        assertEquals("temp", usage.getJSONArray("categories").getJSONObject(1).getString("id"));
        assertEquals(2048, usage.getJSONArray("categories").getJSONObject(1).getLong("bytes"));
        assertTrue(usage.getLong("totalBytes") >= 6144);
    }

    private static File write(File file, int bytes) throws IOException {
        File parent = file.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("mkdirs " + parent);
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(new byte[bytes]);
        }
        return file;
    }
}
