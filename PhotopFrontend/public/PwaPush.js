// PWA install prompt + Web Push helpers for Memblu.
// Loaded before the app shell so `beforeinstallprompt` is captured early.

var PwaInstallPromptEvent = null;
var PwaPromptVisible = false;
var PwaSetupStarted = false;
var PwaPromptSeenKey = "PwaInstallPromptSeenV2";

window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault();
  PwaInstallPromptEvent = event;
});

window.addEventListener("appinstalled", function () {
  // Once installed there is no reason to ask again on this device.
  try {
    window.localStorage.setItem(PwaPromptSeenKey, "true");
  } catch (e) { }
  PwaInstallPromptEvent = null;
  ClosePwaInstallPrompt();
});

function PwaIsStandalone() {
  try {
    if (window.matchMedia && (window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: fullscreen)").matches || window.matchMedia("(display-mode: minimal-ui)").matches)) {
      return true;
    }
  } catch (e) { }
  if (window.navigator.standalone === true) {
    return true;
  }
  if (typeof document !== "undefined" && document.referrer && document.referrer.indexOf("android-app://") === 0) {
    return true;
  }
  return false;
}

function PwaIsIos() {
  var ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return true;
  }
  // iPadOS reports a desktop Safari user agent.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

function PwaIsMobile() {
  var ua = navigator.userAgent || "";
  if (PwaIsIos()) {
    return true;
  }
  return /Android|Mobile|Windows Phone|IEMobile|Opera Mini/i.test(ua);
}

// Best-effort in-app browser detection. Anything that looks like an embedded
// webview fails closed (no prompt).
function PwaIsEmbeddedWebview() {
  var ua = navigator.userAgent || "";
  var markers = [
    "Instagram", "FBAN", "FBAV", "FB_IAB", "FBBV", "FB4A",
    "musical_ly", "TikTok", "BytedanceWebview", "ByteLocale",
    "Snapchat", "Line/", "MicroMessenger", "LinkedInApp",
    "Twitter", "TwitterAndroid", "Messenger", "KAKAOTALK",
    "NAVER", "Discord", "Slack", "WhatsApp", "Pinterest"
  ];
  for (var i = 0; i < markers.length; i++) {
    if (ua.indexOf(markers[i]) != -1) {
      return true;
    }
  }

  // Android webviews append "; wv)" to the user agent.
  if (/Android/i.test(ua) && /;\s*wv\)/i.test(ua)) {
    return true;
  }

  // iOS WKWebViews omit the Safari/ token. Third-party iOS browsers keep it
  // (and add CriOS/FxiOS/EdgiOS), so they are not treated as webviews.
  if (PwaIsIos() && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua) && !/Safari\//i.test(ua) && !PwaIsStandalone()) {
    return true;
  }
  return false;
}

