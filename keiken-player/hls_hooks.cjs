module.exports = {
  "redirect_final": function(url) {
    return url.replace("http://0.0.0.0:4541/", "/.proxy/api/bypass?url=");
  }
};
console.log("hls_hooks.js loaded");
