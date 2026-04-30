const {
  ensureSameOrigin,
  getAuthenticatedSession,
  insertProduct,
  listProducts,
  parseJsonBody,
  sendJson,
  validateProduct,
  verifyCsrf
} = require("../_lib/common");

module.exports = async (req, res) => {
  if (req.method === "GET") {
    try {
      const products = await listProducts();
      sendJson(res, 200, { products });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
    }
    return;
  }

  if (req.method === "POST") {
    const session = getAuthenticatedSession(req, res);
    if (!session) {
      return;
    }

    if (!ensureSameOrigin(req, res) || !verifyCsrf(req, res, session)) {
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const { error, product } = validateProduct(body);
      if (error) {
        sendJson(res, 400, { error });
        return;
      }

      const savedProduct = await insertProduct(product);
      sendJson(res, 201, { product: savedProduct });
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
};
