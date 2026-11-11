package cn.lizmt.cpuweb.schedule;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.File;

/** 小组件背景: the photo kept for the widgets, at most 900 px on its long side, read once per change. */
final class WidgetPhoto {
    private static Bitmap cached;
    private static long cachedStamp = -1L;

    private WidgetPhoto() {
    }

    static synchronized Bitmap load(Context context) {
        File file = ScheduleWidgetPrefs.photoFile(context);
        if (!file.exists()) {
            cached = null;
            cachedStamp = -1L;
            return null;
        }
        long stamp = file.lastModified() ^ file.length();
        if (stamp != cachedStamp) {
            cached = BitmapFactory.decodeFile(file.getAbsolutePath());
            cachedStamp = stamp;
        }
        return cached;
    }

    /** Saves [source] scaled down for the widgets; false when it could not be written. */
    static synchronized boolean save(Context context, Bitmap source) {
        float scale = Math.min(1f, 900f / Math.max(source.getWidth(), source.getHeight()));
        Bitmap scaled = scale < 1f
                ? Bitmap.createScaledBitmap(source, Math.round(source.getWidth() * scale), Math.round(source.getHeight() * scale), true)
                : source;
        File file = ScheduleWidgetPrefs.photoFile(context);
        try (java.io.FileOutputStream out = new java.io.FileOutputStream(file)) {
            scaled.compress(Bitmap.CompressFormat.JPEG, 88, out);
        } catch (java.io.IOException error) {
            return false;
        }
        cachedStamp = -1L;
        return true;
    }

    static synchronized void clear(Context context) {
        //noinspection ResultOfMethodCallIgnored
        ScheduleWidgetPrefs.photoFile(context).delete();
        cached = null;
        cachedStamp = -1L;
    }
}
