let uploadedImageData = "";
let csrfToken = "";
let sellerProducts = [];
const STORE_SYNC_CHANNEL = "ithu-namma-kada-products";
const SHOP_WHATSAPP_NUMBER = "919443594787";

function formatPrice(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function createElement(tagName, className, textContent) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (textContent !== undefined) {
    element.textContent = textContent;
  }
  return element;
}

function getStoreStatusElement() {
  return document.getElementById("storeStatus");
}

function showStoreStatus(message, variant = "error") {
  const status = getStoreStatusElement();
  if (!status) {
    return;
  }

  status.textContent = message;
  status.classList.remove("hidden", "store-status-error", "store-status-success");
  status.classList.add(variant === "success" ? "store-status-success" : "store-status-error");
}

function hideStoreStatus() {
  const status = getStoreStatusElement();
  if (!status) {
    return;
  }

  status.textContent = "";
  status.classList.add("hidden");
  status.classList.remove("store-status-error", "store-status-success");
}

function normalizeProduct(product) {
  return {
    category: String(product?.category || "Casual Wear").trim(),
    color: String(product?.color || "Assorted Colors").trim(),
    description: String(product?.description || "Visit the shop for more details.").trim(),
    id: String(product?.id || `prod-${Date.now()}`),
    image: String(product?.image || "").trim(),
    name: String(product?.name || "Untitled Product").trim(),
    price: Number(product?.price || 0),
    stock: Number(product?.stock || 0)
  };
}

function notifyStoreUpdated() {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }

  const channel = new BroadcastChannel(STORE_SYNC_CHANNEL);
  channel.postMessage({ type: "products-updated" });
  channel.close();
}

function buildProductLink(productId) {
  if (typeof window === "undefined") {
    return "";
  }

  const currentUrl = new URL(window.location.href);
  currentUrl.pathname = "/index.html";
  currentUrl.hash = productId;
  return currentUrl.toString();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || "Request failed");
  }

  return payload;
}

async function fetchProducts() {
  const payload = await requestJson("/api/products");
  return Array.isArray(payload.products) ? payload.products.map(normalizeProduct) : [];
}

async function createProduct(product) {
  const payload = await requestJson("/api/products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken
    },
    body: JSON.stringify(product)
  });

  return payload.product;
}

