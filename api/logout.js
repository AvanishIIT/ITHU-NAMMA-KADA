const {
  clearSessionCookie,
  ensureSameOrigin,
  getAuthenticatedSession,
  sendNoContent,
  sendJson,
  verifyCsrf
} = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const session = getAuthenticatedSession(req, res);
  if (!session) {
    return;
  }

  if (!ensureSameOrigin(req, res) || !verifyCsrf(req, res, session)) {
    return;
  }

  clearSessionCookie(res);
  sendNoContent(res);
};
