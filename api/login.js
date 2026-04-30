const {
  clearLoginFailures,
  createSession,
  ensureSameOrigin,
  getSellerUser,
  isRateLimited,
  parseJsonBody,
  recordLoginFailure,
  sendJson,
  sendNoContent,
  setSessionCookie,
  verifyPassword
} = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!ensureSameOrigin(req, res)) {
    return;
  }

  if (isRateLimited(req)) {
    sendJson(res, 429, { error: "Too many login attempts. Try again later." });
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const user = await getSellerUser(body.username || "");

    if (!user || !verifyPassword(body.password || "", user.password_hash)) {
      recordLoginFailure(req);
      sendJson(res, 401, { error: "Invalid username or password" });
      return;
    }

    clearLoginFailures(req);
    setSessionCookie(res, createSession(user));
    sendNoContent(res);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
};
