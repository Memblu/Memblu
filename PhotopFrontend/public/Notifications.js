// In-app notifications page for Memblu.
// Depends on MainUi.js, JSS.js and BridgeConnect.js being loaded first.

var NotificationPageBuilt = false;
var NotificationFeedItems = [];
var NotificationFeedLast = 0;
var NotificationFeedDone = false;
var NotificationFeedLoading = false;
var NotificationUsers = {};
var NotificationPushStatus = "unknown";

function NotificationTimeAgo(Timestamp) {
  if (Timestamp == null) {
    return "";
  }
  var Seconds = Math.floor((Date.now() - Number(Timestamp)) / 1000);
  if (Seconds < 60) return "just now";
  var Minutes = Math.floor(Seconds / 60);
  if (Minutes < 60) return Minutes + "m ago";
  var Hours = Math.floor(Minutes / 60);
  if (Hours < 24) return Hours + "h ago";
  var Days = Math.floor(Hours / 24);
  if (Days < 7) return Days + "d ago";
  return new Date(Number(Timestamp)).toLocaleDateString();
}

function NotificationActorName(Notification, User) {
  if (User && User.User) return User.User;
  if (Notification.Count > 1) {
    return Notification.Count + " people";
  }
  if (Notification.ActorID) return Notification.ActorID;
  return "Someone";
}

function NotificationText(Notification) {
  var User = Notification.ActorID ? (NotificationUsers[Notification.ActorID] || null) : null;
  var Name = NotificationActorName(Notification, User);
  switch (Notification.Type) {
    case "LikePost": return { Title: "New like", Body: Name + " liked your post.", Icon: "Like" };
    case "LikeChat": return { Title: "New like", Body: Name + " liked your message.", Icon: "Like" };
    case "QuotePost": return { Title: "New quote", Body: Name + " quoted your post.", Icon: "Quote" };
    case "QuoteChat": return { Title: "New quote", Body: Name + " quoted your message.", Icon: "Quote" };
    case "ChatPost": return { Title: Name, Body: (Notification.Preview || (Name + " replied to your post.")), Icon: "Chat" };
    case "ReplyChat": return { Title: Name, Body: (Notification.Preview ? `Replied to you: "${Notification.Preview}"` : `Replied to you: ${Name}`), Icon: "Chat" };
    case "MentionPost": return { Title: "New mention", Body: Name + " mentioned you in a post.", Icon: "Mention" };
    case "MentionChat": return { Title: Name, Body: (Notification.Preview || (Name + " mentioned you in a chat.")), Icon: "Mention" };
    case "NewPost": return { Title: "New post", Body: Name + " posted something new.", Icon: "Post" };
    case "Follow": return { Title: "New follower", Body: Name + " started following you.", Icon: "Follow" };
    case "ThreadActivity": return { Title: Name, Body: (Notification.Preview || (Name + " posted in a thread you joined.")), Icon: "Thread" };
    case "ModeratePost": return { Title: "Post moderated", Body: "Your post was " + (Notification.Action || "reviewed") + ".", Icon: "Mod" };
    case "ModerateChat": return { Title: "Message moderated", Body: "Your message was " + (Notification.Action || "reviewed") + ".", Icon: "Mod" };
    default: return { Title: "Notification", Body: "You have a new notification.", Icon: "Bell" };
  }
}

