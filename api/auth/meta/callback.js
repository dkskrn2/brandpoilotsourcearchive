const {
  callbackUrl,
  completionUrl,
  errorCompletionUrl,
  exchangeCodeForToken,
  methodNotAllowed,
  redirect,
  requestUrl
} = require("../../../lib/meta-oauth");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return methodNotAllowed(res, "GET");
  }

  const url = requestUrl(req);
  const stateParam = url.searchParams.get("state") || "";
  const metaError = url.searchParams.get("error");
  if (metaError) {
    const location = errorCompletionUrl({
      stateParam,
      error: metaError,
      description: url.searchParams.get("error_description") || ""
    });
    return redirect(res, location.toString());
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return res.status(400).json({ ok: false, error: "missing_code" });
  }

  try {
    const tokenResponse = await exchangeCodeForToken({
      code,
      redirectUri: callbackUrl(req)
    });
    const location = completionUrl({ stateParam, tokenResponse });
    return redirect(res, location.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : "meta_callback_failed";
    const location = errorCompletionUrl({
      stateParam,
      error: "token_exchange_failed",
      description: message
    });
    return redirect(res, location.toString());
  }
};
