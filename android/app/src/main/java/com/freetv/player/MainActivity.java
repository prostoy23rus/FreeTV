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
import android.util.Xml;

import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.zip.GZIPInputStream;

public class MainActivity extends Activity {

    private WebView webView;
    private FrameLayout customViewContainer;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private View customView;
    private WebAppInterface webAppInterface;

    private long backPressedTime = 0;
    private Toast backToast;

    // EPG (Телепрограмма) структуры
    public static class EpgProgram {
        public long start;
        public long stop;
        public String title;
        public String desc;

        public EpgProgram(long start, long stop, String title, String desc) {
            this.start = start;
            this.stop = stop;
            this.title = title != null ? title : "";
            this.desc = desc != null ? desc : "";
        }
    }

    private final Map<String, List<EpgProgram>> epgDatabase = new HashMap<>();
    private final Map<String, String> channelLogos = new HashMap<>();
    private volatile boolean isEpgReady = false;

    private static final String DESKTOP_USER_AGENT = 
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

    public class WebAppInterface {
        private volatile boolean isFullscreen = false;

        @JavascriptInterface
        public void setFullscreenState(boolean fullscreen) {
            this.isFullscreen = fullscreen;
        }

        public boolean isFullscreen() {
            return isFullscreen;
        }

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
            if (getPackageName().endsWith(".tv")) return true;
            UiModeManager uiModeManager = (UiModeManager) getSystemService(UI_MODE_SERVICE);
            return uiModeManager != null && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        }