// Returns the platform key whose install steps should be shown, or null when
// the prompt must not be shown at all.
function PwaDetectPlatform() {
  var ua = navigator.userAgent || "";

  if (!PwaIsMobile() || PwaIsStandalone() || PwaIsEmbeddedWebview()) {
    return null;
  }
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    return null;
  }

  if (PwaIsIos()) {
    if (/CriOS/i.test(ua)) return "ios-chrome";
    if (/FxiOS/i.test(ua)) return "ios-firefox";
    if (/EdgiOS/i.test(ua)) return "ios-edge";
    if (/OPiOS/i.test(ua)) return "ios-opera";
    if (/Safari\//i.test(ua)) return "ios-safari";
    return null; // Unknown iOS browser: fail closed.
  }

  if (/SamsungBrowser/i.test(ua)) return "android-samsung";
  if (/EdgA/i.test(ua)) return "android-edge";
  if (/Firefox|FxiOS/i.test(ua)) return "android-firefox";
  if (/OPR\/|Opera/i.test(ua)) return "android-opera";
  if (/Chrome\//i.test(ua)) return "android-chrome";
  return null; // Unknown Android browser: fail closed.
}

function PwaPlatformContent(Platform) {
  if (Platform == "ios-safari") {
    return {
      title: "Install Memblu",
      intro: "Add Memblu to your Home Screen for a full-screen app and push notifications.",
      steps: [
        "Tap the <b>Share</b> button in Safari's toolbar.",
        "Scroll down and tap <b>Add to Home Screen</b>.",
        "Tap <b>Add</b> in the top-right corner."
      ],
      note: "Push notifications on iOS only work after Memblu has been added to the Home Screen (iOS 16.4 or newer)."
    };
  }
  if (Platform == "ios-chrome" || Platform == "ios-firefox" || Platform == "ios-edge" || Platform == "ios-opera") {
    return {
      title: "Install Memblu",
      intro: "This browser cannot install web apps on iOS. Open Memblu in Safari to add it to your Home Screen.",
      steps: [
        "Copy this page's address or use the browser's <b>Open in Safari</b> option.",
        "In Safari, tap the <b>Share</b> button.",
        "Tap <b>Add to Home Screen</b>, then <b>Add</b>."
      ],
      note: "Push notifications on iOS only work after the app is installed from Safari."
    };
  }
  if (Platform == "android-chrome") {
    return {
      title: "Install Memblu",
      intro: "Install Memblu for quick access and push notifications.",
      steps: [
        "Tap the <b>&#8942;</b> menu in Chrome's top-right corner.",
        "Tap <b>Install app</b> (or <b>Add to Home screen</b>).",
        "Confirm the installation."
      ],
      note: "Chrome will offer a one-tap install button when it is available."
    };
  }
  if (Platform == "android-samsung") {
    return {
      title: "Install Memblu",
      intro: "Install Memblu for quick access and push notifications.",
      steps: [
        "Tap the <b>&#9776;</b> menu in Samsung Internet.",
        "Tap <b>Add page to</b>, then <b>Home screen</b>.",
        "Tap <b>Add</b> to confirm."
      ],
      note: "Samsung Internet installs the app on your Home screen."
    };
  }
  if (Platform == "android-firefox") {
    return {
      title: "Install Memblu",
      intro: "Install Memblu for quick access and push notifications.",
      steps: [
        "Tap the <b>&#8942;</b> menu in Firefox.",
        "Tap <b>Install</b> or <b>Add to Home screen</b>.",
        "Confirm the installation."
      ],
      note: "Firefox will add Memblu to your Home screen."
    };
  }
  if (Platform == "android-edge") {
    return {
      title: "Install Memblu",
      intro: "Install Memblu for quick access and push notifications.",
      steps: [
        "Tap the <b>&#8942;</b> menu in Edge.",
        "Tap <b>Add to phone</b> (or <b>Install app</b>).",
        "Confirm the installation."
      ],
      note: "Edge will add Memblu to your Home screen."
    };
  }
  if (Platform == "android-opera") {
    return {
      title: "Install Memblu",
      intro: "Install Memblu for quick access and push notifications.",
      steps: [
        "Tap the <b>Opera</b> menu.",
        "Tap <b>Add to Home screen</b>.",
        "Confirm the installation."
      ],
      note: "Opera will add Memblu to your Home screen."
    };
  }
  return null;
}

function MarkPwaPromptSeen() {
  return; // The install prompt now shows on every launch; nothing is remembered.
  try {
    window.localStorage.setItem(PwaPromptSeenKey, "true");
  } catch (e) { }

  // Remember it on the account too, so a cleared browser does not ask again.
  try {
    if (typeof UserID !== "undefined" && UserID != null && typeof SendRequest === "function") {
      SendRequest("MarkInstallPromptSeen", {});
    }
  } catch (e) { }
}

function PwaServerSaysSeen() {
  return false; // Ignore the old per-account "seen" flag.
  try {
    return typeof Settings !== "undefined" && Settings != null && Settings.Notifications != null && Settings.Notifications.InstallPromptSeen === true;
  } catch (e) {
    return false;
  }
}

function ClosePwaInstallPrompt() {
  var Prompt = document.getElementById("PwaInstallPrompt");
  if (Prompt != null) {
    Prompt.remove();
  }
  PwaPromptVisible = false;
}

function ShowPwaInstallPrompt(Platform) {
  if (PwaPromptVisible) {
    return;
  }
  var Content = PwaPlatformContent(Platform);
  if (Content == null) {
    return;
  }
  PwaPromptVisible = true;

  var Backdrop = createElement("PwaInstallPrompt", "div", "body", [
    ["position", "fixed"],
    ["left", "0px"],
    ["top", "0px"],
    ["width", "100%"],
    ["height", "100%"],
    ["background-color", "rgba(0, 0, 0, 0.6)"],
    ["z-index", "1000"],
    ["display", "flex"],
    ["align-items", "flex-end"],
    ["justify-content", "center"]
  ]);
  Backdrop.addEventListener("click", function (event) {
    if (event.target == Backdrop) {
      MarkPwaPromptSeen();
      ClosePwaInstallPrompt();
    }
  });

  var Card = createElement("PwaInstallCard", "div", Backdrop, [
    ["position", "relative"],
    ["width", "100%"],
    ["max-width", "480px"],
    ["max-height", "85vh"],
    ["overflow-y", "auto"],
    ["background-color", LeftSidebarColor],
    ["border-top-left-radius", "16px"],
    ["border-top-right-radius", "16px"],
    ["padding", "16px"],
    ["box-sizing", "border-box"]
  ]);
  Card.className = "StandardScroll";

  createElement("PwaInstallTitle", "div", Card, [
    ["position", "relative"],
    ["font-size", "26px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "left"]
  ]).textContent = Content.title;

  createElement("PwaInstallIntro", "div", Card, [
    ["position", "relative"],
    ["margin-top", "6px"],
    ["font-size", "16px"],
    ["line-height", "22px"],
    ["font-family", FontTypeA],
    ["font-weight", "600"],
    ["color", "#bbbbbb"],
    ["text-align", "left"]
  ]).innerHTML = Content.intro;

  var Steps = createElement("PwaInstallSteps", "div", Card, [
    ["position", "relative"],
    ["margin-top", "12px"],
    ["padding", "8px"],
    ["background-color", ContentColor],
    ["border-radius", "12px"]
  ]);
  for (var i = 0; i < Content.steps.length; i++) {
    var Step = createElement("PwaInstallStep", "div", Steps, [
      ["position", "relative"],
      ["display", "flex"],
      ["align-items", "flex-start"],
      ["margin-top", i == 0 ? "0px" : "10px"]
    ]);
    createElement("PwaInstallStepNum", "div", Step, [
      ["position", "relative"],
      ["flex", "0 0 auto"],
      ["width", "26px"],
      ["height", "26px"],
      ["margin-right", "8px"],
      ["border-radius", "13px"],
      ["background-color", ThemeColor],

      // Text:
      ["font-size", "15px"],
      ["line-height", "26px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"],
      ["text-align", "center"]
    ]).textContent = String(i + 1);
    createElement("PwaInstallStepText", "div", Step, [
      ["position", "relative"],
      ["flex", "1 1 auto"],
      ["font-size", "16px"],
      ["line-height", "22px"],
      ["font-family", FontTypeA],
      ["font-weight", "600"],
      ["color", FontColorA],
      ["text-align", "left"]
    ]).innerHTML = Content.steps[i];
  }

  if (Content.note) {
    createElement("PwaInstallNote", "div", Card, [
      ["position", "relative"],
      ["margin-top", "12px"],
      ["font-size", "14px"],
      ["line-height", "19px"],
      ["font-family", FontTypeA],
      ["font-weight", "600"],
      ["font-style", "italic"],
      ["color", "#bbbbbb"],
      ["text-align", "left"]
    ]).innerHTML = Content.note;
  }

  var Buttons = createElement("PwaInstallButtons", "div", Card, [
    ["position", "relative"],
    ["display", "flex"],
    ["flex-wrap", "wrap"],
    ["gap", "8px"],
    ["margin-top", "16px"]
  ]);

  if (Platform == "android-chrome" && PwaInstallPromptEvent != null) {
    var InstallButton = createElement("PwaInstallNow", "div", Buttons, [
      ["position", "relative"],
      ["flex", "1 1 auto"],
      ["padding", "10px 14px"],
      ["background-color", ThemeColor],
      ["border-radius", "10px"],
      ["cursor", "pointer"],

      // Text:
      ["font-size", "18px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"],
      ["text-align", "center"]
    ]);
    InstallButton.textContent = "Install app";
    InstallButton.addEventListener("click", async function () {
      var Event = PwaInstallPromptEvent;
      PwaInstallPromptEvent = null;
      MarkPwaPromptSeen();
      ClosePwaInstallPrompt();
      if (Event != null) {
        try {
          Event.prompt();
          await Event.userChoice;
        } catch (e) { }
      }
    });
  }

  var DismissButton = createElement("PwaInstallDismiss", "div", Buttons, [
    ["position", "relative"],
    ["flex", "1 1 auto"],
    ["padding", "10px 14px"],
    ["background-color", ContentColorLayer3],
    ["border-radius", "10px"],
    ["cursor", "pointer"],

    // Text:
    ["font-size", "18px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "center"]
  ]);
  DismissButton.textContent = "Not now";
  DismissButton.addEventListener("click", function () {
    MarkPwaPromptSeen();
    ClosePwaInstallPrompt();
  });

  var Close = createElement("PwaInstallClose", "div", Card, [
    ["position", "absolute"],
    ["right", "10px"],
    ["top", "8px"],
    ["cursor", "pointer"],

    // Text:
    ["font-size", "30px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", "#bbbbbb"]
  ]);
  Close.innerHTML = "&times;";
  Close.setAttribute("title", "Close");
  Close.addEventListener("click", function () {
    MarkPwaPromptSeen();
    ClosePwaInstallPrompt();
  });
}

function SetupPwaInstallPrompt() {
  if (PwaSetupStarted) {
    return;
  }
  PwaSetupStarted = true;

  try {
    if (window.localStorage.getItem(PwaPromptSeenKey) == "true") {
      return;
    }
  } catch (e) { }

  if (PwaServerSaysSeen()) {
    try { window.localStorage.setItem(PwaPromptSeenKey, "true"); } catch (e) { }
    return;
  }

  setTimeout(function () {
    try {
      if (window.localStorage.getItem(PwaPromptSeenKey) == "true") {
        return;
      }
    } catch (e) { }
    if (PwaServerSaysSeen()) {
      try { window.localStorage.setItem(PwaPromptSeenKey, "true"); } catch (e) { }
      return;
    }
    var Platform = PwaDetectPlatform();
    if (Platform != null) {
      ShowPwaInstallPrompt(Platform);
    }
  }, 1800);
}

if (typeof window !== "undefined") {
  if (document.readyState == "complete" || document.readyState == "interactive") {
    setTimeout(SetupPwaInstallPrompt, 0);
  } else {
    window.addEventListener("load", function () {
      setTimeout(SetupPwaInstallPrompt, 0);
    });
  }
}

/* ── Web Push ─────────────────────────────────────────────────────────────── */

function PushGetPublicKey() {
  try {
    return (window.__PHOTOP_CONFIG__ && window.__PHOTOP_CONFIG__.vapidPublicKey) || "";
  } catch (e) {
    return "";
  }
}

function PushIsSupported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
}

function PushIosNeedsInstall() {
  return PwaIsIos() && !PwaIsStandalone();
}

function PushUrlBase64ToUint8Array(Base64String) {
  var Padding = "=".repeat((4 - (Base64String.length % 4)) % 4);
  var Base64 = (Base64String + Padding).replace(/-/g, "+").replace(/_/g, "/");
  var RawData = window.atob(Base64);
  var OutputArray = new Uint8Array(RawData.length);
  for (var i = 0; i < RawData.length; i++) {
    OutputArray[i] = RawData.charCodeAt(i);
  }
  return OutputArray;
}

async function PushRegisterServiceWorker() {
  var Registration = await navigator.serviceWorker.register("/Service-Worker.js");
  await navigator.serviceWorker.ready;
  return Registration;
}

async function PushGetSubscription() {
  if (!PushIsSupported()) {
    return null;
  }
  try {
    var Registration = await navigator.serviceWorker.getRegistration("/");
    if (Registration == null) {
      return null;
    }
    return await Registration.pushManager.getSubscription();
  } catch (e) {
    return null;
  }
}

// Must be called from a user gesture (button click), never on page load.
async function EnablePushNotifications(Callback) {
  function Done(Success, Reason) {
    if (typeof Callback === "function") {
      Callback(Success, Reason);
    }
  }

  if (PushIosNeedsInstall()) {
    Done(false, "ios-install");
    return;
  }
  if (!PushIsSupported()) {
    Done(false, "unsupported");
    return;
  }
  var PublicKey = PushGetPublicKey();
  if (!PublicKey) {
    Done(false, "no-key");
    return;
  }

  try {
    var Permission = Notification.permission;
    if (Permission == "default") {
      Permission = await Notification.requestPermission();
    }
    if (Permission != "granted") {
      Done(false, Permission == "denied" ? "denied" : "dismissed");
      return;
    }

    var Registration = await PushRegisterServiceWorker();
    var Existing = await Registration.pushManager.getSubscription();
    var Subscription = Existing;
    if (Subscription == null) {
      Subscription = await Registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: PushUrlBase64ToUint8Array(PublicKey)
      });
    }

    SendRequest("SubscribePush", {
      Subscription: Subscription.toJSON(),
      UserAgent: navigator.userAgent
    }, function (Metadata, Data) {
      if (Data != null && Data.Code == 200) {
        Done(true, "subscribed");
      } else {
        Done(false, "server");
      }
    });
  } catch (e) {
    console.error("Push subscription failed", e);
    Done(false, "error");
  }
}