function CreateNotificationsPage() {
  if (CurrentPage != "Notifications") {
    return;
  }
  if (find("NotificationPage") != null) {
    return;
  }

  var Page = createElement("NotificationPage", "div", "MainContent", [
    ["position", "relative"],
    ["width", "100%"],
    ["max-width", "760px"],
    ["margin", "0 auto"],
    ["padding", "8px"],
    ["box-sizing", "border-box"]
  ]);

  var Header = createElement("NotificationHeader", "div", Page, [
    ["position", "relative"],
    ["background-color", LeftSidebarColor],
    ["border-radius", "12px"],
    ["padding", "14px"],
    ["margin-bottom", "10px"]
  ]);

  createElement("NotificationTitle", "div", Header, [
    ["position", "relative"],
    ["font-size", "26px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "left"]
  ]).textContent = "Notifications";

  createElement("NotificationUnread", "div", Header, [
    ["position", "relative"],
    ["margin-top", "2px"],
    ["font-size", "14px"],
    ["font-family", FontTypeA],
    ["font-weight", "600"],
    ["color", "#bbbbbb"],
    ["text-align", "left"]
  ]).textContent = "Loading...";

  var Actions = createElement("NotificationActions", "div", Header, [
    ["position", "relative"],
    ["display", "flex"],
    ["flex-wrap", "wrap"],
    ["gap", "8px"],
    ["margin-top", "10px"]
  ]);

  var MarkAll = createElement("NotificationMarkAll", "div", Actions, [
    ["position", "relative"],
    ["padding", "8px 12px"],
    ["background-color", ThemeColor],
    ["border-radius", "10px"],
    ["cursor", "pointer"],

    // Text:
    ["font-size", "16px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", "#ffffff"],
    ["text-align", "center"]
  ]);
  MarkAll.textContent = "Mark all as read";
  MarkAll.addEventListener("click", function () {
    SendRequest("MarkAllNotificationsRead", {}, function (Metadata, Data) {
      if (Data != null && Data.Code == 200) {
        for (var i = 0; i < NotificationFeedItems.length; i++) {
          NotificationFeedItems[i].Read = true;
        }
        if (typeof SetNotificationBadge == "function") {
          SetNotificationBadge(0);
        }
        var Unread = find("NotificationUnread");
        if (Unread != null) Unread.textContent = "0 unread";
        RenderNotificationList();
      }
    });
  });

  var PushButton = createElement("NotificationPushButton", "div", Actions, [
    ["position", "relative"],
    ["padding", "8px 12px"],
    ["background-color", ContentColorLayer3],
    ["border-radius", "10px"],
    ["cursor", "pointer"],

    // Text:
    ["font-size", "16px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "center"]
  ]);
  PushButton.textContent = "Enable push";
  PushButton.addEventListener("click", function () {
    if (typeof EnablePushNotifications != "function") return;
    PushButton.textContent = "Working...";
    EnablePushNotifications(function (Success, Reason) {
      if (Success) {
        PushButton.textContent = "Push enabled";
        NotificationPushStatus = "enabled";
      } else {
        PushButton.textContent = "Enable push";
        if (Reason == "denied") {
          ShowPopUp("Push blocked", "Notifications are blocked in your browser. Re-enable them in your system/browser settings to receive push notifications.", [["OK", ThemeColor, null]]);
        } else if (Reason == "ios-install") {
          ShowPopUp("Install first", "On iOS, add Memblu to your Home Screen before enabling push notifications (iOS 16.4+).", [["OK", ThemeColor, null]]);
        } else if (Reason == "unsupported") {
          ShowPopUp("Not supported", "Push notifications are not supported on this device/browser.", [["OK", ThemeColor, null]]);
        } else if (Reason == "no-key") {
          ShowPopUp("Push unavailable", "Push notifications are not configured on the server yet.", [["OK", ThemeColor, null]]);
        }
      }
    });
  });

  var SettingsButton = createElement("NotificationSettingsButton", "div", Actions, [
    ["position", "relative"],
    ["padding", "8px 12px"],
    ["background-color", ContentColorLayer3],
    ["border-radius", "10px"],
    ["cursor", "pointer"],

    // Text:
    ["font-size", "16px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "center"]
  ]);
  SettingsButton.textContent = "Preferences";
  SettingsButton.addEventListener("click", function () {
    loadScript(LoadScripts.Settings);
    setTimeout(function () {
      if (typeof SwitchSettingScreen == "function") {
        SwitchSettingScreen("NotificationsScreen");
      }
    }, 300);
  });

  var List = createElement("NotificationList", "div", Page, [
    ["position", "relative"],
    ["width", "100%"]
  ]);

  var Empty = createElement("NotificationEmpty", "div", List, [
    ["position", "relative"],
    ["display", "none"],
    ["text-align", "center"],
    ["padding", "24px"],
    ["font-size", "16px"],
    ["font-family", FontTypeA],
    ["font-weight", "600"],
    ["color", "#bbbbbb"]
  ]);
  Empty.textContent = "No notifications yet.";

  var Loader = createElement("NotificationLoader", "div", List, [
    ["position", "relative"],
    ["text-align", "center"],
    ["padding", "12px"],
    ["font-size", "16px"],
    ["font-family", FontTypeA],
    ["font-weight", "600"],
    ["color", "#bbbbbb"],
    ["display", "none"]
  ]);
  Loader.textContent = "Loading...";

  // Infinite scroll.
  window.addEventListener("scroll", NotificationMaybeLoadMore);

  NotificationFeedItems = [];
  NotificationFeedLast = 0;
  NotificationFeedDone = false;
  NotificationFeedLoading = false;
  NotificationUsers = {};

  LoadNotificationFeed(true);
}

function NotificationMaybeLoadMore() {
  if (CurrentPage != "Notifications") return;
  if (NotificationFeedDone || NotificationFeedLoading) return;
  var List = find("NotificationList");
  if (List == null) return;
  var Rect = List.getBoundingClientRect();
  if (Rect.bottom - window.innerHeight < 600) {
    LoadNotificationFeed(false);
  }
}

function LoadNotificationFeed(Reset) {
  if (NotificationFeedLoading) return;
  if (!Reset && NotificationFeedDone) return;
  if (Reset) {
    NotificationFeedItems = [];
    NotificationFeedLast = 0;
    NotificationFeedDone = false;
    var List = find("NotificationList");
    if (List != null) {
      // Remove old cards.
      var Cards = List.querySelectorAll(".NotificationCard");
      for (var i = 0; i < Cards.length; i++) Cards[i].remove();
    }
  }
  NotificationFeedLoading = true;
  var Loader = find("NotificationLoader");
  if (Loader != null) setCSS(Loader, "display", "block");

  var Payload = { Amount: 25 };
  if (!Reset && NotificationFeedLast > 0) {
    Payload.Before = NotificationFeedLast;
  }
  SendRequest("GetNotifications", Payload, function (Metadata, Data) {
    NotificationFeedLoading = false;
    if (Loader != null) setCSS(Loader, "display", "none");
    if (Data == null || Data.Code != 200) return;

    var Notifications = Data.Notifications || [];
    if (Data.Users) {
      for (var key in Data.Users) {
        NotificationUsers[key] = Data.Users[key];
      }
    }
    if (Notifications.length == 0) {
      NotificationFeedDone = true;
    } else {
      for (var i = 0; i < Notifications.length; i++) {
        NotificationFeedItems.push(Notifications[i]);
      }
      if (Data.LastCreatedAt != null) {
        NotificationFeedLast = Data.LastCreatedAt;
      } else if (Notifications.length > 0) {
        NotificationFeedLast = Notifications[Notifications.length - 1].CreatedAt;
      }
      if (Notifications.length < 25) {
        NotificationFeedDone = true;
      }
    }
    if (typeof SetNotificationBadge == "function") {
      SetNotificationBadge(Data.Unread);
    }
    var Unread = find("NotificationUnread");
    if (Unread != null) Unread.textContent = (Data.Unread || 0) + " unread";
    RenderNotificationList();
    var Empty = find("NotificationEmpty");
    if (Empty != null) {
      setCSS(Empty, "display", NotificationFeedItems.length == 0 ? "block" : "none");
    }
  });
}

function RenderNotificationList() {
  var List = find("NotificationList");
  if (List == null) return;
  var Loader = find("NotificationLoader");
  // Remove cards.
  var Cards = List.querySelectorAll(".NotificationCard");
  for (var i = 0; i < Cards.length; i++) Cards[i].remove();

  for (var i = 0; i < NotificationFeedItems.length; i++) {
    var Item = NotificationFeedItems[i];
    RenderNotificationCard(Item, List, Loader);
  }
}

function RenderNotificationCard(Notification, List, Loader) {
  var Info = NotificationText(Notification);
  var User = Notification.ActorID ? (NotificationUsers[Notification.ActorID] || null) : null;

  var Card = createElement("NotificationCard" + Notification._id, "div", List, [
    ["position", "relative"],
    ["width", "100%"],
    ["margin-bottom", "8px"],
    ["padding", "12px"],
    ["box-sizing", "border-box"],
    ["background-color", Notification.Read ? ContentColor : ContentColorLayer2],
    ["border-radius", "12px"],
    ["cursor", "pointer"],
    ["display", "flex"],
    ["align-items", "flex-start"],
    ["gap", "10px"]
  ]);
  Card.className = "NotificationCard";
  if (!Notification.Read) {
    Card.style.borderLeft = "4px solid " + ThemeColor;
  }

  // Avatar / icon.
  var Avatar = createElement("NotificationAvatar", "div", Card, [
    ["position", "relative"],
    ["flex", "0 0 auto"],
    ["width", "44px"],
    ["height", "44px"],
    ["border-radius", "22px"],
    ["background-color", ContentColorLayer3],
    ["overflow", "hidden"],

    // Text:
    ["font-size", "14px"],
    ["line-height", "44px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "center"]
  ]);
  if (User != null && DecideProfilePic(User) != null) {
    var Img = document.createElement("img");
    var picId = DecideProfilePic(User);
    var mediaBase = (typeof GoogleCloudStorgeURL !== "undefined" && GoogleCloudStorgeURL) ? GoogleCloudStorgeURL : ((typeof location !== "undefined" && location.origin) ? location.origin + "/media/" : "https://storage.googleapis.com/parcel-7d05a.appspot.com/"); var profileImg = mediaBase + "ProfileImages/" + picId;
    Img.src = profileImg;
    Img.style.width = "44px";
    Img.style.height = "44px";
    Img.style.objectFit = "cover";
    Avatar.textContent = "";
    Avatar.appendChild(Img);
  } else {
    Avatar.textContent = Info.Icon.charAt(0);
  }

  var Body = createElement("NotificationBody", "div", Card, [
    ["position", "relative"],
    ["flex", "1 1 auto"],
    ["min-width", "0px"]
  ]);

  createElement("NotificationTitle", "div", Body, [
    ["position", "relative"],
    ["font-size", "16px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["text-align", "left"]
  ]).textContent = Info.Title;

  createElement("NotificationText", "div", Body, [
    ["position", "relative"],
    ["margin-top", "2px"],
    ["font-size", "15px"],
    ["line-height", "20px"],
    ["font-family", FontTypeA],
    ["font-weight", "600"],
    ["color", "#cccccc"],
    ["text-align", "left"],
    ["word-break", "break-word"]
  ]).textContent = Info.Body;

  if (Notification.Reason) {
    createElement("NotificationReason", "div", Body, [
      ["position", "relative"],
      ["margin-top", "4px"],
      ["font-size", "13px"],
      ["line-height", "18px"],
      ["font-family", FontTypeA],
      ["font-weight", "600"],
      ["font-style", "italic"],
      ["color", "#ff8a8a"],
      ["text-align", "left"]
    ]).textContent = Notification.Reason;
  }

  createElement("NotificationTime", "div", Body, [
    ["position", "relative"],
    ["margin-top", "6px"],
    ["font-size", "12px"],
    ["font-family", FontTypeA],
    ["font-weight", "600"],
    ["color", "#888888"],
    ["text-align", "left"]
  ]).textContent = NotificationTimeAgo(Notification.CreatedAt);

  if (!Notification.Read) {
    var Dot = createElement("NotificationUnreadDot", "div", Card, [
      ["position", "relative"],
      ["flex", "0 0 auto"],
      ["width", "10px"],
      ["height", "10px"],
      ["margin-top", "6px"],
      ["border-radius", "5px"],
      ["background-color", ThemeColor]
    ]);
    Dot.textContent = "";
  }

  Card.addEventListener("click", function () {
    if (!Notification.Read) {
      MarkNotificationRead([Notification._id]);
      Notification.Read = true;
      Card.style.backgroundColor = ContentColor;
      Card.style.borderLeft = "";
      var DotEl = Card.querySelector("#NotificationUnreadDot" + Notification._id) || Card.querySelector("#NotificationUnreadDot");
      // Best effort: remove any unread dot.
      var Dots = Card.querySelectorAll("div");
      // no-op
    }
    OpenNotificationTarget(Notification);
  });

  // Insert before loader if present.
  if (Loader != null && Loader.parentNode == List) {
    List.insertBefore(Card, Loader);
  }
}

function MarkNotificationRead(Ids) {
  if (!Ids || Ids.length == 0) return;
  SendRequest("MarkNotificationsRead", { IDs: Ids }, function (Metadata, Data) {
    if (Data != null && Data.Code == 200 && typeof SetNotificationBadge == "function") {
      SetNotificationBadge(Data.Unread);
    }
  });
}

function OpenNotificationTarget(Notification) {
  if (Notification == null) return;
  if (Notification.Type == "Follow" && Notification.ActorID) {
    LoadProfilePage(Notification.ActorID);
    return;
  }
  if (Notification.PostID) {
    (async function () {
      await GetPostsFromID({ PostID: Notification.PostID }, "PageLoad");
      await new Promise(function (r) { setTimeout(r, 250); });
      if (Notification.ChatID) {
        if (typeof MobileVersion !== "undefined" && MobileVersion && typeof OpenMobileChat == "function") {
          OpenMobileChat(Notification.PostID);
          await new Promise(function (r) { setTimeout(r, 350); });
        }
        var ChatEl = find(Notification.ChatID + "Chat");
        if (ChatEl != null) {
          ChatEl.scrollIntoView({ behavior: "smooth", block: "center" });
          ChatEl.style.backgroundColor = ContentColorLayer3;
          setTimeout(function () { ChatEl.style.backgroundColor = ""; }, 1500);
        } else {
          var PostEl = find(Notification.PostID);
          if (PostEl != null) PostEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } else {
        var PostEl = find(Notification.PostID);
        if (PostEl != null) PostEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    })();
    return;
  }
  if (Notification.ActorID) {
    LoadProfilePage(Notification.ActorID);
  }
}

function HandleRealtimeNotification(Notification) {
  if (Notification == null) return;
  // Cache user data if present.
  if (Notification.Actor != null && Notification.ActorID != null) {
    NotificationUsers[Notification.ActorID] = Notification.Actor;
  }
  if (CurrentPage != "Notifications") {
    return;
  }
  // Removed event.
  if (Notification.Removed === true && Notification._id != null) {
    NotificationFeedItems = NotificationFeedItems.filter(function (n) { return n._id != Notification._id; });
    var Card = find("NotificationCard" + Notification._id);
    if (Card != null) Card.remove();
    return;
  }
  // Update or prepend.
  var ExistingIndex = -1;
  for (var i = 0; i < NotificationFeedItems.length; i++) {
    if (NotificationFeedItems[i]._id == Notification._id) {
      ExistingIndex = i;
      break;
    }
  }
  if (ExistingIndex >= 0) {
    NotificationFeedItems[ExistingIndex] = Notification;
  } else {
    NotificationFeedItems.unshift(Notification);
  }
  RenderNotificationList();
  var Empty = find("NotificationEmpty");
  if (Empty != null) setCSS(Empty, "display", NotificationFeedItems.length == 0 ? "block" : "none");
}

// Deep-link support for installed PWAs: open a post/chat from a push notification.
(function HandleNotificationDeepLink() {
  try {
    var Params = new URLSearchParams(window.location.search);
    var PostID = Params.get("post");
    var ChatID = Params.get("chat");
    if (!PostID) return;
    var Attempts = 0;
    var Timer = setInterval(function () {
      Attempts++;
      if (typeof GetPostsFromID == "function" && typeof CurrentPage != "undefined") {
        clearInterval(Timer);
        SwitchPage("Home");
        GetPostsFromID({ PostID: PostID }, "PageLoad").then(function () {
          if (ChatID) {
            setTimeout(function () {
              if (typeof MobileVersion !== "undefined" && MobileVersion && typeof OpenMobileChat == "function") {
                OpenMobileChat(PostID);
              }
              setTimeout(function () {
                var ChatEl = find(ChatID + "Chat");
                if (ChatEl != null) ChatEl.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 400);
            }, 300);
          }
        });
      }
      if (Attempts > 40) clearInterval(Timer);
    }, 250);
  } catch (e) { }
})();

// Auto-build when the page is switched to Notifications.
var _NotificationPageObserver = setInterval(function () {
  if (typeof CurrentPage !== "undefined" && CurrentPage == "Notifications" && find("NotificationPage") == null) {
    CreateNotificationsPage();
  }
}, 300);