async function updateProduct(productId, product) {
  const payload = await requestJson(`/api/products/${encodeURIComponent(productId)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken
    },
    body: JSON.stringify(product)
  });

  return payload.product;
}

async function deleteProduct(productId) {
  await requestJson(`/api/products/${encodeURIComponent(productId)}`, {
    method: "DELETE",
    headers: {
      "X-CSRF-Token": csrfToken
    }
  });
}

async function fetchSession() {
  return requestJson("/api/session");
}

async function loginSeller(username, password) {
  await requestJson("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ password, username })
  });
}

async function logoutSeller() {
  await requestJson("/api/logout", {
    method: "POST",
    headers: {
      "X-CSRF-Token": csrfToken
    }
  });
}

function updateImagePreview(imageSource) {
  const previewCard = document.getElementById("imagePreviewCard");
  const previewImage = document.getElementById("imagePreview");

  if (!previewCard || !previewImage) {
    return;
  }

  if (imageSource) {
    previewImage.src = imageSource;
    previewCard.classList.remove("hidden");
    return;
  }

  previewImage.removeAttribute("src");
  previewCard.classList.add("hidden");
}

function setSellerAccessState(isLoggedIn) {
  const loginShell = document.getElementById("sellerLoginShell");
  const dashboardShell = document.getElementById("sellerDashboardShell");

  if (!loginShell || !dashboardShell) {
    return;
  }

  loginShell.classList.toggle("hidden", isLoggedIn);
  dashboardShell.classList.toggle("hidden", !isLoggedIn);
}

async function initSellerLogin() {
  const loginForm = document.getElementById("sellerLoginForm");
  const usernameInput = document.getElementById("sellerUsername");
  const passwordInput = document.getElementById("sellerPassword");
  const passwordToggle = document.getElementById("sellerPasswordToggle");
  const errorText = document.getElementById("sellerLoginError");
  const logoutButton = document.getElementById("sellerLogoutButton");

  if (!loginForm || !usernameInput || !passwordInput || !passwordToggle || !errorText || !logoutButton) {
    return false;
  }

  let session = { authenticated: false };
  try {
    session = await fetchSession();
  } catch {
    session = { authenticated: false };
  }

  csrfToken = session.csrfToken || "";
  setSellerAccessState(session.authenticated === true);

  passwordToggle.onclick = () => {
    const showingPassword = passwordInput.type === "text";
    passwordInput.type = showingPassword ? "password" : "text";
    passwordToggle.setAttribute("aria-label", showingPassword ? "Show password" : "Hide password");
    passwordToggle.setAttribute("aria-pressed", showingPassword ? "false" : "true");
    passwordToggle.textContent = showingPassword ? "👁" : "🙈";
  };

  loginForm.onsubmit = async (event) => {
    event.preventDefault();

    try {
      await loginSeller(usernameInput.value.trim(), passwordInput.value);
      const nextSession = await fetchSession();
      csrfToken = nextSession.csrfToken || "";
      errorText.classList.add("hidden");
      loginForm.reset();
      setSellerAccessState(true);
      sellerProducts = await fetchProducts();
      renderSeller(sellerProducts);
    } catch {
      errorText.classList.remove("hidden");
    }
  };

  logoutButton.onclick = async () => {
    try {
      await logoutSeller();
    } catch {
      // noop
    }

    csrfToken = "";
    setSellerAccessState(false);
    errorText.classList.add("hidden");
    loginForm.reset();
    passwordInput.value = "";
    usernameInput.focus();
  };

  return session.authenticated === true;
}

function renderStore(products) {
  const grid = document.getElementById("productGrid");
  const emptyState = document.getElementById("emptyState");
  const searchInput = document.getElementById("searchInput");
  const categoryFilter = document.getElementById("categoryFilter");

  if (!grid || !emptyState || !searchInput || !categoryFilter) {
    return;
  }

  const search = searchInput.value.trim().toLowerCase();
  const selectedCategory = categoryFilter.value;
  const categories = [...new Set(products.map((product) => product.category))];

  categoryFilter.textContent = "";
  const allOption = createElement("option", "", "All Categories");
  allOption.value = "all";
  categoryFilter.append(allOption);

  categories.forEach((category) => {
    const option = createElement("option", "", category);
    option.value = category;
    categoryFilter.append(option);
  });

  categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : "all";

  const filteredProducts = products.filter((product) => {
    const matchesSearch = [product.name, product.category, product.color, product.description]
      .join(" ")
      .toLowerCase()
      .includes(search);
    const matchesCategory = categoryFilter.value === "all" || product.category === categoryFilter.value;
    return matchesSearch && matchesCategory;
  });

  grid.textContent = "";

  filteredProducts.forEach((product) => {
    const card = createElement("article", "product-card");
    card.id = product.id;
    const imageWrap = createElement("div", "product-image-wrap");
    const image = createElement("img", "product-image");
    image.src = product.image || "assests/logo.jpeg";
    image.alt = product.name;
    image.onerror = () => {
      image.onerror = null;
      image.src = "assests/logo.jpeg";
    };
    const badge = createElement("span", "product-badge", product.category);
    imageWrap.append(image, badge);

    const body = createElement("div", "product-body");
    const meta = createElement("div", "product-meta");
    meta.append(
      createElement("span", "tag", "Featured Casual Wear"),
      createElement("span", "price", formatPrice(product.price))
    );

    const title = createElement("h3", "", product.name);
    const description = createElement("p", "product-description", product.description);
    const footer = createElement("div", "product-footer");
    const buyButton = createElement("a", "button product-buy-button", "Buy Now");
    const productLink = buildProductLink(product.id);
    buyButton.href = `https://wa.me/${SHOP_WHATSAPP_NUMBER}?text=${encodeURIComponent(
      `Hello, I want to buy ${product.name} from Ithu Namma Kada. Product link: ${productLink}. Please share availability and branch details for Attur / Thalaivasal.`
    )}`;
    buyButton.target = "_blank";
    buyButton.rel = "noopener noreferrer";
    footer.append(
      createElement("span", "product-tone", product.color),
      createElement("span", "stock-pill", `${product.stock} in stock`),
      buyButton
    );

    body.append(meta, title, description, footer);
    card.append(imageWrap, body);
    grid.append(card);
  });

  emptyState.classList.toggle("hidden", filteredProducts.length > 0);
  if (filteredProducts.length > 0) {
    hideStoreStatus();
  }
}

function fillSellerForm(product) {
  document.getElementById("productId").value = product.id;
  document.getElementById("name").value = product.name;
  document.getElementById("category").value = product.category;
  document.getElementById("price").value = product.price;
  document.getElementById("image").value = product.image.startsWith("data:image/") ? "" : product.image;
  document.getElementById("color").value = product.color;
  document.getElementById("stock").value = product.stock;
  document.getElementById("description").value = product.description;
  document.getElementById("imageFile").value = "";
  uploadedImageData = product.image.startsWith("data:image/") ? product.image : "";
  updateImagePreview(product.image);
  document.getElementById("formTitle").textContent = "Edit Product";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function resetSellerForm() {
  const form = document.getElementById("productForm");
  if (!form) {
    return;
  }

  form.reset();
  document.getElementById("productId").value = "";
  document.getElementById("imageFile").value = "";
  uploadedImageData = "";
  updateImagePreview("");
  document.getElementById("formTitle").textContent = "Add New Product";
}

function renderSeller(products) {
  const sellerList = document.getElementById("sellerList");
  const form = document.getElementById("productForm");
  const resetButton = document.getElementById("resetButton");
  const imageInput = document.getElementById("image");
  const imageFileInput = document.getElementById("imageFile");

  if (!sellerList || !form || !resetButton || !imageInput || !imageFileInput) {
    return;
  }

  sellerProducts = products;
  sellerList.textContent = "";

  products.forEach((product) => {
    const item = createElement("article", "seller-item");
    const image = createElement("img", "seller-thumb");
    image.src = product.image;
    image.alt = product.name;

    const content = createElement("div");
    const meta = createElement("div", "seller-meta");
    meta.append(
      createElement("h3", "", product.name),
      createElement("span", "price", formatPrice(product.price))
    );

    content.append(
      meta,
      createElement("p", "", `${product.category} | ${product.color} | ${product.stock} in stock`),
      createElement("p", "", product.description)
    );

    const actions = createElement("div", "seller-actions");
    const editButton = createElement("button", "button button-secondary", "Edit");
    editButton.type = "button";
    editButton.onclick = () => fillSellerForm(product);

    const deleteButton = createElement("button", "button button-danger", "Delete");
    deleteButton.type = "button";
    deleteButton.onclick = async () => {
      await deleteProduct(product.id);
      sellerProducts = sellerProducts.filter((itemProduct) => itemProduct.id !== product.id);
      renderSeller(sellerProducts);
      notifyStoreUpdated();
      resetSellerForm();
    };

    actions.append(editButton, deleteButton);
    item.append(image, content, actions);
    sellerList.append(item);
  });

  form.onsubmit = async (event) => {
    event.preventDefault();

    const imageValue = uploadedImageData || imageInput.value.trim();

    if (!imageValue) {
      window.alert("Please add a product image using an image URL or upload a photo.");
      return;
    }

    const product = {
      category: document.getElementById("category").value.trim(),
      color: document.getElementById("color").value.trim(),
      description: document.getElementById("description").value.trim(),
      id: document.getElementById("productId").value || "",
      image: imageValue,
      name: document.getElementById("name").value.trim(),
      price: Number(document.getElementById("price").value),
      stock: Number(document.getElementById("stock").value)
    };

    const isEditing = Boolean(product.id);
    const savedProduct = isEditing
      ? await updateProduct(product.id, product)
      : await createProduct(product);

    if (isEditing) {
      sellerProducts = sellerProducts.map((item) => item.id === savedProduct.id ? savedProduct : item);
    } else {
      sellerProducts = [savedProduct, ...sellerProducts];
    }

    renderSeller(sellerProducts);
    notifyStoreUpdated();
    resetSellerForm();
  };

  resetButton.onclick = () => resetSellerForm();

  imageInput.oninput = () => {
    if (imageInput.value.trim()) {
      uploadedImageData = "";
      imageFileInput.value = "";
      updateImagePreview(imageInput.value.trim());
      return;
    }

    updateImagePreview(uploadedImageData);
  };

  imageFileInput.onchange = () => {
    const [file] = imageFileInput.files || [];
    if (!file) {
      return;
    }

    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    const maxFileSize = 2 * 1024 * 1024;

    if (!allowedTypes.includes(file.type) || file.size > maxFileSize) {
      window.alert("Only JPG, PNG, or WEBP images up to 2MB are allowed.");
      imageFileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      uploadedImageData = typeof reader.result === "string" ? reader.result : "";
      imageInput.value = "";
      updateImagePreview(uploadedImageData);
    };
    reader.readAsDataURL(file);
  };
}

async function initStorePage() {
  const searchInput = document.getElementById("searchInput");
  const categoryFilter = document.getElementById("categoryFilter");
  if (!searchInput || !categoryFilter) {
    return;
  }

  if (window.location.protocol === "file:") {
    showStoreStatus("Open the store using http://localhost:3000/index.html while the server is running. Products will stay blank if index.html is opened directly from the folder.");
    return;
  }

  let products = [];

  const refreshProducts = async () => {
    try {
      products = await fetchProducts();
      renderStore(products);

      if (products.length === 0) {
        showStoreStatus("No products are available right now. Add a product from the seller site and this store will update automatically.", "success");
      } else {
        hideStoreStatus();
      }
    } catch (error) {
      showStoreStatus(`Unable to load products. Open the site through http://localhost:3000/index.html and keep the server running. ${error.message ? `Details: ${error.message}` : ""}`.trim());
    }
  };

  await refreshProducts();

  searchInput.addEventListener("input", () => renderStore(products));
  categoryFilter.addEventListener("change", () => renderStore(products));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshProducts().catch(() => {
        // noop
      });
    }
  });
  window.addEventListener("focus", () => {
    refreshProducts().catch(() => {
      // noop
    });
  });
  window.setInterval(() => {
    refreshProducts().catch(() => {
      // noop
    });
  }, 10000);

  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(STORE_SYNC_CHANNEL);
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "products-updated") {
        refreshProducts().catch(() => {
          // noop
        });
      }
    });
  }
}

async function initSellerPage() {
  const isLoggedIn = await initSellerLogin();

  if (isLoggedIn) {
    sellerProducts = await fetchProducts();
    renderSeller(sellerProducts);
  }
}

const page = document.body.dataset.page;

if (page === "store") {
  initStorePage().catch((error) => {
    showStoreStatus(`Unable to start the store page. ${error.message ? `Details: ${error.message}` : ""}`.trim());
  });
}

if (page === "seller") {
  initSellerPage().catch(() => {
    // noop
  });
}
