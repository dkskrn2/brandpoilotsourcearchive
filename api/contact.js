const buildParams = (data) => {
  const params = new URLSearchParams();
  params.append("name", data?.name || "");
  params.append("phone", data?.phone || "");
  params.append("site", data?.site || "");
  params.append("message", data?.message || "");
  params.append("agree", data?.agree || "");
  return params;
};

const parseRequestBody = (req) => {
  if (!req.body) {
    return {};
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  if (typeof req.body === "object") {
    return req.body;
  }

  return {};
};

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const gasUrl = process.env.GAS_WEBAPP_URL;
  if (!gasUrl) {
    return res.status(500).json({ ok: false, error: "Missing GAS_WEBAPP_URL" });
  }

  try {
    const data = parseRequestBody(req);
    const params = buildParams(data);
    const response = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      return res.status(502).json({ ok: false, error: bodyText || "Upstream error" });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
};
