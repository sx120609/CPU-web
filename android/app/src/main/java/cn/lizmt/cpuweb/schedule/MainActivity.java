package cn.lizmt.cpuweb.schedule;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.Manifest;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

public final class MainActivity extends Activity {
    private static final int REQUEST_FILE_CHOOSER = 2001;
    private static final int REQUEST_WRITE_STORAGE = 2002;

    private WebView webView;
    private LinearLayout errorView;
    private LinearLayout launchView;
    private FrameLayout contentHost;
    private String appHost;
    private boolean mainFrameLoadFailed;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        appHost = Uri.parse(BuildConfig.APP_URL).getHost();
        configureSystemBars();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(248, 250, 252));
        contentHost = new FrameLayout(this);
        webView = new WebView(this);
        errorView = createErrorView();
        launchView = createLaunchView();

        contentHost.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        contentHost.addView(errorView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        contentHost.addView(launchView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        root.addView(contentHost, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        bindSystemBarInsets(contentHost);
        configureWebView();
        webView.loadUrl(BuildConfig.APP_URL);
    }

    private void configureSystemBars() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.rgb(237, 244, 255));
        window.setNavigationBarColor(Color.rgb(248, 250, 252));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void bindSystemBarInsets(View target) {
        ViewCompat.setOnApplyWindowInsetsListener(target, (view, insets) -> {
            int mask = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets bars = insets.getInsets(mask);
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return new WindowInsetsCompat.Builder(insets)
                    .setInsets(mask, Insets.NONE)
                    .build();
        });
        ViewCompat.requestApplyInsets(target);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setTextZoom(100);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setUserAgentString(settings.getUserAgentString()
                + " CPUWebScheduleApp/" + BuildConfig.VERSION_CODE
                + " CPUWebScheduleAppVersion/" + BuildConfig.VERSION_NAME);
        webView.addJavascriptInterface(new CpuAndroidBridge(this), "CPUAndroid");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (MainActivity.this.filePathCallback != null) {
                    MainActivity.this.filePathCallback.onReceiveValue(null);
                }
                MainActivity.this.filePathCallback = filePathCallback;

                Intent intent;
                try {
                    intent = fileChooserParams.createIntent();
                } catch (Exception ignored) {
                    intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/*");
                }

                try {
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException ignored) {
                    MainActivity.this.filePathCallback = null;
                    filePathCallback.onReceiveValue(null);
                    return false;
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView popup = new WebView(view.getContext());
                popup.setWebViewClient(new WebViewClient() {
                    private boolean opened;

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                        openOnce(popupView, request.getUrl());
                        return true;
                    }

                    @SuppressWarnings("deprecation")
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, String url) {
                        openOnce(popupView, Uri.parse(url));
                        return true;
                    }

                    @Override
                    public void onPageStarted(WebView popupView, String url, Bitmap favicon) {
                        openOnce(popupView, Uri.parse(url));
                    }

                    private void openOnce(WebView popupView, Uri uri) {
                        if (opened) return;
                        opened = true;
                        openExternal(uri);
                        popupView.destroy();
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                openExternal(Uri.parse(url));
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                mainFrameLoadFailed = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                CookieManager.getInstance().flush();
                if (!mainFrameLoadFailed) {
                    showWebView();
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && request.isForMainFrame()) {
                    mainFrameLoadFailed = true;
                    showErrorView();
                }
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_FILE_CHOOSER) return;
        if (filePathCallback == null) return;

        Uri[] results = null;
        if (resultCode == RESULT_OK) {
            results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        }
        filePathCallback.onReceiveValue(results);
        filePathCallback = null;
    }

    private boolean handleUrl(Uri uri) {
        String scheme = uri.getScheme();
        if (scheme == null) {
            return true;
        }

        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
            if (isApkDownload(uri)) {
                openExternal(uri);
                return true;
            }
            String host = uri.getHost();
            if (host != null && host.equalsIgnoreCase(appHost)) {
                return false;
            }
            openExternal(uri);
            return true;
        }

        if ("tel".equalsIgnoreCase(scheme)
                || "mailto".equalsIgnoreCase(scheme)
                || "sms".equalsIgnoreCase(scheme)) {
            openExternal(uri);
        }
        return true;
    }

    private boolean isApkDownload(Uri uri) {
        String path = uri.getPath();
        if (path == null) {
            return false;
        }
        return path.endsWith(".apk") || path.contains("/downloads/");
    }

    private void openExternal(Uri uri) {
        if (isApkDownload(uri)) {
            boolean started = new CpuAndroidBridge(this).downloadAndInstallApk(uri.toString(), "");
            if (started) {
                return;
            }
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            // Ignore unsupported schemes instead of breaking the schedule WebView.
        }
    }

    private LinearLayout createErrorView() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(dp(24), dp(24), dp(24), dp(24));
        layout.setBackgroundColor(Color.rgb(246, 248, 251));
        layout.setVisibility(View.GONE);

        TextView title = new TextView(this);
        title.setText("页面暂时无法打开");
        title.setTextColor(Color.rgb(15, 23, 42));
        title.setTextSize(20);
        title.setGravity(Gravity.CENTER);

        TextView message = new TextView(this);
        message.setText("请检查网络连接，或稍后重试。");
        message.setTextColor(Color.rgb(71, 85, 105));
        message.setTextSize(14);
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        messageParams.setMargins(0, dp(10), 0, dp(18));

        Button retry = new Button(this);
        retry.setText("重新打开课表");
        retry.setAllCaps(false);
        retry.setOnClickListener(v -> {
            mainFrameLoadFailed = false;
            showWebView();
            webView.loadUrl(BuildConfig.APP_URL);
        });

        layout.addView(title);
        layout.addView(message, messageParams);
        layout.addView(retry);
        return layout;
    }

    private LinearLayout createLaunchView() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setPadding(dp(24), dp(24), dp(24), dp(24));
        layout.setBackgroundResource(R.drawable.launch_background);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        logo.setAdjustViewBounds(true);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            logo.setElevation(dp(8));
        }
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(68), dp(68));
        logoParams.setMargins(0, 0, 0, dp(18));

        TextView title = new TextView(this);
        title.setText("药大拾间");
        title.setTextColor(Color.rgb(23, 32, 51));
        title.setTextSize(28);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        titleParams.setMargins(0, 0, 0, dp(10));

        TextView subtitle = new TextView(this);
        subtitle.setText("正在打开你的校园服务");
        subtitle.setTextColor(Color.rgb(102, 112, 133));
        subtitle.setTextSize(15);
        subtitle.setGravity(Gravity.CENTER);

        layout.addView(logo, logoParams);
        layout.addView(title, titleParams);
        layout.addView(subtitle);
        return layout;
    }

    private void showErrorView() {
        if (launchView != null) {
            launchView.setVisibility(View.GONE);
        }
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    private void showWebView() {
        if (launchView != null) {
            launchView.animate()
                    .alpha(0f)
                    .setDuration(180)
                    .withEndAction(() -> launchView.setVisibility(View.GONE))
                    .start();
        }
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    boolean ensureLegacyStoragePermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return true;
        }
        if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
            return true;
        }
        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQUEST_WRITE_STORAGE);
        return false;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
