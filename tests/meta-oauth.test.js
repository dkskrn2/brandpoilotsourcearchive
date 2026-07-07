const assert = require("node:assert/strict");
const { test, afterEach } = require("node:test");

const startHandler = require("../api/auth/meta/start");
const callbackHandler = require("../api/auth/meta/callback");

const envKeys = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_REDIRECT_URI",
  "META_LOGIN_CONFIG_ID",
  "META_OAUTH_SCOPES",
  "BRAND_PILOT_DEV_REDIRECT_URL",
  "BRAND_PILOT_ALLOW_DEV_TOKEN_REDIRECT",
  "BRAND_PILOT_ALLOWED_DEV_REDIRECT_ORIGINS"
];

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    writeHead(code, headers) {
      this.statusCode = code;
      for (const [name, value] of Object.entries(headers)) {
        this.headers[name.toLowerCase()] = value;
      }
      return this;
    },
    end(payload) {
      this.body = payload ?? this.body;
      return this;
    }
  };
}

function createRequest(url, method = "GET") {
  return {
    method,
    url,
    headers: {
      host: "www.danbammsg.co.kr",
      "x-forwarded-proto": "https"
    }
  };
}

afterEach(() => {
  for (const key of envKeys) {
    delete process.env[key];
  }
  delete global.fetch;
});

test("start redirects to Meta dialog with the configured HTTPS callback", async () => {
  process.env.META_APP_ID = "123456789";
  process.env.META_REDIRECT_URI = "https://www.danbammsg.co.kr/api/auth/meta/callback";
  process.env.META_LOGIN_CONFIG_ID = "987654321";
  process.env.META_OAUTH_SCOPES = "pages_show_list,instagram_basic";

  const res = createResponse();
  await startHandler(createRequest("/api/auth/meta/start?dev_redirect=http%3A%2F%2F127.0.0.1%3A4000%2Fauth%2Fmeta%2Fdev-complete"), res);

  assert.equal(res.statusCode, 302);
  const location = new URL(res.headers.location);
  assert.equal(location.origin, "https://www.facebook.com");
  assert.equal(location.pathname, "/v20.0/dialog/oauth");
  assert.equal(location.searchParams.get("client_id"), "123456789");
  assert.equal(location.searchParams.get("redirect_uri"), "https://www.danbammsg.co.kr/api/auth/meta/callback");
  assert.equal(location.searchParams.get("config_id"), "987654321");
  assert.equal(location.searchParams.get("scope"), "pages_show_list,instagram_basic");
  assert.ok(location.searchParams.get("state"));
});

test("callback exchanges the code and redirects to the local dev completion endpoint without full token by default", async () => {
  process.env.META_APP_ID = "123456789";
  process.env.META_APP_SECRET = "secret";
  process.env.META_REDIRECT_URI = "https://www.danbammsg.co.kr/api/auth/meta/callback";
  process.env.BRAND_PILOT_DEV_REDIRECT_URL = "http://127.0.0.1:4000/auth/meta/dev-complete";

  global.fetch = async (url) => {
    const requestUrl = new URL(url);
    assert.equal(requestUrl.origin, "https://graph.facebook.com");
    assert.equal(requestUrl.pathname, "/v20.0/oauth/access_token");
    assert.equal(requestUrl.searchParams.get("client_id"), "123456789");
    assert.equal(requestUrl.searchParams.get("client_secret"), "secret");
    assert.equal(requestUrl.searchParams.get("redirect_uri"), "https://www.danbammsg.co.kr/api/auth/meta/callback");
    assert.equal(requestUrl.searchParams.get("code"), "oauth-code");
    return {
      ok: true,
      json: async () => ({
        access_token: "EAAB1234567890",
        token_type: "bearer",
        expires_in: 3600
      })
    };
  };

  const res = createResponse();
  await callbackHandler(createRequest("/api/auth/meta/callback?code=oauth-code&state=opaque-state"), res);

  assert.equal(res.statusCode, 302);
  const location = new URL(res.headers.location);
  assert.equal(location.origin, "http://127.0.0.1:4000");
  assert.equal(location.pathname, "/auth/meta/dev-complete");
  assert.equal(location.searchParams.get("status"), "connected");
  assert.equal(location.searchParams.get("token_preview"), "EAAB12...7890");
  assert.equal(location.searchParams.get("expires_in"), "3600");
  assert.equal(location.searchParams.get("state"), "opaque-state");
  assert.equal(location.searchParams.has("access_token"), false);
});

test("callback includes the full token only when dev token redirect is explicitly enabled", async () => {
  process.env.META_APP_ID = "123456789";
  process.env.META_APP_SECRET = "secret";
  process.env.META_REDIRECT_URI = "https://www.danbammsg.co.kr/api/auth/meta/callback";
  process.env.BRAND_PILOT_DEV_REDIRECT_URL = "http://127.0.0.1:4000/auth/meta/dev-complete";
  process.env.BRAND_PILOT_ALLOW_DEV_TOKEN_REDIRECT = "true";

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      access_token: "EAAB1234567890",
      token_type: "bearer",
      expires_in: 3600
    })
  });

  const res = createResponse();
  await callbackHandler(createRequest("/api/auth/meta/callback?code=oauth-code"), res);

  const location = new URL(res.headers.location);
  assert.equal(location.searchParams.get("access_token"), "EAAB1234567890");
  assert.equal(location.searchParams.get("token_type"), "bearer");
});

test("callback rejects requests without an OAuth code", async () => {
  const res = createResponse();
  await callbackHandler(createRequest("/api/auth/meta/callback"), res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { ok: false, error: "missing_code" });
});
