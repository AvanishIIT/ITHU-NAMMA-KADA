const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSION_COOKIE = "ink_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const LOGIN_MAX_ATTEMPTS = 5;
const SESSION_SECRET = process.env.SESSION_SECRET || "45536d7cd713c26b722b1f15d9d149ba5a208598b7e8ad5f47c7148a5de512e0";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const sessions = new Map();
const loginAttempts = new Map();

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendNoContent(res, statusCode = 204) {
  res.writeHead(statusCode);
  res.end();
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text)
  });
  res.end(text);
}

function applySecurityHeaders(res) {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  if (IS_PRODUCTION) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function safeReadJson(filePath, fallbackValue) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader.split(";").reduce((cookies, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) {
      return cookies;
    }
    cookies[name] = decodeURIComponent(rest.join("="));
    return cookies;
  }, {});
}

function createSignedValue(value) {
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  return `${value}.${signature}`;
}

function verifySignedValue(signedValue) {
  if (!signedValue || !signedValue.includes(".")) {
    return null;
  }

  const lastDotIndex = signedValue.lastIndexOf(".");
  const value = signedValue.slice(0, lastDotIndex);
  const signature = signedValue.slice(lastDotIndex + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");

  try {
    const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    return isValid ? value : null;
  } catch {
    return null;
  }
}

function createSession(user) {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;

  sessions.set(sessionId, {
    csrfToken,
    expiresAt,
    role: user.role,
    username: user.username
  });

  return { csrfToken, sessionId };
}

function clearExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
}

function getSession(req) {
  clearExpiredSessions();
  const cookies = parseCookies(req);
  const signed = cookies[SESSION_COOKIE];
  const sessionId = verifySignedValue(signed);
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { ...session, sessionId };
}

function setSessionCookie(res, sessionId) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(createSignedValue(sessionId))}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];

  if (IS_PRODUCTION) {
    parts.push("Secure");
  }

  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  if (IS_PRODUCTION) {
    parts.push("Secure");
  }

  res.setHeader("Set-Cookie", parts.join("; "));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 3 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === req.headers.host;
  } catch {
    return false;
  }
}

function ensureSameOrigin(req, res) {
  if (isSameOrigin(req)) {
    return true;
  }

  sendJson(res, 403, { error: "Forbidden" });
  return false;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash).split(":");
  if (!salt || !hash) {
    return false;
  }

  const derived = crypto.scryptSync(password, salt, 64);
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), derived);
  } catch {
    return false;
  }
}

function getClientIp(req) {
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const current = loginAttempts.get(ip);

  if (!current || current.expiresAt <= now) {
    return false;
  }

  return current.count >= LOGIN_MAX_ATTEMPTS;
}

function recordLoginFailure(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const current = loginAttempts.get(ip);

  if (!current || current.expiresAt <= now) {
    loginAttempts.set(ip, { count: 1, expiresAt: now + LOGIN_WINDOW_MS });
    return;
  }

  current.count += 1;
}

function clearLoginFailures(req) {
  loginAttempts.delete(getClientIp(req));
}

function requireSellerSession(req, res) {
  const session = getSession(req);
  if (!session || session.role !== "seller") {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }

  return session;
}

function verifyCsrf(req, res, session) {
  const token = req.headers["x-csrf-token"];
  if (!token || token !== session.csrfToken) {
    sendJson(res, 403, { error: "Invalid CSRF token" });
    return false;
  }

  return true;
}

function isAllowedImageSource(value) {
  if (typeof value !== "string" || !value) {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed.length > 2_500_000) {
    return false;
  }

  if (/^https:\/\/[^\s]+$/i.test(trimmed)) {
    return true;
  }

  return /^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i.test(trimmed);
}

function validateProduct(input) {
  const product = {
    id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : `prod-${crypto.randomUUID()}`,
    name: typeof input.name === "string" ? input.name.trim() : "",
    category: typeof input.category === "string" ? input.category.trim() : "",
    price: Number(input.price),
    image: typeof input.image === "string" ? input.image.trim() : "",
    color: typeof input.color === "string" ? input.color.trim() : "",
    stock: Number(input.stock),
    description: typeof input.description === "string" ? input.description.trim() : ""
  };

  if (!product.name || product.name.length > 80) {
    return { error: "Invalid product name" };
  }

  if (!product.category || product.category.length > 40) {
    return { error: "Invalid product category" };
  }

  if (!Number.isFinite(product.price) || product.price < 0 || product.price > 1_000_000) {
    return { error: "Invalid product price" };
  }

  if (!Number.isInteger(product.stock) || product.stock < 0 || product.stock > 100_000) {
    return { error: "Invalid product stock" };
  }

  if (!product.color || product.color.length > 40) {
    return { error: "Invalid product color" };
  }

  if (!product.description || product.description.length > 500) {
    return { error: "Invalid product description" };
  }

  if (!isAllowedImageSource(product.image)) {
    return { error: "Invalid product image" };
  }

  return { product };
}

