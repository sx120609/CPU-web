package cn.lizmt.cpuweb.schedule;

import static org.junit.Assert.*;

import android.content.ComponentName;
import android.content.pm.ActivityInfo;
import android.os.Build;
import android.view.View;
import android.view.WindowManager;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
public class WebViewInsetsTest {
    @Test
    public void keyboardResizesContentAndClosingRestoresNavigationInset() {
        View host = new View(RuntimeEnvironment.getApplication());
        WebViewInsets.install(host);
        apply(host, 300, 24, 0, 48);
        assertEquals(24, host.getPaddingTop());
        assertEquals(300, host.getPaddingBottom());
        apply(host, 420, 24, 0, 48);
        assertEquals(420, host.getPaddingBottom());
        apply(host, 0, 24, 0, 48);
        assertEquals(48, host.getPaddingBottom());
    }

    @Test
    public void landscapeBarsAndSmallerKeyboardUseUnionRatherThanSum() {
        View host = new View(RuntimeEnvironment.getApplication());
        WebViewInsets.install(host);
        apply(host, 20, 0, 36, 48);
        assertEquals(36, host.getPaddingRight());
        assertEquals(48, host.getPaddingBottom());
    }

    @Test
    public void handledInsetsAreNotAppliedAgainByWebView() {
        View host = new View(RuntimeEnvironment.getApplication());
        WebViewInsets.install(host);
        WindowInsetsCompat remaining = apply(host, 300, 24, 0, 48);
        assertEquals(Insets.NONE, remaining.getInsets(WindowInsetsCompat.Type.ime()));
        assertEquals(Insets.NONE, remaining.getInsets(WindowInsetsCompat.Type.systemBars()));
        assertFalse(remaining.isVisible(WindowInsetsCompat.Type.ime()));
    }

    @Test
    public void activityRequestsResizeForOlderAndroidImeInsets() throws Exception {
        ActivityInfo info = RuntimeEnvironment.getApplication().getPackageManager().getActivityInfo(
                new ComponentName(RuntimeEnvironment.getApplication(), MainActivity.class), 0);
        assertEquals(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
                info.softInputMode & WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST);
    }

    private WindowInsetsCompat apply(View host, int keyboard, int top, int right, int bottom) {
        if (Build.VERSION.SDK_INT < 30) {
            WindowInsetsCompat legacy = new WindowInsetsCompat.Builder()
                    .setSystemWindowInsets(Insets.of(0, top, right, Math.max(keyboard, bottom)))
                    .setStableInsets(Insets.of(0, top, right, bottom))
                    .build();
            return ViewCompat.dispatchApplyWindowInsets(host, legacy);
        }
        WindowInsetsCompat insets = new WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.statusBars(), Insets.of(0, top, 0, 0))
                .setInsets(WindowInsetsCompat.Type.navigationBars(), Insets.of(0, 0, right, bottom))
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, keyboard))
                .setVisible(WindowInsetsCompat.Type.ime(), keyboard > 0)
                .build();
        return ViewCompat.dispatchApplyWindowInsets(host, insets);
    }
}