        @JavascriptInterface
        public String getEpgForChannel(String channelName, String tvgId, String group) {
            try {
                long now = System.currentTimeMillis();
                List<EpgProgram> programs = null;

                // 1. Поиск по точному tvgId
                if (tvgId != null && !tvgId.trim().isEmpty()) {
                    String normTvg = normalizeName(tvgId);
                    synchronized (epgDatabase) {
                        programs = epgDatabase.get(normTvg);
                    }
                }

                // 2. Поиск по нормализованному названию канала
                String normName = normalizeName(channelName);
                if (programs == null && !normName.isEmpty()) {
                    synchronized (epgDatabase) {
                        programs = epgDatabase.get(normName);
                    }
                }

                // 3. Поиск по частичному совпадению префикса
                if (programs == null && normName.length() >= 4) {
                    synchronized (epgDatabase) {
                        for (Map.Entry<String, List<EpgProgram>> entry : epgDatabase.entrySet()) {
                            String key = entry.getKey();
                            if (key.length() >= 4 && (key.startsWith(normName) || normName.startsWith(key))) {
                                programs = entry.getValue();
                                break;
                            }
                        }
                    }
                }

                JSONObject result = new JSONObject();

                if (programs != null && !programs.isEmpty()) {
                    EpgProgram current = null;
                    EpgProgram next = null;

                    for (int i = 0; i < programs.size(); i++) {
                        EpgProgram p = programs.get(i);
                        if (p.start <= now && p.stop > now) {
                            current = p;
                            if (i + 1 < programs.size()) {
                                next = programs.get(i + 1);
                            }
                            break;
                        } else if (p.start > now && current == null) {
                            current = p;
                            if (i + 1 < programs.size()) {
                                next = programs.get(i + 1);
                            }
                            break;
                        }
                    }

                    if (current != null) {
                        result.put("found", true);
                        result.put("title", current.title);
                        result.put("desc", current.desc.isEmpty() ? (group != null ? group : "") : current.desc);
                        result.put("start", current.start);
                        result.put("stop", current.stop);
                        if (next != null) {
                            result.put("nextTitle", next.title);
                            result.put("nextStart", next.start);
                        } else {
                            result.put("nextTitle", "");
                            result.put("nextStart", 0);
                        }
                        return result.toString();
                    }
                }

                // Умный динамический генератор сетки вещания по времени суток
                // (гарантирует, что плашка ЭФИР никогда не будет пустой)
                long slotMs = 45 * 60 * 1000L;
                long slotStart = now - (now % slotMs);
                long slotEnd = slotStart + slotMs;

                Calendar cal = Calendar.getInstance();
                int hour = cal.get(Calendar.HOUR_OF_DAY);

                String estimatedTitle;
                String nextTitle;
                String chGroup = (group != null && !group.isEmpty()) ? group : "Эфирные";

                if (chGroup.contains("Спорт")) {
                    if (hour >= 6 && hour < 12) estimatedTitle = "Утренний дайджест спорта";
                    else if (hour >= 12 && hour < 18) estimatedTitle = "Обзор матчей и турниров дня";
                    else if (hour >= 18 && hour < 23) estimatedTitle = "Прямой эфир: Главные события спорта";
                    else estimatedTitle = "Ночной спорт: Избранные моменты";
                    nextTitle = "Спортивный дневник";
                } else if (chGroup.contains("Кино") || chGroup.contains("Сериал")) {
                    if (hour >= 6 && hour < 12) estimatedTitle = "Утренний телесериал";
                    else if (hour >= 12 && hour < 17) estimatedTitle = "Художественный фильм";
                    else if (hour >= 17 && hour < 21) estimatedTitle = "Премьерный телесериал";
                    else if (hour >= 21) estimatedTitle = "Вечерний киносеанс: Блокбастер";
                    else estimatedTitle = "Ночной кинозал: Кинофильм";
                    nextTitle = "Художественный фильм";
                } else if (chGroup.contains("Детск") || chGroup.contains("Мульт")) {
                    if (hour >= 6 && hour < 14) estimatedTitle = "Утренний мультсериал";
                    else if (hour >= 14 && hour < 20) estimatedTitle = "Приключения любимых героев";
                    else estimatedTitle = "Спокойной ночи, малыши!";
                    nextTitle = "Мультфильм";
                } else if (chGroup.contains("Музык")) {
                    if (hour >= 6 && hour < 12) estimatedTitle = "Утренний плейлист: Лучшие хиты";
                    else if (hour >= 12 && hour < 18) estimatedTitle = "Музыкальный чарт ТОП-20";
                    else if (hour >= 18 && hour < 23) estimatedTitle = "Вечерний хит-парад";
                    else estimatedTitle = "Ночной нон-стоп: Музыка ночи";
                    nextTitle = "Горячие треки";
                } else if (chGroup.contains("Новост")) {
                    estimatedTitle = "Новости: Главное к этому часу";
                    nextTitle = "Информационный выпуск";
                } else {
                    if (hour >= 6 && hour < 10) estimatedTitle = "Утреннее информационно-развлекательное шоу";
                    else if (hour >= 10 && hour < 14) estimatedTitle = "Телевизионная программа";
                    else if (hour >= 14 && hour < 18) estimatedTitle = "Дневной эфир: Документальный проект";
                    else if (hour >= 18 && hour < 21) estimatedTitle = "Главный вечерний выпуск новостей";
                    else if (hour >= 21) estimatedTitle = "Вечернее ток-шоу";
                    else estimatedTitle = "Ночной эфир: Лучшие передачи";
                    nextTitle = "Информационно-развлекательный канал";
                }

                result.put("found", false);
                result.put("title", estimatedTitle);
                result.put("desc", "Категория: " + chGroup + " • Прямое вещание " + channelName);
                result.put("start", slotStart);
                result.put("stop", slotEnd);
                result.put("nextTitle", nextTitle);
                result.put("nextStart", slotEnd);
                return result.toString();

            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String getChannelLogo(String channelName, String tvgId) {
            String normTvg = tvgId != null ? normalizeName(tvgId) : "";
            synchronized (channelLogos) {
                if (!normTvg.isEmpty() && channelLogos.containsKey(normTvg)) {
                    return channelLogos.get(normTvg);
                }
                String norm = normalizeName(channelName);
                if (channelLogos.containsKey(norm)) {
                    return channelLogos.get(norm);
                }
            }
            return "";
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
        webAppInterface = new WebAppInterface();
        webView.addJavascriptInterface(webAppInterface, "AndroidBridge");

        webView.loadUrl("file:///android_asset/index.html");

        // Запуск фоновой загрузки и индексации телепрограммы (EPG)
        startEpgBackgroundLoader();
    }

    private String normalizeName(String str) {
        if (str == null) return "";
        return str.toLowerCase()
            .replaceAll("\\s*\\([^)]*\\)", "")
            .replaceAll("\\s*\\[[^\\]]*\\]", "")
            .replaceAll("(?i)\\b(hd|fhd|sd|hevc|50fps|uhd|4k|orig|full hd)\\b", "")
            .replaceAll("[^a-zа-я0-9]", "")
            .trim();
    }

    private long parseXmltvDate(String dateStr) {
        if (dateStr == null || dateStr.length() < 14) return 0;
        try {
            String base = dateStr.substring(0, 14);
            SimpleDateFormat sdf = new SimpleDateFormat("yyyyMMddHHmmss", Locale.US);
            if (dateStr.length() >= 19) {
                String tzStr = dateStr.substring(14).trim();
                sdf.setTimeZone(TimeZone.getTimeZone("GMT" + tzStr));
            } else {
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            }
            Date d = sdf.parse(base);
            return d != null ? d.getTime() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private void startEpgBackgroundLoader() {
        Thread epgThread = new Thread(() -> {
            try {
                File cacheFile = new File(getCacheDir(), "epg_lite.xml.gz");
                boolean needDownload = true;
                if (cacheFile.exists()) {
                    long age = System.currentTimeMillis() - cacheFile.lastModified();
                    if (age < 12 * 3600 * 1000L && cacheFile.length() > 100000) {
                        needDownload = false;
                    }
                }

                if (needDownload) {
                    URL url = new URL("https://iptvx.one/epg/epg_lite.xml.gz");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestProperty("User-Agent", DESKTOP_USER_AGENT);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    conn.connect();

                    if (conn.getResponseCode() == 200) {
                        File tempFile = new File(getCacheDir(), "epg_lite.xml.gz.tmp");
                        try (InputStream in = conn.getInputStream();
                             FileOutputStream out = new FileOutputStream(tempFile)) {
                            byte[] buffer = new byte[32768];
                            int len;
                            while ((len = in.read(buffer)) != -1) {
                                out.write(buffer, 0, len);
                            }
                        }
                        if (tempFile.length() > 100000) {
                            if (cacheFile.exists()) cacheFile.delete();
                            tempFile.renameTo(cacheFile);
                        }
                    }
                }

                if (!cacheFile.exists()) return;

                parseEpgXmlGz(cacheFile);

            } catch (Exception e) {
                e.printStackTrace();
            }
        });
        epgThread.setPriority(Thread.MIN_PRIORITY);
        epgThread.start();
    }

    private void parseEpgXmlGz(File file) {
        FileInputStream fis = null;
        GZIPInputStream gzis = null;
        try {
            fis = new FileInputStream(file);
            gzis = new GZIPInputStream(fis);

            XmlPullParser parser = Xml.newPullParser();
            parser.setInput(gzis, "UTF-8");

            Map<String, List<String>> channelIdToNames = new HashMap<>();
            long now = System.currentTimeMillis();
            long windowStart = now - 2 * 3600 * 1000L;
            long windowEnd = now + 14 * 3600 * 1000L;

            int eventType = parser.getEventType();
            String currentTag = "";
            String currentChannelId = "";
            List<String> currentNames = null;

            String progStartStr = null;
            String progStopStr = null;
            String progChannel = null;
            String progTitle = null;
            String progDesc = null;

            while (eventType != XmlPullParser.END_DOCUMENT) {
                if (eventType == XmlPullParser.START_TAG) {
                    currentTag = parser.getName();
                    if ("channel".equals(currentTag)) {
                        currentChannelId = parser.getAttributeValue(null, "id");
                        currentNames = new ArrayList<>();
                        String normId = normalizeName(currentChannelId);
                        if (!normId.isEmpty()) currentNames.add(normId);
                    } else if ("icon".equals(currentTag)) {
                        String src = parser.getAttributeValue(null, "src");
                        if (src != null && !src.isEmpty() && currentNames != null) {
                            for (String n : currentNames) {
                                synchronized (channelLogos) {
                                    if (!channelLogos.containsKey(n)) {
                                        channelLogos.put(n, src);
                                    }
                                }
                            }
                        }
                    } else if ("programme".equals(currentTag)) {
                        progStartStr = parser.getAttributeValue(null, "start");
                        progStopStr = parser.getAttributeValue(null, "stop");
                        progChannel = parser.getAttributeValue(null, "channel");
                        progTitle = "";
                        progDesc = "";
                    }
                } else if (eventType == XmlPullParser.TEXT) {
                    String text = parser.getText();
                    if (text != null) {
                        text = text.trim();
                        if ("display-name".equals(currentTag) && currentNames != null) {
                            String norm = normalizeName(text);
                            if (!norm.isEmpty() && !currentNames.contains(norm)) {
                                currentNames.add(norm);
                            }
                        } else if ("title".equals(currentTag)) {
                            progTitle = text;
                        } else if ("desc".equals(currentTag)) {
                            progDesc = text;
                        }
                    }
                } else if (eventType == XmlPullParser.END_TAG) {
                    String endTag = parser.getName();
                    if ("channel".equals(endTag)) {
                        if (currentChannelId != null && currentNames != null) {
                            channelIdToNames.put(currentChannelId, currentNames);
                        }
                        currentChannelId = "";
                        currentNames = null;
                    } else if ("programme".equals(endTag)) {
                        if (progChannel != null && progStartStr != null && progStopStr != null) {
                            long start = parseXmltvDate(progStartStr);
                            long stop = parseXmltvDate(progStopStr);
                            if (stop >= windowStart && start <= windowEnd) {
                                List<String> names = channelIdToNames.get(progChannel);
                                if (names == null) {
                                    names = Collections.singletonList(normalizeName(progChannel));
                                }
                                EpgProgram program = new EpgProgram(start, stop, progTitle, progDesc);
                                synchronized (epgDatabase) {
                                    for (String n : names) {
                                        if (n.isEmpty()) continue;
                                        List<EpgProgram> list = epgDatabase.get(n);
                                        if (list == null) {
                                            list = new ArrayList<>();
                                            epgDatabase.put(n, list);
                                        }
                                        list.add(program);
                                    }
                                }
                            }
                        }
                        progChannel = null;
                    }
                    currentTag = "";
                }
                eventType = parser.next();
            }

            synchronized (epgDatabase) {
                for (List<EpgProgram> list : epgDatabase.values()) {
                    Collections.sort(list, (a, b) -> Long.compare(a.start, b.start));
                }
            }

            isEpgReady = true;

            runOnUiThread(() -> {
                if (webView != null) {
                    webView.evaluateJavascript("if (window.freeTV && window.freeTV.onEpgReady) window.freeTV.onEpgReady();", null);
                }
            });

        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            try {
                if (gzis != null) gzis.close();
                if (fis != null) fis.close();
            } catch (Exception ignored) {}
        }
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

            // Меню / Информация на пульте Android TV
            if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_INFO || keyCode == KeyEvent.KEYCODE_GUIDE) {
                dispatchJsEvent("Menu");
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

            // Кнопка Назад (выход из полноэкранного режима или двойное нажатие для выхода)
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                if (customView != null) {
                    if (webView != null && webView.getWebChromeClient() != null) {
                        webView.getWebChromeClient().onHideCustomView();
                    }
                    return true;
                }
                if (webAppInterface != null && webAppInterface.isFullscreen()) {
                    dispatchJsEvent("Escape");
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
        if (webAppInterface != null && webAppInterface.isFullscreen()) {
            dispatchJsEvent("Escape");
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
