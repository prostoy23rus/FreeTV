package com.freetv.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.res.AssetManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {

    private WebView webView;
    private FrameLayout customViewContainer;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private View customView;

    private long backPressedTime = 0;
    private Toast backToast;

    private static final String DESKTOP_USER_AGENT = 
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

    public class WebAppInterface {
        @JavascriptInterface
        public String getBundledPlaylist() {
            try {
                AssetManager am = getAssets();
                InputStream is = am.open("freetv_playlist.m3u");
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] temp = new byte[16384];
                int read;
                while ((read = is.read(temp)) != -1) {
                    buffer.write(temp, 0, read);
                }
                buffer.flush();
                is.close();
                return buffer.toString("UTF-8");
            } catch (Exception e) {
                e.printStackTrace();
                return "";
            }
        }

        @JavascriptInterface
        public String fetchUrl(String urlString) {
            try {
                URL url = new URL(urlString);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", DESKTOP_USER_AGENT);
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(12000);
                conn.connect();

                InputStream is = conn.getInputStream();
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] temp = new byte[16384];
                int read;
                while ((read = is.read(temp)) != -1) {
                    buffer.write(temp, 0, read);
                }
                buffer.flush();
                is.close();
                return buffer.toString("UTF-8");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public boolean isAndroidTv() {
            UiModeManager uiModeManager = (UiModeManager) getSystemService(UI_MODE_SERVICE);
            return uiModeManager != null && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        }
    }

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Полноэкранный режим на весь экран смартфона без черных полос у выреза/челки камеры
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            if (Build.VERSION.SDK_INT >= 30) {
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            } else {
                lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            }
            getWindow().setAttributes(lp);
        }

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

        // Добавляем нативный мост для мгновенного доступа к плейлисту и сети
        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");

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

        settings.setUserAgentString(DESKTOP_USER_AGENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.setBackgroundColor(0xFF070D18);
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
    }

    private void setupWebViewClients() {
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();

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

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();

            // Если отображается нативное полноэкранное видео
            if (customView != null) {
                if (keyCode == KeyEvent.KEYCODE_BACK) {
                    if (webView != null && webView.getWebChromeClient() != null) {
                        webView.getWebChromeClient().onHideCustomView();
                    }
                    return true;
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_UP || keyCode == KeyEvent.KEYCODE_CHANNEL_UP) {
                    dispatchJsEvent("ArrowUp");
                    return true;
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN || keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN) {
                    dispatchJsEvent("ArrowDown");
                    return true;
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER) {
                    dispatchJsEvent(" ");
                    return true;
                }
            }

            // Выделенные кнопки каналов на пультах Android TV
            if (keyCode == KeyEvent.KEYCODE_CHANNEL_UP || keyCode == KeyEvent.KEYCODE_PAGE_UP) {
                dispatchJsEvent("ChannelUp");
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_CHANNEL_DOWN || keyCode == KeyEvent.KEYCODE_PAGE_DOWN) {
                dispatchJsEvent("ChannelDown");
                return true;
            }

            // Медиа-кнопки пульта
            if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
                dispatchJsEvent("MediaPlayPause");
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY) {
                dispatchJsEvent("MediaPlay");
                return true;
            }
            if (keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE || keyCode == KeyEvent.KEYCODE_MEDIA_STOP) {
                dispatchJsEvent("MediaPause");
                return true;
            }

            // Цифры 0-9 (прямой ввод номера канала с пульта)
            if (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9) {
                char digit = (char) ('0' + (keyCode - KeyEvent.KEYCODE_0));
                dispatchJsEvent(String.valueOf(digit));
                return true;
            }

            // Кнопка Назад (двойное нажатие для чистого выхода из приложения)
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                if (customView != null) {
                    if (webView != null && webView.getWebChromeClient() != null) {
                        webView.getWebChromeClient().onHideCustomView();
                    }
                    return true;
                }
                long now = System.currentTimeMillis();
                if (now - backPressedTime < 2000) {
                    if (backToast != null) backToast.cancel();
                    finishAffinity();
                    return true;
                } else {
                    backPressedTime = now;
                    backToast = Toast.makeText(this, "Нажмите «Назад» ещё раз для выхода", Toast.LENGTH_SHORT);
                    backToast.show();
                    dispatchJsEvent("Escape");
                    return true;
                }
            }
        }

        // DPAD_UP, DPAD_DOWN, DPAD_LEFT, DPAD_RIGHT, DPAD_CENTER передаются в WebView для стандартного перемещения фокуса!
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
        long now = System.currentTimeMillis();
        if (now - backPressedTime < 2000) {
            if (backToast != null) backToast.cancel();
            finishAffinity();
        } else {
            backPressedTime = now;
            backToast = Toast.makeText(this, "Нажмите «Назад» ещё раз для выхода", Toast.LENGTH_SHORT);
            backToast.show();
            dispatchJsEvent("Escape");
        }
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
