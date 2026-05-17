package cn.lizmt.cpuweb.schedule;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private WebView webView;
    private LinearLayout errorView;
    private String appHost;
    private boolean mainFrameLoadFailed;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        appHost = Uri.parse(BuildConfig.APP_URL).getHost();

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        errorView = createErrorView();

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));
        root.addView(errorView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(root);
        configureWebView();
        webView.loadUrl(BuildConfig.APP_URL);
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
        settings.setMediaPlaybackRequiresUserGesture(false);
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

        webView.setWebChromeClient(new WebChromeClient());
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
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
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

    private void showErrorView() {
        webView.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
    }

    private void showWebView() {
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
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
