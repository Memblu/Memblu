var Socket = null;
var AwaitingResponse = {};

var UserID = null;
var Username = null;
var UserEmail = null;
var UserCustomURL = null;
var Settings = {};
var ProfileData = {};
var LoginUserRole = null;

var BlockedUsers = [];

var SupportedImageTypes = ["png", "jpeg", "jpg", "webp", "svg+xml", "tiff", "tif", "gif"];
var MonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

var CaptchaData = null;
function SetCaptchaData(Response) {
  CaptchaData = Response;
}
function SetCaptchaExpired() {
  if (typeof hcaptcha != 'undefined') {
    hcaptcha.reset();
  }
  CaptchaData = null;
}

var ServerDomain = (window.__PHOTOP_CONFIG__ && window.__PHOTOP_CONFIG__.serverDomain)
  ? window.__PHOTOP_CONFIG__.serverDomain
  : ((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/Server1");
var ImageUploadDomain = (window.__PHOTOP_CONFIG__ && window.__PHOTOP_CONFIG__.imageUploadDomain)
  ? window.__PHOTOP_CONFIG__.imageUploadDomain
  : (location.origin + "/ImageUpload");

var ViewingProfileID = null;

var SelectedModerationData = null;

var MobileVersion = false;
var ScrolledToMobile = 0;
var ForceMobileVersion = false;

var SocialLinkData = {
  twitter: ["Twitter", "#1DA1F2", "https://twitter.com/USERNAME_GOES_HERE"],
  youtube: ["YouTube", "#FF0000", "https://www.youtube.com/channel/USERID_GOES_HERE"],
  twitch: ["Twitch", "#6441A4", "https://www.twitch.tv/USERNAME_GOES_HERE"],
  discord: ["Discord", "#5865F2", "PROMPT_USERNAME"],
  instagram: ["Instagram", "#E1306C", "https://www.instagram.com/USERNAME_GOES_HERE"],
  reddit: ["Reddit", "#FF4500", "https://www.reddit.com/user/USERNAME_GOES_HERE", "u/"],
  //facebook: ["Facebook", "#4267B2", "https://www.facebook.com/search/top?q=USERNAME_GOES_HERE"],
  pinterest: ["Pinterest", "#E60023", "https://www.pinterest.com/USERNAME_GOES_HERE"],
  //tiktok: ["TikTok", "#FF0050", "OAUTH_URL_HERE"],
  //xbox: ["Xbox", "#107C10", "OAUTH_URL_HERE"],
  github: ["GitHub", "#4078C0", "https://github.com/USERNAME_GOES_HERE"]
};

function UpdateDisplaySettings() {
  if (Settings != null && Settings.Display != null) {
    var Keys = Object.keys(Settings.Display);
    for (var i = 0; i < Keys.length; i++) {
      UserDisplaySettings[Keys[i]] = Settings.Display[Keys[i]];
    }
    window.localStorage.setItem("DisplaySettings", JSON.stringify(UserDisplaySettings));
  }
}

/* START OF MAIN MODULE */

var NextRequestID = 0;
function SendRequest(Task, Payload, Function, NeedsID) {
  // IDs must be unique even when some requests have no callback. Deriving the
  // ID from Object.keys(...).length reused IDs and could route a response to
  // the wrong callback.
  var NewID = NextRequestID++;
  var EstablishRequest = {
    Metadata: {
      ReqID: NewID,
      ReqTask: Task,
      Fingerprint: FormatFingerprint(),
    },
    Body: Payload
  };
  if (Task != "CreateConnection") {
    var AuthToken = GetAuthToken();
    if (AuthToken != null) {
      EstablishRequest.Metadata.AuthToken = AuthToken;
    }
    var UserIDVerify = GetUserID();
    if (UserID != null || UserIDVerify != null) {
      EstablishRequest.Metadata.UserID = UserID || UserIDVerify;
    }
  }
  if (Settings != null && Settings.Display != null) {
    var Text = JSON.stringify(Settings.Display);
    var Hash = 0;
    if (Text.length > 0) {
      for (var i = 0; i < Text.length; i++) {
        var char = Text.charCodeAt(i);
        Hash = ((Hash << 5) - Hash) + char;
        Hash = Hash & Hash; // Convert to 32bit integer
      }
    }

    EstablishRequest.Metadata.SettingsHash = Hash;
  }
  /*
  if (NeedsID == null || NeedsID == true) {
    if (EstablishRequest.Metadata.UserID == null || EstablishRequest.Metadata.AuthToken == null) {
      UserID = null;
      window.localStorage.removeItem("AuthToken");
      window.localStorage.removeItem("LoggedInUser");
      AuthUpdate(false);
      GetPosts({
        Add: "Top",
        Limit: 15
      });
      ShowPopUp("Logged Out", "Your account was logged out due to inactivity.", [ ["Okay", "#618BFF", null] ]);
    }
  }
  */
  try {
    if (Socket != null && Socket.readyState === Socket.OPEN) {
      Socket.send(JSON.stringify(EstablishRequest));
    } else {
      ShowLoading();
      // ConnectToBridge(); //.send(JSON.stringify(EstablishRequest));
    }
  } catch (e) {
    ShowLoading();
    console.log('Sending failed while sending request', e);
  }
  if (Function != null) {
    AwaitingResponse["KEY" + NewID] = Function;
  }
}

var PingInterval = null;
var LastPong = Date.now();

var WebSocketDisabled = false;
var SubmittingAppeal = null;

function ConnectToBridge() {
  if (WebSocketDisabled == true) {
    return;
  }

  if (Socket != null && Socket.readyState == Socket.OPEN && LastPong + 20000 > Date.now()) {
    return;
  }

  ShowLoading();
  SetPageTitle("Connecting...");
  try {
    Socket = new WebSocket(ServerDomain);
  } catch (err) {
    console.log(err);
  }

  //clearInterval(PingInterval);

  // AwaitingResponse = [];

  Socket.onopen = async function() {
    ReportVisibility();
    if (SubmittingAppeal != null) {
      SendRequest("SendBanAppeal", { Appeal: SubmittingAppeal }, function (Metadata, Data) {
        if (Data.Code == 200) {
          WebSocketDisabled = true;
          SubmittingAppeal = null;
          Socket.close();
          ShowPopUp("Appeal Submitted", "Successfully sent ban appeal.", [["Okay", "#618BFF", null]]);
        }
      });
      return;
    }

    LastPong = Date.now();
    var Connected = false;
    while (Connected == false) {
      SendRequest("CreateConnection", {}, function (Metadata, Data) {
        if (Data.ServerVersion != null && Data.ServerVersion > SiteVersion) {
          caches.open('v1').then(function(cache) {
            var LoadScriptKeys = Object.keys(LoadScripts);
            for (var s = 0; s < LoadScriptKeys.length; s++) {
              cache.delete(LoadScriptKeys[s]);
            }
          });
          ShowPopUp("Memblu Update", "It appears Memblu has a new update! Refresh for the newest features!", [["Refresh", "#618BFF", "RefreshPage"], ["Later", "#B3B3B3", null]]);
        }

        if (Data.Code == 200) {
          Connected = true;
          HideLoading();
          setTimeout(ReportVisibility, 0);
          if (GetAuthToken() != null) {
            SendRequest("GetAccountData", {}, function (Metadata, Data) {
              if (Data.Code == 200) {
                SetPageTitle("Home");
                Username = Data.UserData.User;
                UserID = Data.UserData._id;
                LoginUserRole = Data.UserData.Role;
                Settings = Data.UserData.Settings || {};
                ProfileData = Data.UserData.ProfileData || {};
                UpdateDisplaySettings();
                UserEmail = Data.UserData.Email;
                UserCustomURL = Data.UserData.CustomURL || null;
                BlockedUsers = Data.UserData.BlockedUsers || [];
                AuthUpdate(true);
                if (Data.BanData != null) {
                  ShowBanNotice(Data.BanData);
                  return;
                }
                LoadFromURLOrPosts();
                CheckForUnbanURL();
              } else if (Data.Code == 401) {
                window.localStorage.removeItem("AuthToken");
                AuthUpdate(false);
                LoadFromURLOrPosts();
                return;
              }
            });
          } else {
            LoadFromURLOrPosts();
          }
        }
      });
      await sleep(7500);
    }
  }

  Socket.onclose = function() {
    LastPong = Date.now();
    Socket = null;
    ConnectToBridge();
  }

  // Tell the server whether this client is actually visible so backgrounded
  // tabs do not suppress push notifications.
  function ReportVisibility(Event) {
    if (Socket != null && Socket.readyState === Socket.OPEN) {
      var Visible = !document.hidden;
      // On mobile, a tab only counts as "being used" when it is visible AND focused.
      if (Visible && DeviceIsMobile() && typeof document.hasFocus == "function") {
        Visible = document.hasFocus();
      }
      if (Event && Event.type == "pagehide") {
        Visible = false;
      }
      SendRequest("UpdateVisibility", { Visible: Visible }, function () { });
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", ReportVisibility);
    window.addEventListener("focus", ReportVisibility);
    window.addEventListener("blur", ReportVisibility);
    window.addEventListener("pagehide", ReportVisibility);
    window.addEventListener("pageshow", ReportVisibility);
    // The server expires "active" after 45s without a signal, so keep it fresh.
    setInterval(ReportVisibility, 20000);
  }

  /*
  PingInterval = setInterval(function () {
    if (Socket != null && Socket.readyState == Socket.OPEN && LastPong + 20000 > Date.now()) {
      Socket.send("Ping");
    } else if (Socket == null || Socket.readyState != Socket.OPEN || TabIsOpen == true) {
      console.log("Lost connection. Attempting to reconnect...");
      ConnectToBridge();
    }
  }, 8000);
  */

  Socket.onmessage = async function(Data) {
    LastPong = Date.now();
    if (Data.data == "Pong") {
      return;
    }

    var Decoded = JSON.parse(Data.data) || Data.data;
    var Metadata = Decoded.Metadata;
    var SentMetadata = Metadata.SentMetadata;
    var Body = Decoded.Body;

    // DESKTOP APP:
    if (window.desktop != null) { 
      window.desktop.sendMessage(Data.data);
    }

    if (Body.Code != null) {
      if (Body.Code == 401) {  // Not logged in
        window.localStorage.removeItem("AuthToken");
        AuthUpdate(false);
      }
      if (Body.Code == 429) {
        WebSocketDisabled = true;
        var AddTimestamp = "";
        if (Body.Timestamp != null) {
          AddTimestamp = " <i>Time Left: " + TimestampToString(Body.Timestamp) + "</i>";
        }
        ShowPopUp("Rate Limit", "This action has been rate limited due to excessive use. Please try again at a later time." + AddTimestamp, [["Okay", "#618BFF", "RefreshPage"]]);
        return;
      }
    }
    if (Body.Token != null) {
      AuthToken = Body.Token;
    }
    // Only an authentication response may replace the signed-in identity.
    // Other endpoints (for example admin actions) may echo a target user's ID
    // and must not be allowed to hijack the session identity.
    if (Body.UserID != null && Body.Token != null) {
      UserID = Body.UserID;
    }
    if (Body.UpdateDisplaySettings != null) {
      if (JSON.stringify(Body.UpdateDisplaySettings) != JSON.stringify(Settings.Display)) {
        window.localStorage.setItem("DisplaySettings", JSON.stringify(Body.UpdateDisplaySettings));
        Settings.Display = Body.UpdateDisplaySettings;
        ShowPopUp("Settings Changed", "It seems like your account settings where changed. Refresh to get the newest settings.", [["Refresh", "#618BFF", "RefreshPage"], ["Later", "#B3B3B3", null]]);
      }
    }

    if (Metadata.ReqSource == "Client") {
      var FunctionToRun = AwaitingResponse["KEY" + SentMetadata.ReqID];
      if (FunctionToRun != null) {
        delete AwaitingResponse["KEY" + SentMetadata.ReqID];
        FunctionToRun(Metadata, Body);
      }
    } else {
      var Function = window[Body.ClientFunction];
      Function(Metadata, Body);
    }
  }

  return Socket;
}
ConnectToBridge();

function SendAnalytics(SendDetails) {
  var SendInterval = null;
  function IntervalSend() {
    if (Socket != null) {
      SendRequest("Analytics", { NOTE: "These analytics help better the platform. They are not tied to any account details such as your UserID, Name, Email, Password, History, etc.", Type: "ErrorReport", Details: SendDetails });
      clearInterval(SendInterval);
    }
  }
  SendInterval = setInterval(IntervalSend, 3000);
  IntervalSend();
}

window.addEventListener('error', function (LogError) {
  SendAnalytics({ Error: (LogError.message + "\nStack: " + LogError["error"].stack) });
});

function FormatFingerprint() {
  var navigator_info = window.navigator;
  var screen_info = window.screen;
  var uid = navigator_info.mimeTypes.length;
  uid += navigator_info.userAgent.replace(/\D+/g, '');
  uid += navigator_info.plugins.length;
  uid += screen_info.height || '';
  uid += screen_info.width || '';
  uid += screen_info.pixelDepth || '';
  return uid;
}

function GetAuthToken(IsPageLoad) {
  var Token = window.localStorage.getItem("AuthToken");

  if (Token == null) {
    AuthUpdate(false);
    return;
  }
  var DecodedToken = JSON.parse(Token);

  if (DecodedToken[1] > Math.floor(Date.now() / 1000)) {
    return DecodedToken[0].replace("DO_NOT_SHARE_", "");
  } else {
    window.localStorage.removeItem("AuthToken");
    AuthUpdate(false);
    return;
  }
}
function SetAuthToken(Token, TokenExpireDuration) {
  window.localStorage.setItem("AuthToken", JSON.stringify(["DO_NOT_SHARE_" + Token, (Math.floor(Date.now() / 1000) + TokenExpireDuration)]));
}

function GetUserID() {
  return window.localStorage.getItem("LoggedInUser");
}
function SetUserID() {
  window.localStorage.setItem("LoggedInUser", UserID);
}

/* END OF MAIN MODULE */

function AuthUpdate(IsAuth) {
  if (IsAuth == true) {
    // Signed In:
    SetUserID();

    setCSS(LogoutButton, "display", "flex");
    setCSS(PostNavButton, "display", "flex");
    setCSS(NotificationsButton, "display", "flex");
    setCSS(YourProfileButton, "display", "flex");
    setCSS(SettingsButton, "display", "flex");
    setCSS(AdminPanelButton, "display", HasAdminAccess(LoginUserRole) == true ? "flex" : "none");
    if (typeof RefreshNotificationBadge == "function") {
      RefreshNotificationBadge();
    }
    if (typeof SetupPwaInstallPrompt == "function") {
      SetupPwaInstallPrompt();
    }
    if (typeof SetupPushPermissionPrompt == "function") {
      SetupPushPermissionPrompt();
    }
    find("CreatePostUser").textContent = Username;
    find("CreatePostUser").setAttribute("title", "Signed In as " + Username);
    setCSS("CreatePostProfilePic", "content", "url('" + GoogleCloudStorgeURL + "ProfileImages/" + (Settings.ProfilePic || "DefaultProfilePic") + "')");
    UpdatePostCharTextCounter(0);
    find("CreatePostTextHolder").textContent = "Ready to Hangout?";
    setCSS("CreatePostTextHolder", "color", "#aaaaaa");
    CreateDataForUpdate = null; // On next login/sign-up we don't want this carrying over.
    setCSS("CreatePost", "display", "block");
    setCSS("LoginForm", "display", "none");
  } else {
    // Signed Out:
    if (LeftColumn == null) {
      StartSignIn();
    }
    UserID = null;
    Username = null;
    UserEmail = null;
    UserCustomURL = null;
    Settings = {};
    ProfileData = {};
    LoginUserRole = null;

    setCSS(LogoutButton, "display", "none");
    setCSS(PostNavButton, "display", "none");
    setCSS(NotificationsButton, "display", "none");
    setCSS(YourProfileButton, "display", "none");
    setCSS(SettingsButton, "display", "none");
    setCSS(AdminPanelButton, "display", "none");
    if (typeof SetNotificationBadge == "function") {
      SetNotificationBadge(0);
    }
    find("CreatePostUser").textContent = "Signed Out";
    find("CreatePostUser").setAttribute("title", "Signed Out");
    UpdatePostCharTextCounter(0);
    find("CreatePostTextHolder").textContent = "Ready to Hangout?";
    setCSS("CreatePostProfilePic", "content", "");
    setCSS("CreatePostTextHolder", "color", "#aaaaaa");
    setCSS("CreatePost", "display", "none");
    setCSS("LoginForm", "display", "flex");
  }
}

async function CreateAccount(Data) {
  if (CaptchaData == null) {
    if (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "")) {
      CaptchaData = "dev-bypass";
    } else {
      ShowPopUp("Complete Captcha", "You must properly complete the Captcha to continue.", [["Okay", "#618BFF", null]]);
      return;
    }
  }

  Data.CaptchaData = CaptchaData;
  SetCaptchaExpired();

  SendRequest("SignUpAccount", Data, function (Metadata, Data) {
    var ResponseCode = Data.Code;
    if (ResponseCode == 200) {

      TextFieldSignUpEmail.value = "";
      TextFieldSignUpUsername.value = "";
      TextFieldSignUpPassword.value = "";

      Username = Data.RealUser;

      UserID = Data.UserID;
      Settings = Data.Settings || {};
      ProfileData = Data.ProfileData || {};
      UpdateDisplaySettings();
      UserEmail = Data.Email;
      LoginUserRole = Data.Role;
      SetAuthToken(Data.Token, Data.TokenExpireDuration);
      StartSignIn();
      AuthUpdate(true);

      GetPosts({
        Add: "Top",
        Limit: 15
      });
    } else {
      if (ResponseCode == 409) {
        ShowPopUp("Username Taken", "It appears someone already has that username. Pick another one!", [["Okay", "#618BFF", null]]);
      } else if (ResponseCode == 400) {
        ShowPopUp("Captcha Error", "There was an error processing the captcha. Please try again.", [["Okay", "#618BFF", null]]);
      } else if (ResponseCode == "400-test") {
        // ALPHA TESTING ONLY:
        ShowPopUp("Invalid Testing Code", "The entered testing code is invalid. Please enter a valid code.", [["Okay", "#618BFF", null]]);
      } else {
        ShowPopUp("Something Broke...", "Hmm... Something didn't work right. Please try again!", [["Okay", "#618BFF", null]]);
      }
    }
  }, false);
}

async function LoginToAccount(Data) {
  SendRequest("SignInAccount", Data, function (Metadata, Data) {
    if (Data.Code == 200 || Data.Code == 409) {
      Username = Data.RealUser;
      UserID = Data.UserID;
      UserEmail = Data.Email;
      UserCustomURL = Data.CustomURL || null;
      Settings = Data.Settings || {};
      ProfileData = Data.ProfileData || {};
      UpdateDisplaySettings();
      LoginUserRole = Data.Role;
      BlockedUsers = Data.BlockedUsers;
      PreloadedPreviews = {};

      SetAuthToken(Data.Token, Data.TokenExpireDuration);
      AuthUpdate(true);

      if (Data.BanData != null) {
        // Banned users can still sign in to read the notice and appeal.
        ShowBanNotice(Data.BanData);
        return;
      }

      TextFieldSignInUsername.value = "";
      TextFieldSignInPassword.value = "";

      CheckForUnbanURL();

      if (Data.Code == 409) {
        if (Data.ModifiedType == "Delete") {
          var CalcTimestamp = Data.Timeframe;
          if (CalcTimestamp < 1) {
            CalcTimestamp = 1; // Prevent negative timestamps.
          }
          var AmountDivide = 1;
          var End = "Second";
          if (CalcTimestamp > 31536000 - 1) {
            AmountDivide = 31536000;
            End = "Year";
          } else if (CalcTimestamp > 2592000 - 1) {
            AmountDivide = 2592000;
            End = "Month";
          } else if (CalcTimestamp > 604800 - 1) {
            AmountDivide = 604800;
            End = "Week";
          } else if (CalcTimestamp > 86400 - 1) {
            AmountDivide = 86400;
            End = "Day";
          } else if (CalcTimestamp > 3600 - 1) {
            AmountDivide = 3600;
            End = "Hour";
          } else if (CalcTimestamp > 60 - 1) {
            AmountDivide = 60;
            End = "Minute";
          }
          var TimeToSet = Math.round(CalcTimestamp / AmountDivide);
          if (TimeToSet > 1) {
            // Add "S":
            End += "s";
          }
          var Result = TimeToSet + " " + End;
          ShowPopUp("Deleting in " + Result, "This account will be deleted in " + Result + ". Would you like to recover the account?", [["Recover", "#618BFF", "RecoverAccount"], ["Cancel", "#475059", "ClearDataRefreshPage"]]);
        } else {
          ShowPopUp("Account Disabled", "This account has been disabled. Would you like to recover the account?", [["Recover", "#618BFF", "RecoverAccount"], ["Cancel", "#475059", "ClearDataRefreshPage"]]);
        }
      } else {
        if (Settings != null && Settings.Display != null && Settings.Display.Theme == "Dark Mode") {
          if (CurrentTheme != "Dark Mode") {
            RefreshPage();
            return;
          }
        } else if (Settings != null && Settings.Display != null && Settings.Display.Theme == "Light Mode") {
          if (CurrentTheme != "Light Mode") {
            RefreshPage();
            return;
          }
        }

        GetPosts({
          Add: "Top",
          Limit: 15
        });
      }
    } else { // if (Data.Code == 403) {
      ShowPopUp("Login Incorrect", "Your username or password seems to be incorrect. Please try again!", [["Okay", "#618BFF", null]]);
      //} else {
      //ShowPopUp("Something Broke...", "Hmm... Something didn't work right. Please try again!", [ ["Okay", "#618BFF", null] ]);
    }
  }, false);
}

async function SignOutOfAccount(HideLogoutMessage) {
  SendRequest("LogoutAccount", {}, function (Metadata, Data) {
    if (Data.Code == 200) {
      UserID = null;
      window.localStorage.removeItem("AuthToken");
      window.localStorage.removeItem("LoggedInUser");
      AuthUpdate(false);

      PreloadedPreviews = {};

      GetPosts({
        Add: "Top",
        Limit: 15
      });

      if (HideLogoutMessage != true) {
        ShowPopUp("Logged Out", "You where successfully logged out of your account.", [["Okay", "#618BFF", null]]);
      }
    }
  });
}

function ClearDataRefreshPage() {
  window.localStorage.removeItem("AuthToken");
  window.localStorage.removeItem("LoggedInUser");
  RefreshPage();
}

var PostFinishedProcessing = true;
async function AddPost(SendData, ImageUpload) {
  PostFinishedProcessing = false;
  var PostImages = [];
  var ImageHolder = find("CreateMediaHolder");
  while (ImageHolder.firstChild) {
    PostImages.push(ImageHolder.firstChild.id);
    ImageHolder.firstChild.remove();
  }

  SendRequest("CreatePost", SendData, async function (Metadata, Data) {
    if (Data.Code == 200) {
      /*
      for (var i = 0; i < ImageUpload.length; i++) {
        var Image = ImageUpload[i];
        UploadImage(Image.id, Data.NewPostID+i, {contentType: "image/png"});
        Image = "Uploaded";
      }
      */

      if (PostImages.length > 0) {
        await SendImageToServer("PostImageUpload", { PostID: Data.NewPostID }, PostImages);
        //await sleep((500 * PostImages.length) + 1000);
      }

      window.scrollTo(0, 0);
      GetPosts({
        Add: "Top",
        Limit: 15
      });
    } else {
      ShowPopUp("Well, Something Broke", "While trying to post, an error occured! Please try again! Error Message: " + Data.Message, [["Okay", "#618BFF", null]]);
    }
    PostFinishedProcessing = true;
  });

  var PostCreateHolder = find("CreatePost");
  if (PostCreateHolder != null) {
    setCSS(PostCreateHolder, "border-color", ContentColor);
    setCSS(PostCreateHolder, "border-style", "solid");
    setCSS(PostCreateHolder, "border-width", "0px");
    setCSS(PostCreateHolder, "border-bottom-width", "8px");
    while (PostFinishedProcessing == false) {
      if (PostCreateHolder != null) {
        try {
          PostCreateHolder.animate([
            { borderColor: ThemeColor, offset: 0.45 },
            { borderColor: ContentColor },
          ], 1000);
        } catch { }
      }
      await sleep(1000);
    }
    if (PostCreateHolder != null) {
      setCSS(PostCreateHolder, "border-style", "none");
    }
  }
}

function LoadEmbedPreviews() {
  LoadPlatformEmbeds(DataPostEmbedLoad);

  var EmbedLinkFrames = findClass("LinkPreview");
  if (EmbedLinkFrames.length > 0) {
    var PreviewLinks = [];
    for (var l = 0; l < EmbedLinkFrames.length; l++) {
      PreviewLinks.push(EmbedLinkFrames[l].id.substring(11));
    }
    if (PreviewLinks.length > 0) {

      // Remove Any Duplicate URLs to Save Bandwidth:
      var RemoveCopies = {};
      for (var c = 0; c < PreviewLinks.length; c++) {
        RemoveCopies[PreviewLinks[c]] = "";
      }
      PreviewLinks = [];
      var CopiesKeys = Object.keys(RemoveCopies);
      for (var k = 0; k < CopiesKeys.length; k++) {
        PreviewLinks.push(CopiesKeys[k]);
      }

      SendRequest("LinkPreview", { Links: PreviewLinks }, function (Metadata, Data) {
        if (Data.Code == 200) {
          var EmbedFrames = Array.prototype.slice.call(findClass("LinkPreview"));
          for (var i = 0; i < EmbedFrames.length; i++) {
            var EmbedFrame = EmbedFrames[i];
            var Site = EmbedFrame.id.substring(11);
            var SiteData = Data.Links[Site];

            EmbedFrame.className = "LoadedLinkPreview"; // Stop it from being loaded again

            if (SiteData != null) {
              EmbedFrame.setAttribute("title", "Goes To " + Site);

              var SiteDomain = Site.replace(/https\:\/\//g, "").replace(/http\:\/\//g, "");
              var SubIndex = SiteDomain.indexOf("/");
              if (SubIndex != -1) {
                SiteDomain = SiteDomain.substring(0, SubIndex);
              }
              
              if (SiteData.VideoURL != null && UserDisplaySettings["Embed GIFs"] == true) {
                var SitePreviewVideo = createElement("SitePreviewVideo", "video", EmbedFrame, [
                  ["width", "calc(100% - 16px)"],
                  ["margin-left", "8px"],
                  ["margin-top", "8px"],
                  ["border-radius", "6px"]
                ]);
                SitePreviewVideo.src = "https://exotekcdn.exotektechnolog.repl.co/" + encodeURIComponent(SiteData.VideoURL);
                SitePreviewVideo.muted = true;
                SitePreviewVideo.loop = true;
                SitePreviewVideo.play();
                SitePreviewVideo.autoplay = true;
              }

              //if (SiteData.ThumbnailImage != null) {
              createElement("SitePreviewImage", "img", EmbedFrame, [
                ["position", "relative"],
                ["width", "24px"],
                ["height", "24px"],
                ["margin-left", "6px"],
                ["margin-top", "6px"],
                ["object-fit", "cover"],
                ["border-radius", "6px"]
              ]).setAttribute("src", "https://s2.googleusercontent.com/s2/favicons?domain=" + Site); //"https://images.weserv.nl/?url=" + SiteData.ThumbnailImage + "&w=300&h=300");
              //}

              var SitePreviewTitle = createElement("SitePreviewTitle", "span", EmbedFrame, [
                ["position", "relative"],
                ["display", "inline-block"],
                ["width", "calc(100% - 42px)"],
                ["height", "24px"],
                ["margin-left", "6px"],

                // Text:
                ["font-size", "18px"],
                ["overflow", "hidden"],
                ["font-family", FontTypeA],
                ["font-weight", "900"],
                ["color", "#dddddd"],
                ["white-space", "nowrap"],
                ["text-overflow", "ellipsis"],
              ]);
              var TextSet = CleanString(SiteData.Title || SiteDomain);
              SitePreviewTitle.innerHTML = TextSet;
              SitePreviewTitle.innerHTML = SitePreviewTitle.innerHTML.replace(/\&nbsp\;/g, " ");

              if (SiteData.Description != null) {
                var SitePreviewDescription = createElement("SitePreviewDescription", "div", EmbedFrame, [
                  ["position", "relative"],
                  ["width", "calc(100% - 16px)"],
                  ["margin-left", "8px"],

                  // Text:
                  ["font-size", "14px"],
                  ["overflow-wrap", "break-word"],
                  ["white-space", "pre-line"],
                  ["font-family", FontTypeA],
                  ["font-weight", "400"],
                  ["color", "#bbbbbb"]
                ]);
                var TextSet = CleanString(SiteData.Description);
                if (TextSet.length > 190) {  // If greated than 190 characters it will cut it off.
                  TextSet = TextSet.substring(0, 190) + "...";
                }
                SitePreviewDescription.innerHTML = TextSet;
                SitePreviewDescription.innerHTML = SitePreviewDescription.innerHTML.replace(/\&nbsp\;/g, " ");
              }

              createElement("SitePreviewVisitURL", "div", EmbedFrame, [
                ["position", "relative"],
                ["width", "calc(100% - 12px)"],
                ["margin-left", "8px"],
                ["margin-top", "2px"],
                ["margin-bottom", "6px"],

                // Text:
                ["font-size", "14px"],
                ["overflow-wrap", "break-word"],
                ["white-space", "pre-line"],
                ["font-family", FontTypeA],
                ["font-weight", "400"],
                ["color", "#cccccc"],
                ["text-align", "left"]
              ]).textContent = "🔗" + SiteDomain;

              var LinkClickArea = createElement("LinkPreview" + Site, "span", EmbedFrame, [
                ["position", "absolute"],
                ["width", "100%"],
                ["height", "100%"],
                ["left", "0px"],
                ["top", "0px"],
                ["z-index", "5"],
                ["cursor", "pointer"]
              ]);
              LinkClickArea.setAttribute("TypeRender", "WebsiteEmbed");
            }
          }
          /*
          for (var c = 0; c < EmbedFrames.length; c++) {
            EmbedFrames[c].className = "LoadedLinkPreview"; // Stop it from being loaded again
          }
          */
        }
      });
    }
  }
}

var OldestPostTime = 0;
var MaxLoadedPosts = false;
function ProcessPostsFromServer(Data, Filter, CustomHolder) {
  OldestPostTime = 9999999999999;

  var Posts = Data.Posts;
  var Users = {};
  var Likes = {};

  if (Filter != null && Filter.Before != null && Posts.length < (Filter.Amount || 10)) {
    MaxLoadedPosts = true;
  } else {
    MaxLoadedPosts = false;
  }

  for (var u = 0; u < Data.Users.length; u++) {
    var SetObject = Data.Users[u];
    var UserIDSet = SetObject._id;
    delete SetObject._id;
    Users[UserIDSet] = SetObject;
  }
  for (var l = 0; l < Data.Likes.length; l++) {
    var SetObject = Data.Likes[l];
    var UserIDSet = SetObject._id;
    Likes[UserIDSet] = "";
  }
  for (var i = 0; i < Posts.length; i++) {
    var PostLoad = Posts[i];
    var IsLiking = false;
    if (Likes[PostLoad._id + UserID] != null) {
      IsLiking = true;
    }
    OldestPostTime = PostLoad.Timestamp;
    try {
      CreatePostView(PostLoad._id, PostLoad, Users[PostLoad.UserID], (CustomHolder || "PostDisplayHolder"), IsLiking);
    } catch (err) {
      console.log(err);
    };
  }

  if (Filter != null && Filter.Amount != null && Posts.length < Filter.Amount) {
    CreateMiniTextNotif("PostDisplayHolder", "That's all for now...");
  }

  SetupPostChats(false);
  LoadEmbedPreviews();
}

// Shared helper. Lives here (always loaded) instead of Profile.js (lazy-loaded) because the
// feed calls it when fewer posts than requested come back, which previously threw a
// ReferenceError before SetupPostChats() ran, so live chats never loaded.
function CreateMiniTextNotif(Parent, Text) {
  var NewMiniNotif = createElement("MiniNotif", "div", Parent, [
    ["position", "relative"],
    ["margin", "24px 20px 24px 20px"],

    // Text:
    ["font-size", "20px"],
    ["font-family", FontTypeA],
    ["font-weight", "500"],
    ["color", FontColorA],
    ["text-align", "center"]
  ]);
  NewMiniNotif.textContent = Text;
  return NewMiniNotif;
}

var GettingNewPosts = false;
async function GetPosts(ReqData, ViewingOlderPost, Override) {
  if (ViewingProfileID != null && ReqData.FromUserID == null) {
    return;
  } else if (ViewingProfileID != null && (find("PostDisplayHolder") == null || find("PostDisplayHolder").parentNode.id != "ProfileContentHolder")) {
    return;
  }
  if (GettingNewPosts == false || Override == true) {
    GettingNewPosts = true;
    var FilterSend = { Amount: (ReqData.Limit || 15) };
    if (ReqData.Add != "Top") {
      if (MaxLoadedPosts == true || OldestPostTime <= 0) { // End of feed reached.
        GettingNewPosts = false;
        return;
      }
      FilterSend.Before = OldestPostTime;
      if (ReqData.FromUserID != null) {
        FilterSend.FromUserID = ReqData.FromUserID;
      }
      if (ReqData.ExcludePinned != null) {
        FilterSend.ExcludePinned = ReqData.ExcludePinned;
      }
    } else {
      setCSS(ViewRefreshBar, "display", "none");
      OverideTitle("Home");
      CreatePostDisplay();
      window.scrollTo(0, 0);
    }
    SendRequest("GetPosts", FilterSend, function (Metadata, Data) {
      if (ViewingProfileID != null && ReqData.FromUserID == null) {
        return;
      } else if (ViewingProfileID != null && (find("PostDisplayHolder") == null || find("PostDisplayHolder").parentNode.id != "ProfileContentHolder")) {
        return;
      }
      /*
      if (ReqData.Add == "Top") {
        CreatePostDisplay();
      }
      */
      if (Data.Code == 200) {
        ProcessPostsFromServer(Data, FilterSend);
      }
      GettingNewPosts = false;
    });
  }
}

async function GetPostsFromID(SendData, Quote) {
  /*
  if (ViewingProfileID != null) {
    return;
  }
  */
  if (GettingNewPosts == false) {
    if (Quote != null) {
      if (Quote.textContent == "/Post_Invalid") {
        ShowPopUp("Hypothetical Post?", "This post could not be located in the database. The post author most likely mistyped the quote text.", [["Okay", "#618BFF", null]]);
        return;
      }
    }
    GettingNewPosts = true;
    await new Promise(async function verifyPromise(resolve, reject) {
      await SendRequest("GetPosts", { LookupID: SendData.PostID }, async function (Metadata, Data) {
        if (Data.Code == 200) {
          if (Data.Posts.length < 1) {
            GettingNewPosts = false;
            if (Quote != null) {
              Quote.textContent = "/Post_Invalid";
              ShowPopUp("Hypothetical Post?", "This post could not be located in the database. The post author most likely mistyped the quote text.", [["Okay", "#618BFF", null]]);
            }
            resolve();
          } else {
            SwitchPage("Home", true);
            
            URLParams("post", SendData.PostID)
            SetMetaTag("og:title", Data.Posts[0].User + "'s Post");
            SetMetaTag("og:description", Data.Posts[0].Text);
            if (Data.Posts[0].Media != null && Data.Posts[0].Media.ImageCount != null && Data.Posts[0].Media.ImageCount > 0) {
              SetMetaTag("og:image", GoogleCloudStorgeURL + "PostImages/" + SendData.PostID + "0");
            }
            SetPageTitle("Viewing Post");

            CreatePostDisplay();
            await ProcessPostsFromServer(Data);
            window.scrollTo(0, 0);
            ViewRefreshBar.innerHTML = "Your are viewing older posts. Do you want to <div style='display: inline-block; background-color:" + ThemeColor + "; opacity: 0.9; border-radius: 6px; padding-left: 4px; padding-right: 4px; padding-top: 1px; padding-bottom: 1px; cursor: pointer; color: #ffffff'>Go Home</div>";
            setCSS(ViewRefreshBar, "display", "block");
            var Object = find(Data.Posts[0]._id);
            if (Object != null) {
              try {
                Object.animate([
                  { backgroundColor: "#A743E0", offset: 0.1 },
                  { backgroundColor: "#A743E0", offset: 0.8 },
                  { backgroundColor: ContentColor },
                ], 1500);
              } catch { }
            }
            if (OldestPostTime > 0) {
              GetPosts({  // Get the beginning posts:
                Add: "Merge",
                Limit: 14
              }, null, true);
            } else {
              GettingNewPosts = false;
            }
          }
        } else {
          GettingNewPosts = false;
        }
        if (Data.Code == 500) {
          URLParams("post");
          GettingNewPosts = false;
          Quote.textContent = "/Post_Invalid";
          ShowPopUp("Hypothetical Post?", "This post could not be located in the database. The post author most likely mistyped the quote text.", [["Okay", "#618BFF", null]]);
          if (Quote == "PageLoad") {
            GetPosts({
              Add: "Top",
              Limit: 15
            });
          }
        }
        resolve();
      });
    });
  }
}

async function GetProfileLikes(SendData) {
  if (MaxLoadedPosts == true || GettingNewPosts == true) {
    return;
  }
  GettingNewPosts = true;
  SendRequest("GetProfileLikes", { Amount: SendData.Amount, GetUserID: SendData.GetUserID, Before: SendData.Before }, function (Metadata, Data) {
    if (Data.Code == 200) {

      var Posts = {};
      var Users = {};
      var Likes = {};
      
      for (var u = 0; u < Data.Users.length; u++) {
        var SetObject = Data.Users[u];
        Users[SetObject._id] = SetObject;
      }
      for (var l = 0; l < Data.Likes.length; l++) {
        var SetObject = Data.Likes[l];
        Likes[SetObject._id] = "";
      }
      for (var p = 0; p < Data.Posts.length; p++) {
        var SetObject = Data.Posts[p];
        Posts[SetObject._id] = SetObject;
      }
      for (var i = 0; i < Data.LikePostData.length; i++) {
        var LikePostLoad = Data.LikePostData[i];
        var PostLoad = Posts[LikePostLoad._id.substring(0, LikePostLoad._id.length / 2)];
        if (PostLoad != null) {
          var IsLiking = false;
          if (Likes[PostLoad._id + UserID] != null) {
            IsLiking = true;
          }
          OldestPostTime = PostLoad.Timestamp;
          try {
            CreatePostView(PostLoad._id, PostLoad, Users[PostLoad.UserID], "LikeDisplayHolder", IsLiking);
          } catch (err) {
            console.log(err);
          };
        }
      }

      if (Data.LikePostData.length < SendData.Amount) {
        MaxLoadedPosts = true;
        CreateMiniTextNotif("LikeDisplayHolder", "That's all for now...");
      } else {
        MaxLoadedPosts = false;
      }

      var LastLikeItemTime = null;
      if (Data.LikePostData[Data.LikePostData.length-1] != null) {
          LastLikeItemTime = Data.LikePostData[Data.LikePostData.length-1].Timestamp;
      }
      CustumLoadData = { LastItemTime: LastLikeItemTime };
    }
    GettingNewPosts = false;
  });
}

var GettingNewChats = false;
var MaxLoadedChats = false;
async function GetChats(SendData) {
  if (MaxLoadedChats == true || GettingNewChats == true) {
    return;
  }
  GettingNewChats = true;
  SendRequest("GetProfileChats", { Amount: SendData.Amount, GetUserID: SendData.GetUserID, Before: SendData.Before }, function (Metadata, Data) {
    if (Data.Code == 200) {

      var Replies = {};
      if (Data.Replies != null) {
        for (var r = 0; r < Data.Replies.length; r++) {
          var SetObject = Data.Replies[r];
          var ReplyIDSet = SetObject._id;
          delete SetObject._id;
          Replies[ReplyIDSet] = SetObject;
        }
      }

      LoadProfileChats(Data.Chats, Replies);

      if (Data.Chats.length < SendData.Amount) {
        MaxLoadedChats = true;
        CreateMiniTextNotif("ProfileContentHolder", "That's all for now...");
      }
    }
    GettingNewChats = false;
  });
}

var DataPostEmbedLoad = [];
function LoadPlatformEmbeds(Embeds) {
  DataPostEmbedLoad = [];

  var SendEmbedData = [];

  for (var q = 0; q < Embeds.length; q++) {
    var LoadEmbedData = Embeds[q];
    createElement(LoadEmbedData[0] + "Embed" + LoadEmbedData[1] + "FromPost" + LoadEmbedData[2], "div", LoadEmbedData[3], [
        ["position", "relative"],
        ["display", "inline-block"],
        ["width", "95%"],
        ["margin-left", "3.5%"],
        ["margin-top", "4px"],
        ["border-radius", "12px"],
        ["background-color", ContentColorLayer2],
        ["z-index", "8"],
        ["cursor", "pointer"],
        ["vertical-align", "top"],
        ["white-space", "nowrap"]
    ]);
    SendEmbedData.push({ AssetType: LoadEmbedData[0], AssetID: LoadEmbedData[1] })
    //GetQuotePost(LoadEmbedData[2], LoadEmbedData[1]);
  }

  if (Embeds.length < 1) {
    return;
  }
  
  SendRequest("LoadPlatformEmbeds", { Embeds: SendEmbedData }, async function (Metadata, Data) {
    if (Data.Code == 200) {
      for (var e = 0; e < Embeds.length; e++) {
        var LoadEmbedData = Embeds[e];
        var EmbedData = Data.EmbedData[LoadEmbedData[0] + LoadEmbedData[1]];
        var EmbedID = LoadEmbedData[0]  + "Embed" + LoadEmbedData[1] + "FromPost" + LoadEmbedData[2];
        
        if (EmbedData != null) {
          var UserData = Data.UserData[EmbedData.UserID];
          var EmbedContentFrame = find(EmbedID);

          if (LoadEmbedData[0] == "Chat") {
            setCSS(EmbedContentFrame, "box-sizing", "border-box");
            setCSS(EmbedContentFrame, "padding-top", "6px");
            setCSS(EmbedContentFrame, "min-height", "47px");
            if (EmbedData.ReplyID != null && Data.EmbedData["Chat" + EmbedData.ReplyID] != null) {
                var ReplyData = Data.EmbedData["Chat" + EmbedData.ReplyID];
                var ReplyHolder = createElement("ReplyHolder", "div", EmbedContentFrame, [
                    ["position", "relative"],
                    ["width", "calc(100% - 6px)"],
                    ["height", "16px"],
                    ["overflow", "hidden"],
            
                    // Text:
                    ["font-size", "12px"],
                    ["white-space", "nowrap"],
                    ["text-overflow", "ellipsis"],
                    ["overflow", "hidden"],
                    ["font-family", FontTypeA],
                    ["font-weight", "900"],
                    ["color", "#aaaaaa"],
                    ["text-align", "left"],
                    ["vertical-align", "top"]
                ]);
                createElement("QuoteLine", "div", ReplyHolder, [
                    ["position", "absolute"],
                    ["display", "inline-block"],
                    ["width", "20px"],
                    ["height", "10px"],
                    ["margin-left", "23.5px"],
                    ["margin-top", "6px"],
                    ["border-style", "solid"],
                    ["border-width", "0px"],
                    ["border-left-width", "3px"],
                    ["border-top-width", "3px"],
                    ["border-color", "#666666"],
                    ["box-sizing", "border-box"],
                    ["border-top-left-radius", "8px"]
                ]);
                var ReplyUsername = createElement("ReplyUsername", "span", ReplyHolder, [
                    ["position", "relative"],
                    //["display", "inline-block"],
                    ["margin-left", "47.5px"],
                    ["margin-bottom", "2px"],
                    ["padding-left", "2px"],
                    ["cursor", "pointer"],
                
                    // Text:
                    ["font-size", "12px"],
                    ["overflow", "hidden"],
                    ["font-family", FontTypeA],
                    ["font-weight", "900"],
                    ["color", "#cccccc"],
                    ["text-align", "left"]
                ]);
                var ReplyText = createElement("ReplyText", "span", ReplyHolder, [
                    ["position", "relative"],
                    //["display", "inline-block"],
                    ["margin-left", "4px"],
                    ["margin-bottom", "2px"],
                    //["width", "calc(100% - " + (ReplyHolder.clientWidth - (23.5 + QuoteLine.clientWidth + 4 + ReplyUsername.clientWidth)) + "px)"],
                    ["cursor", "pointer"],
            
                    // Text:
                    ["font-size", "12px"],
                    ["white-space", "nowrap"],
                    ["font-family", FontTypeA],
                    ["font-weight", "900"],
                    ["color", "#aaaaaa"],
                    ["text-align", "left"]
                ]);
                if (ReplyData != null) {
                    ReplyHolder.setAttribute("ReplyID", EmbedData.ReplyID);
                    
                    if (Data.UserData[ReplyData.UserID].User != null) {
                        ReplyUsername.textContent = Data.UserData[ReplyData.UserID].User;
                    }
    
                    ReplyText.innerHTML = CleanString(ReplyData.Text);
                    ReplyText.innerHTML = ReplyText.innerHTML.replace(/\&nbsp;/g, " ");
                } else {
                    ReplyUsername.innerHTML = "<i style='color: #aaaaaa'>Deleted</i>"
                }
            }
        
            //SetOnLoad.ChatProfilePic = 
            createElement("ChatProfilePic", "div", EmbedContentFrame, [
                ["position", "absolute"],
                ["width", "35px"],
                ["height", "35px"],
                ["left", "6px"],
                ["border-radius", "8px"],
                ["object-fit", "cover"],
            
                ["content", "url('" + GoogleCloudStorgeURL + "ProfileImages/" + DecideProfilePic(UserData) + "')"]
            ]);
            //SetOnLoad.ChatUsername = 
            var ChatUsername = createElement("ChatUsername", "div", EmbedContentFrame, [
                ["position", "relative"],
                ["display", "block"],
                ["width", "calc(100% - 50px)"],
                //["height", "18px"],
                ["left", "45px"],
                ["margin-top", "-2px"],
            
                // Text:
                ["font-size", "15px"],
                ["white-space", "nowrap"],
                ["text-overflow", "ellipsis"],
                ["overflow", "hidden"],
                ["font-family", FontTypeA],
                ["font-weight", "500"],
                ["color", FontColorA],
                ["text-align", "left"]
            ]);
            SetUsernameRole(ChatUsername, UserData);
            
            if (EmbedData.Timestamp != null) {
                var CalcTimestamp = Math.floor((Date.now() - EmbedData.Timestamp) / 1000);
                if (CalcTimestamp < 1) {
                    CalcTimestamp = 1; // Prevent negative timestamps.
                }
                var AmountDivide = 1;
                var End = "s"; // Second
                if (CalcTimestamp > 31536000-1) {
                    AmountDivide = 31536000;
                    End = "y"; // Year
                } else if (CalcTimestamp > 2592000-1) {
                    AmountDivide = 2592000;
                    End = "mo"; // Month
                } else if (CalcTimestamp > 604800-1) {
                    AmountDivide = 604800;
                    End = "w"; // Week
                } else if (CalcTimestamp > 86400-1) {
                    AmountDivide = 86400;
                    End = "d"; // Day
                } else if (CalcTimestamp > 3600-1) {
                    AmountDivide = 3600;
                    End = "h"; // Hour
                } else if (CalcTimestamp > 60-1) {
                    AmountDivide = 60;
                    End = "m"; // Minute
                }
                var TimeToSet = Math.round(CalcTimestamp / AmountDivide) || "0";
                ChatUsername.innerHTML = ChatUsername.innerHTML + " <span title='Sent: " + new Date(EmbedData.Timestamp) + "' style='font-size: 12px; color: #bbbbbb'>" + TimeToSet + End + "</span>";
            }
        
            EmbedData.Text = CleanString(EmbedData.Text);
            
            var ChatText = createElement("ChatText", "div", EmbedContentFrame, [
                ["position", "relative"],
                ["display", "block"],
                ["width", "calc(100% - 60px)"],
                ["left", "45px"],
                ["margin-top", "1px"],
                ["padding-bottom", "6px"],
            
                // Text:
                ["font-size", "14px"],
                ["font-family", FontTypeA],
                ["font-weight", "400"],
                ["color", FontColorA],
                ["text-align", "left"],
                ["overflow-wrap", "break-word"],
                ["white-space", "pre-wrap"]
            ]);
            ChatText.innerHTML = CleanString(EmbedData.Text);
            ChatText.innerHTML = ChatText.innerHTML.replace(/\&nbsp;/g, " ").replace(/\$\[NEWLINE\]\;/g, "<br/>");
            ChatText.className = UserData.User + "ChatText";
    
            createElement("LoadChat" + LoadEmbedData[1], "span", EmbedContentFrame, [
                ["position", "absolute"],
                ["width", "100%"],
                ["height", "100%"],
                ["left", "0px"],
                ["top", "0px"],
                ["z-index", "10"]
            ]).setAttribute("TypeRender", "LoadChatFromID");
          } else if (LoadEmbedData[0] == "Post") {
            var PostInfo = createElement(EmbedID + "UserHolderQUOTE", "div", EmbedContentFrame, [
              ["position", "relative"],
              ["width", "100%"],
              ["cursor", "pointer"]
            ]);
            var PostContent = createElement(EmbedID + "ContentQUOTE", "div", EmbedContentFrame, [
              ["position", "relative"],
              ["width", "100%"],
              ["overflow", "hidden"],
              ["cursor", "pointer"]
            ]);

            createElement(EmbedID + "ProfilePicQUOTE", "div", PostInfo, [
              ["position", "absolute"],
              ["width", "36px"],
              ["height", "36px"],
              ["left", "6px"],
              ["top", "6px"],
              ["object-fit", "cover"],
              ["border-radius", "8px"],

              ["content", "url('" + GoogleCloudStorgeURL + "ProfileImages/" + DecideProfilePic(UserData) + "')"]
            ]);

            var UsernameText = createElement(EmbedID + "UserQUOTE", "div", PostInfo, [
              ["position", "relative"],
              ["width", "calc(100% - 70px)"],
              ["left", "46px"],
              ["min-height", "24px"],
              ["padding-bottom", "4px"],
              ["top", "6px"],

              // Text:
              ["font-size", "16px"],
              ["font-family", FontTypeA],
              ["font-weight", "900"],
              ["color", FontColorA],
              ["text-align", "left"],
              ["white-space", "nowrap"],
              ["text-overflow", "ellipsis"],
              ["overflow", "hidden"]
            ]);
            SetUsernameRole(UsernameText, UserData);
            if (UsernameText != null) {
              UsernameText.className = UserData.User + "PostText";
            }

            var CalcTimestamp = Math.floor((Date.now() - EmbedData.Timestamp) / 1000);
            if (CalcTimestamp < 1) {
              CalcTimestamp = 1; // Prevent negative timestamps.
            }
            var AmountDivide = 1;
            var End = "Second";
            if (CalcTimestamp > 31536000 - 1) {
              AmountDivide = 31536000;
              End = "Year";
            } else if (CalcTimestamp > 2592000 - 1) {
              AmountDivide = 2592000;
              End = "Month";
            } else if (CalcTimestamp > 604800 - 1) {
              AmountDivide = 604800;
              End = "Week";
            } else if (CalcTimestamp > 86400 - 1) {
              AmountDivide = 86400;
              End = "Day";
            } else if (CalcTimestamp > 3600 - 1) {
              AmountDivide = 3600;
              End = "Hour";
            } else if (CalcTimestamp > 60 - 1) {
              AmountDivide = 60;
              End = "Minute";
            }
            var TimeToSet = Math.round(CalcTimestamp / AmountDivide);
            if (TimeToSet > 1) {
              // Add "S":
              End += "s";
            }

            var PostInfo = createElement(EmbedID + "PostInfoQUOTE", "div", PostInfo, [
              ["position", "relative"],
              ["max-width", "calc(100% - 70px)"],
              ["height", "18px"],
              ["left", "46px"],

              // Text:
              ["font-size", "12px"],
              ["font-family", FontTypeA],
              ["font-weight", "900"],
              ["color", "#999999"],
              ["text-align", "left"],
              ["white-space", "nowrap"],
              ["text-overflow", "ellipsis"],
              ["overflow", "hidden"]
            ]);
            PostInfo.textContent = TimeToSet + " " + End + " Ago";
            PostInfo.setAttribute("title", new Date(EmbedData.Timestamp));

            var PostText = createElement(EmbedID + "TextHolderQUOTE", "div", PostContent, [
              ["position", "relative"],
              ["display", "block"],
              ["width", "95%"],
              ["max-height", "100%"],
              ["margin-left", "3.5%"],
              ["padding-bottom", "6px"],
              ["z-index", "5"],

              // Text:
              ["font-size", "16px"],
              ["overflow-wrap", "break-word"],
              ["white-space", "pre-wrap"],
              ["font-family", FontTypeA],
              ["font-weight", "400"],
              ["color", FontColorA],
              ["text-align", "left"],
              ["overflow", "hidden"]
            ]);

            // GENERATE TEXT:
            var StandardText = CleanString(EmbedData.Text);

            StandardText = StandardText.replace(/\$\[NEWLINE\]\;/g, "<br/>").replace(/\$\[NEWLINE\]/g, "<br/>");

            PostText.innerHTML = StandardText;
            PostText.innerHTML = PostText.innerHTML.replace(/&nbsp;/g, " ");

            var QuoteClickArea = createElement(EmbedID + "ClickAreaQUOTE", "span", EmbedContentFrame, [
              ["position", "absolute"],
              ["width", "100%"],
              ["height", "100%"],
              ["left", "0px"],
              ["top", "0px"],
              ["z-index", "5"],
              ["cursor", "pointer"]
            ]);
            QuoteClickArea.setAttribute("TypeRender", "Quote");
            QuoteClickArea.setAttribute("QuoteEmbedLink", LoadEmbedData[1]);

            if (EmbedData.Media != null && Object.keys(EmbedData.Media).length > 0) {
              var MediaHolder = createElement(EmbedID + "MediaHolderQUOTE", "div", PostContent, [
                ["position", "relative"],
                ["max-width", "95%"],
                ["height", "80px"],
                ["margin-left", "3.5%"],
                ["margin-top", "-2px"],
                ["margin-bottom", "8px"],
                ["border-radius", "12px"],
                ["cursor", "pointer"],
                ["vertical-align", "top"],
                ["overflow", "hidden"]
              ]);
              if (EmbedData.Media != null && EmbedData.Media.ImageCount != null) {
                for (var i = 0; i < EmbedData.Media.ImageCount; i++) {
                  function NewViewImage() {
                    var Image = createElement("Image", "img", MediaHolder, [
                      ["position", "relative"],
                      ["display", "inline-block"],
                      ["height", "100%"],
                      ["min-width", "35px"],
                      ["margin-right", "6px"],
                      ["border-radius", "12px"],
                      ["z-index", "10"]
                    ]);
                    Image.src = GoogleCloudStorgeURL + "PostImages/" + LoadEmbedData[1] + i;
                    Image.addEventListener("click", function () {
                      HighlightedMedia(Image.src);
                    });
                  }
                  NewViewImage();
                }
              }
            }
          }
        } else {
          var RemoveEmbedFrame = find(EmbedID);
          if (RemoveEmbedFrame != null) {
            RemoveEmbedFrame.remove();
          }
        }
      }
    }
  });
}

function SetPostLikeText(LikeButton, Likes) {
  if (LikeButton == null) {
    return;
  }
  // The count lives in the first text node; the heart is an SVG child that
  // must not be destroyed just to update a number.
  for (var i = 0; i < LikeButton.childNodes.length; i++) {
    if (LikeButton.childNodes[i].nodeType == 3) {
      LikeButton.childNodes[i].nodeValue = String(Likes);
      return;
    }
  }
  LikeButton.insertBefore(document.createTextNode(String(Likes)), LikeButton.firstChild);
}

function UpdatePostLikeDisplay(PostID, Likes, IsLiked) {
  if (PostID == null || Likes == null) {
    return;
  }
  if (LoadedPostData[PostID] != null) {
    LoadedPostData[PostID].Likes = Likes;
    if (IsLiked != null) {
      LoadedPostData[PostID].IsLiked = IsLiked;
    }
  }
  SetPostLikeText(find(PostID + "Likes"), Likes);
}

function UpdatePostLikes(Metadata, Body) {
  if (Body == null || Body.PostID == null || Body.Likes == null) {
    return;
  }
  // Only apply the "liked" state when this packet describes our own action.
  // (Do not use a top-level UserID field here: the generic client packet
  // handler treats Body.UserID as the logged-in user and would overwrite it.)
  var IsLiked = null;
  if (Body.LikedBy != null && Body.LikedBy == UserID) {
    IsLiked = Body.IsLiked;
  }
  UpdatePostLikeDisplay(Body.PostID, Body.Likes, IsLiked);
}

async function LikePost(PostID, IsLiking) {
  var Task = (IsLiking == false) ? "LikePost" : "UnlikePost";
  SendRequest(Task, { PostID: PostID }, function (Metadata, Body) {
    if (Body != null && Body.Code == 200) {
      UpdatePostLikeDisplay(PostID, Body.Likes, Body.IsLiked);
    }
  });
}

function ChatLikeColor(IsLiked) {
  return IsLiked ? "#FF5786" : "#999999";
}

function CreateChatLikeButton(ChatID, ChatMessage, Likes, IsLiked) {
  Likes = Number(Likes) || 0;
  var LikeButton = createElement(ChatID + "ChatLike", "div", ChatMessage, [
    ["position", "absolute"],
    ["display", "flex"],
    ["align-items", "center"],
    ["justify-content", "center"],
    ["right", "5px"],
    ["bottom", "2px"],
    ["height", "18px"],
    ["min-width", "30px"],
    ["padding-left", "3px"],
    ["padding-right", "3px"],
    ["z-index", "7"],
    ["border-radius", "9px"],
    ["cursor", "pointer"],
    ["background-color", "rgba(0, 0, 0, 0.12)"],
    ["font-family", FontTypeA],
    ["font-size", "12px"],
    ["font-weight", "900"],
    ["user-select", "none"]
  ]);
  LikeButton.setAttribute("title", IsLiked ? "Unlike Chat" : "Like Chat");

  var Heart = createElement(ChatID + "ChatLikeHeart", "span", LikeButton, [
    ["position", "relative"],
    ["font-size", "14px"],
    ["line-height", "18px"],
    ["color", ChatLikeColor(IsLiked)]
  ]);
  Heart.innerHTML = "&#9829;";

  var Count = createElement(ChatID + "ChatLikeCount", "span", LikeButton, [
    ["position", "relative"],
    ["margin-left", "3px"],
    ["line-height", "18px"],
    ["color", ChatLikeColor(IsLiked)]
  ]);
  Count.textContent = Likes;

  ChatMessage.setAttribute("ChatLikes", String(Likes));
  ChatMessage.setAttribute("ChatIsLiked", IsLiked ? "true" : "false");

  LikeButton.addEventListener("click", function (event) {
    event.stopPropagation();
    if (event.preventDefault != null) {
      event.preventDefault();
    }
    if (UserID == null) {
      ShowPopUp("It's Better Together", "Join the hangout today! You must <b>sign in</b> or <b>sign up</b> before being able to <b style='color: #FF5786'>Like</b> a chat!", [ ["Sign In", ThemeColor, "StartSignIn"], ["Sign Up", "#2AF5B5", "StartSignUp"], ["Later", "#B3B3B3", null] ]);
      return;
    }

    var CurrentlyLiked = ChatMessage.getAttribute("ChatIsLiked") == "true";
    var CurrentLikes = parseInt(ChatMessage.getAttribute("ChatLikes")) || 0;
    LikeChat(ChatID, CurrentlyLiked);
    UpdateChatLikeDisplay(ChatID, Math.max(0, CurrentLikes + (CurrentlyLiked ? -1 : 1)), !CurrentlyLiked);
  });

  return LikeButton;
}

function UpdateChatLikeDisplay(ChatID, Likes, IsLiked) {
  var ChatMessage = find(ChatID + "Chat");
  if (ChatMessage == null) {
    return;
  }

  ChatMessage.setAttribute("ChatLikes", String(Likes));
  if (IsLiked != null) {
    ChatMessage.setAttribute("ChatIsLiked", IsLiked ? "true" : "false");
  }
  var NowLiked = ChatMessage.getAttribute("ChatIsLiked") == "true";
  var Color = ChatLikeColor(NowLiked);

  var Count = find(ChatID + "ChatLikeCount");
  if (Count != null) {
    Count.textContent = Likes;
    Count.style.color = Color;
  }
  var Heart = find(ChatID + "ChatLikeHeart");
  if (Heart != null) {
    Heart.style.color = Color;
  }
  var LikeButton = find(ChatID + "ChatLike");
  if (LikeButton != null) {
    LikeButton.setAttribute("title", NowLiked ? "Unlike Chat" : "Like Chat");
  }
}

function LikeChat(ChatID, IsLiking) {
  var Task = (IsLiking == true) ? "UnlikeChat" : "LikeChat";
  SendRequest(Task, { ChatID: ChatID }, function (Metadata, Body) {
    if (Body != null && Body.Code == 200) {
      UpdateChatLikeDisplay(ChatID, Body.Likes, Body.IsLiked);
    }
  });
}

function UpdateChatLikes(Metadata, Body) {
  if (Body == null || Body.ChatID == null || Body.Likes == null) {
    return;
  }
  // Only adopt the liked state when this packet describes our own action.
  // (Body.UserID would be interpreted as the logged-in user by the packet handler.)
  var IsLiked = null;
  if (Body.LikedBy != null && Body.LikedBy == UserID) {
    IsLiked = Body.IsLiked;
  }
  UpdateChatLikeDisplay(Body.ChatID, Body.Likes, IsLiked);
}


function SendChat(Data, PreviewExtras) {
  SendRequest("CreateChat", Data, function(Metadata, Body) {
    if (Body.Code == 400) {
      var GhostChats = document.getElementsByClassName("GhostSendChatMessage" + Data.PostID);
      for (var g = 0; g < GhostChats.length; g++) {
        GhostChats[g].remove();
      }
    }
  });
  var LiveChatFrame = find(Data.PostID + "LiveChat");
  if (LiveChatFrame != null) {
    var ScrollFrame = LiveChatFrame.querySelector("#Chat");
    if (ScrollFrame != null) {
      if (ScrollFrame.querySelector("#Holder") != null) {
        var SendChatUserData = {};
        SendChatUserData[UserID] = { User: Username, Role: LoginUserRole, Settings: { ProfilePic: Settings.ProfilePic } };
        RenderChatMessage([Data.PostID], [{ UserID: UserID, Text: Data.Text, PostID: Data.PostID, ReplyID: Data.ReplyID, Sending: true }], SendChatUserData, PreviewExtras.Replies, false, false, true, true);
      }
    }
  }
}

function CreateNormalChat(Data, UserData, Holder, ReplyData) {
  var SetBodyCSS = [
    ["position", "relative"],
    //["display", "none"],
    ["flex", "0 0 auto"],
    ["width", "calc(100% - 8px)"],
    ["min-height", "35px"],
    ["bottom", "0px"],
    ["margin-left", "4px"],
    ["margin-top", "2px"],
    ["margin-bottom", "2px"],
    ["padding-top", "6px"],
    ["padding-bottom", "4px"],
    ["z-index", "4"],
    ["border-radius", "10px"],
    ["overflow", "hidden"]
  ];
  var ProfileImage = "";
  if (Data.Source == null) {
    ProfileImage = GoogleCloudStorgeURL + "ProfileImages/" + DecideProfilePic(UserData);
  }
  if (Data.Source == "Twitch") {
    ProfileImage = "./Images/TwitchProfileImg.png";
    SetBodyCSS.push(["background-color", "rgba(100, 65, 165, 0.15)"]);
  }

  var ChatMessage = createElement(Data._id + "Chat", "div", Holder, SetBodyCSS);

  if (Data.ReplyID != null) {
    var ReplyHolder = createElement("ReplyHolder", "div", ChatMessage, [
      ["position", "relative"],
      ["width", "calc(100% - 6px)"],
      ["height", "16px"],
      ["overflow", "hidden"],

      // Text:
      ["font-size", "12px"],
      ["white-space", "nowrap"],
      ["text-overflow", "ellipsis"],
      ["overflow", "hidden"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#aaaaaa"],
      ["text-align", "left"],
      ["vertical-align", "top"]
    ]);
    createElement("QuoteLine", "div", ReplyHolder, [
      ["position", "absolute"],
      ["display", "inline-block"],
      ["width", "20px"],
      ["height", "10px"],
      ["margin-left", "23.5px"],
      ["margin-top", "6px"],
      ["border-style", "solid"],
      ["border-width", "0px"],
      ["border-left-width", "3px"],
      ["border-top-width", "3px"],
      ["border-color", "#666666"],
      ["box-sizing", "border-box"],
      ["border-top-left-radius", "8px"]
    ]);
    var ReplyUsername = createElement("ReplyUsername", "span", ReplyHolder, [
      ["position", "relative"],
      //["display", "inline-block"],
      ["margin-left", "47.5px"],
      ["margin-bottom", "2px"],
      ["padding-left", "2px"],
      ["cursor", "pointer"],

      // Text:
      ["font-size", "12px"],
      ["overflow", "hidden"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#cccccc"],
      ["text-align", "left"]
    ]);
    var ReplyText = createElement("ReplyText", "span", ReplyHolder, [
      ["position", "relative"],
      //["display", "inline-block"],
      ["margin-left", "4px"],
      ["margin-bottom", "2px"],
      //["width", "calc(100% - " + (ReplyHolder.clientWidth - (23.5 + QuoteLine.clientWidth + 4 + ReplyUsername.clientWidth)) + "px)"],
      ["cursor", "pointer"],

      // Text:
      ["font-size", "12px"],
      ["white-space", "nowrap"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#aaaaaa"],
      ["text-align", "left"]
    ]);
    if (ReplyData != null) {
      ReplyHolder.setAttribute("ReplyID", Data.ReplyID);

      ReplyUsername.textContent = ReplyData.UserData.User;

      ReplyText.innerHTML = CleanString(ReplyData.Text);
      ReplyText.innerHTML = ReplyText.innerHTML.replace(/\&nbsp;/g, " ");
    } else {
      ReplyUsername.innerHTML = "<i style='color: #aaaaaa'>Deleted</i>"
    }
  }

  var ChatProfilePic = createElement("ChatProfilePic", "div", ChatMessage, [
    ["position", "absolute"],
    ["width", "35px"],
    ["height", "35px"],
    ["left", "6px"],
    //["top", "6px"],
    ["z-index", "6"],
    ["border-radius", "8px"],
    ["object-fit", "cover"],
    ["cursor", "pointer"],
    //UserData.Settings.ProfilePic

    ["content", "url('" + ProfileImage + "')"]

    //["content", "url('" + "https://firebasestorage.googleapis.com/v0/b/parcel-7d05a.appspot.com/o/ProfileImages%2F" + ( || "StandardProfilePic1.png") + "?alt=media" + "')"]
  ]);
  
  //SetOnLoad.ChatUsername = 
  var ChatUsername = createElement("ChatUsername", "div", ChatMessage, [
    ["position", "relative"],
    ["display", "inline-table"],
    ["max-width", "calc(100% - 50px)"],
    //["height", "18px"],
    ["left", "45px"],
    ["margin-top", "-2px"],
    ["cursor", "pointer"],

    // Text:
    ["font-size", "15px"],
    ["white-space", "nowrap"],
    ["text-overflow", "ellipsis"],
    ["overflow", "hidden"],
    ["font-family", FontTypeA],
    ["font-weight", "500"],
    ["color", FontColorA],
    ["text-align", "left"]
  ]);
  SetUsernameRole(ChatUsername, UserData);

  if (Data.Timestamp != null) {
    var CalcTimestamp = Math.floor((Date.now() - Data.Timestamp) / 1000);
    if (CalcTimestamp < 1) {
      CalcTimestamp = 1; // Prevent negative timestamps.
    }
    var AmountDivide = 1;
    var End = "s"; // Second
    if (CalcTimestamp > 31536000 - 1) {
      AmountDivide = 31536000;
      End = "y"; // Year
    } else if (CalcTimestamp > 2592000 - 1) {
      AmountDivide = 2592000;
      End = "mo"; // Month
    } else if (CalcTimestamp > 604800 - 1) {
      AmountDivide = 604800;
      End = "w"; // Week
    } else if (CalcTimestamp > 86400 - 1) {
      AmountDivide = 86400;
      End = "d"; // Day
    } else if (CalcTimestamp > 3600 - 1) {
      AmountDivide = 3600;
      End = "h"; // Hour
    } else if (CalcTimestamp > 60 - 1) {
      AmountDivide = 60;
      End = "m"; // Minute
    }
    var TimeToSet = Math.round(CalcTimestamp / AmountDivide) || "0";
    ChatUsername.innerHTML = ChatUsername.innerHTML + " <span title='Sent: " + new Date(Data.Timestamp) + "' style='font-size: 12px; color: #bbbbbb'>" + TimeToSet + End + "</span>";
  }

  var TextFontColor = FontColorA;
  if (Data.Sending == true) {
    TextFontColor = "#aaaaaa";
    ChatMessage.className = "GhostSendChatMessage" + Data.PostID;
    ChatMessage.setAttribute("title", "Sending Chat");
  }

  Data.Text = CleanString(Data.Text);

  var ChatText = createElement("ChatText", "div", ChatMessage, [
    ["position", "relative"],
    ["display", "block"],
    ["width", "calc(100% - 60px)"],
    ["left", "45px"],
    ["margin-top", "1px"],

    // Text:
    ["font-size", "14px"],
    ["font-family", FontTypeA],
    ["font-weight", "400"],
    ["color", TextFontColor],
    ["text-align", "left"],
    ["overflow-wrap", "break-word"],
    //["white-space", "pre-wrap"]
  ]);
  ChatText.innerHTML = CleanString(Data.Text);
  ChatText.innerHTML = ChatText.innerHTML.replace(/\&nbsp;/g, " ").replace(/\$\[NEWLINE\]\;/g, "<br/>");
  ChatText.className = UserData.User + "ChatText";
  if (Data.EditedAt != null) {
    AddChatEditedMarker(ChatMessage, Data._id);
  }

  // Only real Photop chats have a stable backend id to attach likes to.
  ChatMessage.setAttribute("Source", Data.Source != null ? Data.Source : "");
  if (Data.Source == null && Data._id != null && Data.Sending != true) {
    setCSS(ChatText, "width", "calc(100% - 96px)");
    CreateChatLikeButton(Data._id, ChatMessage, Data.Likes, Data.IsLiked == true);
  }

  //ReadUser(Data.UserID, SetOnLoad);
  if (Data.Source == null) {
    ChatProfilePic.setAttribute("LoadUserID", Data.UserID);
    ChatUsername.setAttribute("LoadUserID", Data.UserID);

    ChatMessage.setAttribute("onMouseOver", "ChatHoverDetector(this)");
    ChatMessage.setAttribute("onMouseOut", "ChatHoverOutDetector(this)");
    ChatMessage.setAttribute("FunctionHoverClickData", "LiveChatDropdownData");
    ChatMessage.setAttribute("User", UserData.User);
    ChatMessage.setAttribute("Text", Data.Text);
  } else if (Data.Source == "Twitch") {
    /*
    ChatMessage.addEventListener("click", function() {
      ShowPopUp("Twitch Chat", "This is a chat from <b style='color:#6441a5'>Twitch.com</b>, and is only viewable. Chatting on this post only appears here on <b>Memblu</b>!", [ ["Okay", "#618BFF", null] ]);
    });
    */
    ChatMessage.setAttribute("LiveChatClickData", "TwitchLiveChatPopUp");
  }

  return ChatMessage;
}

function CreateMinifyChat(Data, UserData, Holder, PreviousChildDOMObject, ForceMargin) {
  var SetBodyCSS = [
    ["position", "relative"],
    //["display", "none"],
    ["flex", "0 0 auto"],
    ["width", "calc(100% - 8px)"],
    ["bottom", "0px"],
    ["margin-left", "4px"],
    ["margin-top", "2px"],
    ["padding-bottom", "2px"],
    ["z-index", "4"],
    ["border-radius", "10px"],
    ["overflow", "hidden"]
  ];

  if (PreviousChildDOMObject.querySelector("#ChatProfilePic") != null && ForceMargin != true) {
    SetBodyCSS.push(["margin-top", "-3px"]);
  } else {
    SetBodyCSS.push(["margin-top", "2px"]);
  }

  var ChatMessage = createElement(Data._id + "Chat", "div", Holder, SetBodyCSS);

  // Keep identity on the DOM node: minified chats are also rebuilt from a sibling
  // message, and the click dropdown needs UserID to decide who may delete the chat.
  if (Data.UserID != null) {
    ChatMessage.setAttribute("UserID", Data.UserID);
  }
  if (Data.Timestamp != null) {
    ChatMessage.setAttribute("Timestamp", Data.Timestamp);
  }

  if (Data.Timestamp != null) {
    var MiniTimestampTx = createElement("MiniTimestampTx", "div", ChatMessage, [
      ["position", "absolute"],
      ["display", "none"],
      ["width", "30px"],
      ["left", "10px"],
      ["top", "3px"],
      ["z-index", "6"],
      ["border-radius", "8px"],

      // Text:
      ["font-size", "12px"],
      ["font-family", FontTypeA],
      ["font-weight", "800"],
      ["color", "#bbbbbb"],
      ["overflow-wrap", "break-word"]
    ]);

    var CalcTimestamp = Math.floor((Date.now() - Data.Timestamp) / 1000);
    if (CalcTimestamp < 1) {
      CalcTimestamp = 1; // Prevent negative timestamps.
    }
    var AmountDivide = 1;
    var End = "s"; // Second
    if (CalcTimestamp > 31536000 - 1) {
      AmountDivide = 31536000;
      End = "y"; // Year
    } else if (CalcTimestamp > 2592000 - 1) {
      AmountDivide = 2592000;
      End = "mo"; // Month
    } else if (CalcTimestamp > 604800 - 1) {
      AmountDivide = 604800;
      End = "w"; // Week
    } else if (CalcTimestamp > 86400 - 1) {
      AmountDivide = 86400;
      End = "d"; // Day
    } else if (CalcTimestamp > 3600 - 1) {
      AmountDivide = 3600;
      End = "h"; // Hour
    } else if (CalcTimestamp > 60 - 1) {
      AmountDivide = 60;
      End = "m"; // Minute
    }
    var TimeToSet = Math.round(CalcTimestamp / AmountDivide) || "0";
    MiniTimestampTx.textContent = TimeToSet + End;
    MiniTimestampTx.setAttribute("title", "Sent: " + new Date(Data.Timestamp));
  }

  var TextFontColor = FontColorA;
  if (Data.Sending != null && Data.Sending == true) {
    TextFontColor = "#aaaaaa";
    ChatMessage.className = "GhostSendChatMessage" + Data.PostID;
    ChatMessage.setAttribute("title", "Sending Chat");
  }

  Data.Text = CleanString(Data.Text);

  var ChatText = createElement("ChatText", "div", ChatMessage, [
    ["position", "relative"],
    ["display", "block"],
    ["width", "calc(100% - 60px)"],
    ["left", "45px"],
    ["margin-top", "1px"],

    // Text:
    ["font-size", "14px"],
    ["font-family", FontTypeA],
    ["font-weight", "400"],
    ["color", TextFontColor],
    ["text-align", "left"],
    ["overflow-wrap", "break-word"],
    //["white-space", "pre-wrap"]
  ]);
  ChatText.innerHTML = CleanString(Data.Text);
  ChatText.innerHTML = ChatText.innerHTML.replace(/\&nbsp;/g, " ").replace(/\$\[NEWLINE\]\;/g, "<br/>");
  ChatText.className = UserData.User + "ChatText";
  if (Data.EditedAt != null) {
    AddChatEditedMarker(ChatMessage, Data._id);
  }

  // Only real Photop chats have a stable backend id to attach likes to.
  ChatMessage.setAttribute("Source", Data.Source != null ? Data.Source : "");
  if (Data.Source == null && Data._id != null && Data.Sending != true) {
    setCSS(ChatText, "width", "calc(100% - 96px)");
    CreateChatLikeButton(Data._id, ChatMessage, Data.Likes, Data.IsLiked == true);
  }

  if (Data.Source == null) {
    ChatMessage.setAttribute("onMouseOver", "ChatHoverDetector(this)");
    ChatMessage.setAttribute("onMouseOut", "ChatHoverOutDetector(this)");
    ChatMessage.setAttribute("FunctionHoverClickData", "LiveChatDropdownData");
    ChatMessage.setAttribute("User", UserData.User);
    ChatMessage.setAttribute("Text", Data.Text);
  }

  return ChatMessage;
}

// A small grey italic marker sits under an edited chat's text.
function AddChatEditedMarker(ChatMessage, ChatID) {
  if (ChatMessage == null || ChatID == null) {
    return;
  }
  var MarkerID = ChatID + "ChatEdited";
  if (ChatMessage.querySelector('[id="' + MarkerID + '"]') != null) {
    return;
  }
  if (ChatMessage.querySelector("#ChatText") == null) {
    return;
  }
  var Marker = createElement(MarkerID, "div", ChatMessage, [
      ["position", "relative"],
      ["display", "block"],
      ["width", "calc(100% - 60px)"],
      ["left", "45px"],
      ["margin-top", "1px"],

      // Text:
      ["font-size", "11px"],
      ["font-family", FontTypeA],
      ["font-style", "italic"],
      ["font-weight", "400"],
      ["color", "#999999"],
      ["text-align", "left"]
  ]);
  Marker.textContent = "(edited)";
}

// Updates every mounted copy of a chat after its author edits it.
function UpdateRenderedChatText(ChatID, Text) {
  var Messages = document.querySelectorAll('[id="' + ChatID + 'Chat"]');
  for (var i = 0; i < Messages.length; i++) {
    var Message = Messages[i];
    var TextBox = Message.querySelector("#ChatText");
    if (TextBox != null) {
      var SafeText = CleanString(Text);
      TextBox.innerHTML = SafeText.replace(/\&nbsp;/g, " ").replace(/\$\[NEWLINE\]\;/g, "<br/>");
      Message.setAttribute("Text", SafeText);
    }
    AddChatEditedMarker(Message, ChatID);
  }
}

function ChatHoverDetector(Chat) {
  if (Chat.style.backgroundColor != 'rgba(42, 245, 181, 0.15)') {
    Chat.style.backgroundColor = ContentColor;
  }
  if (Chat.querySelector('#MiniTimestampTx') != null) {
    Chat.querySelector('#MiniTimestampTx').style.display = 'block';
  }
}
function ChatHoverOutDetector(Chat) {
  if (Chat.style.backgroundColor != 'rgba(42, 245, 181, 0.15)') {
    Chat.style.backgroundColor = 'rgba(0, 0, 0, 0)'
  }
  if (Chat.querySelector('#MiniTimestampTx') != null) {
    Chat.querySelector('#MiniTimestampTx').style.display = 'none';
  }
}
function EditChat(Selected) {
  Selected = Selected[3];
  if (Selected == null || UserID == null || Selected.UserID != UserID || find("EditChatOverlay") != null) {
    return;
  }
  var ChatID = Selected._id;

  var Overlay = createElement("EditChatOverlay", "div", "body", [
      ["position", "fixed"],
      ["display", "flex"],
      ["align-items", "center"],
      ["justify-content", "center"],
      ["left", "0px"],
      ["top", "0px"],
      ["width", "100%"],
      ["height", "100%"],
      ["padding", "8px"],
      ["box-sizing", "border-box"],
      ["z-index", "3500"],
      ["background-color", "rgba(0, 0, 0, 0.6)"]
  ]);
  var Frame = createElement("EditChatFrame", "div", Overlay, [
      ["position", "relative"],
      ["width", "100%"],
      ["max-width", "420px"],
      ["box-sizing", "border-box"],
      ["padding", "14px"],
      ["background-color", ContentColor],
      ["border", "4px solid " + BorderColor],
      ["border-radius", "12px"]
  ]);
  createElement("EditChatTitle", "div", Frame, [
      ["position", "relative"],
      ["margin-bottom", "10px"],

      // Text:
      ["font-size", "20px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", FontColorA],
      ["text-align", "left"]
  ]).textContent = "Edit Chat";

  var TextBox = createElement("EditChatText", "textarea", Frame, [
      ["position", "relative"],
      ["display", "block"],
      ["box-sizing", "border-box"],
      ["width", "100%"],
      ["min-height", "90px"],
      ["max-height", "35vh"],
      ["padding", "8px"],
      ["border-width", "0px"],
      ["border-radius", "8px"],
      ["background-color", ContentColorLayer3],
      ["resize", "vertical"],
      ["outline", "none"],

      // Text:
      ["font-size", "16px"],
      ["font-family", FontTypeA],
      ["font-weight", "400"],
      ["color", FontColorA],
      ["text-align", "left"]
  ]);
  TextBox.value = Selected.Text || "";

  var ErrorBox = createElement("EditChatError", "div", Frame, [
      ["position", "relative"],
      ["display", "none"],
      ["margin-top", "8px"],

      // Text:
      ["font-size", "13px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#FF5C5C"],
      ["text-align", "left"]
  ]);

  var Buttons = createElement("EditChatButtons", "div", Frame, [
      ["position", "relative"],
      ["display", "flex"],
      ["justify-content", "flex-end"],
      ["margin-top", "10px"]
  ]);
  var CancelButton = createElement("EditChatCancel", "div", Buttons, [
      ["position", "relative"],
      ["padding", "7px 12px"],
      ["margin-right", "8px"],
      ["background-color", "#475059"],
      ["border-radius", "8px"],
      ["cursor", "pointer"],

      // Text:
      ["font-size", "14px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"]
  ]);
  CancelButton.textContent = "Cancel";
  var SaveButton = createElement("EditChatSave", "div", Buttons, [
      ["position", "relative"],
      ["padding", "7px 12px"],
      ["background-color", ThemeColor],
      ["border-radius", "8px"],
      ["cursor", "pointer"],

      // Text:
      ["font-size", "14px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"]
  ]);
  SaveButton.textContent = "Save";

  function CloseEditor() {
    Overlay.remove();
  }
  CancelButton.addEventListener("click", CloseEditor);
  Overlay.addEventListener("click", function(event) {
    if (event.target == Overlay) {
      CloseEditor();
    }
  });

  var Saving = false;
  SaveButton.addEventListener("click", function() {
    if (Saving == true) {
      return;
    }
    var Value = TextBox.value.replace(/\r\n/g, "\n").trim();
    if (Value == "") {
      ErrorBox.textContent = "A chat cannot be empty.";
      ErrorBox.style.display = "block";
      return;
    }
    if (Value.length > 200) {
      ErrorBox.textContent = "Chats can be up to 200 characters long.";
      ErrorBox.style.display = "block";
      return;
    }

    Saving = true;
    SaveButton.textContent = "Saving...";
    setCSS(SaveButton, "opacity", "0.7");
    SendRequest("UpdateChat", { Task: "Edit", ChatID: ChatID, Text: Value }, function(Metadata, Result) {
      if (Result.Code == 200) {
        UpdateRenderedChatText(ChatID, Value);
        CloseEditor();
        return;
      }
      Saving = false;
      SaveButton.textContent = "Save";
      setCSS(SaveButton, "opacity", "1");
      ErrorBox.textContent = Result.Message || "Could not save the edit. Please try again.";
      ErrorBox.style.display = "block";
    });
  });

  TextBox.addEventListener("input", function() {
    ErrorBox.style.display = "none";
  });
  TextBox.focus();
  TextBox.setSelectionRange(TextBox.value.length, TextBox.value.length);
}

function LiveChatDropdownData(Chat) {
  if (Chat.className.includes("GhostSendChatMessage") == true) {
    return;
  }

  var Data = {
    _id: Chat.id.replace(/Chat/g, ""),
    User: Chat.getAttribute("User"),
    UserID: Chat.getAttribute("UserID"),
    PostID: Chat.parentNode.parentNode.parentNode.id.replace(/LiveChat/g, ""),
    Text: Chat.getAttribute("Text")
  };

  var DropdownChatButtons = [
    ["Copy Username", ThemeColor, "CopyClipboardText", Data.User],
    ["Copy Text", ThemeColor, "CopyClipboardText", Data.Text],
    ["Copy ID", ThemeColor, "CopyClipboardText", "/Chat_" + Data._id]
  ];
  if (UserID != Data.UserID) {
    if (CheckPermision(LoginUserRole, "CanBanUsers") == true) {
      DropdownChatButtons.unshift(["Ban User", "#FF5C5C", "OpenModerationPage", ["Ban", Data.UserID, Data.User]]);
    }
    if (UserID != null) {
      DropdownChatButtons.unshift(["Block User", "#FF8652", "BlockUser", [Data.UserID, Data.User]]);
      DropdownChatButtons.unshift(["Report", "#FFCB70", "ReportContent", { _id: Data._id, User: Data.User, PostID: Data.PostID }]);
    }
  }
  if (UserID != null && (UserID == Data.UserID || CheckPermision(LoginUserRole, "CanDeleteChats") == true)) {
    DropdownChatButtons.unshift(["Delete", "#FF5C5C", "ChatActions", ["Delete", Data._id, Data.User, Data.PostID]]);
  }
  if (UserID != null && UserID == Data.UserID) {
    DropdownChatButtons.unshift(["Edit Chat", ThemeColor, "EditChat", Data]);
  }
  DropdownChatButtons.unshift(["Quote in New Post", "#C95EFF", "QuoteChatInNewPost", { _id: Data._id }]);
  if (UserID != null) {
    DropdownChatButtons.unshift(["Reply", "#2AF5B5", "ReplyChat", { _id: Data._id, User: Data.User }]);
  }
  return JSON.stringify(DropdownChatButtons);
}

var RequestChatPosts = [];
function RenderChatMessage(RequestedChats, Chats, Users, Replies, ClearHolder, FromTop, LoadingMoreChats, NewChat, LoadingFromIDChat) {
  var RequestChatPosts = RequestedChats || RequestChatPosts;

  var ClearedChats = [];
  for (var i = 0; i < Chats.length; i++) {
    var Data = Chats[i];
    var UserData = Users[Data.UserID];
    if (Data.Text == null || UserData == null) {
      break;
    }
    var LiveChatFrame = find(Data.PostID + "LiveChat");
    if (LiveChatFrame != null) {
      var ScrollFrame = LiveChatFrame.querySelector("#Chat");
      if (ScrollFrame.hasAttribute("LoadedForChatID") == false || LoadingFromIDChat == true) {
        if (NewChat != true || ScrollFrame.parentNode.querySelector("#ChatType") == null || ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#RefreshToBottom") == null) {
          var TopMessage = find(Data.PostID + "ChatTopMessage");
          if (TopMessage != null) {
            TopMessage.remove();
          }
          var BeforeChats = 0;
          var AtBottomOfFrame = false;
          var ChatMessage = null;
          CreateChat();
          function CreateChat() {
            var Holder = ScrollFrame.querySelector("#Holder");
            if (ClearHolder == true && ClearedChats.includes(Data.PostID) == false) {
              ClearedChats.push(Data.PostID);
              if (Holder != null) {
                Holder.remove();
                Holder = null;
              }
              ScrollFrame.setAttribute("AllDownChatsLoaded", "");
            }
            if (Holder == null) {
              var NewChatContainer = createElement("Holder", "div", ScrollFrame, [
                ["position", "relative"],
                ["width", "100%"],
                ["margin-top", "8px"]
              ]);
              NewChatContainer.setAttribute("dir", "ltr");
              Holder = NewChatContainer;
            } else {
              BeforeChats = Holder.childNodes.length;
            }

            var BeforeChildren = Holder.childNodes;
            var BeforeOnePrevious = BeforeChildren[BeforeChildren.length - 1];
            if (BeforeOnePrevious != null && ScrollFrame.scrollTop + ScrollFrame.clientHeight + BeforeOnePrevious.clientHeight + 20 > ScrollFrame.scrollHeight) {
              AtBottomOfFrame = true;
            }

            var PreviousChildDOMObject = find(Holder.getAttribute("LastChatID"));

            if (FromTop != true && LoadingMoreChats != true) {
              PreviousChildDOMObject = find(Holder.getAttribute("GlobalLastChatID"));
            }

            if (LoadingMoreChats == true) {
              PreviousChildDOMObject = Holder.lastChild;
            }

            /*
            var IsSendingChildDOM = false;
            
            if (Holder.getAttribute("LastChatUser") == Data.UserID && Holder.getAttribute("LastChatID") != null) {
              PreviousChildDOMObject = find(Holder.getAttribute("LastChatID"));
              if (PreviousChildDOMObject != null && Data.Sending == true) {
                IsSendingChildDOM = true;
              }
            }
            */

            //if ((IsSendingChildDOM == false && PreviousChildDOMObject == null) || Data.Source != null) {
            if (PreviousChildDOMObject == null || PreviousChildDOMObject.getAttribute("UserID") != Data.UserID || Data.ReplyID != null || PreviousChildDOMObject.querySelector("#ReplyHolder") != null || Data.Source != null) {

              var ReplyData = null;
              if (Data.ReplyID != null) {
                ReplyData = Replies[Data.ReplyID];
              }

              ChatMessage = CreateNormalChat(Data, UserData, Holder, ReplyData)

              if (FromTop == true) {
                if (PreviousChildDOMObject == null) {
                  Holder.insertBefore(ChatMessage, Holder.firstChild);
                } else {
                  Holder.insertBefore(ChatMessage, PreviousChildDOMObject.nextSibling);
                }
                //var SiblingChat = ChatMessage.nextSibling;
                //console.log(Data.Text, SiblingChat.querySelector("#ChatText").textContent)
              }

              var SiblingChat = ChatMessage.nextSibling; //Holder.firstChild;
              if (i == Chats.length - 1 && SiblingChat != null && SiblingChat.getAttribute("UserID") == Data.UserID && SiblingChat.querySelector("#ChatProfilePic") != null && SiblingChat.querySelector("#ReplyHolder") == null) {
                var FixedChat = CreateMinifyChat({ _id: SiblingChat.id.replace(/Chat/g, ""), UserID: SiblingChat.getAttribute("UserID"), Text: SiblingChat.querySelector("#ChatText").textContent, Timestamp: parseInt(SiblingChat.getAttribute("Timestamp")), Likes: parseInt(SiblingChat.getAttribute("ChatLikes")) || 0, IsLiked: SiblingChat.getAttribute("ChatIsLiked") == "true", Source: SiblingChat.getAttribute("Source") || undefined, EditedAt: SiblingChat.querySelector('[id$="ChatEdited"]') != null ? 1 : null }, UserData, Holder, ChatMessage);//, (Chats[i+1] != null && Chats[i+1].UserID == Data.UserID));
                Holder.insertBefore(FixedChat, SiblingChat);
                SiblingChat.remove();
                if (FixedChat.nextSibling != null && FixedChat.nextSibling.getAttribute("UserID") == Data.UserID) {
                  setCSS(FixedChat.nextSibling, "margin-top", "2px");
                }
              }
              if (Holder.firstChild == ChatMessage) {
                Holder.setAttribute("FirstTimestamp", Data.Timestamp);
              }

              if (Data.Sending == null) {
                Holder.setAttribute("LastChatID", Data._id + "Chat");
                Holder.setAttribute("GlobalLastChatID", Data._id + "Chat");
                Holder.setAttribute("LastChatUser", Data.UserID);
                ChatMessage.setAttribute("UserID", Data.UserID);
                ChatMessage.setAttribute("Timestamp", Data.Timestamp);
              }

            } else {

              //setCSS(PreviousChildDOMObject, "padding-bottom", "2px");

              ChatMessage = CreateMinifyChat(Data, UserData, Holder, PreviousChildDOMObject);

              if (FromTop == true) {
                if (PreviousChildDOMObject != null) {
                  Holder.insertBefore(ChatMessage, PreviousChildDOMObject.nextSibling);

                  /*
                  if (ChatMessage.nextSibling != null && ChatMessage.nextSibling.getAttribute("UserID") == Data.UserID) {
                    setCSS(ChatMessage.nextSibling, "margin-top", "2px");
                  }
                  */

                  /*
                  if (PreviousChildDOMObject.previousSibling.getAttribute("UserID") == Data.UserID) {
                    setCSS(PreviousChildDOMObject.previousSibling, "margin-top", "2px");
                  }
                  */


                  /*
                  if (PreviousChildDOMObject != null && PreviousChildDOMObject.querySelector("#ChatProfilePic") == null) {
                    if (PreviousChildDOMObject.previousSibling.querySelector("#ChatProfilePic") == null) {
                      setCSS(PreviousChildDOMObject, "margin-top", "2px");  // LAZY FIX | Change Later...
                      PreviousChildDOMObject.style.backgroundColor = "green";
                    }
                  }
                  */
                }
              }

              var SiblingChat = ChatMessage.nextSibling; //Holder.firstChild;
              if (i == Chats.length - 1 && SiblingChat != null && SiblingChat.getAttribute("UserID") == Data.UserID && SiblingChat.querySelector("#ChatProfilePic") != null && SiblingChat.querySelector("#ReplyHolder") == null) {
                var FixedChat = CreateMinifyChat({ _id: SiblingChat.id.replace(/Chat/g, ""), UserID: SiblingChat.getAttribute("UserID"), Text: SiblingChat.querySelector("#ChatText").textContent, Timestamp: parseInt(SiblingChat.getAttribute("Timestamp")), Likes: parseInt(SiblingChat.getAttribute("ChatLikes")) || 0, IsLiked: SiblingChat.getAttribute("ChatIsLiked") == "true", Source: SiblingChat.getAttribute("Source") || undefined, EditedAt: SiblingChat.querySelector('[id$="ChatEdited"]') != null ? 1 : null }, UserData, Holder, ChatMessage);//, (Chats[i+1] != null && Chats[i+1].UserID == Data.UserID));
                Holder.insertBefore(FixedChat, SiblingChat);
                SiblingChat.remove();
                if (FixedChat.nextSibling != null && FixedChat.nextSibling.getAttribute("UserID") == Data.UserID) {
                  setCSS(FixedChat.nextSibling, "margin-top", "2px");
                }
              }

              if (Data.Sending == null) {
                Holder.setAttribute("LastChatID", Data._id + "Chat");
                Holder.setAttribute("GlobalLastChatID", Data._id + "Chat");
                Holder.setAttribute("LastChatUser", Data.UserID);
                ChatMessage.setAttribute("UserID", Data.UserID);
                ChatMessage.setAttribute("Timestamp", Data.Timestamp);
              }


              /*
              if (PreviousChildDOMObject != null) {
                Data.Text = Data.Text.replace(/\?/g, "&#63;");
                Data.Text = Data.Text.replace(/\=/g, "&#61;");
                // XSS Protection:
                Data.Text = Data.Text.replace(/\</g, "&#60;");
                Data.Text = Data.Text.replace(/\>/g, "&#62;");

                if (IsSendingChildDOM == true) {
                  var ChatText = createElement("ChatText", "div", PreviousChildDOMObject, [
                    ["position", "relative"],
                    ["display", "block"],
                    ["width", "calc(100% - 60px)"],
                    ["left", "45px"],
                    ["margin-top", "2px"],

                    // Text:
                    ["font-size", "14px"],
                    ["font-family", FontTypeA],
                    ["font-weight", "400"],
                    ["color", "#aaaaaa"],
                    ["text-align", "left"],
                    ["overflow-wrap", "break-word"],
                    //["white-space", "pre-wrap"]
                  ]);
                  ChatText.innerHTML = Data.Text.replace(/\&nbsp;/g, " ").replace(/\$\[NEWLINE\]\;/g, "<br/>");
                  ChatText.innerHTML = ChatText.innerHTML;
                  ChatText.className = UserData.User + "ChatText";

                  ChatText.className = "GhostSendChatMessage" + Data.PostID;
                  ChatText.setAttribute("title", "Sending Chat");
                } else {
                  var ChatTextBox = PreviousChildDOMObject.querySelector("#ChatText");
                  ChatTextBox.innerHTML = Data.Text;
                  ChatTextBox.innerHTML = ChatTextBox.innerHTML.replace(/\&nbsp;/g, " ").replace(/\$\[NEWLINE\]\;/g, "<br/>");
                  ChatTextBox.className = UserData.User + "ChatText";
                }
              }
              */
            }
          }
          var Holder = ScrollFrame.querySelector("#Holder");
          if (Holder != null) {
            var Children = Holder.childNodes;
            if (BeforeChats > 0) {
              if (BeforeChats > 350) {
                Holder.firstChild.remove();
              }
              var OnePrevious = Children[Children.length - 2];
              if (OnePrevious != null) {
                if (AtBottomOfFrame == true) {
                  ScrollFrame.scrollTo(0, ScrollFrame.scrollTop + ScrollFrame.clientHeight + OnePrevious.clientHeight + 20);
                }
              }
            } else {
              ScrollFrame.scrollTo(0, ScrollFrame.scrollTop + ScrollFrame.clientHeight + 1000);
            }
          }
        }
      }
    }
  }

  /*
  if (FromTop == true) {
    var LiveChatFrame = find(Chats[0].PostID + "LiveChat");
    if (LiveChatFrame != null) {
      var ScrollFrame = LiveChatFrame.querySelector("#Chat");
      var Holder = ScrollFrame.querySelector("#Holder");
      if (Holder != null) {
        var Sibling = Holder.firstChild;
        for (var i = 0; i < 15; i++) {
          Sibling.setAttribute("title", "AAAAAAA")
          if (Sibling != null && Sibling.querySelector("#ChatProfilePic") == null && Sibling.nextSibling.querySelector("#ChatProfilePic") == null && Sibling.nextSibling.getAttribute("UserID") == Chats[i].UserID) {
            setCSS(Sibling, "margin-top", "2px");
          }
          Sibling = Sibling.nextSibling;
          if (Sibling == null) {
            break;
          }
        }
      }
    }
  }
  */

  if (RequestChatPosts != null) {
    for (var p = 0; p < RequestChatPosts.length; p++) {
      var LiveChatFrame = find(RequestChatPosts[p] + "LiveChat");
      if (LiveChatFrame != null) {
        var ScrollFrame = LiveChatFrame.querySelector("#Chat");
        if (ScrollFrame != null) {
          var Holder = ScrollFrame.querySelector("#Holder");
          if (Holder == null || Holder.childNodes.length < 1) {
            var TopMessage = find(RequestChatPosts[p] + "ChatTopMessage");
            if (TopMessage != null) {
              TopMessage.textContent = "No chats... Ready to start the hangout?";
            }
          } else {
            Holder.removeAttribute("LastChatID");
          }
        }
      }
    }
  }
}

function NewChatRecieve(Metadata, Body) {
  if (Body.Chats == null || Body.Chats.length < 1) {
    return;
  }
  if (BlockedUsers.includes(Body.Chats[0].UserID) == true) {
    return;
  }

  var ChatCounter = find(Body.Chats[0].PostID + "Chats");
  if (ChatCounter != null) {
    ChatCounter.childNodes[0].nodeValue = parseInt(ChatCounter.textContent) + 1;
  }

  var GhostChats = document.getElementsByClassName("GhostSendChatMessage" + Body.Chats[0].PostID);
  for (var g = 0; g < GhostChats.length; g++) {
    GhostChats[g].remove();
  }

  var SendUser = {};
  var ReplyData = {};
  var SetUserData = JSON.parse(JSON.stringify(Body.Users[0]));
  delete SetUserData._id;
  SendUser[Body.Users[0]._id] = SetUserData;

  if (Body.Replies != null) {
    var SetReplyData = JSON.parse(JSON.stringify(Body.Replies[0]));
    delete SetReplyData._id;
    ReplyData[Body.Chats[0].ReplyID] = SetReplyData;
  }

  RenderChatMessage([Body.Chats[0].PostID], Body.Chats, SendUser, ReplyData, false, false, true, true);

  // On mobile the open post view should follow the live conversation, even
  // while the keyboard is up.
  if (MobilePostView != null && MobilePostView.ID == Body.Chats[0].PostID) {
    setTimeout(function () {
      ScrollMobileChatToBottom(true);
    }, 60);
  }
}

function NewChatDeleted(Metadata, Body) {
  if (Body.ChatIDs != null) {
    for (var i = 0; i < Body.ChatIDs.length; i++) {
      var ChatObject = find(Body.ChatIDs[i] + "Chat");
      if (ChatObject != null) {
        ChatObject.remove();
      }
    }
  }
}

function PostUpdated(Metadata, Body) {
  if (Body.PostID == null || Body.Text == null) {
    return;
  }
  // Pages that never loaded the timeline renderer have nothing to update.
  if (typeof UpdateRenderedPostText == "function") {
    UpdateRenderedPostText(Body.PostID, Body.Text);
  }
}

function ChatUpdated(Metadata, Body) {
  if (Body.ChatID == null || Body.Text == null) {
    return;
  }
  if (typeof UpdateRenderedChatText == "function") {
    UpdateRenderedChatText(Body.ChatID, Body.Text);
  }
}

function NotificationReceived(Metadata, Body) {
  if (Body == null) {
    return;
  }
  if (Body.Unread != null && typeof SetNotificationBadge == "function") {
    SetNotificationBadge(Body.Unread);
  }
  if (typeof HandleRealtimeNotification == "function") {
    HandleRealtimeNotification(Body.Notification);
  }
}

async function NewPostDeleted(Metadata, Body) {
  if (Body.PostIDs == null) {
    return;
  }
  for (var i = 0; i < Body.PostIDs.length; i++) {
    var PostID = Body.PostIDs[i];
    if (PostID == null) {
      continue;
    }

    // If the deleted post is open in the mobile full-screen view, close it first
    // so the real post/chat elements return to their container before removal.
    if (MobilePostView != null && MobilePostView.ID == PostID) {
      await CloseMobileChat();
    }

    var PostObject = find(PostID);
    if (PostObject != null) {
      PostObject.remove();
    }

    delete LoadedPostData[PostID];
    if (LoadedPostChats.includes(PostID)) {
      LoadedPostChats = LoadedPostChats.filter(function (LoadedID) {
        return LoadedID != PostID;
      });
    }
    if (ActiveChatScrollListeners[PostID] != null) {
      var Listener = ActiveChatScrollListeners[PostID];
      if (Listener[0] != null && Listener[1] != null) {
        Listener[0].removeEventListener("scroll", Listener[1]);
      }
      delete ActiveChatScrollListeners[PostID];
    }
    if (ProfileData.PinnedPost == PostID) {
      delete ProfileData.PinnedPost;
    }
    if (CurrentActionSelectPost != null && CurrentActionSelectPost[1] == PostID) {
      CurrentActionSelectPost = null;
    }
  }
  SetupPostChats(false);
}

function ClearAttributes(ScrollFrame, IgnoreClearingDown) {
  ScrollFrame.removeAttribute("UpLoadingMoreChats");
  ScrollFrame.removeAttribute("AllUpChatsLoaded");
  ScrollFrame.removeAttribute("DownLoadingMoreChats");
  /*
  if (IgnoreClearingDown != true) {
    ScrollFrame.removeAttribute("AllDownChatsLoaded");
  }
  */
}

function CreateScrollToBottomButton(Holder, Name) {
  var ScrollToBottom = createElement(Name, "div", Holder, [
    ["position", "absolute"],
    ["display", "flex"],
    ["box-sizing", "border-box"],
    ["bottom", "calc(100% + 4px)"],
    ["right", "16px"],
    ["height", "36px"],
    ["width", "36px"],
    ["padding-top", "4px"],
    ["background-color", "rgba(0, 0, 0, 0.45)"],
    ["border-radius", "60px"],
    ["z-index", "50"],
    ["cursor", "pointer"],

    // Text:
    ["font-size", "18px"],
    ["font-family", FontTypeA],
    ["font-weight", "1800"],
    ["color", "#cccccc"],
    ["text-align", "center"],
    ["justify-content", "center"],
    ["align-items", "center"]
  ]);
  ScrollToBottom.innerHTML = "&#9660;";
  ScrollToBottom.setAttribute("title", "Scroll to Bottom");
  return ScrollToBottom;
}

var LoadedPostChats = [];
var ActiveChatScrollListeners = {};
var IsLoadingTwitchLiveChatModule = false;
var WaitingForTwitchLiveChatModule = [];
function SetupPostChats(CheckAlreadyLoad, ForceAddScrollListener) {
  if (getCSS("body", "position") == "fixed") { // Don't unload while in mobile chat menu.
    return;
  }

  RequestChatPosts = [];
  var RequestPostsForChats = [];
  var RequestLiveUserCount = [];

  var LoadedPosts = document.getElementsByClassName("Posts");
  for (var i = 0; i < LoadedPosts.length; i++) {
    var CheckPost = LoadedPosts[i];
    var ObjectRect = CheckPost.getBoundingClientRect();
    var LiveChatFrame = find(CheckPost.id + "LiveChat");
    if (LiveChatFrame != null) {
      var ScrollFrame = LiveChatFrame.querySelector("#Chat");
      if (ScrollFrame != null) {
        var Holder = ScrollFrame.querySelector("#Holder");
        if ((ObjectRect.y) + (CheckPost.offsetHeight) > 0 && ObjectRect.y < (window.innerHeight || document.documentElement.clientHeight)) {
          RequestChatPosts.push(CheckPost.id);
          if (Holder == null || Holder.childNodes.length < 1) {
            RequestPostsForChats.push(CheckPost.id);
          }
          var LastLoad = CheckPost.getAttribute("LastChatLoad");
          if (LastLoad == null || LastLoad + 120 < Math.round(Date.now() / 1000)) {
            RequestLiveUserCount.push(CheckPost.id);
          }
          CheckPost.setAttribute("LastChatLoad", Math.round(Date.now() / 1000));

          var VideoFrame = find(CheckPost.id + "SiteEmbed");
          if (VideoFrame != null && VideoFrame.src == "about:blank") {
            if (UserDisplaySettings["Embed Twitch Live Chat"] == true) {
              if (VideoFrame.getAttribute("TwitchChannel") != null) {
                if (typeof LoadedTwitchLiveScript !== 'undefined') {
                  AddTwitchLiveChat(CheckPost.id, VideoFrame.getAttribute("TwitchChannel"));
                } else {
                  WaitingForTwitchLiveChatModule[CheckPost.id] = VideoFrame.getAttribute("TwitchChannel");
                  if (IsLoadingTwitchLiveChatModule == false) {
                    function LoadTwitchLiveChatModule() {
                      IsLoadingTwitchLiveChatModule = true;
                      var TwitchChatScript = loadScript("./TwitchLiveChat.js");
                      TwitchChatScript.addEventListener('load', function () {
                        var Keys = Object.keys(WaitingForTwitchLiveChatModule);
                        for (var l = 0; l < Keys.length; l++) {
                          AddTwitchLiveChat(Keys[l], WaitingForTwitchLiveChatModule[Keys[l]]);
                        }
                        IsLoadingTwitchLiveChatModule = false;
                      });
                    }
                    LoadTwitchLiveChatModule();
                  }
                }
              }
            }
            VideoFrame.src = VideoFrame.getAttribute("PlaySrc") || "about:blank";
          }
        } else if (MobileVersion == false || getCSS("LiveChatHolder", "left") != "0%") {
          if (Holder != null) {
            Holder.remove();
          }
          if (LiveChatFrame.querySelector("#ChatType") != null) {
            if (LiveChatFrame.querySelector("#ChatType").querySelector("#ReplyToFrame") != null) {
              LiveChatFrame.querySelector("#ChatType").querySelector("#ReplyToFrame").remove();
              setCSS(LiveChatFrame.querySelector("#ChatType").querySelector("#SendChatButton"), "margin-top", "0px");
            }
          }
          var TopMessage = find(CheckPost.id + "ChatTopMessage");
          if (TopMessage == null) {
            createElement(CheckPost.id + "ChatTopMessage", "div", ScrollFrame, [
              ["position", "relative"],
              ["width", "80%"],
              ["left", "10%"],
              ["margin-top", "12px"],
              ["margin-bottom", "10px"],

              // Text:
              ["font-size", "16px"],
              ["font-family", FontTypeA],
              ["font-weight", "500"],
              ["color", "#bbbbbb"],
              ["text-align", "center"],
              ["overflow-wrap", "break-word"],
              ["white-space", "pre-wrap"]
            ]).textContent = "Loading Chat Messages...";
          } else {
            TopMessage.textContent = "Loading Chat Messages...";
          }

          var VideoFrame = find(CheckPost.id + "SiteEmbed");
          if (VideoFrame != null && VideoFrame.src != "about:blank") {
            if (VideoFrame.getAttribute("TwitchChannel") != null) {
              RemoveTwitchLiveChat(CheckPost.id);
            }
            VideoFrame.src = "about:blank";
          }
        }
      }
    }
  }
  /*
  var RequestNewChats = [];
  for (var c = 0; c < RequestChatPosts.length; c++) {
    if (LoadedPostChats.includes(RequestChatPosts[c]) == false) {
      RequestNewChats.push(RequestChatPosts[c]);
    }
  }
  */
  if (CheckAlreadyLoad == false || JSON.stringify(RequestChatPosts) != JSON.stringify(LoadedPostChats)) {
    if (RequestChatPosts.length > 0 && RequestPostsForChats.length > 0) {
      SendRequest("ConnectLiveChat", { Posts: RequestChatPosts, ChatPosts: RequestPostsForChats, Amount: 25 }, function (Metadata, Data) {
        if (Data.Code == 200) {
          var Users = {};
          var Replies = {};
          for (var u = 0; u < Data.Users.length; u++) {
            var SetObject = Data.Users[u];
            var UserIDSet = SetObject._id;
            delete SetObject._id;
            Users[UserIDSet] = SetObject;
          }
          if (Data.Replies != null) {
            for (var r = 0; r < Data.Replies.length; r++) {
              var SetObject = Data.Replies[r];
              var ReplyIDSet = SetObject._id;
              delete SetObject._id;
              Replies[ReplyIDSet] = SetObject;
            }
          }
          RenderChatMessage(RequestChatPosts, Data.Chats.reverse(), Users, Replies, true);

          var ArrayKeys = Object.keys(ActiveChatScrollListeners);
          for (var d = 0; d < ArrayKeys.length; d++) {
            var ActiveListener = ActiveChatScrollListeners[ArrayKeys[d]][1];
            if (ActiveChatScrollListeners[ArrayKeys[d]][0] != null && ActiveListener != null) {
              ActiveChatScrollListeners[ArrayKeys[d]][0].removeEventListener("scroll", ActiveListener);
            }
            delete ActiveChatScrollListeners[ArrayKeys[d]];
          }

          for (var i = 0; i < RequestChatPosts.length; i++) {
            var CheckPost = RequestChatPosts[i];

            var LiveChat = find(CheckPost + "LiveChat");
            if (LiveChat != null) {
              var ScrollFrame = LiveChat.querySelector("#Chat");
              if (ScrollFrame != null) {
                var Holder = ScrollFrame.querySelector("#Holder");
                if (Holder != null) {
                  if (ForceAddScrollListener == true || Holder.childElementCount > 24) {
                    ClearAttributes(ScrollFrame);
                    ActiveChatScrollListeners[CheckPost] = [ScrollFrame, ScrollFrame.addEventListener("scroll", function (event) {
                      var Path = event.path || (event.composedPath && event.composedPath());
                      if (Path == null) {
                        return;
                      }
                      var ScrollFrame = Path[0];
                      if (ScrollFrame.parentNode == null) {
                        ScrollFrame.removeEventListener("scroll", ActiveChatScrollListeners[CheckPost][1]);
                        return;
                      }
                      var CheckPost = ScrollFrame.parentNode.id.replace(/LiveChat/g, ""); //Path[2].id
                      var Holder = ScrollFrame.querySelector("#Holder");
                      if (Holder != null && ScrollFrame.scrollTop < 200 && (ForceAddScrollListener == true || Holder.childElementCount > 24)) {
                        // Load more chats:
                        if (ScrollFrame.hasAttribute("AllUpChatsLoaded") == false && ScrollFrame.hasAttribute("UpLoadingMoreChats") == false) {
                          if (ScrollFrame != null) {
                            if (Holder != null && Holder.getAttribute("FirstTimestamp") != null) {
                              ScrollFrame.setAttribute("UpLoadingMoreChats", "");
                              SendRequest("GetChats", { Post: CheckPost, Before: parseInt(Holder.getAttribute("FirstTimestamp")), Amount: 15 }, function (Metadata, Data) {
                                if (Data.Code == 200) {
                                  // Load in the new chats:
                                  var Users = {};
                                  var Replies = {};
                                  for (var u = 0; u < Data.Users.length; u++) {
                                    var SetObject = Data.Users[u];
                                    var UserIDSet = SetObject._id;
                                    delete SetObject._id;
                                    Users[UserIDSet] = SetObject;
                                  }
                                  if (Data.Replies != null) {
                                    for (var r = 0; r < Data.Replies.length; r++) {
                                      var SetObject = Data.Replies[r];
                                      var ReplyIDSet = SetObject._id;
                                      delete SetObject._id;
                                      Replies[ReplyIDSet] = SetObject;
                                    }
                                  }
                                  RenderChatMessage([CheckPost], Data.Chats.reverse(), Users, Replies, false, true);

                                  if (Data.Chats.length < 15) {
                                    ScrollFrame.setAttribute("AllUpChatsLoaded", "");
                                    /*
                                    if (ActiveChatScrollListeners[CheckPost] != null && ActiveChatScrollListeners[CheckPost][1] != null) {
                                      ScrollFrame.removeEventListener("scroll", ActiveChatScrollListeners[CheckPost][1]);
                                    }
                                    */
                                  } else {
                                    ScrollFrame.removeAttribute("UpLoadingMoreChats");
                                  }
                                }
                              });
                            } else {
                              if (ActiveChatScrollListeners[CheckPost][1] != null) {
                                ScrollFrame.removeEventListener("scroll", ActiveChatScrollListeners[CheckPost][1]);
                              }
                            }
                          } else {
                            if (ActiveChatScrollListeners[CheckPost][1] != null) {
                              ScrollFrame.removeEventListener("scroll", ActiveChatScrollListeners[CheckPost][1]);
                            }
                          }
                        }
                      } else if (ScrollFrame.scrollTop + ScrollFrame.clientHeight + 200 > ScrollFrame.scrollHeight) {
                        // Load more chats:
                        if (ScrollFrame.hasAttribute("AllDownChatsLoaded") == false && ScrollFrame.hasAttribute("DownLoadingMoreChats") == false) {
                          if (Holder != null && Holder.lastChild != null) {
                            ScrollFrame.setAttribute("DownLoadingMoreChats", "");
                            SendRequest("GetChats", { Post: CheckPost, After: parseInt(Holder.lastChild.getAttribute("Timestamp")), Amount: 15 }, function (Metadata, Data) {
                              if (Data.Code == 200) {
                                // Load in the new chats:
                                var Users = {};
                                var Replies = {};
                                for (var u = 0; u < Data.Users.length; u++) {
                                  var SetObject = Data.Users[u];
                                  var UserIDSet = SetObject._id;
                                  delete SetObject._id;
                                  Users[UserIDSet] = SetObject;
                                }
                                if (Data.Replies != null) {
                                  for (var r = 0; r < Data.Replies.length; r++) {
                                    var SetObject = Data.Replies[r];
                                    var ReplyIDSet = SetObject._id;
                                    delete SetObject._id;
                                    Replies[ReplyIDSet] = SetObject;
                                  }
                                }
                                RenderChatMessage([CheckPost], Data.Chats, Users, Replies, false, false, true);
                                
                                //ScrollFrame.scrollTo({ top: (ScrollFrame.scrollHeight - 200) });

                                if (Data.Chats.length < 15) {
                                  ScrollFrame.setAttribute("AllDownChatsLoaded", "");
                                  /*
                                  if (ActiveChatScrollListeners[CheckPost] != null && ActiveChatScrollListeners[CheckPost][1] != null) {
                                    ScrollFrame.removeEventListener("scroll", ActiveChatScrollListeners[CheckPost][1]);
                                  }
                                  */
                                } else {
                                  ScrollFrame.removeAttribute("DownLoadingMoreChats");
                                }
                              }
                            });
                          }
                        }
                      }
                      if (ScrollFrame != null) {
                        if (ScrollFrame.scrollTop + ScrollFrame.clientHeight + 1000 < ScrollFrame.scrollHeight) {
                          if (ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#RefreshToBottom") != null) {
                            ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#RefreshToBottom").remove();
                          }
                          if (ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#ScrollToBottom") == null) {
                            var ScrollToBottom = CreateScrollToBottomButton(ScrollFrame.parentNode.querySelector("#ChatType"), "ScrollToBottom");

                            ScrollToBottom.addEventListener("mouseup", function () {
                              ScrollFrame.scrollTo({
                                top: ScrollFrame.scrollHeight,
                                behavior: 'smooth'
                              })
                            });
                          }
                        } else {
                          if (ScrollFrame.hasAttribute("AllDownChatsLoaded") == true && ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#RefreshToBottom") != null) {
                            ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#RefreshToBottom").remove();
                          }
                          if (ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#ScrollToBottom") != null) {
                            ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#ScrollToBottom").remove();
                          }
                        }
                      }
                    })];
                  }
                }
              }
            }
          }
        }
      });
    }
    if (RequestLiveUserCount.length > 0) {
      SendRequest("GetLiveCount", { Posts: RequestLiveUserCount }, function (Metadata, Data) {
        if (Data.Code == 200) {
          for (var l = 0; l < Data.LiveUserCounts.length; l++) {
            var PostLiveCounter = find(Data.LiveUserCounts[l][0] + "ChatTitleLiveUsers");
            if (PostLiveCounter != null) {
              PostLiveCounter.textContent = "• " + Data.LiveUserCounts[l][1] + " Chatting";
              var AddCounter = "s are";
              if (Data.LiveUserCounts[l][1] == 1) {
                AddCounter = " is";
              }
              PostLiveCounter.setAttribute("title", "~" + Data.LiveUserCounts[l][1] + " User" + AddCounter + " Chatting");
            }
          }
        }
      });
    }
    LoadedPostChats = RequestChatPosts;
  }
}
var ScrollTimeout = null;
window.addEventListener("scroll", function () {
  clearTimeout(ScrollTimeout);
  ScrollTimeout = setTimeout(SetupPostChats, 200);
});

function PrepareReplyLoads(Data) {
  var Users = {};
  var Replies = {};
  for (var u = 0; u < Data.Users.length; u++) {
    var SetObject = Data.Users[u];
    var UserIDSet = SetObject._id;
    delete SetObject._id;
    Users[UserIDSet] = SetObject;
  }
  if (Data.Replies != null) {
    for (var r = 0; r < Data.Replies.length; r++) {
      var SetObject = Data.Replies[r];
      var ReplyIDSet = SetObject._id;
      delete SetObject._id;
      Replies[ReplyIDSet] = SetObject;
    }
  }

  return [Users, Replies];
}

async function LoadReplyChat(ChatID, ScrollPostContainer) {
  SendRequest("GetChats", { LookupID: ChatID }, async function (Metadata, Data) {
    if (Data.Code == 200) {

      // Load in the new chats:
      var ReturnData = PrepareReplyLoads(Data);
      var OriginalData = Data.Chats[0];
      var ChatObject = find(ChatID + "Chat");
      
      var PostContainer = find(Data.Chats[0].PostID);
      if (PostContainer != null) {
        if (ChatObject != null) {
          var ScrollFrame = ChatObject.parentNode.parentNode;

          ScrollFrame.scrollTo({
            top: ChatObject.offsetTop - 25, //+ ExistingChat.parentNode.parentNode.scrollY,
            behavior: 'smooth'
          });
          ChatObject.animate([
            { backgroundColor: "#2AF5B5", offset: 0.1 },
            { backgroundColor: "#2AF5B5", offset: 0.8 },
            { backgroundColor: "rgba(0, 0, 0, 0)" }
          ], 1500);

          return;
        }
      } else {
        await GetPostsFromID({
          PostID: OriginalData.PostID,
          Limit: 9 // Not 10 because first post adds up to 10.
        });
      }
      
      PostContainer = find(OriginalData.PostID);
      if (PostContainer == null) {
        ShowPopUp("Hypothetical Chat?", "This chat could not be located in the database. It could have been removed, hidden, or never sent.", [["Okay", "#618BFF", null]]);
        return;
      }

      var LiveChatFrame = find(OriginalData.PostID + "LiveChat");
      if (LiveChatFrame != null) {
        var ScrollFrame = LiveChatFrame.querySelector("#Chat");
        if (ScrollFrame != null) {
          ScrollFrame.setAttribute("LoadedForChatID", "");
        }
      }

      SetupPostChats(false, true);

      if (ScrollPostContainer == true) {
        var ObjectRect = PostContainer.getBoundingClientRect();
        if ((ObjectRect.x + ObjectRect.width) < 0 || (ObjectRect.y + ObjectRect.height) < 0 || (ObjectRect.x > window.innerWidth || ObjectRect.y > window.innerHeight)) {
          await new Promise(async function (resolve, reject) {
            PostContainer.scrollIntoView();
            var ScrollTimeout = null;
            window.addEventListener('scroll', function(e) {
              clearTimeout(ScrollTimeout);
              ScrollTimeout = setTimeout(function() {
                resolve();
              }, 150);
            });
          });
        }
      }

      RenderChatMessage([OriginalData.PostID], Data.Chats, ReturnData[0], ReturnData[1], true, null, null, null, true);
      ChatObject = find(ChatID + "Chat");
      
      if (ChatObject == null) {
        ShowPopUp("Hypothetical Chat?", "This chat could not be located in the database. It could have been removed, hidden, or never sent.", [["Okay", "#618BFF", null]]);
        ScrollFrame.removeAttribute("LoadedForChatID");
        return;
      }
      
      if (ScrollPostContainer == true) {
        //SwitchPage("Home");
        PostContainer.scrollIntoView();
      }
      
      ClearAttributes(ChatObject.parentNode.parentNode);
      ChatObject.parentNode.parentNode.setAttribute("AllDownChatsLoaded", "");
      if (ChatObject != null) {
        SendRequest("GetChats", { Before: OriginalData.Timestamp, Post: OriginalData.PostID, Amount: 15 }, function (Metadata, Data) {
          if (Data.Code == 200) {
            // Load in the new chats:
            var ReturnData = PrepareReplyLoads(Data);
            RenderChatMessage([OriginalData.PostID], Data.Chats.reverse(), ReturnData[0], ReturnData[1], false, true, null, null, true);

            var ChatObject = find(ChatID + "Chat");
            ChatObject.parentNode.parentNode.scrollTo({
              top: ChatObject.offsetTop - 25, //+ ExistingChat.parentNode.parentNode.scrollY,
              behavior: 'smooth'
            });

            SendRequest("GetChats", { After: OriginalData.Timestamp, Post: OriginalData.PostID, Amount: 15 }, function (Metadata, Data) {
              if (Data.Code == 200) {
                // Load in the new chats:
                var ReturnData = PrepareReplyLoads(Data);
                RenderChatMessage([OriginalData.PostID], Data.Chats, ReturnData[0], ReturnData[1], false, false, true, null, true);

                var ChatObject = find(ChatID + "Chat");
                var ScrollFrame = ChatObject.parentNode.parentNode;
                
                ScrollFrame.scrollTo({
                  top: ChatObject.offsetTop - 25, //+ ExistingChat.parentNode.parentNode.scrollY,
                  behavior: 'smooth'
                });
                ChatObject.animate([
                  { backgroundColor: "#2AF5B5", offset: 0.1 },
                  { backgroundColor: "#2AF5B5", offset: 0.8 },
                  { backgroundColor: "rgba(0, 0, 0, 0)" }
                ], 1500);

                if (ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#ScrollToBottom") != null) {
                  ScrollFrame.parentNode.querySelector("#ChatType").querySelector("#ScrollToBottom").remove();
                }

                ScrollFrame.removeAttribute("LoadedForChatID");

                if (ChatObject.parentNode.childNodes.length > 30) {
                  var ScrollToBottom = CreateScrollToBottomButton(ScrollFrame.parentNode.querySelector("#ChatType"), "RefreshToBottom");

                  ScrollToBottom.addEventListener("mouseup", function () {
                    SendRequest("GetChats", { Post: OriginalData.PostID, Amount: 25 }, function (Metadata, Data) {
                      if (Data.Code == 200) {
                        // Load in the new chats:
                        var ReturnData = PrepareReplyLoads(Data);
                        RenderChatMessage([OriginalData.PostID], Data.Chats.reverse(), ReturnData[0], ReturnData[1], true, null, null, null, true);
                        ScrollToBottom.remove();
                      }
                    });
                  });
                }

                ScrollFrame.removeAttribute("AllDownChatsLoaded");
              }
            });
          }
        });
      }
    }
  });
}

function SetPageToProfileReset() {
  if (CurrentPage == "Profile" && ProfileUserData != null && ProfileUserData._id != null) {
    //SwitchPage("Profile", true);
    LoadProfilePage(ProfileUserData._id, true);
  }
}
var CurrentActionSelectPost = null;
function FinishPostActionConfirm() {
  if (CurrentActionSelectPost[1] == null) {
    return;
  }
  if (CurrentActionSelectPost[0] == "Delete") {
    SendRequest("UpdatePost", { Task: "Delete", PostID: CurrentActionSelectPost[1] });
    if (CurrentActionSelectPost[3] != null) {
      CurrentActionSelectPost[3].remove();
    }
  } else if (CurrentActionSelectPost[0] == "PinOnProfile") {
    SendRequest("UpdatePost", { Task: "PinProfile", PostID: CurrentActionSelectPost[1] }, function(Metadata, Data) {
      if (Data.Code == 200) {
        ProfileData.PinnedPost = CurrentActionSelectPost[1];
        SetPageToProfileReset();
      }
    });
  } else if (CurrentActionSelectPost[0] == "UnpinFromProfile") {
    SendRequest("UpdatePost", { Task: "UnpinProfile", PostID: CurrentActionSelectPost[1] }, function(Metadata, Data) {
      if (ProfileData.PinnedPost != null && Data.Code == 200) {
        delete ProfileData.PinnedPost;
      }
      SetPageToProfileReset();
    });
  }
}
function PostActions(Data) {
  Data = Data[3];
  CurrentActionSelectPost = Data;
  if (Data[0] == "Delete") {
    ShowPopUp("Delete Post?", "Are you sure you want to <b>delete</b> this post?", [["Delete", "#FF4174", "FinishPostActionConfirm"], ["Cancel", "#B3B3B3", null]]);
  } else if (Data[0] == "PinOnProfile") {
    ShowPopUp("Pin to Profile?", "Are you sure you want to <b>pin</b> this post to the top of your profile?", [["Pin It!", ThemeColor, "FinishPostActionConfirm"], ["Cancel", "#B3B3B3", null]]);
  } else if (Data[0] == "UnpinFromProfile") {
    ShowPopUp("Unpin from Profile?", "Are you sure you want to <b>unpin</b> this post from your profile?", [["Unpin", ThemeColor, "FinishPostActionConfirm"], ["Cancel", "#B3B3B3", null]]);
  }
}
//["Delete", Data._id, UserData.User, Data.PostID]
var CurrentActionSelectChat = null;
function FinishChatActionConfirm() {
  if (CurrentActionSelectChat[1] != null && CurrentActionSelectChat[3] != null) {
    SendRequest("UpdateChat", { ChatID: CurrentActionSelectChat[1], UpdateValues: [["Hidden", ""]] });
    find(CurrentActionSelectChat[1] + "Chat").remove();
  }
}
function ChatActions(Data) {
  Data = Data[3];
  if (Data[0] == "Delete") {
    CurrentActionSelectChat = Data;
    ShowPopUp("Delete Chat?", "Are you sure you want to <b>delete</b> this chat?", [["Delete", "#FF4174", "FinishChatActionConfirm"], ["Cancel", "#B3B3B3", null]]);
  }
}
async function QuoteChatInNewPost(Data) {
  Data = Data[3];
  if (Data == null || Data._id == null) {
    return;
  }
  if (UserID == null) {
    ShowPopUp("It's Better Together", "Join the hangout today! You must <b>sign in</b> or <b>sign up</b> before being able to <b style='color: #C95EFF'>Quote</b> a chat!", [ ["Sign In", ThemeColor, "StartSignIn"], ["Sign Up", "#2AF5B5", "StartSignUp"], ["Later", "#B3B3B3", null] ]);
    return;
  }
  // Leave the mobile full-screen post view before moving to the composer, so
  // the post/chat elements are restored and the feed is no longer body-fixed.
  if (MobilePostView != null) {
    if (MobilePostView.Closing == true) {
      await sleep(450);
    } else {
      await CloseMobileChat();
    }
  }
  SwitchPage("Home");

  function InsertChatQuote() {
    var PostCreate = find("CreatePostTextHolder");
    if (PostCreate == null) {
      return;
    }
    var SearchAdd = "/Chat_" + Data._id;
    if (PostCreate.textContent.includes(SearchAdd) == false) {
      PostCreate.textContent = SearchAdd + " ";
    }
    // Force a format pass even if PreviousText happens to match the composer
    // text (for example after a previous attempt inserted the token but could
    // not style it). Without this RenderNewText() returns early and the token
    // stays plain white.
    PreviousText = null;
    PostCreate.focus();
    SetCursor(PostCreate, PostCreate.textContent.length);
    if (PostCreate.textContent.length > 0) {
      // A previously blurred empty composer keeps the placeholder color, which
      // makes RenderNewText() clear the placeholder and return without styling.
      setCSS(PostCreate, "color", FontColorA);
      RenderNewText();
    }
    // RenderNewText rebuilds the composer nodes, so restore the caret and keep
    // focus in the field after formatting.
    SetCursor(PostCreate, PostCreate.textContent.length);
    PostCreate.focus();

    var Composer = find("CreatePost");
    if (Composer != null) {
      Composer.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  InsertChatQuote();
  // Dropdown actions run on mousedown. Re-assert focus afterwards so the
  // browser's default focus change cannot blur the composer on desktop.
  setTimeout(InsertChatQuote, 0);
}

function ReplyChat(Data) {
  Data = Data[3];
  if (Data._id != null && Data.User != null) {
    var ChatContainer = find(Data._id + "Chat").parentNode.parentNode.parentNode.querySelector("#ChatType");
    if (ChatContainer.querySelector("#ReplyToFrame") != null) {
      setCSS(ChatContainer.querySelector("#ReplyToFrame").getAttribute("ReplyChatID") + "Chat", "background-color", "rgba(0, 0, 0, 0)");
      ChatContainer.querySelector("#ReplyToFrame").remove();
    }
    setCSS(Data._id + "Chat", "background-color", "rgba(42, 245, 181, 0.15)");
    var ReplyFrame = createElement("ReplyToFrame", "div", ChatContainer, [
      ["position", "relative"],
      ["width", "calc(100% - 10px)"],
      ["height", "18px"],
      ["left", "5px"],
      ["margin-top", "4px"]
    ]);
    ReplyFrame.setAttribute("ReplyChatID", Data._id);
    ChatContainer.insertBefore(ReplyFrame, ChatContainer.firstChild);
    setCSS(ChatContainer.querySelector("#SendChatButton"), "margin-top", "22px");
    createElement("UserAlert", "div", ReplyFrame, [
      ["position", "relative"],
      ["width", "calc(100% - 18px)"],
      ["height", "18px"],

      // Text:
      ["font-size", "14px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#aaaaaa"],
      ["text-align", "left"]
    ]).innerHTML = "Replying to <span style='color: " + FontColorA + "'>" + Data.User + "</span>";
    var CancelReplyButton = createElement("CloseMediaButton", "div", ReplyFrame, [
      ["position", "absolute"],
      ["display", "flex"],
      ["top", "0px"],
      ["right", "0px"],
      ["height", "18px"],
      ["width", "18px"],
      ["background-color", "rgba(0, 0, 0, 0.45)"],
      ["border-radius", "60px"],
      ["cursor", "pointer"],

      // Text:
      ["font-size", "16px"],
      ["font-family", FontTypeA],
      ["font-weight", "1800"],
      ["color", "#cccccc"],
      ["text-align", "center"],
      ["justify-content", "center"],
      ["align-items", "center"]
    ]);
    CancelReplyButton.innerHTML = "&times;";
    CancelReplyButton.addEventListener("click", function () {
      setCSS(Data._id + "Chat", "background-color", "rgba(0, 0, 0, 0)");
      setCSS(ChatContainer.querySelector("#SendChatButton"), "margin-top", "0px");
      ReplyFrame.remove();
    });
  }
}
function ReportUser(Data) {
  SendRequest("PostWebhook", {
    Webhook: "Report",
    Details: Data
  }, function (Metadata, Data) {});
}

function DisableAccount() {
  SendRequest("ManageAccount", { Type: "Disable" }, function (Metadata, Data) {
    if (Data.Code == 200) {
      SignOutOfAccount(true);
      ShowPopUp("Account Disabled", "Your account has been disabled. If you want to recover your account just log back in.", [["Okay", "#618BFF", "ClearDataRefreshPage"]]);
    } else if (Data.Code == "AccountManage-429") {
      ShowPopUp("Rate Limit", "You may only <b>Disable</b> or <b>Delete</b> you account once per day to prevent abuse.", [["Okay", "#618BFF", null]]);
    } else {
      ShowPopUp("Error " + Data.Code, "There was some sort of error with your request. Please try again later.", [["Okay", "#618BFF", null]]);
    }
  });
}
function DeleteAccount() {
  SendRequest("ManageAccount", { Type: "Delete" }, function (Metadata, Data) {
    if (Data.Code == 200) {
      SignOutOfAccount(true);
      ShowPopUp("Account Marked", "Your account has been disabled for 30 days. After 30 days all data relating to the account will be cleared. We're sad to see you go! ☹️ Please contact us at <b>exotekservices@gmail.com</b> if you have feedback!", [["Okay", "#618BFF", "ClearDataRefreshPage"]]);
    } else if (Data.Code == "AccountManage-429") {
      ShowPopUp("Rate Limit", "You may only <b>Disable</b> or <b>Delete</b> you account once per day to prevent abuse.", [["Okay", "#618BFF", null]]);
    } else {
      ShowPopUp("Error " + Data.Code, "There was some sort of error with your request. Please try again later.", [["Okay", "#618BFF", null]]);
    }
  });
}

function RecoverAccount() {
  SendRequest("ManageAccount", { Type: "Recover" }, function (Metadata, Data) {
    if (Data.Code == 200) {
      RefreshPage();
    } else {
      ShowPopUp("Error " + Data.Code, "There was some sort of error with your request. Please try again later.", [["Okay", "#618BFF", null]]);
    }
  });
}

function UpdateSocialLinks(Metadata, Data) {
  if (UserID == null) {
    return;
  }
  ProfileData.Socials = ProfileData.Socials || {};

  var Key = Object.keys(Data.NewSocial)[0];
  var Value = Data.NewSocial[Key];
  if (ProfileData.Socials[Key] == Value) {
    return;
  }
  var OldTile = find("SocialConnectionTile" + Key);
  if (OldTile != null) {
    OldTile.remove();
  }
  ProfileData.Socials[Key] = Value;
  
  var MaxConnectedCounter = find("MaxConnectedCounter");
  if (MaxConnectedCounter != null) {
    MaxConnectedCounter.innerHTML = "<b>" + Object.keys(ProfileData.Socials).length + "</b>/12 Accounts";
  }
  var SocialLinksHolder = find("SocialLinksHolder");
  if (SocialLinksHolder != null) {
    var SocialData = SocialLinkData[Key.substring(0, Key.indexOf("_"))];

    var Tile = createElement("SocialConnectionTile" + Key, "div", SocialLinksHolder, [
      ["position", "relative"],
      ["display", "inline-block"],
      ["box-sizing", "border-box"],
      ["background-color", ContentColorLayer3],
      ["width", "100%"],
      ["padding", "5px"],
      ["margin-top", "3px"],
      ["border-radius", "8px"]
    ]);
    Tile.setAttribute("title", SocialData[0]);
    var ViewProfileB = createElement("SocialViewProfile" + Key, "a", Tile, [
      ["box-sizing", "border-box"],
      ["width", "30px"],
      ["height", "30px"],
      ["float", "left"],
      ["padding", "4px"],
      ["background-color", SocialData[1]],
      ["content", "url('./Images/SocialNetworks/" + SocialData[0] + ".svg')"],
      ["border-radius", "6px"],
      ["cursor", "pointer"]
    ]);
    var ConnectedMediaUsername = createElement("ConnectedMediaUsername" + Key, "a", Tile, [
      ["position", "relative"],
      ["display", "inline-block"],
      ["float", "left"],
      ["margin-left", "4px"],
      ["margin-top", "5.5px"],
      ["cursor", "pointer"],

      // Text:
      ["font-size", "16px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["text-decoration", "none"],
      ["color", FontColorA],
      ["text-align", "left"]
    ]);
    var SocialProfileName = Value;
    if (SocialData[3] != null) {
      SocialProfileName = SocialData[3] + SocialProfileName;
    }
    ConnectedMediaUsername.textContent = SocialProfileName;
    if (SocialData[2] != "PROMPT_USERNAME") {
      ViewProfileB.setAttribute("href", SocialData[2].replace(/USERID_GOES_HERE/g, Key.substring(Key.indexOf("_")+1)).replace(/USERNAME_GOES_HERE/g, Value));
      ViewProfileB.setAttribute("target", "_blank");
      ConnectedMediaUsername.setAttribute("href", SocialData[2].replace(/USERID_GOES_HERE/g, Key.substring(Key.indexOf("_")+1)).replace(/USERNAME_GOES_HERE/g, Value));
      ConnectedMediaUsername.setAttribute("target", "_blank");
    } else {
      ViewProfileB.setAttribute("onmouseup", 'ShowPopUp("' + SocialData[0] + '", "<i>' + SocialProfileName + '</i>", [ ["Close", "#618BFF"] ])');
      ConnectedMediaUsername.setAttribute("onmouseup", 'ShowPopUp("' + SocialData[0] + '", "<i>' + SocialProfileName + '</i>", [ ["Close", "#618BFF"] ])');
    }
    var RemoveConnectionB = createElement("RemoveConnectionB" + Key, "div", Tile, [
      ["position", "relative"],
      ["display", "inline-block"],
      ["background-color", "#FF4174"],
      ["padding", "4px 6px 4px 6px"],
      ["float", "right"],
      ["margin", "3px 3px 0px 0px"],
      ["cursor", "pointer"],
      ["border-radius", "6px"],

      // Text:
      ["font-size", "14px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"],
      ["text-align", "left"]
    ]);
    RemoveConnectionB.textContent = "Remove";
    RemoveConnectionB.setAttribute("TypeRender", "RemoveSocialConnectionB");
    RemoveConnectionB.setAttribute("SocialID", Key);
  }
}

var CurrentUserSelect = null;
function FinishBlockUser() {
  SendRequest("AddBlockedUser", { BlockUser: CurrentUserSelect[0] }, function (Metadata, Data) {
    if (Data.Code == 200) {
      var ModChats = document.getElementsByClassName(CurrentUserSelect[1] + "ChatText");
      for (var d = (ModChats.length - 1); d > -1; d -= 1) {
        ModChats[d].parentNode.remove();
      }
      var ModPosts = document.getElementsByClassName(CurrentUserSelect[1] + "PostText");
      for (var d = (ModPosts.length - 1); d > -1; d -= 1) {
        ModPosts[d].parentNode.parentNode.parentNode.remove();
      }
      BlockedUsers = Data.BlockedUsers;
      SwitchPage("Home");
      GetPosts({
        Add: "Top",
        Limit: 15
      });
    }
  });
}
function BlockUser(Data) {
  Data = Data[3];
  CurrentUserSelect = Data;
  ShowPopUp("Block " + Data[1] + "?", "Are you sure you want to <b>block " + Data[1] + "</b>? You can always unblock them in settings.", [["Block", "#FF8652", "FinishBlockUser"], ["Cancel", "#B3B3B3", null]]);
}
function GetBlockedUsers() {
  SendRequest("GetBlockedUsers", {}, function (Metadata, Data) {
    if (Data.Code == 200) {
      var BlockedTileHolder = find("SettingsBlockedHolder");
      if (BlockedTileHolder != null) {
        var BlockedDataUsers = Data.BlockedUsers;
        while (BlockedTileHolder.firstChild) {
          BlockedTileHolder.firstChild.remove();
        }
        var BlockedUserSettingsTitleText = find("BlockedUserSettingsTitleText");
        if (BlockedUserSettingsTitleText != null) {
          BlockedUserSettingsTitleText.innerHTML = "Blocked Users  <span style='font-size: 16px; color: #dddddd '>" + BlockedDataUsers.length + "</span><span style='font-size: 13px; color: #888888'> /50</span>";
        }
        var UnblockAllButton = find("UnblockAllButton");
        if (BlockedDataUsers.length < 1) {
          if (UnblockAllButton != null) {
            setCSS(UnblockAllButton, "display", "none");
          }
          createElement("NobodyBlockedMessage", "div", BlockedTileHolder, [
            ["position", "relative"],
            ["width", "calc(100% - 30px)"],
            ["left", "15px"],
            ["margin-top", "6px"],

            // Text:
            ["font-size", "16px"],
            ["font-family", FontTypeA],
            ["font-weight", "900"],
            ["color", "#aaaaaa"],
            ["text-align", "center"]
          ]).textContent = "When you run into a meanie, they go here...";
        } else {
          if (UnblockAllButton != null) {
            setCSS(UnblockAllButton, "display", "inline-block");
          }
          for (var i = 0; i < BlockedDataUsers.length; i++) {
            var Tile = createElement("BlockedUserTile", "div", BlockedTileHolder, [
              ["position", "relative"],
              ["background-color", ContentColorLayer3],
              ["width", "calc(100% - 12px)"],
              ["left", "6px"],
              ["min-height", "50px"],
              ["border-radius", "12px"],
              ["margin-top", "6px"]
            ]);
            createElement("BlockedUserPic", "div", Tile, [
              ["position", "relative"],
              ["display", "inline-block"],
              ["width", "35px"],
              ["height", "35px"],
              ["border-radius", "8px"],
              ["float", "left"],
              ["margin-left", "7.5px"],
              ["margin-top", "7.5px"],
              ["margin-bottom", "7.5px"],
              ["object-fit", "cover"],

              ["content", "url('" + GoogleCloudStorgeURL + "ProfileImages/" + DecideProfilePic(BlockedDataUsers[i]) + "')"]
            ]);
            createElement("BlockedUsername", "div", Tile, [
              ["position", "relative"],
              ["display", "inline-block"],
              ["float", "left"],
              ["margin-left", "4px"],
              ["margin-top", "14px"],
              ["margin-bottom", "14px"],

              // Text:
              ["font-size", "18px"],
              ["font-family", FontTypeA],
              ["font-weight", "900"],
              ["color", FontColorA],
              ["text-align", "left"]
            ]).textContent = BlockedDataUsers[i].User;
            var UnblockButton = createElement("UnblockUser", "div", Tile, [
              ["position", "relative"],
              ["display", "inline-block"],
              ["background-color", ThemeColor],
              ["padding", "4px 6px 4px 6px"],
              ["float", "right"],
              ["margin-right", "10.5px"],
              ["margin-top", "10.5px"],
              ["margin-bottom", "10.5px"],
              ["border-radius", "8px"],
              ["cursor", "pointer"],

              // Text:
              ["font-size", "18px"],
              ["font-family", FontTypeA],
              ["font-weight", "900"],
              ["color", "#ffffff"],
              ["text-align", "left"]
            ]);
            UnblockButton.setAttribute("UnblockButton", BlockedDataUsers[i]._id);
            UnblockButton.textContent = "Unblock";
          }
        }
      }
    }
  });
}
function UnblockUsers(Users, Source) {
  if (Users == null) {
    return;
  }
  SendRequest("UnblockUsers", { UnblockUsers: Users }, async function (Metadata, Data) {
    if (Data.Code == 200) {
      BlockedUsers = Data.BlockedUsers;
      window.scrollTo(window.scrollX, 0);
      if (Source == "ProfileBlock") {
        LoadProfilePage(Users[0], true);
      } else {
        GetBlockedUsers();
        GetPosts({
          Add: "Top",
          Limit: 15
        });
      }
    }
  });
}

function GetActiveSessions() {
  SendRequest("GetActiveDevices", {}, function (Metadata, Data) {
    if (Data.Code == 200) {
      var SessionTileHolder = find("SettingsSessionHolder");
      if (SessionTileHolder != null) {
        var ActiveDevices = Data.Devices;
        while (SessionTileHolder.firstChild) {
          SessionTileHolder.firstChild.remove();
        }
        var LoadingSessionsMessage = find("LoadingSessionsMessage");
        if (LoadingSessionsMessage != null) {
          LoadingSessionsMessage.remove();
        }
        if (ActiveDevices.length < 2) {
          var SignOutAllButton = find("SignOutAllButton");
          if (SignOutAllButton != null) {
            SignOutAllButton.remove();
          }
        }
        for (var i = 0; i < ActiveDevices.length; i++) {
          var Tile = createElement("DeviceUserTile", "div", SessionTileHolder, [
            ["position", "relative"],
            ["background-color", ContentColorLayer3],
            ["width", "calc(100% - 12px)"],
            ["left", "6px"],
            ["min-height", "50px"],
            ["border-radius", "12px"],
            ["margin-top", "6px"]
          ]);
          var DeviceIPText = createElement("DeviceIPText", "div", Tile, [
            ["position", "relative"],
            ["margin-left", "8px"],
            ["top", "8px"],

            // Text:
            ["font-size", "18px"],
            ["font-family", FontTypeA],
            ["font-weight", "900"],
            ["color", FontColorA],
            ["text-align", "left"]
          ]);
          var LoginTime = (new Date(ActiveDevices[i].LastVisit)).toString();
          createElement("LastLoginText", "div", Tile, [
            ["position", "relative"],
            ["margin-left", "8px"],
            ["top", "8px"],

            // Text:
            ["font-size", "12px"],
            ["font-family", FontTypeA],
            ["font-weight", "900"],
            ["color", "#bbbbbb"],
            ["text-align", "left"]
          ]).textContent = "Login: " + LoginTime.substring(0, LoginTime.indexOf(" GMT"));

          var SetText = ActiveDevices[i].IP;
          if (ActiveDevices[i].IsUser != null) {
            SetText += " (This Device)";
          } else {
            var SignOutButton = createElement("SignOutButton", "div", Tile, [
              ["position", "absolute"],
              ["display", "inline-block"],
              ["background-color", ThemeColor],
              ["padding-left", "6px"],
              ["padding-right", "6px"],
              ["padding-top", "4px"],
              ["padding-bottom", "4px"],
              ["border-radius", "8px"],
              ["float", "right"],
              ["right", "10.5px"],
              ["top", "10.5px"],
              ["cursor", "pointer"],

              // Text:
              ["font-size", "18px"],
              ["font-family", FontTypeA],
              ["font-weight", "900"],
              ["color", "#ffffff"],
              ["text-align", "left"]
            ]);
            SignOutButton.setAttribute("SignOutButton", ActiveDevices[i].IP);
            SignOutButton.textContent = "Sign Out";
          }
          DeviceIPText.textContent = SetText;
        }
      }
    }
  });
}
function LogoutDevice(LogoutIP) {
  if (LogoutIP == null) {
    return;
  }
  SendRequest("SignOutSession", { SessionIP: LogoutIP }, function (Metadata, Data) {
    if (Data.Code == 200) {
      GetActiveSessions();
    }
  });
}

function SaveAccountData(UpdateData, SendBlobURL, SettingsPage, SaveLocalStorage) {
  SendRequest("UpdateAccountData", { Update: UpdateData }, function (Metadata, Data) {
    if (Data.Code == 200) {
      if (SaveLocalStorage != null) {
        window.localStorage.setItem("DisplaySettings", JSON.stringify(SaveLocalStorage));
      }

      Settings = Data.Settings;
      if (Data.CustomURL !== undefined) {
        UserCustomURL = Data.CustomURL;
      }
      if (SendBlobURL != null) {
        if (SettingsPage == "AccountScreen") {
          SendImageToServer("ProfileImageUpload", {}, [SendBlobURL]);
        } else if (SettingsPage == "ProfileScreen") {
          SendImageToServer("ProfileBannerUpload", {}, [SendBlobURL]);
        }
      }
      UpdateDisplaySettings();
      ShowPopUp("Saved Settings", "Your account settings have been successfully updated. It may take a bit for all changes to apply.", [["Okay", "#618BFF", "RefreshPage"]]);
    } else {
      if (Data.Code == 403) {
        ShowPopUp("Password Incorrect", "Your old password is incorrect.", [["Okay", "#618BFF", null]]);
      } else if (Data.Code == 409) {
        ShowPopUp("URL Taken", Data.Message || "That profile URL is already taken.", [["Okay", "#618BFF", null]]);
      } else if (Data.Code == 400) {
        ShowPopUp("Invalid Settings", Data.Message || "Profile pictures must be under <b>2 MB</b> in size!", [["Okay", "#618BFF", null]]);
      } else {
        ShowPopUp("Something Broke...", "Hmm... Something didn't work right. Please try again!", [["Okay", "#618BFF", null]]);
      }
    }
  });
}

function CheckUsernameAvailability(Username) {
  SendRequest("UsernameAvailability", { Username: Username }, function (Metadata, Data) {
    if (Data.Code == 200) {
      if (Data.Available == true) {
        var SaveButton = find("SaveSettingsButton");
        if (SaveButton != null) {
          setCSS(SaveButton, "display", "flex");
        }
      } else {
        var SaveButton = find("SaveSettingsButton");
        if (SaveButton != null) {
          setCSS(SaveButton, "display", "none");
        }
        ShowPopUp("Username Taken", "Somebody already has that username. Pick another one or add more charecters!", [["Okay", "#618BFF", null]]);
      }
    }
  });
}

function DisplayNewPostMessage(Metadata, Body) {
  if (ViewingProfileID != null || CurrentPage != "Home") {
    return;
  }
  // Don't disturb the single-post / older-posts view.
  var PostParam = new URLSearchParams(window.location.search).get("post");
  if (PostParam != null && PostParam != "") {
    return;
  }
  if (Body.NewPostData == null) {
    return;
  }
  var IsOwnPost = Body.NewPostData.UserID == UserID;
  if (IsOwnPost == false && BlockedUsers.includes(Body.NewPostData.UserID) == true) {
    return;
  }

  var NewPost = Body.Post;
  var NewPostUser = Body.User;
  var Holder = find("PostDisplayHolder");

  if (NewPost != null && find(NewPost._id) != null) {
    return; // Already rendered.
  }

  // On the home feed, insert the post live when the reader is already at the
  // top. Otherwise offer the refresh bar so the reading position is preserved.
  // The author's own post is always handled automatically.
  if (Holder != null && NewPost != null && NewPostUser != null) {
    var ScrollTop = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
    if (IsOwnPost == true || ScrollTop < 150) {
      CreatePostView(NewPost._id, NewPost, NewPostUser, Holder, false);
      var NewPostNode = find(NewPost._id);
      if (NewPostNode != null && Holder.firstChild != null && Holder.firstChild != NewPostNode) {
        Holder.insertBefore(NewPostNode, Holder.firstChild);
      }
      // Inserting above the viewport makes the browser anchor the old content
      // and push scrollY down. Keep the reader at the top so the newest post
      // (and any further live posts) stays in view.
      if (ScrollTop < 150) {
        requestAnimationFrame(function () {
          window.scrollTo(0, 0);
          requestAnimationFrame(function () {
            window.scrollTo(0, 0);
          });
        });
      }
      SetupPostChats(false);
      LoadEmbedPreviews();
      return;
    }
  }

  // The author never needs the refresh banner; their post was handled above.
  if (IsOwnPost == true) {
    return;
  }

  var ViewRefreshBar = find("ViewRefreshBar");
  if (ViewRefreshBar != null) {
    setCSS(ViewRefreshBar, "display", "block");
    ViewRefreshBar.innerHTML = "New posts have been added. Do you want to <div style='display: inline-block; background-color:" + ThemeColor + "; opacity: 0.9; border-radius: 6px; padding-left: 4px; padding-right: 4px; padding-top: 1px; padding-bottom: 1px; cursor: pointer; color: #ffffff'>Refresh</div>";
  }
}

// Staff broadcasts -----------------------------------------------------------

function AdminForceRefresh(Metadata, Body) {
  if (Body == null) return;

  if (Body.Mode == "Reload") {
    // A staff member pushed an update that all clients must pick up now.
    // Show a short blocking notice so nobody misses why the page reloads.
    if (find("AdminUpdateOverlay") != null) return;
    var UpdateOverlay = createElement("AdminUpdateOverlay", "div", "body", [
      ["position", "fixed"],
      ["left", "0px"],
      ["top", "0px"],
      ["z-index", "5000"],
      ["width", "100%"],
      ["height", "100%"],
      ["display", "flex"],
      ["align-items", "center"],
      ["justify-content", "center"],
      ["background-color", "rgba(0, 0, 0, 0.75)"],
      ["font-size", "26px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"],
      ["text-align", "center"],
      ["padding", "20px"],
      ["box-sizing", "border-box"]
    ]);
    UpdateOverlay.textContent = "Memblu has been updated. Reloading…";
    setTimeout(function () {
      window.location.reload();
    }, 1200);
    return;
  }

  // Feed mode: pull the newest posts on the home feed.
  if (CurrentPage == "Home" && typeof GetPosts == "function") {
    GetPosts({
      Add: "Top",
      Limit: 15
    });
  }
}

function AdminAnnouncement(Metadata, Body) {
  if (Body == null || Body.Message == null || String(Body.Message).length == 0) return;

  var ExistingBanner = find("AdminAnnouncementBanner");
  if (ExistingBanner != null) ExistingBanner.remove();

  var LevelColors = { info: "#3D87FF", success: "#2F9E58", warning: "#E0A63A", alert: "#C0392B" };
  var Color = LevelColors[String(Body.Level)] || LevelColors.info;

  var Banner = createElement("AdminAnnouncementBanner", "div", "body", [
    ["position", "fixed"],
    ["top", "12px"],
    ["left", "50%"],
    ["transform", "translateX(-50%)"],
    ["z-index", "1500"],
    ["display", "flex"],
    ["align-items", "center"],
    ["box-sizing", "border-box"],
    ["width", "calc(100% - 24px)"],
    ["max-width", "620px"],
    ["padding", "10px 12px"],
    ["background-color", Color],
    ["border-radius", "10px"],
    ["box-shadow", "0 6px 20px 0 rgba(0, 0, 0, 0.35)"]
  ]);

  var BannerText = createElement("AdminAnnouncementText", "div", Banner, [
    ["flex", "1"],
    ["font-size", "17px"],
    ["overflow-wrap", "break-word"],
    ["white-space", "pre-wrap"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", "#ffffff"]
  ]);
  BannerText.textContent = String(Body.Message);

  var BannerClose = createElement("AdminAnnouncementClose", "div", Banner, [
    ["display", "flex"],
    ["align-items", "center"],
    ["justify-content", "center"],
    ["width", "32px"],
    ["height", "32px"],
    ["margin-left", "10px"],
    ["background-color", "rgba(0, 0, 0, 0.25)"],
    ["border-radius", "8px"],
    ["cursor", "pointer"],
    ["font-size", "26px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", "#ffffff"]
  ]);
  BannerClose.innerHTML = "&times;";
  BannerClose.addEventListener("click", function () {
    Banner.remove();
  });
}

function AdminSessionRevoked(Metadata, Body) {
  WebSocketDisabled = true;
  ShowPopUp(
    "Signed Out",
    (Body && Body.Reason) || "An administrator signed out your session. Please sign in again.",
    [["Okay", "#618BFF", "RefreshPage"]]
  );
}

function ModerateUserAction(Task, Data) {
  SendRequest("ModerateUserAction", { Task: Task, Data: Data }, function (Metadata, Data) {
    if (Data.Code == 200) {
      if (Task == "Ban") {
        ShowPopUp("User Banned", "Successfully banned the selected user.", [["Okay", "#618BFF", null]]);
      }
    }
  });
}

function AlertUserOfTor() {
  WebSocketDisabled = true;
  ShowPopUp("TOR Blocked", "For moderation reasons, TOR Browser is currently blocked. Please use a standard browser such as <a style='color: #3D87FF' href='https://www.google.com/chrome/'>Google Chrome</a> in order to use Memblu.", []);
}

var BanData = null;
function ShowBanNotice(BanInfo) {
  if (BanData != null) {
    return;
  }
  WebSocketDisabled = true;
  BanData = BanInfo;
  loadScript(LoadScripts.BannedMessage);
}

function UserBanDisplay(Metadata, Body) {
  if (BanData != null) {
    return;
  }
  //ShowPopUp("BANNED", "Thor has spoken. <img style='width: 100%' src='https://media.tenor.com/images/bc8ff9b0f2271982a4592c205c9084b6/tenor.gif'></img>", []);
  ShowBanNotice(Body);
}

async function SendBanAppeal(Appeal) {
  SubmittingAppeal = Appeal;
  // The socket is often still open (banned users can sign in now), so send the
  // appeal immediately instead of waiting for a reconnect that never happens.
  if (Socket != null && Socket.readyState == Socket.OPEN) {
    SendRequest("SendBanAppeal", { Appeal: Appeal }, function (Metadata, Data) {
      if (Data.Code == 200) {
        SubmittingAppeal = null;
        WebSocketDisabled = true;
        ShowPopUp("Appeal Submitted", "Successfully sent ban appeal.", [["Okay", "#618BFF", null]]);
      }
    });
    return;
  }
  WebSocketDisabled = false;
  ConnectToBridge();
}

// Load Post From URL:
function LoadFromURLOrPosts() {
  var queryString = window.location.search;
  var urlParams = new URLSearchParams(queryString);

  var ProfileLoad = urlParams.get("user");
  if (ProfileLoad != null && ProfileLoad != "") {
    LoadProfilePage(ProfileLoad);
    return;
  }

  var PageLoad = urlParams.get("page");
  if (PageLoad != null && PageLoad != "") {
    PageLoad = PageLoad.toLowerCase();
    if (PageLoad == "privacy") {
      loadScript(LoadScripts.Privacy);
    } else if (PageLoad == "tos") {
      loadScript(LoadScripts.TOS);
    } else if (PageLoad == "rules") {
      loadScript(LoadScripts.Rules);
    } else if (PageLoad == "passreset") {
      SendRequest("ResetPassword", { NewPass: urlParams.get("newpass") }, function (Metadata, Data) {
        if (Data.Code == 200) {
          ShowPopUp("Password Data", "Copy the bellow data:\n<b>" + Data.NewPassData + "</b>", [["Okay", "#618BFF", null]]);
        }
      });
    } else if (PageLoad == "requestdata") {
      ShowPopUp("So Sorry!", "Requesting data is currently offline. Once we establish email verification we will be able to offer this service. You can also reach out to us at exotekservices@gmail.com. We appologize for this inconvenience.", [["Okay", "#618BFF", null]]);
    }
    //URLParams("post");
  }

  var PostLoad = urlParams.get("post");
  if (PostLoad == null || PostLoad == "") {
    GetPosts({
      Add: "Top",
      Limit: 15
    });
  } else {
    GetPostsFromID({ PostID: PostLoad.toLowerCase() }, "PageLoad");
  }
}

function FinishUnbanSelect(Data) {
  var queryString = window.location.search;
  var urlParams = new URLSearchParams(queryString);
  var UnbanUserLoad = urlParams.get("user");
  if (UnbanUserLoad != null && UnbanUserLoad != "") {
    SendRequest("UnbanUser", { UserID: UnbanUserLoad }, function (Metadata, Data) {
      if (Data.Code == 200) {
        ShowPopUp("User Unbanned", "Successfully unbanned the selected user.", [["Okay", "#618BFF", null]]);
      }
    });
  }
}
function CheckForUnbanURL() {
  var queryString = window.location.search;
  var urlParams = new URLSearchParams(queryString);
  var UnbanUserModLoad = urlParams.get("ModViewUnban");
  var UnbanUserLoad = urlParams.get("user");
  if (UnbanUserModLoad == "true" && UnbanUserLoad != null && UnbanUserLoad != "") {
    if (CheckPermision(LoginUserRole, "CanUnbanUser") == true) {
      URLParams("user", UnbanUserLoad);
      ShowPopUp("Unban User?", "Are you sure you want to <b>unban</b> this user?", [["Yes", "#FF4174", "FinishUnbanSelect"], ["Cancel", "#B3B3B3", null]]);
    }
  }
}

function SetMetaTag(Name, Content) {
  // CREDIT: https://stackoverflow.com/questions/9231845/javascript-to-change-metadata-metatags-dynamically

  var allMetaElements = document.getElementsByTagName('meta');
  //loop through and find the element you want
  for (var i = 0; i < allMetaElements.length; i++) {
    if (allMetaElements[i].getAttribute("property") == Name) {
      //make necessary changes
      allMetaElements[i].setAttribute('content', Content);
      //no need to continue loop after making changes.
      break;
    }
  }
}

function BinEncode(data) {
  var binArray = []
  var datEncode = "";

  for (i = 0; i < data.length; i++) {
    binArray.push(data[i].charCodeAt(0).toString(2));
  }
  for (j = 0; j < binArray.length; j++) {
    var pad = padding_left(binArray[j], '0', 8);
    datEncode += pad + ' ';
  }
  function padding_left(s, c, n) {
    if (!s || !c || s.length >= n) {
      return s;
    }
    var max = (n - s.length) / c.length;
    for (var i = 0; i < max; i++) {
      s = c + s;
    } return s;
  }
  console.log(binArray);
}

async function SendImageToServer(Type, Data, Files) {
  //new Image()

  var RequestData = {
    Type: Type,
    AccountData: {
      UserID: UserID,
      Fingerprint: FormatFingerprint(),
      AuthToken: GetAuthToken()
    },
    Metadata: {}
  };

  var DataKeys = Object.keys(Data);
  for (var i = 0; i < DataKeys.length; i++) {
    var Key = DataKeys[i];
    RequestData.Metadata[Key] = Data[Key];
  }

  var SendData = new FormData();

  SendData.append("RequestData", JSON.stringify(RequestData));

  for (var f = 0; f < Files.length; f++) {
    await fetch(Files[f]).then(async function (file) {
      SendData.append("File" + f, await file.blob());
    });
  }

  await fetch(ImageUploadDomain, {  // http://localhost:3000/ImageUpload | https://api.photop.live:3000/ImageUpload
    method: 'POST',
    cache: 'no-cache', // *default, no-cache, reload, force-cache, only-if-cached
    body: SendData
  });

  await sleep(1000);
}

/*
async function GetBase64ImageData(BlobImage) {

  var Image = document.createElement('img');
  
  return new Promise((resolve, reject) => {
    Image.addEventListener("load", function() {

      // CREDIT (Canvas Techniche): https://www.tutorialspoint.com/converting-images-to-a-base64-data-url-using-javascript
      // Create canvas
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      // Set width and height
      canvas.width = Image.width;
      canvas.height = Image.height;
      // Draw the image
      //ctx.drawImage(Image, 0, 0);
      ctx.drawImage(Image, 0, 0);
      var Base64 = canvas.toDataURL('image/webp');
      //prompt(Base64.substring(Base64.indexOf(":")+1, Base64.indexOf(";")));
      
      Image.remove();
      canvas.remove();
      URL.revokeObjectURL(BlobImage);

      resolve(Base64);
    });

    Image.src = BlobImage;
  });
}
*/

// MOVE LATER:
var PrimaryObj = find("Primary");
// ---- Mobile navigation helpers (visible buttons + gestures share these) ----
// Full-screen post view (mobile): post card on top, live chat filling the rest.
// The real post/button/chat elements are moved into the overlay (so likes, sending, etc. keep
// working) and put back, with their original inline styles, when it closes.
var MobilePostView = null;
var MobileViewportHandler = null;

// The chat panel inside the mobile view. Posting into a detached element while
// the view animates closed returns null, so every caller checks before using it.
function MobileChatFrame() {
  if (MobilePostView == null || MobilePostView.Chat == null || MobilePostView.Chat.parentNode == null) {
    return null;
  }
  return MobilePostView.Chat.querySelector("#Chat");
}

function ScrollMobileChatToBottom(Instant) {
  var Frame = MobileChatFrame();
  if (Frame == null) {
    return;
  }
  if (Instant == true) {
    Frame.scrollTop = Frame.scrollHeight;
  } else {
    Frame.scrollTo({ top: Frame.scrollHeight, behavior: "smooth" });
  }
}

// While the mobile keyboard is open the post card is folded away so the chat
// gets the screen; a long post would otherwise leave only a couple of lines.
function SetMobilePostCollapsed(Collapsed) {
  var Top = find("MobilePostViewTop");
  if (Top == null) {
    return;
  }
  if (Collapsed == true) {
    if (Top.getAttribute("Collapsed") == "true") {
      return;
    }
    Top.setAttribute("Collapsed", "true");
    Top.style.maxHeight = "0px";
    Top.style.marginTop = "0px";
    Top.style.marginBottom = "0px";
    Top.style.overflow = "hidden";
  } else if (Top.getAttribute("Collapsed") == "true") {
    Top.removeAttribute("Collapsed");
    Top.style.maxHeight = "55%";
    Top.style.marginTop = "8px";
    Top.style.marginBottom = "0px";
    Top.style.overflow = "hidden";
  }
}

function SyncMobileChatViewport() {
  if (MobilePostView == null || MobilePostView.Closing == true) {
    return;
  }
  var Holder = find("LiveChatHolder");
  if (Holder == null) {
    return;
  }

  // Size against the visual viewport so the input row stays above the keyboard
  // instead of being covered by it on mobile browsers.
  var Viewport = window.visualViewport;
  if (Viewport != null) {
    Holder.style.height = Viewport.height + "px";
    Holder.style.top = Viewport.offsetTop + "px";
  }

  var InputFocused = MobilePostView.Input != null && document.activeElement == MobilePostView.Input;
  SetMobilePostCollapsed(InputFocused);

  // Keep the newest message in view, including while the keyboard is open and
  // when the chat is long.
  var Frame = MobileChatFrame();
  if (Frame != null) {
    requestAnimationFrame(function () {
      if (MobilePostView != null && MobilePostView.Closing != true) {
        Frame.scrollTop = Frame.scrollHeight;
      }
    });
  }
}

var MobileButtonRowStyle = { "position": "relative", "bottom": "auto", "width": "100%", "height": "20px", "flex": "0 0 auto", "margin": "8px 0px 12px 0px", "padding-top": "0px" };

// Liking a post rebuilds its button row (inside the feed's post container). While that post is
// open in the full-screen view, the rebuilt row has to land in the view instead.
function MobilePostViewAdoptButtons(ID, Buttons) {
  var View = MobilePostView;
  if (View == null || View.ID != ID || View.Closing == true || Buttons == null || Buttons == View.Buttons) {
    return;
  }
  var Top = find("MobilePostViewTop");
  if (Top == null) {
    return;
  }
  View.Buttons = Buttons;
  MobileViewStyle(Buttons, MobileButtonRowStyle);
  Top.appendChild(Buttons);
}

function MobileViewStyle(Element, Styles) {
  if (Element == null || MobilePostView == null) {
    return;
  }
  MobilePostView.Saved.push([Element, Element.getAttribute("style")]);
  var Keys = Object.keys(Styles);
  for (var i = 0; i < Keys.length; i++) {
    Element.style.setProperty(Keys[i], Styles[Keys[i]]);
  }
}

async function OpenMobileChat(PostID) {
  var PostContainer = find(PostID);
  var Chat = find(PostID + "LiveChat");
  var Post = find(PostID + "Post");
  var Buttons = find(PostID + "PostButtonHolder");
  var Holder = find("LiveChatHolder");
  var Nav = find("NavButtonHolder");
  if (PostContainer == null || Chat == null || Post == null || Holder == null || MobilePostView != null || Holder.hasAttribute("Open") == true || (Nav != null && Nav.hasAttribute("Open") == true)) {
    return;
  }
  ScrolledToMobile = window.scrollY;
  MobilePostView = {
    ID: PostID,
    Container: PostContainer,
    Post: Post,
    Buttons: Buttons,
    Chat: Chat,
    Input: find(PostID + "TextBox"),
    HolderHeight: Holder.style.height,
    HolderTop: Holder.style.top,
    HolderTransition: Holder.style.transition,
    Saved: [],
    Closing: false
  };
  Holder.setAttribute("Open", "");
  // Only the slide should animate; the viewport-following height must be instant.
  Holder.style.transition = "left 0.4s ease 0s";

  // Top bar with back button:
  var Bar = createElement("MobilePostViewBar", "div", Holder, [
    ["position", "relative"],
    ["display", "flex"],
    ["flex", "0 0 auto"],
    ["align-items", "center"],
    ["width", "100%"],
    ["height", "48px"],
    ["background-color", PageColor],
    ["border-bottom", "1px solid " + BorderColor]
  ]);
  var BackButton = createElement("MobilePostViewBack", "div", Bar, [
    ["position", "relative"],
    ["display", "flex"],
    ["align-items", "center"],
    ["justify-content", "center"],
    ["width", "52px"],
    ["height", "100%"],
    ["cursor", "pointer"]
  ]);
  BackButton.setAttribute("role", "button");
  BackButton.setAttribute("aria-label", "Back to feed");
  BackButton.setAttribute("title", "Back");
  BackButton.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="' + FontColorA + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';
  BackButton.addEventListener("click", CloseMobileChat);
  createElement("MobilePostViewTitle", "div", Bar, [
    ["position", "relative"],
    ["font-size", "20px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA],
    ["user-select", "none"]
  ]).textContent = "Post";

  // Post card (scrolls if the post is long, never taking more than ~55% of the screen):
  var Top = createElement("MobilePostViewTop", "div", Holder, [
    ["position", "relative"],
    ["display", "flex"],
    ["flex-direction", "column"],
    ["flex", "0 1 auto"],
    ["max-height", "55%"],
    ["margin", "8px 8px 0px 8px"],
    ["background-color", ContentColor],
    ["border-radius", "12px"],
    ["overflow", "hidden"]
  ]);
  var Scroll = createElement("MobilePostViewScroll", "div", Top, [
    ["position", "relative"],
    ["flex", "1 1 auto"],
    ["min-height", "0px"],
    ["overflow-y", "auto"]
  ]);
  Scroll.className = "StandardScroll";

  MobileViewStyle(Post, { "width": "100%", "min-height": "0px", "max-height": "none" });
  MobileViewStyle(find(PostID + "Content"), { "max-height": "none", "overflow": "visible" });
  MobileViewStyle(find(PostID + "TextHolder"), { "max-height": "none", "overflow": "visible" });
  MobileViewStyle(Post.querySelector("#Spacer"), { "display": "none" });
  Scroll.appendChild(Post);

  if (Buttons != null) {
    MobileViewStyle(Buttons, MobileButtonRowStyle);
    Top.appendChild(Buttons);
  }

  // Live chat fills the remaining space:
  MobileViewStyle(Chat, {
    "position": "relative",
    "display": "flex",
    "flex": "1 1 0px",
    "min-height": "0px",
    "width": "calc(100% - 16px)",
    "height": "auto",
    "max-height": "none",
    "margin": "8px 8px 8px 8px",
    "left": "0px",
    "top": "0px",
    "right": "auto",
    "border-radius": "12px"
  });
  Holder.appendChild(Chat);
  var ChatContainer = Chat.querySelector("#Chat");
  if (ChatContainer != null) {
    ChatContainer.scrollTo(0, ChatContainer.scrollHeight);
  }

  // Fold the post away as soon as the reader starts typing, and bring the chat
  // back when they are done. Without this a long post or a busy chat leaves
  // almost no room above the keyboard.
  if (MobilePostView.Input != null) {
    MobilePostView.Input.addEventListener("focus", function () {
      SetMobilePostCollapsed(true);
      SyncMobileChatViewport();
      setTimeout(function () {
        ScrollMobileChatToBottom(true);
      }, 250);
    });
    MobilePostView.Input.addEventListener("blur", function () {
      SetMobilePostCollapsed(false);
      SyncMobileChatViewport();
    });
  }

  MobileViewportHandler = function () {
    SyncMobileChatViewport();
  };
  window.addEventListener("resize", MobileViewportHandler);
  if (window.visualViewport != null) {
    window.visualViewport.addEventListener("resize", MobileViewportHandler);
    window.visualViewport.addEventListener("scroll", MobileViewportHandler);
  }

  Holder.style.left = "0%";
  await sleep(400);

  SyncMobileChatViewport();
  ScrollMobileChatToBottom(true);
  // Late layout (fonts, wrapped media) can still change the chat height.
  setTimeout(function () {
    ScrollMobileChatToBottom(true);
  }, 250);

  setCSS("Primary", "overflow", "hidden");
  setCSS("body", "position", "fixed");
  // Locking the body can change the visual viewport one last time.
  SyncMobileChatViewport();
  ScrollMobileChatToBottom(true);
}

async function CloseMobileChat() {
  var Holder = find("LiveChatHolder");
  var View = MobilePostView;
  if (Holder == null || View == null || View.Closing == true || Holder.hasAttribute("Open") == false) {
    return;
  }
  View.Closing = true;
  if (MobileViewportHandler != null) {
    window.removeEventListener("resize", MobileViewportHandler);
    if (window.visualViewport != null) {
      window.visualViewport.removeEventListener("resize", MobileViewportHandler);
      window.visualViewport.removeEventListener("scroll", MobileViewportHandler);
    }
    MobileViewportHandler = null;
  }
  Holder.style.height = View.HolderHeight || "";
  Holder.style.top = View.HolderTop || "";
  Holder.style.transition = View.HolderTransition || "";
  removeCSS("Primary", "overflow");
  removeCSS("body", "position");
  window.scrollTo({ top: ScrolledToMobile, left: 0, behavior: "auto" });

  Holder.style.left = "110%";
  await sleep(400);

  // Put everything back where it came from, exactly as it was:
  View.Container.insertBefore(View.Post, View.Container.firstChild);
  if (View.Buttons != null) {
    View.Container.appendChild(View.Buttons);
  }
  View.Container.appendChild(View.Chat);
  for (var i = 0; i < View.Saved.length; i++) {
    var Saved = View.Saved[i];
    if (Saved[1] == null) {
      Saved[0].removeAttribute("style");
    } else {
      Saved[0].setAttribute("style", Saved[1]);
    }
  }
  var Leftovers = ["MobilePostViewBar", "MobilePostViewTop"];
  for (var l = 0; l < Leftovers.length; l++) {
    var Leftover = find(Leftovers[l]);
    if (Leftover != null) {
      Leftover.remove();
    }
  }
  Holder.removeAttribute("Open");
  MobilePostView = null;
}

async function OpenMobileNav() {
  var Nav = find("NavButtonHolder");
  var Holder = find("LiveChatHolder");
  if (Nav == null || (Holder != null && Holder.hasAttribute("Open") == true)) {
    return;
  }
  Nav.setAttribute("Open", "");
  Nav.style.left = "0%";
  var Backdrop = find("NavBackdrop");
  if (Backdrop != null) {
    Backdrop.style.display = "block";
    await sleep(10);
    Backdrop.style.opacity = "1";
  }
}

async function CloseMobileNav() {
  var Nav = find("NavButtonHolder");
  if (Nav == null || Nav.hasAttribute("Open") == false) {
    return;
  }
  Nav.style.left = "-110%";
  var Backdrop = find("NavBackdrop");
  if (Backdrop != null) {
    Backdrop.style.opacity = "0";
  }
  await sleep(400);
  if (Nav.style.left == "-110%") { // Not re-opened while closing.
    Nav.removeAttribute("Open");
    if (Backdrop != null) {
      Backdrop.style.display = "none";
    }
  }
}

function CheckPrimarySize(Source) {
  if (PrimaryObj.clientWidth < 940) { // 1100
    setCSS(PrimaryObj, "left", "0%");
    setCSS(PrimaryObj, "transform", "translateX(0%)");
  } else {
    setCSS(PrimaryObj, "left", "50%");
    setCSS(PrimaryObj, "transform", "translateX(-50%)");
  }
  if ((DeviceIsMobile() == true && screen.width < 550) || ForceMobileVersion == true) { //window.innerWidth < 616 || 
    if (MobileVersion == false) {
      MobileVersion = true;
      removeCSS(PrimaryObj, "min-width");
      //setCSS(PrimaryObj, "width", "200vh");
      //setCSS(PrimaryObj, "overflow-x", "hidden");

      setCSS("MainContent", "width", "calc(100% - 16px)");
      //setCSS("PostContent", "position", "absolute");
      setCSS("MainContent", "margin-left", "8px");

      //setCSS("SponseredContent", "display", "none");

      var MobileLiveChatHolder = createElement("LiveChatHolder", "div", "body", [
        ["position", "fixed"],
        //["display", "none"],
        ["top", "0px"],
        ["width", "100%"],
        ["height", "100vh"],
        ["left", "110%"],
        ["transition", "all 0.4s ease 0s"],
        ["background-color", PageColor],
        ["z-index", "20"]
      ]);

      MobileLiveChatHolder.style.height = "100dvh"; // Ignored where unsupported; keeps 100vh.
      MobileLiveChatHolder.style.display = "flex";
      MobileLiveChatHolder.style.flexDirection = "column";

      var swiper = new Swipe(MobileLiveChatHolder);
      swiper.onRight(CloseMobileChat);
      swiper.run();

      var NavBackdrop = createElement("NavBackdrop", "div", "body", [
        ["position", "fixed"],
        ["display", "none"],
        ["top", "0px"],
        ["left", "0px"],
        ["width", "100%"],
        ["height", "100%"],
        ["background-color", "rgba(0, 0, 0, 0.55)"],
        ["opacity", "0"],
        ["transition", "opacity 0.4s ease 0s"],
        ["z-index", "19"]
      ]);
      NavBackdrop.addEventListener("click", CloseMobileNav);

      var NavButtonHolder = createElement("NavButtonHolder", "div", "body", [
        ["position", "fixed"],
        ["top", "0px"],
        ["width", "80%"],
        ["max-width", "320px"],
        ["height", "100vh"],
        ["left", "-110%"],
        ["transition", "all 0.4s ease 0s"],
        ["background-color", PageColor],
        ["overflow-y", "auto"],
        ["z-index", "20"]
      ]);
      NavButtonHolder.style.height = "100dvh"; // Ignored where unsupported; keeps 100vh.

      var SideBarHolder = find("SideBarHolder");

      setCSS(SideBarHolder, "width", "calc(100% - 16px)");
      setCSS(SideBarHolder, "position", "absolute");
      setCSS(SideBarHolder, "left", "0px");
      setCSS(SideBarHolder, "margin-left", "8px");

      NavButtonHolder.appendChild(SideBarHolder);

      // Always-visible top bar so the menu doesn't depend on discovering a swipe gesture.
      var MobileTopBar = createElement("MobileTopBar", "div", "body", [
        ["position", "fixed"],
        ["display", "flex"],
        ["align-items", "center"],
        ["top", "0px"],
        ["left", "0px"],
        ["width", "100%"],
        ["height", "48px"],
        ["background-color", PageColor],
        ["border-bottom", "1px solid " + BorderColor],
        ["z-index", "15"]
      ]);
      var MenuButton = createElement("MobileMenuButton", "div", MobileTopBar, [
        ["position", "relative"],
        ["display", "flex"],
        ["align-items", "center"],
        ["justify-content", "center"],
        ["width", "52px"],
        ["height", "100%"],
        ["cursor", "pointer"]
      ]);
      MenuButton.setAttribute("role", "button");
      MenuButton.setAttribute("aria-label", "Open menu");
      MenuButton.setAttribute("title", "Menu");
      MenuButton.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="' + ThemeColor + '" stroke-width="2.4" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
      MenuButton.addEventListener("click", OpenMobileNav);
      createElement("MobileTopBarTitle", "div", MobileTopBar, [
        ["position", "relative"],
        ["font-size", "22px"],
        ["font-family", FontTypeA],
        ["font-weight", "900"],
        ["color", ThemeColor],
        ["user-select", "none"]
      ]).textContent = "Memblu";
      setCSS("MainContent", "margin-top", "56px"); // Clear the fixed top bar.

      var swiper = new Swipe("body");
      swiper.onRight(OpenMobileNav);
      swiper.run();
      var swiper = new Swipe("body");
      swiper.onLeft(CloseMobileNav);
      swiper.run();

      if (Source == "Event") {
        if (typeof GetPosts != "undefined") {
          GetPosts({
            Add: "Top",
            Limit: 15
          });
        }
      }
    }
  } else if (MobileVersion == true) {
    MobileVersion = false;
    RefreshPage();
  }
}
//var ResizeTimeout;
window.addEventListener("resize", function () {
  //clearTimeout(ResizeTimeout);

  CheckPrimarySize("Event");

  // User Dropwdown - Most is in MainUi
  if (CurrentDropdown != null && LastClickTime < Date.now()) {
    CurrentDropdown.remove();
  }
  // User Preview - Most is in MainUi
  if (CurrentPreview != null && LastClickTime < Date.now()) {
    CurrentPreview.remove();
  }
});

var queryString = window.location.search;
var urlParams = new URLSearchParams(queryString);
var EmbedLoad = urlParams.get("embed");
if (EmbedLoad == "mobile") {
  ForceMobileVersion = true;
  //CheckPrimarySize();
  //MobileVersion = true;
}

CheckPrimarySize("Load");

/*
async function GetBase64ImageData(BlobImage) {
  var BlobImage = await fetch(BlobImage).then(r => r.blob());
  var Image = await FileReaderCalculate(BlobImage);
  URL.revokeObjectURL(BlobImage);
  return Image;
}

const FileReaderCalculate = (inputFile) => {
  const temporaryFileReader = new FileReader();

  return new Promise((resolve, reject) => {
    temporaryFileReader.onerror = () => {
      temporaryFileReader.abort();
      reject(new DOMException("Problem parsing input file."));
    };

    temporaryFileReader.onloadend = () => {
      resolve(temporaryFileReader.result);
    };
    temporaryFileReader.readAsDataURL(inputFile);
  });
};
*/

async function LoadProfilePage(ProfileUserID, IgnoreAlreadyOn) {
  if (window.ProfilePageJSLoaded == null) {
    loadScript(LoadScripts.Profile);
    while (window.ProfilePageJSLoaded == null) { await sleep(100) }
    LoadProfile(ProfileUserID, IgnoreAlreadyOn);
  } else {
    LoadProfile(ProfileUserID, IgnoreAlreadyOn);
  }
}