package com.freetv.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.InputStream;

public class MainActivity extends Activity {

    private WebView webView;
    private FrameLayout customViewContainer;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private View customView;

    private static final String DESKTOP_USER_AGENT = 
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Полноэкранный режим и запрет отключения экрана при воспроизведении
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUI();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF070D18);

        webView = new WebView(this);
        customViewContainer = new FrameLayout(this);
        customViewContainer.setVisibility(View.GONE);

        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(customViewContainer, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        setContentView(root);

        initWebViewSettings();
        setupWebViewClients();

        // Загрузка локального приложения
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            View decorView = getWindow().getDecorView();
            decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUI();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void initWebViewSettings() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);

        // Эмуляция User-Agent для стабильного открытия защищенных потоков без 400 ошибок
        settings.setUserAgentString(DESKTOP_USER_AGENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.setBackgroundColor(0xFF070D18);
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
    }

    private void setupWebViewClients() {
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();

                // Автоматическая подстановка встроенного плейлиста из assets
                if (path != null && path.endsWith("freetv_playlist.m3u")) {
                    try {
                        AssetManager am = getAssets();
                        InputStream is = am.open("freetv_playlist.m3u");
                        return new WebResourceResponse("audio/x-mpegurl", "UTF-8", is);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Разрешаем стримы с самоподписанными или устаревшими SSL сертификатами
                handler.proceed();
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                webView.setVisibility(View.GONE);
                customViewContainer.addView(view);
                customViewContainer.setVisibility(View.VISIBLE);
                hideSystemUI();
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                customViewContainer.removeView(customView);
                customViewContainer.setVisibility(View.GONE);
                customView = null;
                if (customViewCallback != null) {
                    customViewCallback.onCustomViewHidden();
                    customViewCallback = null;
                }
                webView.setVisibility(View.VISIBLE);
                hideSystemUI();
            }
        });
    }

    /**
     * Обработка клавиш пульта дистанционного управления Android TV
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_UP:
                case KeyEvent.KEYCODE_CHANNEL_UP:
                case KeyEvent.KEYCODE_PAGE_UP:
                    dispatchJsEvent("ChannelUp");
                    return true;

                case KeyEvent.KEYCODE_DPAD_DOWN:
                case KeyEvent.KEYCODE_CHANNEL_DOWN:
                case KeyEvent.KEYCODE_PAGE_DOWN:
                    dispatchJsEvent("ChannelDown");
                    return true;

                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    dispatchJsEvent("Enter");
                    return true;

                case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                    dispatchJsEvent("MediaPlayPause");
                    return true;

                case KeyEvent.KEYCODE_MEDIA_PLAY:
                    dispatchJsEvent("MediaPlay");
                    return true;

                case KeyEvent.KEYCODE_MEDIA_PAUSE:
                case KeyEvent.KEYCODE_MEDIA_STOP:
                    dispatchJsEvent("MediaPause");
                    return true;

                case KeyEvent.KEYCODE_0:
                case KeyEvent.KEYCODE_1:
                case KeyEvent.KEYCODE_2:
                case KeyEvent.KEYCODE_3:
                case KeyEvent.KEYCODE_4:
                case KeyEvent.KEYCODE_5:
                case KeyEvent.KEYCODE_6:
                case KeyEvent.KEYCODE_7:
                case KeyEvent.KEYCODE_8:
                case KeyEvent.KEYCODE_9:
                    char digit = (char) ('0' + (keyCode - KeyEvent.KEYCODE_0));
                    dispatchJsEvent(String.valueOf(digit));
                    return true;

                case KeyEvent.KEYCODE_BACK:
                    if (customView != null) {
                        ((WebChromeClient) webView.getWebChromeClient()).onHideCustomView();
                        return true;
                    }
                    dispatchJsEvent("Escape");
                    return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private void dispatchJsEvent(String keyName) {
        if (webView == null) return;
        String js = "window.dispatchEvent(new KeyboardEvent('keydown', { key: '" + keyName + "', bubbles: true }));";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.evaluateJavascript(js, null);
        } else {
            webView.loadUrl("javascript:" + js);
        }
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            if (webView != null && webView.getWebChromeClient() != null) {
                webView.getWebChromeClient().onHideCustomView();
            }
            return;
        }
        dispatchJsEvent("Escape");
        super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        hideSystemUI();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