async function DisablePushNotifications(Callback) {
  function Done(Success) {
    if (typeof Callback === "function") {
      Callback(Success);
    }
  }

  try {
    var Subscription = await PushGetSubscription();
    var Endpoint = Subscription != null ? Subscription.endpoint : null;
    if (Subscription != null) {
      await Subscription.unsubscribe();
    }
    if (typeof SendRequest === "function" && typeof UserID !== "undefined" && UserID != null) {
      SendRequest("UnsubscribePush", { Endpoint: Endpoint || "All" }, function (Metadata, Data) {
        Done(Data != null && Data.Code == 200);
      });
    } else {
      Done(true);
    }
  } catch (e) {
    console.error("Push unsubscribe failed", e);
    Done(false);
  }
}

/* ── One-time push permission prompt ──────────────────────────────────────── */

var PushPromptSeenKey = "PushPermissionPromptSeen";
var PushPromptScheduled = false;
var PushPromptVisible = false;

function PushPromptWasSeen() {
  try {
    return window.localStorage.getItem(PushPromptSeenKey) == "true";
  } catch (e) {
    return false;
  }
}

function PushPromptMarkSeen() {
  try {
    window.localStorage.setItem(PushPromptSeenKey, "true");
  } catch (e) { }
}

function ClosePushPrompt() {
  var Prompt = document.getElementById("PushPermissionPrompt");
  if (Prompt != null) {
    Prompt.remove();
  }
  PushPromptVisible = false;
}

