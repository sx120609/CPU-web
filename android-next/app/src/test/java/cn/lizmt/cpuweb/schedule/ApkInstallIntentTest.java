package cn.lizmt.cpuweb.schedule;

import android.content.Context;
import android.content.Intent;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {26, 35})
public class ApkInstallIntentTest {
    @Test
    public void sharesReadableStagedFileWithInstaller() throws Exception {
        Context context = RuntimeEnvironment.getApplication();
        File directory = new File(context.getCacheDir(), "apk-updates");
        directory.mkdirs();
        File apk = new File(directory, "test-update.apk");
        byte[] bytes = {0x50, 0x4b, 3, 4};
        try (FileOutputStream output = new FileOutputStream(apk)) {
            output.write(bytes);
        }
        Intent intent = ApkInstallIntent.create(context, apk);
        assertEquals("content", intent.getData().getScheme());
        assertEquals(context.getPackageName() + ".fileprovider", intent.getData().getAuthority());
        assertEquals("application/vnd.android.package-archive", intent.getType());
        assertEquals(intent.getData(), intent.getClipData().getItemAt(0).getUri());
        assertTrue((intent.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0);
        try (InputStream input = context.getContentResolver().openInputStream(intent.getData())) {
            assertNotNull(input);
            for (byte value : bytes) assertEquals(value & 0xff, input.read());
            assertEquals(-1, input.read());
        }
    }
}
