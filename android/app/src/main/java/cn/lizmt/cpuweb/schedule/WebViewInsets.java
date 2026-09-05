package cn.lizmt.cpuweb.schedule;

import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

final class WebViewInsets {
    private WebViewInsets() {}

    static void install(View target) {
        ViewCompat.setOnApplyWindowInsetsListener(target, (view, insets) -> {
            int mask = WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.ime();
            Insets occupied = insets.getInsets(mask);
            view.setPadding(occupied.left, occupied.top, occupied.right, occupied.bottom);
            // The host already resizes the WebView; do not apply the IME twice inside it.
            return new WindowInsetsCompat.Builder(insets)
                    .setInsets(mask, Insets.NONE)
                    .setVisible(WindowInsetsCompat.Type.ime(), false)
                    .build();
        });
        ViewCompat.requestApplyInsets(target);
    }
}
