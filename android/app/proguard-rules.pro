# Release builds drop library code the app never uses (most of the Material
# icon set, unused Compose pieces), which keeps the APK small now that DEX is
# stored uncompressed for incremental updates.
#
# Names stay as written: crash reports from ClientStats remain readable, and
# unchanged classes keep the same bytes from one version to the next, which is
# what keeps incremental update patches small. For the same reason R8 does not
# rewrite (inline, merge) the code that survives.
-dontobfuscate
-dontoptimize

# Methods the site calls through the WebView JavaScript interfaces
# (CpuAndroidBridge "CPUAndroid", WebSession "CPUAndroidNative").
-keepclassmembers class cn.lizmt.cpuweb.schedule.** {
    @android.webkit.JavascriptInterface <methods>;
}
