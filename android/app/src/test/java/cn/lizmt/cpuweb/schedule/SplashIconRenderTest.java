package cn.lizmt.cpuweb.schedule;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;

import java.io.File;
import java.io.FileOutputStream;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class SplashIconRenderTest {
    @Test
    public void splashLogoKeepsTransparentOuterArea() throws Exception {
        Drawable drawable = RuntimeEnvironment.getApplication().getDrawable(R.drawable.splash_icon);
        assertNotNull(drawable);
        Bitmap bitmap = Bitmap.createBitmap(432, 432, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        drawable.setBounds(0, 0, bitmap.getWidth(), bitmap.getHeight());
        drawable.draw(canvas);

        assertEquals(0, Color.alpha(bitmap.getPixel(8, 8)));
        assertTrue(Color.alpha(bitmap.getPixel(216, 216)) > 0);
        File preview = new File("build/reports/splash-icon.png");
        assertTrue(preview.getParentFile().exists() || preview.getParentFile().mkdirs());
        try (FileOutputStream stream = new FileOutputStream(preview)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream));
        }
    }
}