function PushPromptEligible() {
  // Shown on every launch while eligible, so there is no "already seen" check here.
  if (!PushIsSupported() || !PushGetPublicKey()) {
    return false;
  }
  // iOS can only do push once installed to the Home Screen; the install prompt covers that.
  if (PwaIsEmbeddedWebview() || PushIosNeedsInstall()) {
    return false;
  }
  // Already granted or blocked: nothing to ask.
  if (Notification.permission != "default") {
    return false;
  }
  if (typeof UserID === "undefined" || UserID == null) {
    return false;
  }
  return true;
}

function ShowPushPrompt() {
  if (PushPromptVisible) {
    return;
  }
  PushPromptVisible = true;
  // Shown on every launch while the device is eligible; nothing is remembered.

  var Card = createElement("PushPermissionPrompt", "div", "body", [
    ["position", "fixed"],
    ["right", "12px"],
    ["bottom", "calc(12px + env(safe-area-inset-bottom, 0px))"],
    ["width", "calc(100% - 24px)"],
    ["max-width", "460px"],
    ["z-index", "1000"],
    ["background-color", LeftSidebarColor],
    ["border-radius", "20px"],
    ["padding", "24px"],
    ["box-sizing", "border-box"],
    ["box-shadow", "0px 4px 24px rgba(0, 0, 0, 0.45)"]
  ]);

  createElement("PushPermissionTitle", "div", Card, [
    ["position", "relative"],
    ["font-size", "28px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "left"]
  ]).textContent = "Turn on notifications?";

  createElement("PushPermissionIntro", "div", Card, [
    ["position", "relative"],
    ["margin-top", "8px"],
    ["font-size", "19px"],
    ["line-height", "27px"],
    ["font-family", FontTypeA],
    ["font-weight", "600"],
    ["color", "#bbbbbb"],
    ["text-align", "left"]
  ]).textContent = "Get notified about likes, replies and new followers, even when Memblu isn't open.";

  var Buttons = createElement("PushPermissionButtons", "div", Card, [
    ["position", "relative"],
    ["display", "flex"],
    ["gap", "12px"],
    ["margin-top", "22px"]
  ]);

  var EnableButton = createElement("PushPermissionEnable", "div", Buttons, [
    ["position", "relative"],
    ["flex", "1 1 auto"],
    ["padding", "15px 18px"],
    ["background-color", ThemeColor],
    ["border-radius", "12px"],
    ["cursor", "pointer"],
    ["font-size", "20px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", "#ffffff"],
    ["text-align", "center"]
  ]);
  EnableButton.textContent = "Enable";
  EnableButton.addEventListener("click", function () {
    EnableButton.textContent = "Working...";
    // Runs inside this click, so the browser allows the permission dialog.
    EnablePushNotifications(function (Success, Reason) {
      ClosePushPrompt();
      if (!Success && Reason == "denied" && typeof ShowPopUp === "function") {
        ShowPopUp("Push blocked", "Notifications are blocked in your browser. Re-enable them in your browser settings to receive push notifications.", [["OK", ThemeColor, null]]);
      }
    });
  });

  var LaterButton = createElement("PushPermissionLater", "div", Buttons, [
    ["position", "relative"],
    ["flex", "1 1 auto"],
    ["padding", "15px 18px"],
    ["background-color", ContentColorLayer3],
    ["border-radius", "12px"],
    ["cursor", "pointer"],
    ["font-size", "20px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "center"]
  ]);
  LaterButton.textContent = "Not now";
  LaterButton.addEventListener("click", ClosePushPrompt);
}

// Called after sign-in (AuthUpdate). Safe to call repeatedly.
function SetupPushPermissionPrompt() {
  if (PushPromptScheduled || !PushPromptEligible()) {
    return;
  }
  PushPromptScheduled = true;
  var Attempts = 0;

  function Attempt() {
    Attempts++;
    if (!PushPromptEligible()) {
      return;
    }
    // Don't stack on the install prompt or fire while the tab is in the background.
    if (PwaPromptVisible || document.hidden) {
      if (Attempts < 8) {
        setTimeout(Attempt, 6000);
      }
      return;
    }
    PushGetSubscription().then(function (Existing) {
      if (Existing == null) {
        ShowPushPrompt();
      }
    });
  }
  setTimeout(Attempt, 5000);
}

/* ── Push prompt diagnostics: open the site with ?pushdebug=1 ─────────────── */

var PushDebugRequested = false;
try { PushDebugRequested = /[?&]pushdebug(=|&|$)/.test(window.location.search); } catch (e) { }
var PushPromptTrace = [];

(function () {
  var OriginalSetup = SetupPushPermissionPrompt;
  SetupPushPermissionPrompt = function () {
    PushPromptTrace.push("SetupPushPermissionPrompt called (eligible=" + PushPromptEligible() + ", alreadyScheduled=" + PushPromptScheduled + ")");
    return OriginalSetup.apply(this, arguments);
  };
  var OriginalShow = ShowPushPrompt;
  ShowPushPrompt = function () {
    PushPromptTrace.push("ShowPushPrompt called");
    return OriginalShow.apply(this, arguments);
  };
})();

async function PushPromptDiagnosticText() {
  var Lines = [];
  var SignedIn = typeof UserID !== "undefined" && UserID != null;
  var Sub = null;
  try { Sub = await PushGetSubscription(); } catch (e) { }
  Lines.push("new code loaded: yes");
  Lines.push("secure context (https): " + window.isSecureContext);
  Lines.push("push supported by browser: " + PushIsSupported());
  Lines.push("server VAPID key present: " + !!PushGetPublicKey());
  Lines.push("notification permission: " + (typeof Notification !== "undefined" ? Notification.permission : "n/a"));
  Lines.push("already seen flag: " + PushPromptWasSeen());
  Lines.push("signed in: " + SignedIn);
  Lines.push("iOS needs install: " + PushIosNeedsInstall());
  Lines.push("looks like in-app webview: " + PwaIsEmbeddedWebview());
  Lines.push("install prompt open: " + PwaPromptVisible);
  Lines.push("existing push subscription: " + (Sub != null));
  Lines.push("tab hidden: " + document.hidden);
  Lines.push("setup scheduled: " + PushPromptScheduled);
  Lines.push("verdict: " + (PushPromptEligible() ? "ELIGIBLE (card should appear ~5s after sign-in)" : (PushPromptWasSeen() ? "NOT eligible: prompt was already shown on this browser (flag set)" : "NOT eligible (see the false/blocked line above)")));
  Lines.push("--- events ---");
  Lines.push(PushPromptTrace.length ? PushPromptTrace.join("\n") : "(none yet)");
  Lines.push("--- user agent ---");
  Lines.push(navigator.userAgent);
  return Lines.join("\n");
}

function ShowPushDiagnosticOverlay() {
  if (document.getElementById("PushDebugOverlay") != null) {
    return;
  }
  var Box = document.createElement("div");
  Box.id = "PushDebugOverlay";
  Box.style.cssText = "position:fixed;top:8px;left:8px;right:8px;max-height:70vh;overflow:auto;z-index:100000;background:rgba(0,0,0,0.92);color:#fff;font:12px/16px monospace;padding:10px;border-radius:10px;white-space:pre-wrap;box-sizing:border-box;";
  var Text = document.createElement("div");
  var Row = document.createElement("div");
  Row.style.cssText = "margin-top:8px;display:flex;gap:8px;";
  function Btn(Label, Fn) {
    var B = document.createElement("button");
    B.textContent = Label;
    B.style.cssText = "padding:6px 10px;font:12px monospace;cursor:pointer;";
    B.addEventListener("click", Fn);
    Row.appendChild(B);
  }
  Btn("Force-show the prompt card", function () {
    try { window.localStorage.removeItem(PushPromptSeenKey); } catch (e) { }
    PushPromptVisible = false;
    ShowPushPrompt();
  });
  Btn("Reset flag + re-run setup", function () {
    try { window.localStorage.removeItem(PushPromptSeenKey); } catch (e) { }
    PushPromptScheduled = false;
    SetupPushPermissionPrompt();
  });
  Btn("Close", function () { Box.remove(); });
  Box.appendChild(Text);
  Box.appendChild(Row);
  document.body.appendChild(Box);
  async function Refresh() {
    if (document.getElementById("PushDebugOverlay") == null) {
      return;
    }
    try { Text.textContent = await PushPromptDiagnosticText(); } catch (e) { Text.textContent = "diagnostic error: " + e; }
    setTimeout(Refresh, 2000);
  }
  Refresh();
}

if (PushDebugRequested) {
  // Wait for sign-in and the 5s prompt delay so the events list is meaningful.
  setTimeout(ShowPushDiagnosticOverlay, 8000);
}
