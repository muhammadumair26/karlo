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
        // Ask native for the side-strip size on every page load (the page reloads after a deploy).
        let ready = "document.addEventListener('DOMContentLoaded',function(){window.webkit.messageHandlers.karloRail.postMessage('ready')})"
        controller.addUserScript(WKUserScript(source: ready, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.add(self, name: "karloRail")
    }

    /// Width of the one-sided strip (the iPhone Duo's clock column). The page turns its controls into a side rail there.
    private var rail: CGFloat = 0
    func applyRail(_ width: CGFloat) {
        rail = width
        let w = Int(width.rounded())
        let js = "(function(){var h=document.documentElement;h.classList.toggle('side-rail',\(w)>0);h.style.setProperty('--rail','\(w)px')})()"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "karloRail" { applyRail(rail); return }
        let title = (message.body as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Unlock Karlo"
        LAContext().evaluatePolicy(.deviceOwnerAuthentication, localizedReason: title) { ok, err in
            let reason = ok ? "" : (err?.localizedDescription ?? "")
            let quoted = String(data: try! JSONSerialization.data(withJSONObject: [reason]), encoding: .utf8)!
            let js = "window.dispatchEvent(new CustomEvent('karlo:unlock',{detail:{ok:\(ok ? "true" : "false"),reason:\(quoted)[0]}}))"
            DispatchQueue.main.async { self.webView?.evaluateJavaScript(js, completionHandler: nil) }
        }
    }
}

/// Scene-based startup (required by current iOS). The window and Karlo's view controller come from Main.storyboard.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        if let url = connectionOptions.urlContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
        if let activity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}

/// Holds Karlo's screen. On a one-sided strip (the iPhone Duo's clock and camera column) the page runs full
/// width and is told the strip's size, so it can put its buttons there like a side rail (as Trello does).
/// Ordinary iPhones have no one-sided strip, so nothing changes there.
class KarloContainerViewController: UIViewController {
    private let karlo = KarloViewController()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        addChild(karlo)
        view.addSubview(karlo.view)
        karlo.didMove(toParent: self)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let i = view.safeAreaInsets
        // The page's rail sits on the right. A strip on the left (device turned round) is simply kept clear.
        // Ordinary iPhones turned sideways have equal margins on both sides: full width, no rail.
        let leftOnly = i.left > 0 && i.right == 0
        karlo.view.frame = leftOnly ? view.bounds.inset(by: UIEdgeInsets(top: 0, left: i.left, bottom: 0, right: 0)) : view.bounds
        karlo.applyRail(i.right > 0 && i.left == 0 ? i.right : 0)
    }

    private var hasSideStrip: Bool { (view.safeAreaInsets.left > 0) != (view.safeAreaInsets.right > 0) }
    // With a side rail the clock sits over the dark scrim, so keep it white; otherwise the page decides.
    override var childForStatusBarStyle: UIViewController? { hasSideStrip ? nil : karlo }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        setNeedsStatusBarAppearanceUpdate()
    }
    override var childForStatusBarHidden: UIViewController? { karlo }
}
