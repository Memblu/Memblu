// Default fallback configuration when /config.js is not served dynamically by the backend.
if (typeof window !== "undefined" && !window.__PHOTOP_CONFIG__) {
  var isHttps = location.protocol === "https:";
  window.__PHOTOP_CONFIG__ = {
    serverDomain: (isHttps ? "wss://" : "ws://") + location.host + "/Server1",
    imageUploadDomain: location.origin + "/ImageUpload",
    mediaUrl: location.origin + "/media/",
    bypassCaptcha: true,
    vapidPublicKey: ""
  };
}
