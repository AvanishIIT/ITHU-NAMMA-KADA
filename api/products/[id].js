const {
  deleteProductRecord,
  ensureSameOrigin,
  getAuthenticatedSession,
  parseJsonBody,
  sendJson,
  sendNoContent,
  updateProductRecord,
  validateProduct,
  verifyCsrf
} = require("../_lib/common");

module.exports = async (req, res) => {
  const productId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;

  if (!productId) {
    sendJson(res, 400, { error: "Missing product id" });
    return;
  }

  const session = getAuthenticatedSession(req, res);
  if (!session) {
    return;
  }

  if (!ensureSameOrigin(req, res) || !verifyCsrf(req, res, session)) {
    return;
  }

  try {
    if (req.method === "DELETE") {
      await deleteProductRecord(productId);
      sendNoContent(res);
      return;
    }

    if (req.method === "PUT") {
      const body = await parseJsonBody(req);
      const { error, product } = validateProduct({ ...body, id: productId });
      if (error) {
        sendJson(res, 400, { error });
        return;
      }

      const savedProduct = await updateProductRecord(productId, product);
      if (!savedProduct) {
        sendJson(res, 404, { error: "Product not found" });
        return;
      }

      sendJson(res, 200, { product: savedProduct });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error.statusCode === 404) {
      sendJson(res, 404, { error: "Product not found" });
      return;
    }

    sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
  }
};