function serveStaticFile(reqPath, res) {
  const filePath = reqPath === "/" ? path.join(ROOT_DIR, "index.html") : path.join(ROOT_DIR, reqPath);
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(ROOT_DIR) || resolvedPath.startsWith(DATA_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    sendText(res, 404, "Not Found");
    return;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });

  if (res.req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(resolvedPath).pipe(res);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/products") {
    const products = safeReadJson(PRODUCTS_FILE, []);
    sendJson(res, 200, { products });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/session") {
    const session = getSession(req);
    if (!session) {
      sendJson(res, 200, { authenticated: false });
      return true;
    }

    sendJson(res, 200, {
      authenticated: true,
      csrfToken: session.csrfToken,
      role: session.role,
      username: session.username
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    if (!ensureSameOrigin(req, res)) {
      return true;
    }

    if (isRateLimited(req)) {
      sendJson(res, 429, { error: "Too many login attempts. Try again later." });
      return true;
    }

    const body = await parseJsonBody(req);
    const users = safeReadJson(USERS_FILE, []);
    const user = users.find((candidate) => candidate.username === body.username);

    if (!user || !verifyPassword(body.password || "", user.passwordHash)) {
      recordLoginFailure(req);
      sendJson(res, 401, { error: "Invalid username or password" });
      return true;
    }

    clearLoginFailures(req);
    const session = createSession(user);
    setSessionCookie(res, session.sessionId);
    sendNoContent(res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const session = requireSellerSession(req, res);
    if (!session) {
      return true;
    }

    if (!ensureSameOrigin(req, res) || !verifyCsrf(req, res, session)) {
      return true;
    }

    sessions.delete(session.sessionId);
    clearSessionCookie(res);
    sendNoContent(res);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/products") {
    const session = requireSellerSession(req, res);
    if (!session) {
      return true;
    }

    if (!ensureSameOrigin(req, res) || !verifyCsrf(req, res, session)) {
      return true;
    }

    const body = await parseJsonBody(req);
    const { error, product } = validateProduct(body);
    if (error) {
      sendJson(res, 400, { error });
      return true;
    }

    const products = safeReadJson(PRODUCTS_FILE, []);
    products.unshift(product);
    writeJson(PRODUCTS_FILE, products);
    sendJson(res, 201, { product });
    return true;
  }

  if ((req.method === "PUT" || req.method === "DELETE") && url.pathname.startsWith("/api/products/")) {
    const session = requireSellerSession(req, res);
    if (!session) {
      return true;
    }

    if (!ensureSameOrigin(req, res) || !verifyCsrf(req, res, session)) {
      return true;
    }

    const productId = decodeURIComponent(url.pathname.replace("/api/products/", ""));
    const products = safeReadJson(PRODUCTS_FILE, []);
    const index = products.findIndex((product) => product.id === productId);

    if (index < 0) {
      sendJson(res, 404, { error: "Product not found" });
      return true;
    }

    if (req.method === "DELETE") {
      products.splice(index, 1);
      writeJson(PRODUCTS_FILE, products);
      sendNoContent(res);
      return true;
    }

    const body = await parseJsonBody(req);
    const { error, product } = validateProduct({ ...body, id: productId });
    if (error) {
      sendJson(res, 400, { error });
      return true;
    }

    products[index] = product;
    writeJson(PRODUCTS_FILE, products);
    sendJson(res, 200, { product });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);

  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    const handled = await handleApi(req, res, url);
    if (handled) {
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendText(res, 405, "Method Not Allowed");
      return;
    }

    serveStaticFile(url.pathname, res);
  } catch (error) {
    if (error.message === "Invalid JSON") {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    if (error.message === "Payload too large") {
      sendJson(res, 413, { error: "Payload too large" });
      return;
    }

    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Ithu Namma Kada server running at http://${HOST}:${PORT}`);
  console.log("Default seller username: seller");
  console.log("Default seller password: ChangeMe@123");
});
