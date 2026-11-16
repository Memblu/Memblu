#!/usr/bin/env python3
"""Run from the repo root:  python3 apply_memblu_fixes.py
Idempotent, line-ending safe. Prints what it did for each edit."""
import os, sys

def find(rel):
    for base in (".", "Memblu", "PhotopRevival"):
        p = os.path.join(base, rel)
        if os.path.exists(p):
            return p
    return None

PUSH_BLOCK = r'''
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
  if (PushPromptWasSeen()) {
    return false;
  }
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
  if (PushPromptVisible || PushPromptWasSeen()) {
    return;
  }
  PushPromptVisible = true;
  // One time only: showing it counts, whether it gets accepted, dismissed or ignored.
  PushPromptMarkSeen();

  var Card = createElement("PushPermissionPrompt", "div", "body", [
    ["position", "fixed"],
    ["right", "12px"],
    ["bottom", "calc(12px + env(safe-area-inset-bottom, 0px))"],
    ["width", "calc(100% - 24px)"],
    ["max-width", "360px"],
    ["z-index", "1000"],
    ["background-color", LeftSidebarColor],
    ["border-radius", "16px"],
    ["padding", "16px"],
    ["box-sizing", "border-box"],
    ["box-shadow", "0px 4px 24px rgba(0, 0, 0, 0.45)"]
  ]);

  createElement("PushPermissionTitle", "div", Card, [
    ["position", "relative"],
    ["font-size", "22px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "left"]
  ]).textContent = "Turn on notifications?";

  createElement("PushPermissionIntro", "div", Card, [
    ["position", "relative"],
    ["margin-top", "6px"],
    ["font-size", "16px"],
    ["line-height", "22px"],
    ["font-family", FontTypeA],
    ["font-weight", "600"],
    ["color", "#bbbbbb"],
    ["text-align", "left"]
  ]).textContent = "Get notified about likes, replies and new followers, even when Memblu isn't open.";

  var Buttons = createElement("PushPermissionButtons", "div", Card, [
    ["position", "relative"],
    ["display", "flex"],
    ["gap", "8px"],
    ["margin-top", "14px"]
  ]);

  var EnableButton = createElement("PushPermissionEnable", "div", Buttons, [
    ["position", "relative"],
    ["flex", "1 1 auto"],
    ["padding", "10px 14px"],
    ["background-color", ThemeColor],
    ["border-radius", "10px"],
    ["cursor", "pointer"],
    ["font-size", "17px"],
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
    ["padding", "10px 14px"],
    ["background-color", ContentColorLayer3],
    ["border-radius", "10px"],
    ["cursor", "pointer"],
    ["font-size", "17px"],
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
'''

DEBUG_BLOCK = r'''
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
'''

EDITS = [
 # (file, label, old, new, marker that proves it's already applied)
 ("PhotopFrontend/public/Notifications.js", "pfp fix (clear before append)",
  'Avatar.appendChild(Img);\n    Avatar.textContent = "";',
  'Avatar.textContent = "";\n    Avatar.appendChild(Img);',
  'Avatar.textContent = "";\n    Avatar.appendChild(Img);'),

 ("PhotopFrontend/public/Notifications.js", "reply text (in-app)",
  'case "ChatPost": return { Title: Name, Body: (Notification.Preview || (Name + " replied to your post.")), Icon: "Chat" };',
  'case "ChatPost": return { Title: "New reply", Body: (Notification.Preview ? (Name + " replied to your post: \\"" + Notification.Preview + "\\"") : (Name + " replied to your post.")), Icon: "Chat" };',
  'Title: "New reply"'),

 ("PhotopBackend/src/notifications.ts", "reply text (push)",
  'title = actor;\n      body = preview ? preview : `${actor} chatted on your post`;',
  'title = "New reply";\n      body = preview ? `${actor} replied to your post: "${preview}"` : `${actor} replied to your post`;',
  'title = "New reply"'),

 ("PhotopFrontend/public/BridgeConnect.js", "ReportVisibility signature",
  'function ReportVisibility() {',
  'function ReportVisibility(Event) {',
  'function ReportVisibility(Event)'),

 ("PhotopFrontend/public/BridgeConnect.js", "focus-aware visibility",
  'SendRequest("UpdateVisibility", { Visible: !document.hidden }, function () { });',
  'var Visible = !document.hidden;\n'
  '      // On mobile, a tab only counts as "being used" when it is visible AND focused.\n'
  '      if (Visible && DeviceIsMobile() && typeof document.hasFocus == "function") {\n'
  '        Visible = document.hasFocus();\n'
  '      }\n'
  '      if (Event && Event.type == "pagehide") {\n'
  '        Visible = false;\n'
  '      }\n'
  '      SendRequest("UpdateVisibility", { Visible: Visible }, function () { });',
  'var Visible = !document.hidden;'),

 ("PhotopFrontend/public/BridgeConnect.js", "pageshow + 20s re-report",
  'window.addEventListener("pagehide", ReportVisibility);',
  'window.addEventListener("pagehide", ReportVisibility);\n'
  '    window.addEventListener("pageshow", ReportVisibility);\n'
  '    // The server expires "active" after 45s without a signal, so keep it fresh.\n'
  '    setInterval(ReportVisibility, 20000);',
  'setInterval(ReportVisibility, 20000);'),

 ("PhotopFrontend/public/BridgeConnect.js", "report on socket open",
  'Socket.onopen = async function() {',
  'Socket.onopen = async function() {\n    ReportVisibility();',
  'Socket.onopen = async function() {\n    ReportVisibility();'),
 ("PhotopFrontend/public/PwaPush.js", "one-time push permission prompt",
  None, PUSH_BLOCK, 'function SetupPushPermissionPrompt()'),

 ("PhotopFrontend/public/BridgeConnect.js", "trigger push prompt after sign-in",
  'SetupPwaInstallPrompt();',
  'SetupPwaInstallPrompt();\n    }\n    if (typeof SetupPushPermissionPrompt == "function") {\n      SetupPushPermissionPrompt();',
  'SetupPushPermissionPrompt();'),
 ("PhotopFrontend/public/PwaPush.js", "push prompt diagnostics (?pushdebug=1)",
  None, DEBUG_BLOCK, 'var PushPromptTrace = [];'),

 # ── v2: prompts show on every launch ───────────────────────────────────────
 ("PhotopFrontend/public/PwaPush.js", "push prompt: every launch (eligibility)",
  '  if (PushPromptWasSeen()) {\n    return false;\n  }\n  if (!PushIsSupported() || !PushGetPublicKey()) {',
  '  // Shown on every launch while eligible, so there is no "already seen" check here.\n  if (!PushIsSupported() || !PushGetPublicKey()) {',
  'Shown on every launch while eligible'),

 ("PhotopFrontend/public/PwaPush.js", "push prompt: every launch (show)",
  '  if (PushPromptVisible || PushPromptWasSeen()) {',
  '  if (PushPromptVisible) {',
  'function ShowPushPrompt() {\n  if (PushPromptVisible) {'),

 ("PhotopFrontend/public/PwaPush.js", "push prompt: stop remembering it was shown",
  '  // One time only: showing it counts, whether it gets accepted, dismissed or ignored.\n  PushPromptMarkSeen();',
  '  // Shown on every launch while the device is eligible; nothing is remembered.',
  'Shown on every launch while the device is eligible; nothing is remembered.'),

 ("PhotopFrontend/public/PwaPush.js", "install prompt: fresh storage key (ignores old dismissals)",
  'var PwaPromptSeenKey = "PwaInstallPromptSeen";',
  'var PwaPromptSeenKey = "PwaInstallPromptSeenV2";',
  'PwaInstallPromptSeenV2'),

 ("PhotopFrontend/public/PwaPush.js", "install prompt: never remember dismissal",
  'function MarkPwaPromptSeen() {',
  'function MarkPwaPromptSeen() {\n  return; // The install prompt now shows on every launch; nothing is remembered.',
  'The install prompt now shows on every launch'),

 ("PhotopFrontend/public/PwaPush.js", "install prompt: ignore old per-account flag",
  'function PwaServerSaysSeen() {',
  'function PwaServerSaysSeen() {\n  return false; // Ignore the old per-account "seen" flag.',
  'Ignore the old per-account "seen" flag.'),

 ("PhotopFrontend/public/PwaPush.js", "install prompt: dismiss button label",
  'DismissButton.textContent = "Don\'t show again";',
  'DismissButton.textContent = "Not now";',
  'DismissButton.textContent = "Not now";'),
]

