// Photop Admin / Moderator Panel
// Renders the staff tools exposed by the Admin* WebSocket tasks:
// AdminOverview, AdminUsers, AdminUserDetail, AdminUpdateUser, AdminContent,
// AdminContentAction, AdminReports, AdminAppeals, AdminSessions,
// AdminBroadcast and AdminLog.

// Re-opening the panel must not stack a second copy of the overlay.
var ExistingAdminPanel = find("AdminBackBlur");
if (ExistingAdminPanel != null) {
  ExistingAdminPanel.remove();
}

if (HasAdminAccess(LoginUserRole) != true) {
  ShowPopUp("Staff Only", "You do not have permission to open the admin panel.", [["Okay", "#618BFF", null]]);
} else {
  SetPageTitle("Admin Panel | Photop");

  var AdminState = {
    Tab: "Overview",
    Users: { Page: 1, Search: "", Filter: "All", Sort: "Newest" },
    Content: { Type: "Posts", Page: 1, Search: "", Filter: "All" },
    Reports: { Page: 1, Status: "open", Type: "All", Search: "" },
    Appeals: { Page: 1, Status: "pending", Search: "" },
    Sessions: { Page: 1, Status: "Active", Search: "" },
    UserID: null
  };

  var AdminUIDCounter = 0;
  var AdminTabButtons = {};
  var AdminTabNames = ["Overview", "Users", "Content", "Reports", "Appeals", "Sessions", "Audit Log", "Broadcast"];

  function AdminID(Prefix) {
    AdminUIDCounter = AdminUIDCounter + 1;
    return Prefix + AdminUIDCounter;
  }

  function AdminClear(Node) {
    if (Node == null) return;
    while (Node.firstChild != null) {
      Node.removeChild(Node.firstChild);
    }
  }

  function AdminText(Parent, Text, Styles, Tag) {
    var Element = createElement(AdminID("AdminText"), Tag || "div", Parent, Styles || []);
    Element.textContent = Text == null ? "" : String(Text);
    return Element;
  }

  function AdminButton(Parent, Label, Color, OnClick, Title) {
    var Button = createElement(AdminID("AdminButton"), "div", Parent, [
      ["display", "inline-flex"],
      ["align-items", "center"],
      ["justify-content", "center"],
      ["width", "fit-content"],
      ["min-height", "34px"],
      ["padding", "0px 12px"],
      ["margin", "4px 6px 0px 0px"],
      ["background-color", Color || ContentColorLayer3],
      ["border-radius", "8px"],
      ["cursor", "pointer"],
      ["box-sizing", "border-box"],
      ["font-size", "16px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"]
    ]);
    Button.textContent = Label;
    if (Title != null) Button.title = Title;
    if (OnClick != null) Button.addEventListener("click", OnClick);
    return Button;
  }

  function AdminInput(Parent, Type, Placeholder, Value, MaxWidth) {
    var IsTextArea = Type == "textarea";
    var Input = createElement(AdminID("AdminInput"), IsTextArea ? "textarea" : "input", Parent, [
      ["box-sizing", "border-box"],
      ["width", "100%"],
      ["max-width", MaxWidth || "460px"],
      ["min-height", IsTextArea ? "90px" : "38px"],
      ["padding", "8px 10px"],
      ["margin", "4px 8px 4px 0px"],
      ["background-color", ContentColorLayer3],
      ["border-width", "0px"],
      ["border-radius", "8px"],
      ["color", FontColorA],
      ["font-size", "16px"],
      ["font-family", FontTypeA],
      ["outline", "none"],
      ["resize", "vertical"]
    ]);
    if (!IsTextArea) Input.type = Type || "text";
    if (Placeholder != null) Input.placeholder = Placeholder;
    if (Value != null) Input.value = Value;
    return Input;
  }

  function AdminSelect(Parent, Options, Selected) {
    var Select = createElement(AdminID("AdminSelect"), "select", Parent, [
      ["box-sizing", "border-box"],
      ["height", "38px"],
      ["padding", "4px 8px"],
      ["margin", "4px 8px 4px 0px"],
      ["background-color", ContentColorLayer3],
      ["border-width", "0px"],
      ["border-radius", "8px"],
      ["color", FontColorA],
      ["font-size", "16px"],
      ["font-family", FontTypeA],
      ["outline", "none"],
      ["cursor", "pointer"]
    ]);
    for (var i = 0; i < Options.length; i++) {
      var Option = document.createElement("option");
      Option.value = Options[i][0];
      Option.textContent = Options[i][1] != null ? Options[i][1] : Options[i][0];
      Select.appendChild(Option);
    }
    if (Selected != null) Select.value = Selected;
    return Select;
  }

  function AdminCheckbox(Parent, Label) {
    var Holder = createElement(AdminID("AdminCheckHolder"), "label", Parent, [
      ["display", "inline-flex"],
      ["align-items", "center"],
      ["margin", "6px 10px 0px 0px"],
      ["cursor", "pointer"],
      ["font-size", "16px"],
      ["font-family", FontTypeA],
      ["font-weight", "700"],
      ["color", FontColorA]
    ]);
    var Box = createElement(AdminID("AdminCheck"), "input", Holder, [
      ["width", "18px"],
      ["height", "18px"],
      ["margin-right", "8px"],
      ["cursor", "pointer"]
    ]);
    Box.type = "checkbox";
    AdminText(Holder, Label, [["font-size", "16px"], ["font-family", FontTypeA], ["color", FontColorA]]);
    return Box;
  }

  function AdminTime(Value) {
    if (Value == null || Value == "") return "—";
    var Time = Number(Value);
    if (!isFinite(Time) || Time <= 0) return String(Value);
    return new Date(Time).toLocaleString();
  }

  function AdminStatusColor(Status) {
    if (Status == "banned") return "#FF5C5C";
    if (Status == "disabled") return "#E0A63A";
    if (Status == "pending_delete") return "#B06BE0";
    return "#57C27A";
  }

  function AdminBadge(Parent, Text, Color) {
    var Badge = createElement(AdminID("AdminBadge"), "span", Parent, [
      ["display", "inline-block"],
      ["padding", "1px 7px"],
      ["margin-right", "6px"],
      ["background-color", Color || ContentColorLayer3],
      ["border-radius", "6px"],
      ["font-size", "13px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"],
      ["vertical-align", "middle"]
    ]);
    Badge.textContent = Text;
    return Badge;
  }

  function AdminSection(Parent, Title, Description) {
    var Section = createElement(AdminID("AdminSection"), "div", Parent, [
      ["box-sizing", "border-box"],
      ["width", "100%"],
      ["margin-bottom", "10px"],
      ["padding", "10px"],
      ["background-color", ContentColorLayer2],
      ["border-radius", "10px"]
    ]);
    if (Title != null) {
      AdminText(Section, Title, [
        ["font-size", "20px"],
        ["font-family", FontTypeA],
        ["font-weight", "900"],
        ["color", FontColorA],
        ["margin-bottom", "2px"]
      ]);
    }
    if (Description != null) {
      AdminText(Section, Description, [
        ["font-size", "13px"],
        ["font-family", FontTypeA],
        ["color", "#aaaaaa"],
        ["margin-bottom", "4px"]
      ]);
    }
    return Section;
  }

  function AdminRow(Parent, Widths) {
    var Row = createElement(AdminID("AdminRow"), "div", Parent, [
      ["display", "flex"],
      ["box-sizing", "border-box"],
      ["width", "100%"],
      ["padding", "6px 8px"],
      ["border-bottom-style", "solid"],
      ["border-bottom-width", "1px"],
      ["border-bottom-color", BorderColor],
      ["font-size", "14px"],
      ["font-family", FontTypeA],
      ["color", FontColorA],
      ["align-items", "center"]
    ]);
    Row.AdminWidths = Widths;
    return Row;
  }

  function AdminCell(Row, Index, Text, Styles, Tag) {
    var Width = Row.AdminWidths != null && Row.AdminWidths[Index] != null ? Row.AdminWidths[Index] : "auto";
    var Cell = createElement(AdminID("AdminCell"), Tag || "div", Row, [
      ["flex", Width == "auto" ? "1" : "0 0 " + Width],
      ["min-width", "0px"],
      ["padding-right", "8px"],
      ["overflow-wrap", "break-word"]
    ]);
    if (Styles != null) {
      for (var i = 0; i < Styles.length; i++) setCSS(Cell, Styles[i][0], Styles[i][1]);
    }
    Cell.textContent = Text == null ? "" : String(Text);
    return Cell;
  }

  function AdminNotice(Message, Color) {
    var Notice = createElement(AdminID("AdminNotice"), "div", "body", [
      ["position", "fixed"],
      ["z-index", "4000"],
      ["right", "16px"],
      ["bottom", "16px"],
      ["max-width", "360px"],
      ["padding", "10px 14px"],
      ["background-color", Color || "#2F9E58"],
      ["border-radius", "8px"],
      ["font-size", "16px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", "#ffffff"],
      ["box-shadow", "0 6px 20px 0 rgba(0, 0, 0, 0.35)"]
    ]);
    Notice.textContent = Message;
    setTimeout(function () {
      if (Notice.parentNode != null) Notice.parentNode.removeChild(Notice);
    }, 3200);
  }

  function AdminRequest(Task, Body, Callback) {
    SendRequest(Task, Body, function (Metadata, Data) {
      if (Data == null) return;
      if (Data.Code != 200) {
        AdminNotice(Data.Message || ("Admin request failed (" + Data.Code + ")."), "#C0392B");
        if (Callback != null) Callback(Data, false);
        return;
      }
      if (Callback != null) Callback(Data, true);
    });
  }

  // A small modal with configurable fields so actions do not need global
  // callback names (ShowPopUp only invokes named window functions).
  function AdminModal(Title, Description, Fields, SubmitLabel, SubmitColor, OnSubmit) {
    var Overlay = createElement("AdminModalBlur", "div", "body", [
      ["position", "fixed"],
      ["left", "0px"],
      ["top", "0px"],
      ["z-index", "3000"],
      ["width", "100%"],
      ["height", "100%"],
      ["background-color", "rgba(0, 0, 0, 0.55)"]
    ]);

    var Frame = createElement("AdminModalFrame", "div", Overlay, [
      ["position", "absolute"],
      ["box-sizing", "border-box"],
      ["width", "100%"],
      ["max-width", "440px"],
      ["max-height", "calc(100% - 40px)"],
      ["padding", "14px"],
      ["left", "50%"],
      ["top", "50%"],
      ["transform", "translate(-50%, -50%)"],
      ["background-color", LeftSidebarColor],
      ["border-style", "solid"],
      ["border-width", "4px"],
      ["border-color", BorderColor],
      ["border-radius", "12px"],
      ["overflow-y", "auto"]
    ]);
    Frame.className = "StandardScroll";

    AdminText(Frame, Title, [
      ["font-size", "24px"],
      ["font-family", FontTypeA],
      ["font-weight", "900"],
      ["color", FontColorA]
    ]);
    if (Description != null) {
      AdminText(Frame, Description, [
        ["font-size", "15px"],
        ["font-family", FontTypeA],
        ["color", "#bbbbbb"],
        ["margin-top", "4px"],
        ["margin-bottom", "6px"]
      ]);
    }

    var Controls = {};
    for (var i = 0; i < Fields.length; i++) {
      var Field = Fields[i];
      if (Field.Type != "checkbox") {
        AdminText(Frame, Field.Label, [
          ["font-size", "14px"],
          ["font-family", FontTypeA],
          ["font-weight", "900"],
          ["color", FontColorA],
          ["margin-top", "8px"]
        ]);
      }
      if (Field.Type == "select") {
        Controls[Field.Key] = AdminSelect(Frame, Field.Options, Field.Value);
      } else if (Field.Type == "checkbox") {
        Controls[Field.Key] = AdminCheckbox(Frame, Field.Label == null ? "" : Field.Label);
      } else {
        Controls[Field.Key] = AdminInput(Frame, Field.Type || "text", Field.Placeholder, Field.Value, "100%");
      }
    }

    var ButtonHolder = createElement("AdminModalButtons", "div", Frame, [
      ["display", "flex"],
      ["justify-content", "flex-end"],
      ["margin-top", "12px"]
    ]);
    AdminButton(ButtonHolder, "Cancel", "#4A4D55", function () {
      Overlay.remove();
    });
    AdminButton(ButtonHolder, SubmitLabel || "Submit", SubmitColor || ThemeColor, function () {
      var Values = {};
      for (var Key in Controls) {
        Values[Key] = Controls[Key].type == "checkbox" ? Controls[Key].checked : Controls[Key].value;
      }
      Overlay.remove();
      OnSubmit(Values);
    });

    return Overlay;
  }

  function AdminConfirm(Title, Description, SubmitLabel, OnSubmit, Color) {
    return AdminModal(Title, Description, [], SubmitLabel, Color || "#FF5C5C", OnSubmit);
  }

  // Panel shell -------------------------------------------------------------

  var AdminBackBlur = createElement("AdminBackBlur", "div", "body", [
    ["position", "fixed"],
    ["left", "0px"],
    ["top", "0px"],
    ["z-index", "2000"],
    ["width", "100%"],
    ["height", "100%"],
    ["background-color", "rgba(0, 0, 0, 0.55)"],
    ["backdrop-filter", "blur(2px)"],
    ["-webkit-backdrop-filter", "blur(2px)"]
  ]);

  var AdminFrame = createElement("AdminFrame", "div", AdminBackBlur, [
    ["position", "absolute"],
    ["box-sizing", "border-box"],
    ["width", "96%"],
    ["max-width", "1180px"],
    ["height", "92%"],
    ["left", "50%"],
    ["top", "50%"],
    ["transform", "translate(-50%, -50%)"],
    ["background-color", LeftSidebarColor],
    ["border-style", "solid"],
    ["border-width", "4px"],
    ["border-color", BorderColor],
    ["border-radius", "12px"],
    ["overflow", "hidden"]
  ]);

  var AdminHeader = createElement("AdminHeader", "div", AdminFrame, [
    ["position", "relative"],
    ["box-sizing", "border-box"],
    ["display", "flex"],
    ["align-items", "center"],
    ["justify-content", "space-between"],
    ["width", "100%"],
    ["height", "62px"],
    ["padding", "0px 14px"],
    ["background-color", ContentColorLayer2],
    ["border-bottom-style", "solid"],
    ["border-bottom-width", "2px"],
    ["border-bottom-color", BorderColor]
  ]);

  var AdminTitleHolder = createElement("AdminTitleHolder", "div", AdminHeader, [
    ["display", "flex"],
    ["flex-direction", "column"],
    ["justify-content", "center"]
  ]);
  AdminText(AdminTitleHolder, "Admin Panel", [
    ["font-size", "26px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", FontColorA]
  ]);
  AdminText(AdminTitleHolder, "Signed in as " + (Username || "Unknown") + " · " + String(LoginUserRole || "User"), [
    ["font-size", "13px"],
    ["font-family", FontTypeA],
    ["color", "#aaaaaa"]
  ]);

  var AdminCloseButton = createElement("AdminCloseButton", "div", AdminHeader, [
    ["display", "flex"],
    ["align-items", "center"],
    ["justify-content", "center"],
    ["width", "44px"],
    ["height", "44px"],
    ["background-color", "rgba(0, 0, 0, 0.35)"],
    ["border-radius", "10px"],
    ["cursor", "pointer"],
    ["font-size", "34px"],
    ["font-family", FontTypeA],
    ["font-weight", "900"],
    ["color", "#ffffff"]
  ]);
  AdminCloseButton.innerHTML = "&times;";
  AdminCloseButton.title = "Close Admin Panel";
  AdminCloseButton.addEventListener("click", function () {
    AdminBackBlur.remove();
    removeScript("./Admin.js");
    RevertTitle();
  });

  var AdminBodyHolder = createElement("AdminBodyHolder", "div", AdminFrame, [
    ["display", "flex"],
    ["box-sizing", "border-box"],
    ["width", "100%"],
    ["height", "calc(100% - 62px)"]
  ]);

  var AdminNav = createElement("AdminNav", "div", AdminBodyHolder, [
    ["box-sizing", "border-box"],
    ["width", "190px"],
    ["flex", "0 0 190px"],
    ["height", "100%"],
    ["padding", "8px"],
    ["background-color", LeftSidebarColor],
    ["border-right-style", "solid"],
    ["border-right-width", "2px"],
    ["border-right-color", BorderColor],
    ["overflow-y", "auto"]
  ]);
  AdminNav.className = "StandardScroll";

  var AdminContentPane = createElement("AdminContentPane", "div", AdminBodyHolder, [
    ["box-sizing", "border-box"],
    ["flex", "1"],
    ["height", "100%"],
    ["padding", "12px"],
    ["overflow-y", "auto"]
  ]);
  AdminContentPane.className = "StandardScroll";

  for (var AdminTabIndex = 0; AdminTabIndex < AdminTabNames.length; AdminTabIndex++) {
    (function (TabName) {
      var TabButton = createElement(AdminID("AdminTabButton"), "div", AdminNav, [
        ["box-sizing", "border-box"],
        ["width", "100%"],
        ["padding", "9px 10px"],
        ["margin-bottom", "4px"],
        ["background-color", ContentColorLayer3],
        ["border-radius", "8px"],
        ["cursor", "pointer"],
        ["font-size", "17px"],
        ["font-family", FontTypeA],
        ["font-weight", "900"],
        ["color", FontColorA]
      ]);
      TabButton.textContent = TabName;
      TabButton.addEventListener("click", function () {
        AdminState.UserID = null;
        AdminShowTab(TabName);
      });
      AdminTabButtons[TabName] = TabButton;
    })(AdminTabNames[AdminTabIndex]);
  }

  function AdminHighlightTab(TabName) {
    for (var Name in AdminTabButtons) {
      if (Name == TabName) {
        setCSS(AdminTabButtons[Name], "background-color", ThemeColor);
      } else {
        setCSS(AdminTabButtons[Name], "background-color", ContentColorLayer3);
      }
    }
  }

  function AdminShowTab(TabName) {
    AdminState.Tab = TabName;
    AdminHighlightTab(TabName);
    AdminClear(AdminContentPane);
    if (TabName == "Overview") AdminLoadOverview();
    else if (TabName == "Users") AdminLoadUsers();
    else if (TabName == "Content") AdminLoadContent();
    else if (TabName == "Reports") AdminLoadReports();
    else if (TabName == "Appeals") AdminLoadAppeals();
    else if (TabName == "Sessions") AdminLoadSessions();
    else if (TabName == "Audit Log") AdminLoadLog();
    else if (TabName == "Broadcast") AdminLoadBroadcast();
  }

  function AdminPagination(Parent, Data, OnPage) {
    var Holder = createElement(AdminID("AdminPagination"), "div", Parent, [
      ["display", "flex"],
      ["align-items", "center"],
      ["flex-wrap", "wrap"],
      ["margin-top", "8px"]
    ]);
    var Page = Number(Data.Page || 1);
    var Pages = Number(Data.Pages || 1);
    AdminButton(Holder, "Previous", ContentColorLayer3, function () {
      if (Page > 1) OnPage(Page - 1);
    });
    AdminText(Holder, "Page " + Page + " of " + Pages + " · " + Number(Data.Total || 0) + " total", [
      ["font-size", "14px"],
      ["font-family", FontTypeA],
      ["color", "#bbbbbb"],
      ["margin", "0px 8px"]
    ], "span");
    AdminButton(Holder, "Next", ContentColorLayer3, function () {
      if (Page < Pages) OnPage(Page + 1);
    });
  }

  // Overview ----------------------------------------------------------------

  function AdminLoadOverview() {
    AdminText(AdminContentPane, "Loading overview…", [
      ["font-size", "16px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]
    ]);
    AdminRequest("AdminOverview", {}, function (Data) {
      if (AdminState.Tab != "Overview") return;
      AdminClear(AdminContentPane);

      var Header = AdminSection(AdminContentPane, "Overview", "Live server and community statistics.");
      var HeaderButtons = createElement(AdminID("AdminOverviewButtons"), "div", Header, [["margin-bottom", "4px"]]);
      AdminButton(HeaderButtons, "Refresh", ThemeColor, function () {
        AdminShowTab("Overview");
      });

      var Cards = createElement(AdminID("AdminStatCards"), "div", Header, [
        ["display", "flex"], ["flex-wrap", "wrap"]
      ]);
      var Stats = Data.Stats || {};
      var StatCards = [
        ["Users", Stats.Users, "#5AB7FA"],
        ["Active Users", Stats.ActiveUsers, "#57C27A"],
        ["Banned", Stats.BannedUsers, "#FF5C5C"],
        ["Disabled", Stats.DisabledUsers, "#E0A63A"],
        ["Posts", Stats.Posts, "#5AB7FA"],
        ["Chats", Stats.Chats, "#57C27A"],
        ["Open Reports", Stats.OpenReports, Stats.OpenReports > 0 ? "#FF5C5C" : "#57C27A"],
        ["Pending Appeals", Stats.PendingAppeals, Stats.PendingAppeals > 0 ? "#E0A63A" : "#57C27A"],
        ["New Users Today", Stats.NewUsersToday, "#B06BE0"],
        ["Posts Today", Stats.PostsToday, "#5AB7FA"],
        ["Chats Today", Stats.ChatsToday, "#57C27A"],
        ["Deleted Posts", Stats.DeletedPosts, "#888888"]
      ];
      for (var i = 0; i < StatCards.length; i++) {
        var Card = createElement(AdminID("AdminStatCard"), "div", Cards, [
          ["box-sizing", "border-box"],
          ["width", "calc(25% - 8px)"],
          ["min-width", "120px"],
          ["margin", "4px"],
          ["padding", "8px 10px"],
          ["background-color", ContentColorLayer3],
          ["border-radius", "10px"]
        ]);
        AdminText(Card, StatCards[i][1] == null ? 0 : StatCards[i][1], [
          ["font-size", "26px"], ["font-family", FontTypeA], ["font-weight", "900"], ["color", StatCards[i][2]]
        ]);
        AdminText(Card, StatCards[i][0], [
          ["font-size", "13px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]
        ]);
      }

      var ActivitySection = AdminSection(AdminContentPane, "Last 7 Days", "New users, posts and chats per day.");
      var ActivityRows = Data.Activity || [];
      var ActivityHeader = AdminRow(ActivitySection, ["16%", "28%", "28%", "28%"]);
      AdminCell(ActivityHeader, 0, "Date", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(ActivityHeader, 1, "Users", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(ActivityHeader, 2, "Posts", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(ActivityHeader, 3, "Chats", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      for (var a = 0; a < ActivityRows.length; a++) {
        var ActivityRow = AdminRow(ActivitySection, ["16%", "28%", "28%", "28%"]);
        AdminCell(ActivityRow, 0, ActivityRows[a].Date);
        AdminCell(ActivityRow, 1, ActivityRows[a].Users);
        AdminCell(ActivityRow, 2, ActivityRows[a].Posts);
        AdminCell(ActivityRow, 3, ActivityRows[a].Chats);
      }

      var TopSection = AdminSection(AdminContentPane, "Top Posters This Week");
      if ((Data.TopPosters || []).length == 0) {
        AdminText(TopSection, "No posts this week.", [["font-size", "14px"], ["color", "#aaaaaa"], ["font-family", FontTypeA]]);
      } else {
        for (var t = 0; t < Data.TopPosters.length; t++) {
          var PosterRow = AdminRow(TopSection, ["50%", "25%", "25%"]);
          AdminCell(PosterRow, 0, Data.TopPosters[t].User);
          AdminCell(PosterRow, 1, Data.TopPosters[t].Role || "User");
          AdminCell(PosterRow, 2, String(Data.TopPosters[t].Count) + " posts");
        }
      }

      var ActionsSection = AdminSection(AdminContentPane, "Recent Staff Actions");
      if ((Data.RecentActions || []).length == 0) {
        AdminText(ActionsSection, "No staff actions recorded yet.", [["font-size", "14px"], ["color", "#aaaaaa"], ["font-family", FontTypeA]]);
      } else {
        for (var r = 0; r < Data.RecentActions.length; r++) {
          var ActionRow = AdminRow(ActionsSection, ["22%", "26%", "30%", "22%"]);
          AdminCell(ActionRow, 0, Data.RecentActions[r].Actor);
          AdminCell(ActionRow, 1, Data.RecentActions[r].Action);
          AdminCell(ActionRow, 2, Data.RecentActions[r].Target || "—");
          AdminCell(ActionRow, 3, AdminTime(Data.RecentActions[r].Timestamp));
        }
      }

      var SystemSection = AdminSection(AdminContentPane, "System");
      var SystemData = Data.System || {};
      AdminText(SystemSection, "Node " + (SystemData.Node || "?") + " · Uptime " + Math.floor(Number(SystemData.Uptime || 0) / 60) + " min · " + (SystemData.MemoryMB || 0) + " MB RSS", [
        ["font-size", "14px"], ["font-family", FontTypeA], ["color", "#bbbbbb"]
      ]);
      AdminText(SystemSection, "Connected clients: " + (Data.ConnectedClients == null ? "?" : Data.ConnectedClients), [
        ["font-size", "14px"], ["font-family", FontTypeA], ["color", "#bbbbbb"]
      ]);
    });
  }

  // Users -------------------------------------------------------------------

  function AdminRoleOptions() {
    return [
      ["User", "User"], ["Tester", "Tester"], ["Verified", "Verified"],
      ["Partner", "Partner"], ["Contributor", "Contributor"],
      ["Developer", "Developer"], ["Moderator", "Moderator"], ["Owner", "Owner"]
    ];
  }

  function AdminLoadUsers() {
    var State = AdminState.Users;
    var Toolbar = AdminSection(AdminContentPane, "Users", "Search, filter and moderate accounts.");
    var RowHolder = createElement(AdminID("AdminToolbar"), "div", Toolbar, [
      ["display", "flex"], ["flex-wrap", "wrap"], ["align-items", "center"]
    ]);

    var SearchInput = AdminInput(RowHolder, "search", "Search username, email or ID", State.Search, "260px");
    var FilterSelect = AdminSelect(RowHolder, [
      ["All", "All Users"], ["Active", "Active"], ["Staff", "Staff"],
      ["Banned", "Banned"], ["Disabled", "Disabled"], ["PendingDelete", "Pending Delete"], ["Reported", "Reported"]
    ], State.Filter);
    var SortSelect = AdminSelect(RowHolder, [
      ["Newest", "Newest"], ["Oldest", "Oldest"], ["Name", "Name"],
      ["Posts", "Most Posts"], ["Chats", "Most Chats"], ["LastSeen", "Last Seen"], ["Reports", "Most Reports"]
    ], State.Sort);

    function ApplyFilters() {
      State.Search = SearchInput.value.trim();
      State.Filter = FilterSelect.value;
      State.Sort = SortSelect.value;
      State.Page = 1;
      AdminShowTab("Users");
    }

    SearchInput.addEventListener("keydown", function (Event) {
      if (Event.key == "Enter") ApplyFilters();
    });
    FilterSelect.addEventListener("change", ApplyFilters);
    SortSelect.addEventListener("change", ApplyFilters);
    AdminButton(RowHolder, "Search", ThemeColor, ApplyFilters);

    var ListSection = AdminSection(AdminContentPane, null);
    AdminText(ListSection, "Loading users…", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);

    AdminRequest("AdminUsers", {
      Page: State.Page, Limit: 25, Search: State.Search, Filter: State.Filter, Sort: State.Sort
    }, function (Data) {
      if (AdminState.Tab != "Users" || AdminState.UserID != null) return;
      AdminClear(ListSection);
      var HeaderRow = AdminRow(ListSection, ["26%", "20%", "12%", "10%", "10%", "22%"]);
      AdminCell(HeaderRow, 0, "User", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 1, "Email", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 2, "Role", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 3, "Posts", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 4, "Chats", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 5, "Last Seen", [["color", "#aaaaaa"], ["font-weight", "900"]]);

      if ((Data.Users || []).length == 0) {
        AdminText(ListSection, "No users matched those filters.", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "6px"]]);
      }

      for (var u = 0; u < Data.Users.length; u++) {
        (function (User) {
          var UserRow = AdminRow(ListSection, ["26%", "20%", "12%", "10%", "10%", "22%"]);
          UserRow.style.cursor = "pointer";
          UserRow.addEventListener("click", function () {
            AdminOpenUser(User._id);
          });

          var UserCell = AdminCell(UserRow, 0, "");
          AdminText(UserCell, User.User + (User.OpenReports > 0 ? "  ⚠ " + User.OpenReports : ""), [
            ["font-size", "15px"], ["font-family", FontTypeA], ["font-weight", "900"], ["color", FontColorA]
          ]);
          AdminBadge(UserCell, User.Status, AdminStatusColor(User.Status));
          AdminCell(UserRow, 1, User.Email);
          AdminCell(UserRow, 2, User.Role);
          AdminCell(UserRow, 3, User.PostCount);
          AdminCell(UserRow, 4, User.ChatCount);
          AdminCell(UserRow, 5, AdminTime(User.LastSeen));
        })(Data.Users[u]);
      }

      AdminPagination(ListSection, Data, function (Page) {
        State.Page = Page;
        AdminShowTab("Users");
      });
    });
  }

  function AdminOpenUser(UserID) {
    AdminState.UserID = UserID;
    AdminClear(AdminContentPane);
    AdminText(AdminContentPane, "Loading user…", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);
    AdminRequest("AdminUserDetail", { UserID: UserID }, function (Data) {
      if (AdminState.Tab != "Users" || AdminState.UserID != UserID) return;
      AdminClear(AdminContentPane);
      AdminRenderUserDetail(Data);
    });
  }

  function AdminRenderUserDetail(Data) {
    var User = Data.User || {};
    var Stats = Data.Stats || {};

    var Top = AdminSection(AdminContentPane, null);
    AdminButton(Top, "← Back to Users", ContentColorLayer3, function () {
      AdminState.UserID = null;
      AdminShowTab("Users");
    });

    var TitleHolder = createElement(AdminID("AdminUserTitle"), "div", Top, [
      ["display", "flex"], ["flex-wrap", "wrap"], ["align-items", "center"], ["margin-top", "4px"]
    ]);
    AdminText(TitleHolder, User.User || "Unknown", [
      ["font-size", "26px"], ["font-family", FontTypeA], ["font-weight", "900"], ["color", FontColorA], ["margin-right", "8px"]
    ], "span");
    AdminBadge(TitleHolder, User.Role || "User", ThemeColor);
    AdminBadge(TitleHolder, User.Status || "active", AdminStatusColor(User.Status));
    AdminText(Top, (User.Email || "—") + " · ID " + (User._id || "—") + " · Joined " + AdminTime(User.CreationTime), [
      ["font-size", "13px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "2px"]
    ]);
    if (User.BanData != null) {
      AdminText(Top, "Ban reason: " + (User.BanData.BanReason || "—") + " · Expires: " + (User.BanData.BanExpires == "Permanent" ? "Permanent" : AdminTime(User.BanData.BanExpires)), [
        ["font-size", "13px"], ["font-family", FontTypeA], ["color", "#FF8A8A"], ["margin-top", "2px"]
      ]);
    }

    var Actions = createElement(AdminID("AdminUserActions"), "div", Top, [
      ["display", "flex"], ["flex-wrap", "wrap"], ["margin-top", "6px"]
    ]);
    var IsOwner = AdminUserIsOwner();

    if (IsOwner) {
      var RoleSelect = AdminSelect(Actions, AdminRoleOptions(), User.Role);
      AdminButton(Actions, "Apply Role", ThemeColor, function () {
        AdminRequest("AdminUpdateUser", {
          Task: "Role", UserID: User._id, Role: RoleSelect.value
        }, function () {
          AdminNotice("Role updated.");
          AdminOpenUser(User._id);
        });
      }, "Owner only");
    }

    if (User.Status == "banned") {
      if (IsOwner) {
        AdminButton(Actions, "Unban", "#57C27A", function () {
          AdminConfirm("Unban " + User.User + "?", "This restores the account to active.", "Unban", function () {
            AdminRequest("AdminUpdateUser", { Task: "Unban", UserID: User._id }, function () {
              AdminNotice("User unbanned.");
              AdminOpenUser(User._id);
            });
          }, "#57C27A");
        });
      }
    } else {
      AdminButton(Actions, "Ban", "#FF5C5C", function () {
        AdminModal("Ban " + User.User, "The reason is shown to the user.", [
          { Key: "Reason", Label: "Ban reason", Type: "textarea", Placeholder: "Violating community guidelines." },
          {
            Key: "BanLength", Label: "Ban length", Type: "select", Value: "Permanent", Options: [
              ["1800", "30 Minutes"], ["3600", "1 Hour"], ["21600", "6 Hours"],
              ["86400", "1 Day"], ["259200", "3 Days"], ["604800", "1 Week"],
              ["2678400", "1 Month"], ["7890000", "3 Months"], ["15780000", "6 Months"],
              ["31536000", "1 Year"], ["Permanent", "Permanent"]
            ]
          },
          { Key: "TerminateAccount", Label: "Terminate account and hide all content", Type: "checkbox" }
        ], "Ban User", "#FF5C5C", function (Values) {
          var Length = Values.BanLength == "Permanent" ? "Permanent" : Number(Values.BanLength);
          AdminRequest("AdminUpdateUser", {
            Task: "Ban", UserID: User._id, Reason: Values.Reason, BanLength: Length,
            TerminateAccount: Values.TerminateAccount
          }, function () {
            AdminNotice("User banned.");
            AdminOpenUser(User._id);
          });
        });
      });
    }

    if (User.Status == "disabled") {
      if (IsOwner) {
        AdminButton(Actions, "Enable", "#57C27A", function () {
          AdminRequest("AdminUpdateUser", { Task: "Enable", UserID: User._id }, function () {
            AdminNotice("User enabled.");
            AdminOpenUser(User._id);
          });
        });
      }
    } else if (IsOwner) {
      AdminButton(Actions, "Disable", "#E0A63A", function () {
        AdminConfirm("Disable " + User.User + "?", "The account will be signed out and blocked from signing in.", "Disable", function () {
          AdminRequest("AdminUpdateUser", { Task: "Disable", UserID: User._id }, function () {
            AdminNotice("User disabled.");
            AdminOpenUser(User._id);
          });
        }, "#E0A63A");
      });
    }

    AdminButton(Actions, "Sign Out", ContentColorLayer3, function () {
      AdminConfirm("Sign out " + User.User + "?", "All of this user's sessions will be revoked.", "Sign Out", function () {
        AdminRequest("AdminUpdateUser", { Task: "SignOut", UserID: User._id }, function () {
          AdminNotice("Sessions revoked.");
          AdminOpenUser(User._id);
        });
      }, "#4A4D55");
    });

    AdminButton(Actions, "Purge Content", "#B06BE0", function () {
      AdminConfirm("Purge all content?", "Every post and chat by " + User.User + " will be hidden.", "Purge", function () {
        AdminRequest("AdminUpdateUser", { Task: "PurgeContent", UserID: User._id }, function (Result) {
          AdminNotice("Purged " + (Result.DeletedPostIDs || []).length + " posts and " + (Result.DeletedChatIDs || []).length + " chats.");
          AdminOpenUser(User._id);
        });
      }, "#B06BE0");
    });

    var StatsSection = AdminSection(AdminContentPane, "Statistics");
    var StatsHolder = createElement(AdminID("AdminUserStats"), "div", StatsSection, [["display", "flex"], ["flex-wrap", "wrap"]]);
    var StatPairs = [
      ["Posts", Stats.Posts], ["Deleted Posts", Stats.DeletedPosts],
      ["Chats", Stats.Chats], ["Hidden Chats", Stats.HiddenChats],
      ["Likes Given", Stats.LikesGiven], ["Followers", Stats.Followers],
      ["Following", Stats.Following], ["Sessions", Stats.Sessions],
      ["Open Reports", Stats.OpenReports]
    ];
    for (var s = 0; s < StatPairs.length; s++) {
      var StatBox = createElement(AdminID("AdminUserStat"), "div", StatsHolder, [
        ["box-sizing", "border-box"], ["width", "calc(33% - 8px)"], ["min-width", "110px"],
        ["margin", "4px"], ["padding", "6px 8px"], ["background-color", ContentColorLayer3], ["border-radius", "8px"]
      ]);
      AdminText(StatBox, StatPairs[s][1] == null ? 0 : StatPairs[s][1], [
        ["font-size", "22px"], ["font-family", FontTypeA], ["font-weight", "900"], ["color", FontColorA]
      ]);
      AdminText(StatBox, StatPairs[s][0], [
        ["font-size", "12px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]
      ]);
    }

    var PostsSection = AdminSection(AdminContentPane, "Recent Posts");
    if ((Data.Posts || []).length == 0) {
      AdminText(PostsSection, "No posts.", [["font-size", "14px"], ["color", "#aaaaaa"], ["font-family", FontTypeA]]);
    }
    for (var p = 0; p < (Data.Posts || []).length; p++) {
      var Post = Data.Posts[p];
      var PostRow = AdminRow(PostsSection, ["55%", "15%", "15%", "15%"]);
      AdminCell(PostRow, 0, Post.Text);
      AdminCell(PostRow, 1, String(Post.Likes) + " likes");
      AdminCell(PostRow, 2, String(Post.Chats) + " chats");
      AdminCell(PostRow, 3, Post.Removed == true ? "Removed" : AdminTime(Post.Timestamp));
    }

    var ChatsSection = AdminSection(AdminContentPane, "Recent Chats");
    if ((Data.Chats || []).length == 0) {
      AdminText(ChatsSection, "No chats.", [["font-size", "14px"], ["color", "#aaaaaa"], ["font-family", FontTypeA]]);
    }
    for (var c = 0; c < (Data.Chats || []).length; c++) {
      var Chat = Data.Chats[c];
      var ChatRow = AdminRow(ChatsSection, ["55%", "15%", "15%", "15%"]);
      AdminCell(ChatRow, 0, Chat.Text);
      AdminCell(ChatRow, 1, String(Chat.Likes) + " likes");
      AdminCell(ChatRow, 2, Chat.Removed == true ? "Hidden" : "Visible");
      AdminCell(ChatRow, 3, AdminTime(Chat.Timestamp));
    }

    var SessionsSection = AdminSection(AdminContentPane, "Recent Sessions");
    if ((Data.Sessions || []).length == 0) {
      AdminText(SessionsSection, "No sessions.", [["font-size", "14px"], ["color", "#aaaaaa"], ["font-family", FontTypeA]]);
    }
    for (var se = 0; se < (Data.Sessions || []).length; se++) {
      var SessionRow = AdminRow(SessionsSection, ["38%", "22%", "22%", "18%"]);
      AdminCell(SessionRow, 0, Data.Sessions[se].IP);
      AdminCell(SessionRow, 1, String(Data.Sessions[se].Count) + " sessions");
      AdminCell(SessionRow, 2, "Last: " + AdminTime(Data.Sessions[se].LastSeen));
      AdminButton(SessionRow, "Revoke", "#FF5C5C", function (IP) {
        return function () {
          AdminConfirm("Revoke this session?", "The device will be signed out.", "Revoke", function () {
            AdminRequest("AdminSessions", { Task: "Revoke", UserID: User._id, IP: IP }, function () {
              AdminNotice("Session revoked.");
              AdminOpenUser(User._id);
            });
          });
        };
      }(Data.Sessions[se].IP));
    }
  }

  function AdminUserIsOwner() {
    var Roles = ParseRoleList(LoginUserRole);
    return Roles.indexOf("Owner") >= 0;
  }

  // Content -----------------------------------------------------------------

  function AdminLoadContent() {
    var State = AdminState.Content;
    var Toolbar = AdminSection(AdminContentPane, "Content", "Review and moderate posts and live chats.");
    var RowHolder = createElement(AdminID("AdminContentToolbar"), "div", Toolbar, [
      ["display", "flex"], ["flex-wrap", "wrap"], ["align-items", "center"]
    ]);

    var TypeSelect = AdminSelect(RowHolder, [["Posts", "Posts"], ["Chats", "Chats"]], State.Type);
    var SearchInput = AdminInput(RowHolder, "search", "Search text, author or ID", State.Search, "240px");
    var FilterSelect = AdminSelect(RowHolder, [["All", "All"], ["Active", "Visible"], ["Deleted", "Removed"]], State.Filter);

    function ApplyFilters() {
      State.Type = TypeSelect.value;
      State.Search = SearchInput.value.trim();
      State.Filter = FilterSelect.value;
      State.Page = 1;
      AdminShowTab("Content");
    }

    SearchInput.addEventListener("keydown", function (Event) {
      if (Event.key == "Enter") ApplyFilters();
    });
    TypeSelect.addEventListener("change", ApplyFilters);
    FilterSelect.addEventListener("change", ApplyFilters);
    AdminButton(RowHolder, "Search", ThemeColor, ApplyFilters);

    var ListSection = AdminSection(AdminContentPane, null);
    AdminText(ListSection, "Loading content…", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);

    AdminRequest("AdminContent", {
      Type: State.Type, Page: State.Page, Limit: 25, Search: State.Search, Filter: State.Filter, Sort: "Newest"
    }, function (Data) {
      if (AdminState.Tab != "Content") return;
      AdminClear(ListSection);
      var HeaderRow = AdminRow(ListSection, ["44%", "16%", "12%", "14%", "14%"]);
      AdminCell(HeaderRow, 0, "Text", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 1, "Author", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 2, "Likes", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 3, "Created", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 4, "Actions", [["color", "#aaaaaa"], ["font-weight", "900"]]);

      if ((Data.Items || []).length == 0) {
        AdminText(ListSection, "No content matched those filters.", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "6px"]]);
      }

      for (var i = 0; i < (Data.Items || []).length; i++) {
        (function (Item) {
          var ContentRow = AdminRow(ListSection, ["44%", "16%", "12%", "14%", "14%"]);
          var TextCell = AdminCell(ContentRow, 0, Item.Text);
          if (Item.Removed == true) AdminBadge(TextCell, "Removed", "#FF5C5C");
          AdminCell(ContentRow, 1, Item.Author);
          AdminCell(ContentRow, 2, Item.Likes);
          AdminCell(ContentRow, 3, AdminTime(Item.Timestamp));
          var ActionsCell = AdminCell(ContentRow, 4, "");
          if (Item.Removed == true) {
            AdminButton(ActionsCell, "Restore", "#57C27A", function () {
              AdminRequest("AdminContentAction", {
                Task: "Restore", Type: Item.Type, ID: Item._id
              }, function () {
                AdminNotice("Content restored.");
                AdminShowTab("Content");
              });
            });
          } else {
            AdminButton(ActionsCell, "Delete", "#FF5C5C", function () {
              AdminConfirm("Remove this " + Item.Type.toLowerCase() + "?", "The content will be hidden for everyone.", "Remove", function () {
                AdminRequest("AdminContentAction", {
                  Task: "Delete", Type: Item.Type, ID: Item._id
                }, function () {
                  AdminNotice("Content removed.");
                  AdminShowTab("Content");
                });
              });
            });
          }
        })(Data.Items[i]);
      }

      AdminPagination(ListSection, Data, function (Page) {
        State.Page = Page;
        AdminShowTab("Content");
      });
    });
  }

  // Reports -----------------------------------------------------------------

  function AdminLoadReports() {
    var State = AdminState.Reports;
    var Toolbar = AdminSection(AdminContentPane, "Reports", "User-submitted reports waiting for review.");
    var RowHolder = createElement(AdminID("AdminReportToolbar"), "div", Toolbar, [
      ["display", "flex"], ["flex-wrap", "wrap"], ["align-items", "center"]
    ]);

    var StatusSelect = AdminSelect(RowHolder, [["open", "Open"], ["resolved", "Resolved"], ["dismissed", "Dismissed"]], State.Status);
    var TypeSelect = AdminSelect(RowHolder, [["All", "All Types"], ["User", "Users"], ["Post", "Posts"], ["Chat", "Chats"]], State.Type);
    var SearchInput = AdminInput(RowHolder, "search", "Search reason, content or reporter", State.Search, "240px");

    function ApplyFilters() {
      State.Status = StatusSelect.value;
      State.Type = TypeSelect.value;
      State.Search = SearchInput.value.trim();
      State.Page = 1;
      AdminShowTab("Reports");
    }

    SearchInput.addEventListener("keydown", function (Event) {
      if (Event.key == "Enter") ApplyFilters();
    });
    StatusSelect.addEventListener("change", ApplyFilters);
    TypeSelect.addEventListener("change", ApplyFilters);
    AdminButton(RowHolder, "Search", ThemeColor, ApplyFilters);

    var ListSection = AdminSection(AdminContentPane, null);
    AdminText(ListSection, "Loading reports…", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);

    AdminRequest("AdminReports", {
      Task: "List", Status: State.Status, Type: State.Type, Search: State.Search, Page: State.Page, Limit: 25
    }, function (Data) {
      if (AdminState.Tab != "Reports") return;
      AdminClear(ListSection);

      if ((Data.Reports || []).length == 0) {
        AdminText(ListSection, "No reports in this queue.", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);
      }

      for (var i = 0; i < (Data.Reports || []).length; i++) {
        (function (Report) {
          var ReportCard = createElement(AdminID("AdminReportCard"), "div", ListSection, [
            ["box-sizing", "border-box"],
            ["width", "100%"],
            ["margin-bottom", "6px"],
            ["padding", "8px"],
            ["background-color", ContentColorLayer3],
            ["border-radius", "8px"]
          ]);

          var TitleRow = createElement(AdminID("AdminReportTitle"), "div", ReportCard, [
            ["display", "flex"], ["flex-wrap", "wrap"], ["align-items", "center"]
          ]);
          AdminBadge(TitleRow, Report.Type, ThemeColor);
          AdminBadge(TitleRow, Report.Status, Report.Status == "open" ? "#E0A63A" : "#57C27A");
          AdminText(TitleRow, "Reason: " + Report.Reason, [
            ["font-size", "16px"], ["font-family", FontTypeA], ["font-weight", "900"], ["color", FontColorA]
          ], "span");

          var Snapshot = Report.Snapshot || {};
          var ContentText = Snapshot.Text || Snapshot.TargetUser || "";
          if (ContentText != "") {
            AdminText(ReportCard, "Content: " + ContentText, [
              ["font-size", "14px"], ["font-family", FontTypeA], ["color", "#dddddd"], ["margin-top", "3px"]
            ]);
          }
          AdminText(ReportCard, "Reported by " + (Report.Reporter || "Unknown") + " · " + AdminTime(Report.Timestamp) + " · Content ID " + Report.ContentID, [
            ["font-size", "12px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "2px"]
          ]);
          if (Report.ResolutionNote != null) {
            AdminText(ReportCard, "Note: " + Report.ResolutionNote, [
              ["font-size", "12px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "2px"]
            ]);
          }

          var Actions = createElement(AdminID("AdminReportActions"), "div", ReportCard, [
            ["display", "flex"], ["flex-wrap", "wrap"], ["margin-top", "4px"]
          ]);

          if (Report.Status == "open") {
            AdminButton(Actions, "Dismiss", "#4A4D55", function () {
              AdminModal("Dismiss Report", "Optional note for the audit log.", [
                { Key: "Note", Label: "Resolution note", Type: "textarea" }
              ], "Dismiss", "#4A4D55", function (Values) {
                AdminRequest("AdminReports", {
                  Task: "Update", ReportID: Report._id, Status: "dismissed", Note: Values.Note
                }, function () {
                  AdminNotice("Report dismissed.");
                  AdminShowTab("Reports");
                });
              });
            });
            AdminButton(Actions, "Resolve", "#57C27A", function () {
              AdminModal("Resolve Report", "Optional note for the audit log.", [
                { Key: "Note", Label: "Resolution note", Type: "textarea" }
              ], "Resolve", "#57C27A", function (Values) {
                AdminRequest("AdminReports", {
                  Task: "Update", ReportID: Report._id, Status: "resolved", Note: Values.Note
                }, function () {
                  AdminNotice("Report resolved.");
                  AdminShowTab("Reports");
                });
              });
            });
            if (Report.Type != "User") {
              AdminButton(Actions, "Remove Content", "#FF5C5C", function () {
                AdminConfirm("Remove reported content?", "The " + Report.Type.toLowerCase() + " will be deleted and this report resolved.", "Remove", function () {
                  AdminRequest("AdminReports", { Task: "DeleteContent", ReportID: Report._id }, function () {
                    AdminNotice("Content removed.");
                    AdminShowTab("Reports");
                  });
                });
              });
            }
            AdminButton(Actions, "View Author", ContentColorLayer2, function () {
              var AuthorID = Snapshot.TargetUserID;
              if (AuthorID != null) {
                AdminState.Tab = "Users";
                AdminHighlightTab("Users");
                AdminClear(AdminContentPane);
                AdminOpenUser(AuthorID);
              }
            });
          } else {
            AdminButton(Actions, "Reopen", ContentColorLayer3, function () {
              AdminRequest("AdminReports", {
                Task: "Update", ReportID: Report._id, Status: "open"
              }, function () {
                AdminNotice("Report reopened.");
                AdminShowTab("Reports");
              });
            });
          }

          if (Report.ReviewedBy != null) {
            AdminText(ReportCard, "Reviewed " + AdminTime(Report.ReviewedAt), [
              ["font-size", "12px"], ["font-family", FontTypeA], ["color", "#888888"], ["margin-top", "2px"]
            ]);
          }
        })(Data.Reports[i]);
      }

      AdminPagination(ListSection, Data, function (Page) {
        State.Page = Page;
        AdminShowTab("Reports");
      });
    });
  }

  // Appeals -----------------------------------------------------------------

  function AdminLoadAppeals() {
    var State = AdminState.Appeals;
    var Toolbar = AdminSection(AdminContentPane, "Ban Appeals", "Appeals submitted by banned accounts.");
    var RowHolder = createElement(AdminID("AdminAppealToolbar"), "div", Toolbar, [
      ["display", "flex"], ["flex-wrap", "wrap"], ["align-items", "center"]
    ]);

    var StatusSelect = AdminSelect(RowHolder, [["pending", "Pending"], ["handled", "Handled"], ["all", "All"]], State.Status);
    var SearchInput = AdminInput(RowHolder, "search", "Search username or appeal", State.Search, "240px");

    function ApplyFilters() {
      State.Status = StatusSelect.value;
      State.Search = SearchInput.value.trim();
      State.Page = 1;
      AdminShowTab("Appeals");
    }

    SearchInput.addEventListener("keydown", function (Event) {
      if (Event.key == "Enter") ApplyFilters();
    });
    StatusSelect.addEventListener("change", ApplyFilters);
    AdminButton(RowHolder, "Search", ThemeColor, ApplyFilters);

    var ListSection = AdminSection(AdminContentPane, null);
    AdminText(ListSection, "Loading appeals…", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);

    AdminRequest("AdminAppeals", {
      Task: "List", Status: State.Status, Search: State.Search, Page: State.Page, Limit: 25
    }, function (Data) {
      if (AdminState.Tab != "Appeals") return;
      AdminClear(ListSection);

      if ((Data.Appeals || []).length == 0) {
        AdminText(ListSection, "No appeals in this queue.", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);
      }

      for (var i = 0; i < (Data.Appeals || []).length; i++) {
        (function (Appeal) {
          var Card = createElement(AdminID("AdminAppealCard"), "div", ListSection, [
            ["box-sizing", "border-box"], ["width", "100%"], ["margin-bottom", "6px"],
            ["padding", "8px"], ["background-color", ContentColorLayer3], ["border-radius", "8px"]
          ]);
          var TitleRow = createElement(AdminID("AdminAppealTitle"), "div", Card, [
            ["display", "flex"], ["flex-wrap", "wrap"], ["align-items", "center"]
          ]);
          AdminBadge(TitleRow, Appeal.Handled == true ? "Handled" : "Pending", Appeal.Handled == true ? "#57C27A" : "#E0A63A");
          AdminText(TitleRow, Appeal.User || "Unknown", [
            ["font-size", "17px"], ["font-family", FontTypeA], ["font-weight", "900"], ["color", FontColorA]
          ], "span");

          AdminText(Card, "“" + Appeal.Appeal + "”", [
            ["font-size", "14px"], ["font-family", FontTypeA], ["color", "#dddddd"], ["margin-top", "3px"]
          ]);
          if (Appeal.BanData != null) {
            AdminText(Card, "Ban reason: " + (Appeal.BanData.BanReason || "—"), [
              ["font-size", "12px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "2px"]
            ]);
          }
          AdminText(Card, "Submitted " + AdminTime(Appeal.Timestamp), [
            ["font-size", "12px"], ["font-family", FontTypeA], ["color", "#888888"], ["margin-top", "2px"]
          ]);
          if (Appeal.AdminNote != null) {
            AdminText(Card, "Staff note: " + Appeal.AdminNote, [
              ["font-size", "12px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "2px"]
            ]);
          }

          var Actions = createElement(AdminID("AdminAppealActions"), "div", Card, [
            ["display", "flex"], ["flex-wrap", "wrap"], ["margin-top", "4px"]
          ]);
          if (Appeal.Handled != true) {
            if (AdminUserIsOwner()) {
              AdminButton(Actions, "Approve & Unban", "#57C27A", function () {
                AdminModal("Approve Appeal", "The account will be unbanned.", [
                  { Key: "Note", Label: "Staff note", Type: "textarea" }
                ], "Unban", "#57C27A", function (Values) {
                  AdminRequest("AdminAppeals", {
                    Task: "Resolve", AppealID: Appeal._id, Action: "Unban", Note: Values.Note
                  }, function () {
                    AdminNotice("Appeal approved.");
                    AdminShowTab("Appeals");
                  });
                });
              });
            }
            AdminButton(Actions, "Dismiss", "#4A4D55", function () {
              AdminModal("Dismiss Appeal", "The ban will remain in place.", [
                { Key: "Note", Label: "Staff note", Type: "textarea" }
              ], "Dismiss", "#4A4D55", function (Values) {
                AdminRequest("AdminAppeals", {
                  Task: "Resolve", AppealID: Appeal._id, Action: "Dismiss", Note: Values.Note
                }, function () {
                  AdminNotice("Appeal dismissed.");
                  AdminShowTab("Appeals");
                });
              });
            });
          } else {
            AdminButton(Actions, "Reopen", ContentColorLayer3, function () {
              AdminRequest("AdminAppeals", {
                Task: "Resolve", AppealID: Appeal._id, Action: "Reopen"
              }, function () {
                AdminNotice("Appeal reopened.");
                AdminShowTab("Appeals");
              });
            });
          }
          AdminButton(Actions, "View User", ContentColorLayer2, function () {
            if (Appeal.UserID != null) {
              AdminState.Tab = "Users";
              AdminHighlightTab("Users");
              AdminClear(AdminContentPane);
              AdminOpenUser(Appeal.UserID);
            }
          });
        })(Data.Appeals[i]);
      }

      AdminPagination(ListSection, Data, function (Page) {
        State.Page = Page;
        AdminShowTab("Appeals");
      });
    });
  }

  // Sessions ----------------------------------------------------------------

  function AdminLoadSessions() {
    var State = AdminState.Sessions;
    var Toolbar = AdminSection(AdminContentPane, "Sessions", "Signed-in devices across the site.");
    var RowHolder = createElement(AdminID("AdminSessionToolbar"), "div", Toolbar, [
      ["display", "flex"], ["flex-wrap", "wrap"], ["align-items", "center"]
    ]);

    var StatusSelect = AdminSelect(RowHolder, [["Active", "Active"], ["Expired", "Expired"], ["All", "All"]], State.Status);
    var SearchInput = AdminInput(RowHolder, "search", "Search user, IP or ID", State.Search, "240px");

    function ApplyFilters() {
      State.Status = StatusSelect.value;
      State.Search = SearchInput.value.trim();
      State.Page = 1;
      AdminShowTab("Sessions");
    }

    SearchInput.addEventListener("keydown", function (Event) {
      if (Event.key == "Enter") ApplyFilters();
    });
    StatusSelect.addEventListener("change", ApplyFilters);
    AdminButton(RowHolder, "Search", ThemeColor, ApplyFilters);
    AdminButton(RowHolder, "Clean Up Expired", "#E0A63A", function () {
      AdminConfirm("Clean up expired sessions?", "Every expired session row will be deleted.", "Clean Up", function () {
        AdminRequest("AdminSessions", { Task: "Cleanup" }, function (Result) {
          AdminNotice("Removed " + (Result.Removed || 0) + " expired sessions.");
          AdminShowTab("Sessions");
        });
      }, "#E0A63A");
    });

    var ListSection = AdminSection(AdminContentPane, null);
    AdminText(ListSection, "Loading sessions…", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);

    AdminRequest("AdminSessions", {
      Task: "List", Status: State.Status, Search: State.Search, Page: State.Page, Limit: 25
    }, function (Data) {
      if (AdminState.Tab != "Sessions") return;
      AdminClear(ListSection);
      var HeaderRow = AdminRow(ListSection, ["20%", "20%", "12%", "20%", "20%", "8%"]);
      AdminCell(HeaderRow, 0, "User", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 1, "IP", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 2, "Count", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 3, "Last Seen", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 4, "Expires", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 5, "", []);

      if ((Data.Sessions || []).length == 0) {
        AdminText(ListSection, "No sessions matched.", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "6px"]]);
      }

      for (var i = 0; i < (Data.Sessions || []).length; i++) {
        (function (Session) {
          var SessionRow = AdminRow(ListSection, ["20%", "20%", "12%", "20%", "20%", "8%"]);
          AdminCell(SessionRow, 0, Session.User);
          AdminCell(SessionRow, 1, Session.IP);
          AdminCell(SessionRow, 2, Session.Count);
          AdminCell(SessionRow, 3, AdminTime(Session.LastSeen));
          AdminCell(SessionRow, 4, AdminTime(Session.ExpiresAt));
          AdminButton(AdminCell(SessionRow, 5, ""), "Revoke", "#FF5C5C", function () {
            AdminConfirm("Revoke this session?", "This device will be signed out.", "Revoke", function () {
              AdminRequest("AdminSessions", {
                Task: "Revoke", UserID: Session.UserID, IP: Session.IP
              }, function () {
                AdminNotice("Session revoked.");
                AdminShowTab("Sessions");
              });
            });
          });
        })(Data.Sessions[i]);
      }

      AdminPagination(ListSection, Data, function (Page) {
        State.Page = Page;
        AdminShowTab("Sessions");
      });
    });
  }

  // Audit log ---------------------------------------------------------------

  function AdminLoadLog() {
    var Toolbar = AdminSection(AdminContentPane, "Audit Log", "The 100 most recent staff actions.");
    AdminButton(Toolbar, "Refresh", ThemeColor, function () {
      AdminShowTab("Audit Log");
    });

    var ListSection = AdminSection(AdminContentPane, null);
    AdminText(ListSection, "Loading log…", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"]]);

    AdminRequest("AdminLog", {}, function (Data) {
      if (AdminState.Tab != "Audit Log") return;
      AdminClear(ListSection);
      var HeaderRow = AdminRow(ListSection, ["18%", "20%", "20%", "14%", "28%"]);
      AdminCell(HeaderRow, 0, "Actor", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 1, "Action", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 2, "Target", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 3, "When", [["color", "#aaaaaa"], ["font-weight", "900"]]);
      AdminCell(HeaderRow, 4, "Details", [["color", "#aaaaaa"], ["font-weight", "900"]]);

      if ((Data.Log || []).length == 0) {
        AdminText(ListSection, "No staff actions recorded yet.", [["font-size", "15px"], ["font-family", FontTypeA], ["color", "#aaaaaa"], ["margin-top", "6px"]]);
      }

      for (var i = 0; i < (Data.Log || []).length; i++) {
        var Entry = Data.Log[i];
        var LogRow = AdminRow(ListSection, ["18%", "20%", "20%", "14%", "28%"]);
        AdminCell(LogRow, 0, Entry.Actor);
        AdminCell(LogRow, 1, Entry.Action);
        AdminCell(LogRow, 2, Entry.Target || "—");
        AdminCell(LogRow, 3, AdminTime(Entry.Timestamp));
        AdminCell(LogRow, 4, Entry.Details == null ? "—" : JSON.stringify(Entry.Details));
      }
    });
  }

  // Broadcast ---------------------------------------------------------------

  function AdminLoadBroadcast() {
    var UpdateSection = AdminSection(AdminContentPane, "Update All Clients", "Force every connected client to reload the page so they immediately pick up the latest version.");
    AdminButton(UpdateSection, "Update All Clients", "#FF5C5C", function () {
      AdminConfirm("Push update to all clients?", "Every connected client will be prompted and then reloaded. Unsaved input will be lost.", "Update All Clients", function () {
        AdminRequest("AdminBroadcast", {
          Mode: "Reload", Message: "Photop has been updated. Reloading…", Level: "info"
        }, function (Result) {
          AdminNotice("Update pushed to " + (Result.Delivered || 0) + " clients.");
        });
      }, "#FF5C5C");
    }, "Reload every connected client");

    var Section = AdminSection(AdminContentPane, "Staff Broadcast", "Send a real-time update to every connected client.");
    var ModeSelect = AdminSelect(Section, [
      ["Reload", "Reload All Clients"],
      ["Feed", "Refresh Feed"],
      ["Announcement", "Announcement Banner"]
    ], "Announcement");
    var LevelSelect = AdminSelect(Section, [
      ["info", "Info"], ["success", "Success"], ["warning", "Warning"], ["alert", "Alert"]
    ], "info");
    var MessageInput = AdminInput(Section, "textarea", "Message shown to clients", "", "100%");

    AdminButton(Section, "Send Broadcast", ThemeColor, function () {
      var Mode = ModeSelect.value;
      if (Mode == "Announcement" && MessageInput.value.trim() == "") {
        AdminNotice("Write a message before sending an announcement.", "#C0392B");
        return;
      }
      AdminConfirm("Send this broadcast?", "Mode: " + Mode + ". Every connected client will receive it.", "Send", function () {
        AdminRequest("AdminBroadcast", {
          Mode: Mode, Message: MessageInput.value.trim(), Level: LevelSelect.value
        }, function (Result) {
          AdminNotice("Broadcast delivered to " + (Result.Delivered || 0) + " clients.");
        });
      }, ThemeColor);
    });
  }

  // Boot --------------------------------------------------------------------

  AdminHighlightTab("Overview");
  AdminLoadOverview();
}
