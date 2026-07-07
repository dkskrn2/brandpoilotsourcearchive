const crypto = require("node:crypto");
const {
  callbackUrl,
  devRedirectUrl,
  encodeState,
  methodNotAllowed,
  metaDialogUrl,
  oauthScopes,
  redirect,
  requestUrl
} = require("../../../lib/meta-oauth");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return methodNotAllowed(res, "GET");
  }
  if (!process.env.META_APP_ID) {
    return res.status(500).json({ ok: false, error: "missing_meta_app_id" });
  }

  try {
    const url = requestUrl(req);
    const devRedirect = devRedirectUrl(url.searchParams.get("dev_redirect"));
    const state = encodeState({
      nonce: crypto.randomUUID(),
      devRedirect
    });
    const dialogUrl = metaDialogUrl({
      appId: process.env.META_APP_ID,
      redirectUri: callbackUrl(req),
      state,
      scopes: oauthScopes()
    });

    return redirect(res, dialogUrl.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_start_failed";
    return res.status(400).json({ ok: false, error: message });
  }
};
