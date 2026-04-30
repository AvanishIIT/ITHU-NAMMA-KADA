const { getSession, sendJson } = require("./_lib/common");

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const session = getSession(req);
  if (!session) {
    sendJson(res, 200, { authenticated: false });
    return;
  }

  sendJson(res, 200, {
    authenticated: true,
    csrfToken: session.csrfToken,
    role: session.role,
    username: session.username
  });
};
