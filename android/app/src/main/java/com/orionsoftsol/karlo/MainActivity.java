package com.orionsoftsol.karlo;

import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean passkeys = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        // Karlo blue behind the page while it loads, so opening the app never flashes white.
        webView.setBackgroundColor(0xFF1D4ED8);
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

            /** True when the phone has a fingerprint, face or screen lock that can unlock Karlo. */
            @JavascriptInterface
            public boolean canLock() {
                return BiometricManager.from(MainActivity.this).canAuthenticate(LOCK_AUTH) == BiometricManager.BIOMETRIC_SUCCESS;
            }

            /** Shows the phone's own fingerprint / face / PIN prompt; the answer arrives as a "karlo:unlock" event. */
            @JavascriptInterface
            public void unlock(String title) {
                runOnUiThread(() -> showUnlockPrompt(title));
            }

            /** True when this build has Firebase set up (google-services.json), so phone notifications can work. */
            @JavascriptInterface
            public boolean firebase() {
                return getResources().getIdentifier("google_app_id", "string", getPackageName()) != 0;
            }
        }, "KarloNative");
    }

    private static final int LOCK_AUTH = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    private void sendUnlockResult(boolean ok, String reason) {
        String js = "window.dispatchEvent(new CustomEvent('karlo:unlock',{detail:{ok:" + ok + ",reason:" + org.json.JSONObject.quote(reason) + "}}))";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }

    private void showUnlockPrompt(String title) {
        BiometricPrompt prompt = new BiometricPrompt(this, ContextCompat.getMainExecutor(this), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) { sendUnlockResult(true, ""); }

            @Override
            public void onAuthenticationError(int code, CharSequence message) { sendUnlockResult(false, String.valueOf(message)); }
        });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title == null || title.isEmpty() ? "Unlock Karlo" : title)
            .setSubtitle("Use your fingerprint, face or screen lock")
            .setAllowedAuthenticators(LOCK_AUTH)
            .build();
        prompt.authenticate(info);
    }
}
