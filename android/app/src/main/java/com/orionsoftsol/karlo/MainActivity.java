package com.orionsoftsol.karlo;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean passkeys = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        // Passkeys (Face / fingerprint / screen lock) inside the app, through Android's Credential Manager.
        // The website's assetlinks.json lets this app use karlo.orionsoftsol.com passkeys.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(settings, WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);
            passkeys = true;
        }
        webView.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public boolean passkeys() { return passkeys; }
        }, "KarloNative");
    }
}
