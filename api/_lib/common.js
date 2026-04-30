const crypto = require("crypto");

const SESSION_COOKIE = "ink_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
const LOGIN_WINDOW_MS = 1000 * 60 * 15;
const LOGIN_MAX_ATTEMPTS = 5;
const IS_PRODUCTION = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-session-secret-before-production";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PUBLIC_PRODUCT_COLUMNS = "id,name,category,price,image,color,stock,description";

const loginAttempts = new Map();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  applyApiHeaders(res);
  res.end(body);
}

function sendNoContent(res, statusCode = 204) {
  res.statusCode = statusCode;
  applyApiHeaders(res);
  res.end();
}

function applyApiHeaders(res) {
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

function signValue(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}

function encodeSession(session) {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${signValue(payload)}`;
}

function decodeSession(rawValue) {
  if (!rawValue || !rawValue.includes(".")) {
    return null;
  }

  const [payload, signature] = rawValue.split(".");
  if (!payload || !signature || signValue(payload) !== signature) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session || typeof session !== "object" || Number(session.exp) <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function createSession(user) {
  return {
    csrfToken: crypto.randomBytes(24).toString("hex"),
    exp: Date.now() + SESSION_TTL_MS,
    role: user.role,
    username: user.username
  };
}

function setSessionCookie(res, session) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(encodeSession(session))}`,
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

function getSession(req) {
  const cookies = parseCookies(req);
  return decodeSession(cookies[SESSION_COOKIE]);
}

function getAuthenticatedSession(req, res) {
  const session = getSession(req);
  if (!session || session.role !== "seller") {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  return session;
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

function verifyCsrf(req, res, session) {
  const token = req.headers["x-csrf-token"];
  if (!token || token !== session.csrfToken) {
    sendJson(res, 403, { error: "Invalid CSRF token" });
    return false;
  }
  return true;
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

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
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

function ensureSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
}

async function supabaseRequest(resourcePath, options = {}) {
  ensureSupabaseConfig();

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${resourcePath}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    const message = payload?.message || payload?.error || "Supabase request failed";
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function listProducts() {
  const products = await supabaseRequest(`products?select=${PUBLIC_PRODUCT_COLUMNS}&order=created_at.desc`);
  return Array.isArray(products) ? products : [];
}

async function getSellerUser(username) {
  const rows = await supabaseRequest(
    `seller_users?select=username,role,password_hash&username=eq.${encodeURIComponent(username)}&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function insertProduct(product) {
  const rows = await supabaseRequest("products", {
    method: "POST",
    headers: {
      Prefer: "return=representation"
    },
    body: product
  });
  return Array.isArray(rows) ? rows[0] : null;
}

async function updateProductRecord(productId, product) {
  const rows = await supabaseRequest(`products?id=eq.${encodeURIComponent(productId)}`, {
    method: "PATCH",
    headers: {
      Prefer: "return=representation"
    },
    body: product
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function deleteProductRecord(productId) {
  await supabaseRequest(`products?id=eq.${encodeURIComponent(productId)}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal"
    }
  });
}

module.exports = {
  applyApiHeaders,
  clearLoginFailures,
  clearSessionCookie,
  createSession,
  deleteProductRecord,
  ensureSameOrigin,
  getAuthenticatedSession,
  getSellerUser,
  getSession,
  insertProduct,
  isRateLimited,
  listProducts,
  parseJsonBody,
  recordLoginFailure,
  sendJson,
  sendNoContent,
  setSessionCookie,
  updateProductRecord,
  validateProduct,
  verifyCsrf,
  verifyPassword
};