# Region edits: (file, label, start marker, end marker, [(old, new), ...], done marker)
REGION_EDITS = [
 ("PhotopFrontend/public/PwaPush.js", "push prompt: bigger card",
  'createElement("PushPermissionPrompt", "div", "body"', 'LaterButton.addEventListener("click", ClosePushPrompt);',
  [('"max-width", "360px"', '"max-width", "460px"'),
   ('"border-radius", "16px"', '"border-radius", "20px"'),
   ('"padding", "16px"', '"padding", "24px"'),
   ('"font-size", "22px"', '"font-size", "28px"'),
   ('"font-size", "16px"', '"font-size", "19px"'),
   ('"line-height", "22px"', '"line-height", "27px"'),
   ('"margin-top", "6px"', '"margin-top", "8px"'),
   ('"gap", "8px"', '"gap", "12px"'),
   ('"margin-top", "14px"', '"margin-top", "22px"'),
   ('"padding", "10px 14px"', '"padding", "15px 18px"'),
   ('"border-radius", "10px"', '"border-radius", "12px"'),
   ('"font-size", "17px"', '"font-size", "20px"')],
  '"max-width", "460px"'),
]

ok = True
for rel, label, old, new, marker in EDITS:
    path = find(rel)
    if not path:
        print(f"[MISSING FILE] {label}: {rel}"); ok = False; continue
    s = open(path, newline="").read()
    crlf = "\r\n" in s
    fix = (lambda t: t.replace("\n", "\r\n")) if crlf else (lambda t: t)
    if fix(marker) in s:
        print(f"[already applied] {label}"); continue
    if old is None:
        open(path, "w", newline="").write(s.rstrip("\r\n") + fix("\n" + new))
        print(f"[applied] {label}"); continue
    if s.count(fix(old)) != 1:
        print(f"[NOT FOUND x{s.count(fix(old))}] {label}  ({path})"); ok = False; continue
    open(path, "w", newline="").write(s.replace(fix(old), fix(new)))
    print(f"[applied] {label}")
for rel, label, start, end, pairs, done in REGION_EDITS:
    path = find(rel)
    if not path:
        print(f"[MISSING FILE] {label}: {rel}"); ok = False; continue
    s = open(path, newline="").read()
    if done in s:
        print(f"[already applied] {label}"); continue
    a = s.find(start); b = s.find(end, a if a >= 0 else 0)
    if a < 0 or b < 0:
        print(f"[NOT FOUND] {label}  ({path})"); ok = False; continue
    region = s[a:b]
    for old, new in pairs:
        region = region.replace(old, new)
    open(path, "w", newline="").write(s[:a] + region + s[b:])
    print(f"[applied] {label}")

sys.exit(0 if ok else 1)