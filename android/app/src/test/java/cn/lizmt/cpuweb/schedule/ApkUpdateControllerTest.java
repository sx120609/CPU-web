package cn.lizmt.cpuweb.schedule;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Robolectric;
import org.robolectric.annotation.Config;
import java.io.File;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk=35)
public class ApkUpdateControllerTest {
    private Context context;
    private SharedPreferences prefs;
    @Before public void prepare() {
        context=RuntimeEnvironment.getApplication();
        prefs=context.getSharedPreferences("cpu-apk-update-v1",Context.MODE_PRIVATE);
        prefs.edit().clear().commit();
    }
    @Test public void restartingReusesThePersistedDownloadInsteadOfEnqueueingAgain() throws Exception {
        ApkUpdateController first=new ApkUpdateController(context);
        assertTrue(first.start("https://cputime.cn/api/site/downloads/android-app","CPU-Web.apk"));
        long id=new JSONObject(first.stateJson()).getLong("downloadId");
        assertTrue(id>=0);
        ApkUpdateController restored=new ApkUpdateController(context);
        assertTrue(restored.start("https://cputime.cn/api/site/downloads/android-app","CPU-Web.apk"));
        assertEquals(id,new JSONObject(restored.stateJson()).getLong("downloadId"));
        DownloadManager manager=(DownloadManager)context.getSystemService(Context.DOWNLOAD_SERVICE);
        try(Cursor cursor=manager.query(new DownloadManager.Query())) { assertEquals(1,cursor.getCount()); }
    }
    @Test public void installationCannotReadAPathOutsideTheUpdateCache() throws Exception {
        File outside=new File(context.getFilesDir(),"private.txt");
        outside.createNewFile();
        prefs.edit().putString("phase","ready").putString("path",outside.getPath()).putLong("targetVersion",99999).commit();
        ApkUpdateController restored=new ApkUpdateController(context);
        Activity activity=Robolectric.buildActivity(Activity.class).create().get();
        assertFalse(restored.requestInstall(activity));
        assertEquals("failed",new JSONObject(restored.stateJson()).getString("phase"));
        assertTrue(outside.exists());
    }
    @Test public void successfullyInstalledUpdateClearsItsPendingFile() throws Exception {
        File directory=new File(context.getCacheDir(),"apk-updates");
        directory.mkdirs();
        File ready=new File(directory,"installed.apk");
        ready.createNewFile();
        prefs.edit().putString("phase","ready").putString("path",ready.getPath()).putLong("targetVersion",BuildConfig.VERSION_CODE).commit();
        assertEquals("idle",new JSONObject(new ApkUpdateController(context).stateJson()).getString("phase"));
        assertFalse(ready.exists());
    }
    @Test public void invalidDownloadUrlIsNotQueued() {
        assertFalse(new ApkUpdateController(context).start("file:///private.apk","update.apk"));
    }
}
