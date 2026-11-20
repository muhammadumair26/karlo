import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

import LocalAuthentication
import WebKit

/// Karlo's web view: adds `window.KarloNative` (as on Android) so the page can offer App lock with Face ID / Touch ID / passcode.
class KarloViewController: CAPBridgeViewController, WKScriptMessageHandler {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let controller = webView?.configuration.userContentController else { return }
        var error: NSError?
        let canLock = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        let js = """
        window.KarloNative = {
          passkeys: function () { return false; },
          firebase: function () { return false; },
          canLock: function () { return \(canLock ? "true" : "false"); },
          unlock: function (title) { window.webkit.messageHandlers.karloUnlock.postMessage(String(title || '')); }
        };
        """
        controller.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.add(self, name: "karloUnlock")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let title = (message.body as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Unlock Karlo"
        LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: title) { ok, err in
            let reason = ok ? "" : (err?.localizedDescription ?? "")
            let quoted = String(data: try! JSONSerialization.data(withJSONObject: [reason]), encoding: .utf8)!
            let js = "window.dispatchEvent(new CustomEvent('karlo:unlock',{detail:{ok:\(ok ? "true" : "false"),reason:\(quoted)[0]}}))"
            DispatchQueue.main.async { self.webView?.evaluateJavaScript(js, completionHandler: nil) }
        }
    }
}
