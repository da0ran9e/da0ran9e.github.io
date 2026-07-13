(() => {
  "use strict";

  const STORAGE_KEY = "my-album-endpoint-v1";
  const PAGE_SIZE = 80;
  const MAX_CONCURRENT_REQUESTS = 4;
  const PROBE_TIMEOUT_MS = 10000;
  const API_TIMEOUT_MS = 120000;
  const DIRECTORY_TIMEOUT_MS = 15000;
  const VIEWER_CACHE_DELAY_MS = 8000;
  const VIEWED_IMAGE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
  const THUMBNAIL_CACHE_NAME = "my-album-thumbnails-v1";
  const VIEWED_IMAGE_CACHE_NAME = "my-album-viewed-images-v1";
  const CATALOG_CACHE_NAME = "my-album-catalog-v1";
  const VIEWED_IMAGE_CACHE_INDEX_KEY = "my-album-viewed-images-index-v1";
  const IMAGE_EXTENSIONS = new Set([
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif",
  ]);
  const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "avi", "mkv"]);
  const SKIPPED_DIRECTORIES = new Set([
    "thumbs", "_thumbnails", ".my-album-cache", "__pycache__",
  ]);

  class ApiUnavailableError extends Error {}

  const state = {
    endpoint: null,
    baseUrl: "",
    mode: null,
    items: [],
    visibleItems: [],
    total: 0,
    stats: null,
    hasMore: false,
    filter: "all",
    query: "",
    sort: "newest",
    renderedCount: 0,
    requestVersion: 0,
    isLoading: false,
    isLoadingMore: false,
    viewerIndex: -1,
    viewerLoadToken: 0,
    viewerAbortController: null,
    viewerObjectUrl: null,
    viewerCacheTimer: null,
    viewerBlob: null,
    viewerCacheUrl: null,
  };

  const elements = {
    endpointLabel: document.querySelector("#endpoint-label"),
    openDirect: document.querySelector("#open-direct"),
    changeEndpoint: document.querySelector("#change-endpoint"),
    searchInput: document.querySelector("#search-input"),
    filterButtons: [...document.querySelectorAll("[data-filter]")],
    sortSelect: document.querySelector("#sort-select"),
    sizeInput: document.querySelector("#size-input"),
    connectionNotice: document.querySelector("#connection-notice"),
    noticeTitle: document.querySelector("#notice-title"),
    noticeMessage: document.querySelector("#notice-message"),
    retryButton: document.querySelector("#retry-button"),
    noticeOpenDirect: document.querySelector("#notice-open-direct"),
    albumSummary: document.querySelector("#album-summary"),
    connectionMode: document.querySelector("#connection-mode"),
    scanStatus: document.querySelector("#scan-status"),
    scanStatusText: document.querySelector("#scan-status-text"),
    refreshButton: document.querySelector("#refresh-button"),
    mediaGrid: document.querySelector("#media-grid"),
    emptyState: document.querySelector("#empty-state"),
    emptyTitle: document.querySelector("#empty-state h2"),
    emptyCopy: document.querySelector("#empty-state p"),
    emptyConnect: document.querySelector("#empty-connect"),
    loadSentinel: document.querySelector("#load-sentinel"),
    connectionDialog: document.querySelector("#connection-dialog"),
    connectionForm: document.querySelector("#connection-form"),
    ipInput: document.querySelector("#ip-input"),
    portInput: document.querySelector("#port-input"),
    formError: document.querySelector("#form-error"),
    viewerDialog: document.querySelector("#viewer-dialog"),
    viewerName: document.querySelector("#viewer-name"),
    viewerFolder: document.querySelector("#viewer-folder"),
    viewerDetails: document.querySelector("#viewer-details"),
    viewerOpenOriginal: document.querySelector("#viewer-open-original"),
    viewerClose: document.querySelector("#viewer-close"),
    viewerPrevious: document.querySelector("#viewer-previous"),
    viewerNext: document.querySelector("#viewer-next"),
    viewerStage: document.querySelector("#viewer-stage"),
    viewerCount: document.querySelector("#viewer-count"),
    viewerOfflineStatus: document.querySelector("#viewer-offline-status"),
    mediaCardTemplate: document.querySelector("#media-card-template"),
  };

  const numberFormatter = new Intl.NumberFormat("vi-VN");
  const textEncoder = new TextEncoder();
  const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const thumbnailObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        const image = entry.target;
        thumbnailObserver.unobserve(image);
        const thumbnail = image.albumThumbnail;
        if (thumbnail) {
          loadThumbnailImage(image, thumbnail.preview, thumbnail.item);
        }
      }
    }, { rootMargin: "600px 0px" })
    : null;

  function readSavedEndpoint() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return validateEndpoint(parsed?.ip ?? "", parsed?.port ?? "");
    } catch {
      return null;
    }
  }

  function validateEndpoint(rawIp, rawPort) {
    const ip = String(rawIp).trim();
    const octets = ip.split(".");
    const isIpv4 =
      octets.length === 4 &&
      octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
    const port = Number(rawPort);

    if (!isIpv4) {
      throw new Error("Địa chỉ IP chưa đúng định dạng, ví dụ 192.168.0.102.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Cổng phải là một số từ 1 đến 65535.");
    }

    return { ip, port };
  }

  function saveEndpoint(endpoint) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoint));
  }

  function endpointUrl(endpoint) {
    return `http://${endpoint.ip}:${endpoint.port}/`;
  }

  function showConnectionDialog() {
    const endpoint = state.endpoint ?? readSavedEndpoint();
    elements.ipInput.value = endpoint?.ip ?? "192.168.0.102";
    elements.portInput.value = endpoint?.port ?? "8000";
    elements.formError.hidden = true;
    elements.connectionDialog.showModal();
    requestAnimationFrame(() => elements.ipInput.select());
  }

  function closeConnectionDialog() {
    if (elements.connectionDialog.open) {
      elements.connectionDialog.close();
    }
  }

  function openDirectly() {
    if (state.baseUrl) {
      window.open(state.baseUrl, "_blank", "noopener,noreferrer");
    }
  }

  function setLoading(isLoading, message = "Đang tải…") {
    state.isLoading = isLoading;
    elements.scanStatus.hidden = !isLoading;
    elements.scanStatusText.textContent = message;
    elements.refreshButton.disabled = isLoading;
    updateEmptyState();
  }

  function setMode(mode) {
    state.mode = mode;
    elements.connectionMode.hidden = !mode;
    const labels = { api: "LAN API", directory: "Directory", offline: "Offline" };
    elements.connectionMode.textContent = labels[mode] || "";
    elements.refreshButton.hidden = !mode;
  }

  function hideNotice() {
    elements.connectionNotice.hidden = true;
  }

  function showConnectionError(error) {
    const detail = error instanceof Error ? error.message : String(error);
    elements.noticeTitle.textContent = "Chưa kết nối được server LAN";
    elements.noticeMessage.textContent =
      `Trình duyệt chưa đọc được API album tại ${state.baseUrl} (${detail}). ` +
      "Hãy chạy gói My Album LAN trên máy Windows, cho phép Mạng riêng khi Firewall hỏi rồi thử lại.";
    elements.connectionNotice.hidden = false;
  }

  function showOfflineNotice(error) {
    const detail = error instanceof Error ? error.message : String(error);
    elements.noticeTitle.textContent = "Đang dùng album ngoại tuyến";
    elements.noticeMessage.textContent =
      `Không kết nối được ${state.baseUrl} (${detail}). ` +
      "Những thumbnail và ảnh đã lưu vẫn có thể mở; bấm làm mới khi máy Windows hoạt động lại.";
    elements.connectionNotice.hidden = false;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return "";
    }
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** index;
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  }

  function formatDate(timestamp) {
    return Number.isFinite(timestamp) && timestamp > 0 ? dateFormatter.format(new Date(timestamp * 1000)) : "";
  }

  function itemDetail(item) {
    return [formatDate(item.modified), formatBytes(item.bytes)].filter(Boolean).join(" · ");
  }

  function canUseCacheStorage() {
    return "caches" in window && typeof window.caches?.open === "function";
  }

  function blobCacheKey(cacheName, sourceUrl) {
    const url = new URL("./__offline/blob", window.location.href);
    url.search = "";
    url.searchParams.set("cache", cacheName);
    url.searchParams.set("source", sourceUrl);
    return url.href;
  }

  async function fetchMediaResponse(url, signal) {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      signal,
      targetAddressSpace: "local",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response;
  }

  async function readCachedBlob(cacheName, url) {
    if (!canUseCacheStorage()) {
      return null;
    }
    const cache = await caches.open(cacheName);
    const response = await cache.match(blobCacheKey(cacheName, url));
    if (!response) {
      return null;
    }
    return response.blob();
  }

  async function loadThumbnailBlob(url, signal) {
    const cachedBlob = await readCachedBlob(THUMBNAIL_CACHE_NAME, url);
    if (cachedBlob) {
      return cachedBlob;
    }

    const response = await fetchMediaResponse(url, signal);
    if (canUseCacheStorage()) {
      const cache = await caches.open(THUMBNAIL_CACHE_NAME);
      cache.put(blobCacheKey(THUMBNAIL_CACHE_NAME, url), response.clone()).catch(() => {});
    }
    return response.blob();
  }

  function readViewedImageCacheIndex() {
    try {
      const parsed = JSON.parse(localStorage.getItem(VIEWED_IMAGE_CACHE_INDEX_KEY));
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((entry) =>
        entry && typeof entry.url === "string" && Number.isFinite(entry.bytes) && Number.isFinite(entry.lastAccess));
    } catch {
      return [];
    }
  }

  function writeViewedImageCacheIndex(entries) {
    try {
      localStorage.setItem(VIEWED_IMAGE_CACHE_INDEX_KEY, JSON.stringify(entries));
    } catch {
      // The image remains cached even if the optional LRU index cannot be stored.
    }
  }

  function touchViewedImageCache(url, bytes) {
    const entries = readViewedImageCacheIndex();
    const existing = entries.find((entry) => entry.url === url);
    if (existing) {
      existing.bytes = bytes || existing.bytes;
      existing.lastAccess = Date.now();
    } else {
      entries.push({ url, bytes, lastAccess: Date.now() });
    }
    writeViewedImageCacheIndex(entries);
  }

  async function storeViewedImage(url, blob) {
    if (!canUseCacheStorage()) {
      return false;
    }

    const cache = await caches.open(VIEWED_IMAGE_CACHE_NAME);
    const response = new Response(blob, {
      headers: {
        "Content-Length": String(blob.size),
        "Content-Type": blob.type || "application/octet-stream",
        "X-My-Album-Cached-At": new Date().toISOString(),
      },
    });
    await cache.put(blobCacheKey(VIEWED_IMAGE_CACHE_NAME, url), response);

    const entries = readViewedImageCacheIndex().filter((entry) => entry.url !== url);
    entries.push({ url, bytes: blob.size, lastAccess: Date.now() });
    entries.sort((left, right) => left.lastAccess - right.lastAccess);

    let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    while (totalBytes > VIEWED_IMAGE_CACHE_MAX_BYTES && entries.length > 0) {
      const oldest = entries.shift();
      totalBytes -= oldest.bytes;
      await cache.delete(blobCacheKey(VIEWED_IMAGE_CACHE_NAME, oldest.url));
    }
    writeViewedImageCacheIndex(entries);
    return entries.some((entry) => entry.url === url);
  }

  function mediaExtension(pathname) {
    const name = pathname.split("/").pop() ?? "";
    const dot = name.lastIndexOf(".");
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function relativePath(url) {
    const basePath = new URL(state.baseUrl).pathname;
    const pathname = safeDecode(new URL(url).pathname);
    return pathname.slice(basePath.length).replace(/^\/+/, "");
  }

  function makeDirectoryThumbnailUrl(relative) {
    const base = new URL(state.baseUrl);
    const encoded = relative
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return new URL(`_thumbnails/${encoded}.jpg`, base).href;
  }

  async function makeHashedDirectoryThumbnailUrl(relative) {
    const digest = await crypto.subtle.digest("SHA-1", textEncoder.encode(relative));
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
    return new URL(`thumbs/${hash}.jpg`, state.baseUrl).href;
  }

  function directoryItemFromUrl(url) {
    const parsed = new URL(url);
    const extension = mediaExtension(parsed.pathname);
    const type = IMAGE_EXTENSIONS.has(extension) ? "image" : VIDEO_EXTENSIONS.has(extension) ? "video" : null;
    if (!type) {
      return null;
    }

    const relative = relativePath(url);
    const parts = relative.split("/");
    const encodedName = parts.pop() ?? relative;
    const name = safeDecode(encodedName);
    const folder = parts.map(safeDecode).join(" / ") || "Thư mục gốc";

    return {
      id: url,
      url,
      preview: url,
      type,
      extension,
      relative,
      name,
      folder,
      thumbnail: null,
      bytes: 0,
      modified: 0,
      source: "directory",
      thumbnailFallback: type === "image" ? makeDirectoryThumbnailUrl(relative) : null,
    };
  }

  function normalizeApiItem(rawItem) {
    const name = String(rawItem.fileName || rawItem.name || "Không tên");
    const folder = rawItem.folder && rawItem.folder !== "." ? String(rawItem.folder).replaceAll("/", " / ") : "Thư mục gốc";
    return {
      id: String(rawItem.id),
      url: new URL(String(rawItem.media), state.baseUrl).href,
      preview: new URL(String(rawItem.view || rawItem.media), state.baseUrl).href,
      thumbnail: new URL(String(rawItem.thumbnail), state.baseUrl).href,
      type: rawItem.type === "video" ? "video" : "image",
      extension: String(rawItem.extension || mediaExtension(name)),
      relative: `${rawItem.folder || ""}/${name}`,
      name,
      folder,
      bytes: Number(rawItem.bytes) || 0,
      modified: Number(rawItem.modified) || 0,
      source: "api",
      thumbnailFallback: null,
    };
  }

  function catalogCacheUrl() {
    const url = new URL("./__offline/catalog.json", window.location.href);
    url.search = "";
    url.searchParams.set("endpoint", state.baseUrl);
    return url.href;
  }

  async function saveCachedCatalog() {
    if (!canUseCacheStorage() || !state.endpoint || !["api", "directory"].includes(state.mode)) {
      return;
    }
    if (state.mode === "api" && (state.filter !== "all" || state.query.trim())) {
      return;
    }

    const cache = await caches.open(CATALOG_CACHE_NAME);
    const payload = {
      version: 1,
      endpoint: state.baseUrl,
      savedAt: Date.now(),
      sourceMode: state.mode,
      items: state.items,
      stats: state.stats,
    };
    await cache.put(catalogCacheUrl(), new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }));
  }

  async function restoreCachedCatalog() {
    if (!canUseCacheStorage() || !state.endpoint) {
      return false;
    }

    try {
      const cache = await caches.open(CATALOG_CACHE_NAME);
      const response = await cache.match(catalogCacheUrl());
      if (!response) {
        return false;
      }
      const payload = await response.json();
      if (payload?.version !== 1 || payload.endpoint !== state.baseUrl || !Array.isArray(payload.items)) {
        return false;
      }

      const items = payload.items.filter((item) =>
        item && typeof item.url === "string" && typeof item.name === "string" &&
        (item.type === "image" || item.type === "video"));
      if (items.length === 0) {
        return false;
      }

      state.items = items;
      state.visibleItems = items;
      state.total = items.length;
      state.stats = payload.stats || {
        total: items.length,
        images: items.filter((item) => item.type === "image").length,
        videos: items.filter((item) => item.type === "video").length,
      };
      state.hasMore = false;
      state.renderedCount = 0;
      setMode("offline");
      refreshDirectoryItems(false);
      return true;
    } catch {
      return false;
    }
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        signal: controller.signal,
        targetAddressSpace: "local",
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("quá thời gian chờ server");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function probeApi() {
    const response = await fetchWithTimeout(new URL("healthz", state.baseUrl), PROBE_TIMEOUT_MS);
    if (response.status === 404) {
      throw new ApiUnavailableError("Không có API album");
    }
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error(`health check HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (payload.status !== "ok") {
      throw new Error("health check không hợp lệ");
    }
  }

  function apiItemsUrl({ offset, force }) {
    const url = new URL("api/items", state.baseUrl);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("type", state.filter);
    url.searchParams.set("sort", state.sort);
    if (state.query.trim()) {
      url.searchParams.set("q", state.query.trim());
    }
    if (force) {
      url.searchParams.set("refresh", "1");
    }
    return url;
  }

  async function fetchApiPage({ offset, force, version }) {
    const response = await fetchWithTimeout(apiItemsUrl({ offset, force }), API_TIMEOUT_MS);
    const contentType = response.headers.get("content-type") || "";
    if (response.status === 404 || !contentType.includes("application/json")) {
      throw new ApiUnavailableError("Server không trả API JSON");
    }
    if (!response.ok) {
      throw new Error(`API HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (version !== state.requestVersion) {
      return null;
    }
    if (!Array.isArray(payload.items)) {
      throw new Error("Dữ liệu API không hợp lệ");
    }
    return payload;
  }

  async function loadApiPage({ reset = false, force = false, version = state.requestVersion } = {}) {
    if (state.isLoadingMore && !reset) {
      return false;
    }
    if (!reset && !state.hasMore) {
      return false;
    }

    const offset = reset ? 0 : state.items.length;
    state.isLoadingMore = !reset;
    if (!reset) {
      elements.scanStatus.hidden = false;
      elements.scanStatusText.textContent = "Đang tải thêm…";
    }

    try {
      const payload = await fetchApiPage({ offset, force, version });
      if (!payload) {
        return false;
      }
      const nextItems = payload.items.map(normalizeApiItem);
      state.items = reset ? nextItems : [...state.items, ...nextItems];
      state.visibleItems = state.items;
      state.total = Number(payload.total) || 0;
      state.stats = payload.stats || null;
      state.hasMore = Boolean(payload.hasMore);
      setMode("api");

      if (reset) {
        clearMediaGrid();
        state.renderedCount = 0;
      }
      renderNextPage(nextItems.length || PAGE_SIZE);
      updateSummary();
      updateEmptyState();
      saveCachedCatalog().catch(() => {});
      return true;
    } finally {
      state.isLoadingMore = false;
      if (!state.isLoading) {
        elements.scanStatus.hidden = true;
      }
    }
  }

  function isInsideAlbum(candidate) {
    const base = new URL(state.baseUrl);
    return (
      candidate.protocol === base.protocol &&
      candidate.hostname === base.hostname &&
      candidate.port === base.port &&
      candidate.pathname.startsWith(base.pathname)
    );
  }

  function parseDirectory(html, directoryUrl) {
    const documentNode = new DOMParser().parseFromString(html, "text/html");
    const directories = [];
    const media = [];

    for (const anchor of documentNode.querySelectorAll("a[href]")) {
      const rawHref = anchor.getAttribute("href") ?? "";
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("?")) {
        continue;
      }

      let candidate;
      try {
        candidate = new URL(rawHref, directoryUrl);
      } catch {
        continue;
      }

      candidate.hash = "";
      candidate.search = "";
      if (!isInsideAlbum(candidate)) {
        continue;
      }

      const currentPath = new URL(directoryUrl).pathname;
      if (candidate.pathname === currentPath || candidate.pathname.length < currentPath.length) {
        continue;
      }

      const decodedParts = safeDecode(candidate.pathname).split("/").filter(Boolean);
      const lastPart = (decodedParts.at(-1) ?? "").toLocaleLowerCase("en");
      const appearsToBeDirectory = rawHref.endsWith("/") || anchor.textContent.trim().endsWith("/");

      if (appearsToBeDirectory) {
        if (!SKIPPED_DIRECTORIES.has(lastPart)) {
          if (!candidate.pathname.endsWith("/")) {
            candidate.pathname += "/";
          }
          directories.push(candidate.href);
        }
        continue;
      }

      const item = directoryItemFromUrl(candidate.href);
      if (item) {
        media.push(item);
      }
    }

    return { directories, media };
  }

  async function fetchDirectory(url, version) {
    const response = await fetchWithTimeout(url, DIRECTORY_TIMEOUT_MS);
    if (version !== state.requestVersion) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return parseDirectory(await response.text(), url);
  }

  async function scanDirectory(version) {
    const pending = [state.baseUrl];
    const queued = new Set(pending);
    const visited = new Set();
    const mediaUrls = new Set();
    let completedDirectories = 0;

    state.items = [];
    state.visibleItems = [];
    state.total = 0;
    state.stats = null;
    state.hasMore = false;
    setMode("directory");

    while (pending.length > 0 && version === state.requestVersion) {
      const batch = pending.splice(0, MAX_CONCURRENT_REQUESTS);
      const results = await Promise.all(batch.map((url) => fetchDirectory(url, version)));

      for (let index = 0; index < batch.length; index += 1) {
        const directoryUrl = batch[index];
        const result = results[index];
        visited.add(directoryUrl);
        completedDirectories += 1;
        if (!result) {
          continue;
        }

        for (const nestedUrl of result.directories) {
          if (!visited.has(nestedUrl) && !queued.has(nestedUrl)) {
            queued.add(nestedUrl);
            pending.push(nestedUrl);
          }
        }

        for (const item of result.media) {
          if (!mediaUrls.has(item.url)) {
            mediaUrls.add(item.url);
            state.items.push(item);
          }
        }
      }

      elements.scanStatusText.textContent =
        `${numberFormatter.format(state.items.length)} mục · ${completedDirectories} thư mục`;
    }

    if (version !== state.requestVersion) {
      return;
    }
    state.total = state.items.length;
    state.stats = {
      total: state.items.length,
      images: state.items.filter((item) => item.type === "image").length,
      videos: state.items.filter((item) => item.type === "video").length,
    };
    refreshDirectoryItems(false);
    saveCachedCatalog().catch(() => {});
  }

  function renderSkeletons() {
    clearMediaGrid();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 10; index += 1) {
      const card = document.createElement("div");
      card.className = "media-card is-skeleton";
      card.setAttribute("aria-hidden", "true");
      const preview = document.createElement("span");
      preview.className = "media-preview";
      const meta = document.createElement("span");
      meta.className = "media-meta";
      const firstLine = document.createElement("span");
      const secondLine = document.createElement("span");
      firstLine.className = "skeleton-line";
      secondLine.className = "skeleton-line";
      meta.append(firstLine, secondLine);
      card.append(preview, meta);
      fragment.append(card);
    }
    elements.mediaGrid.append(fragment);
  }

  function compareDirectoryItems(left, right) {
    const collator = compareDirectoryItems.collator ??= new Intl.Collator("vi", {
      numeric: true,
      sensitivity: "base",
    });
    if (state.sort === "name-desc") {
      return collator.compare(right.name, left.name);
    }
    if (state.sort === "name-asc") {
      return collator.compare(left.name, right.name);
    }
    return collator.compare(left.relative, right.relative);
  }

  function refreshDirectoryItems(keepRenderLimit = false) {
    const normalizedQuery = state.query.trim().toLocaleLowerCase("vi");
    state.visibleItems = state.items
      .filter((item) => state.filter === "all" || item.type === state.filter)
      .filter((item) => !normalizedQuery || `${item.name} ${item.folder}`.toLocaleLowerCase("vi").includes(normalizedQuery))
      .sort(compareDirectoryItems);
    if (state.mode !== "api") {
      state.total = state.visibleItems.length;
    }

    const targetCount = keepRenderLimit ? Math.max(state.renderedCount, PAGE_SIZE) : PAGE_SIZE;
    state.renderedCount = 0;
    clearMediaGrid();
    renderNextPage(targetCount);
    updateSummary();
    updateEmptyState();
  }

  async function thumbnailSources(item) {
    if (item.source === "directory") {
      let hashedThumbnail = null;
      try {
        hashedThumbnail = await makeHashedDirectoryThumbnailUrl(item.relative);
      } catch {
        // The mirrored _thumbnails layout remains a fallback for older setups.
      }
      return [hashedThumbnail, item.type === "image" ? item.thumbnailFallback : null].filter(Boolean);
    }

    if (!item.thumbnail) {
      return [];
    }
    return [item.thumbnail];
  }

  function releaseThumbnailImage(image) {
    thumbnailObserver?.unobserve(image);
    image.albumThumbnailAbort?.abort();
    image.albumThumbnailAbort = null;
    if (image.albumThumbnailObjectUrl) {
      URL.revokeObjectURL(image.albumThumbnailObjectUrl);
      image.albumThumbnailObjectUrl = null;
    }
    image.removeAttribute("src");
    image.albumThumbnail = null;
  }

  function clearMediaGrid() {
    for (const image of elements.mediaGrid.querySelectorAll(".media-preview img")) {
      releaseThumbnailImage(image);
    }
    elements.mediaGrid.replaceChildren();
  }

  function showThumbnailBlob(image, blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      image.albumThumbnailObjectUrl = objectUrl;

      const releaseObjectUrl = () => {
        if (image.albumThumbnailObjectUrl === objectUrl) {
          URL.revokeObjectURL(objectUrl);
          image.albumThumbnailObjectUrl = null;
        }
      };
      image.addEventListener("load", () => {
        releaseObjectUrl();
        resolve();
      }, { once: true });
      image.addEventListener("error", () => {
        releaseObjectUrl();
        reject(new Error("Thumbnail không hợp lệ"));
      }, { once: true });
      image.src = objectUrl;
    });
  }

  async function loadThumbnailImage(image, preview, item) {
    const controller = new AbortController();
    image.albumThumbnailAbort = controller;
    try {
      const fallbacks = await thumbnailSources(item);
      for (const url of fallbacks) {
        try {
          const blob = await loadThumbnailBlob(url, controller.signal);
          if (!image.isConnected || controller.signal.aborted) {
            return;
          }
          await showThumbnailBlob(image, blob);
          image.albumThumbnailAbort = null;
          return;
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }
        }
      }

      releaseThumbnailImage(image);
      image.remove();
      if (item.type === "video") {
        preview.classList.add("video-preview");
      }
    } catch {
      releaseThumbnailImage(image);
      image.remove();
      if (item.type === "video") {
        preview.classList.add("video-preview");
      }
    }
  }

  function addPreviewImage(preview, item) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.albumThumbnail = { preview, item };
    preview.prepend(image);

    if (thumbnailObserver) {
      thumbnailObserver.observe(image);
    } else {
      loadThumbnailImage(image, preview, item);
    }
  }

  function createMediaCard(item, index) {
    const fragment = elements.mediaCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".media-card");
    const preview = fragment.querySelector(".media-preview");
    const name = fragment.querySelector(".media-name");
    const folder = fragment.querySelector(".media-folder");
    const detail = fragment.querySelector(".media-detail");

    card.dataset.index = String(index);
    card.setAttribute("aria-label", `Mở ${item.name}`);
    name.textContent = item.name;
    folder.textContent = item.folder;
    detail.textContent = itemDetail(item);

    const typeBadge = document.createElement("span");
    typeBadge.className = "media-type";
    typeBadge.textContent = item.extension;
    preview.append(typeBadge);
    addPreviewImage(preview, item);

    return fragment;
  }

  function renderNextPage(targetCount = PAGE_SIZE) {
    if (state.renderedCount >= state.visibleItems.length) {
      return;
    }
    const end = Math.min(state.renderedCount + targetCount, state.visibleItems.length);
    const fragment = document.createDocumentFragment();
    for (let index = state.renderedCount; index < end; index += 1) {
      fragment.append(createMediaCard(state.visibleItems[index], index));
    }
    elements.mediaGrid.append(fragment);
    state.renderedCount = end;
  }

  function updateSummary() {
    if (!state.endpoint) {
      elements.albumSummary.textContent = "Nhập IP và cổng của máy lưu album để bắt đầu.";
      return;
    }

    const stats = state.stats || { images: 0, videos: 0 };
    const baseSummary = `${numberFormatter.format(stats.images || 0)} ảnh · ${numberFormatter.format(stats.videos || 0)} video`;
    const hasActiveQuery = state.filter !== "all" || Boolean(state.query.trim());
    elements.albumSummary.textContent = hasActiveQuery
      ? `${numberFormatter.format(state.total)} kết quả · ${baseSummary}`
      : baseSummary;
  }

  function updateEmptyState() {
    const hasVisibleItems = state.visibleItems.length > 0;
    elements.emptyState.hidden = hasVisibleItems || state.isLoading;
    elements.emptyConnect.textContent = state.endpoint ? "Đổi IP và cổng" : "Nhập IP và cổng";
    if (state.endpoint && state.mode && !hasVisibleItems) {
      elements.emptyTitle.textContent = "Không có kết quả";
      elements.emptyCopy.textContent = "Thử từ khóa khác, đổi bộ lọc hoặc làm mới album.";
    } else {
      elements.emptyTitle.textContent = "Chưa có nội dung";
      elements.emptyCopy.textContent = "Kết nối tới máy lưu album để xem ảnh và video.";
    }
  }

  function releaseViewerMedia() {
    state.viewerLoadToken += 1;
    state.viewerAbortController?.abort();
    state.viewerAbortController = null;
    clearTimeout(state.viewerCacheTimer);
    state.viewerCacheTimer = null;

    const video = elements.viewerStage.querySelector("video");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    const image = elements.viewerStage.querySelector("img");
    image?.removeAttribute("src");

    if (state.viewerObjectUrl) {
      URL.revokeObjectURL(state.viewerObjectUrl);
    }
    state.viewerObjectUrl = null;
    state.viewerBlob = null;
    state.viewerCacheUrl = null;
    if (elements.viewerOfflineStatus) {
      elements.viewerOfflineStatus.hidden = true;
    }
    elements.viewerStage.replaceChildren();
  }

  function renderViewerLoading() {
    const loader = document.createElement("span");
    loader.className = "viewer-loader";
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-label", "Đang tải ảnh");
    elements.viewerStage.replaceChildren(loader);
  }

  function renderViewerError(index) {
    const error = document.createElement("div");
    error.className = "viewer-error";
    const message = document.createElement("p");
    message.textContent = "Không tải được nội dung này.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button button-dark";
    retry.textContent = "Thử lại";
    retry.addEventListener("click", () => showViewer(index));
    error.append(message, retry);
    elements.viewerStage.replaceChildren(error);
  }

  async function loadViewerImage(item, index, token) {
    const viewUrl = item.preview || item.url;
    const controller = new AbortController();
    state.viewerAbortController = controller;

    try {
      let blob = null;
      let fromCache = false;
      try {
        blob = await readCachedBlob(VIEWED_IMAGE_CACHE_NAME, viewUrl);
        fromCache = Boolean(blob);
      } catch {
        // Cache failures should not prevent a normal LAN request.
      }

      if (!blob) {
        const response = await fetchMediaResponse(viewUrl, controller.signal);
        blob = await response.blob();
      }
      if (token !== state.viewerLoadToken || controller.signal.aborted) {
        return;
      }

      state.viewerAbortController = null;
      state.viewerBlob = blob;
      state.viewerCacheUrl = viewUrl;
      state.viewerObjectUrl = URL.createObjectURL(blob);

      const image = document.createElement("img");
      image.alt = item.name;
      image.decoding = "async";
      image.addEventListener("load", () => {
        if (token !== state.viewerLoadToken) {
          return;
        }
        if (fromCache) {
          touchViewedImageCache(viewUrl, blob.size);
          if (elements.viewerOfflineStatus) {
            elements.viewerOfflineStatus.hidden = false;
          }
          return;
        }

        state.viewerCacheTimer = window.setTimeout(async () => {
          state.viewerCacheTimer = null;
          if (token !== state.viewerLoadToken || state.viewerCacheUrl !== viewUrl || state.viewerBlob !== blob) {
            return;
          }
          try {
            const stored = await storeViewedImage(viewUrl, blob);
            if (stored && token === state.viewerLoadToken && elements.viewerOfflineStatus) {
              elements.viewerOfflineStatus.hidden = false;
            }
          } catch {
            // Quota and browser policy errors leave the current viewer unaffected.
          }
        }, VIEWER_CACHE_DELAY_MS);
      }, { once: true });
      image.addEventListener("error", () => {
        if (token === state.viewerLoadToken) {
          image.removeAttribute("src");
          if (state.viewerObjectUrl) {
            URL.revokeObjectURL(state.viewerObjectUrl);
          }
          state.viewerObjectUrl = null;
          state.viewerBlob = null;
          state.viewerCacheUrl = null;
          renderViewerError(index);
        }
      }, { once: true });
      image.src = state.viewerObjectUrl;
      elements.viewerStage.replaceChildren(image);
    } catch (error) {
      if (error?.name !== "AbortError" && token === state.viewerLoadToken) {
        state.viewerAbortController = null;
        renderViewerError(index);
      }
    }
  }

  function showViewer(index) {
    const item = state.visibleItems[index];
    if (!item) {
      return;
    }

    releaseViewerMedia();
    state.viewerIndex = index;
    const token = state.viewerLoadToken;
    const viewerTotal = state.mode === "api" ? state.total : state.visibleItems.length;
    elements.viewerName.textContent = item.name;
    elements.viewerFolder.textContent = item.folder;
    elements.viewerDetails.textContent = itemDetail(item) || item.extension.toUpperCase();
    elements.viewerOpenOriginal.href = item.url;
    elements.viewerCount.textContent = `${numberFormatter.format(index + 1)} / ${numberFormatter.format(viewerTotal)}`;
    elements.viewerPrevious.disabled = index === 0;
    elements.viewerNext.disabled = index >= viewerTotal - 1;

    if (!elements.viewerDialog.open) {
      elements.viewerDialog.showModal();
    }

    if (item.type === "image") {
      renderViewerLoading();
      loadViewerImage(item, index, token);
    } else {
      const video = document.createElement("video");
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = item.url;
      elements.viewerStage.append(video);
    }
  }

  async function moveViewer(offset) {
    let nextIndex = state.viewerIndex + offset;
    if (offset > 0 && nextIndex >= state.visibleItems.length && state.mode === "api" && state.hasMore) {
      try {
        await loadApiPage();
      } catch (error) {
        showConnectionError(error);
        elements.scanStatus.hidden = true;
        return;
      }
      nextIndex = state.viewerIndex + offset;
    }
    if (nextIndex >= 0 && nextIndex < state.visibleItems.length) {
      showViewer(nextIndex);
    }
  }

  function closeViewer() {
    releaseViewerMedia();
    state.viewerIndex = -1;
    if (elements.viewerDialog.open) {
      elements.viewerDialog.close();
    }
  }

  function resetAlbumState() {
    closeViewer();
    state.items = [];
    state.visibleItems = [];
    state.total = 0;
    state.stats = null;
    state.hasMore = false;
    state.renderedCount = 0;
    state.viewerIndex = -1;
    state.isLoadingMore = false;
    clearMediaGrid();
    setMode(null);
  }

  async function connectAlbum({ force = false } = {}) {
    if (!state.endpoint) {
      showConnectionDialog();
      return;
    }

    state.requestVersion += 1;
    const version = state.requestVersion;
    resetAlbumState();
    hideNotice();
    renderSkeletons();
    setLoading(true, "Đang tìm server LAN…");

    try {
      try {
        await probeApi();
        if (version !== state.requestVersion) {
          return;
        }
        elements.scanStatusText.textContent = "Đang lập chỉ mục album…";
        await loadApiPage({ reset: true, force, version });
      } catch (error) {
        if (!(error instanceof ApiUnavailableError)) {
          throw error;
        }
        elements.scanStatusText.textContent = "Đang quét thư mục…";
        await scanDirectory(version);
      }

      if (version === state.requestVersion) {
        hideNotice();
      }
    } catch (error) {
      if (version !== state.requestVersion) {
        return;
      }
      resetAlbumState();
      if (await restoreCachedCatalog()) {
        showOfflineNotice(error);
      } else {
        showConnectionError(error);
      }
    } finally {
      if (version === state.requestVersion) {
        setLoading(false);
        updateSummary();
        updateEmptyState();
      }
    }
  }

  let controlTimer = null;

  function reloadFromControls() {
    clearTimeout(controlTimer);
    if (state.mode === "api") {
      controlTimer = setTimeout(async () => {
        state.requestVersion += 1;
        const version = state.requestVersion;
        closeViewer();
        state.items = [];
        state.visibleItems = [];
        state.total = 0;
        state.hasMore = false;
        state.renderedCount = 0;
        renderSkeletons();
        setLoading(true, "Đang cập nhật kết quả…");
        try {
          await loadApiPage({ reset: true, version });
          hideNotice();
        } catch (error) {
          if (version === state.requestVersion) {
            resetAlbumState();
            if (await restoreCachedCatalog()) {
              showOfflineNotice(error);
            } else {
              showConnectionError(error);
            }
          }
        } finally {
          if (version === state.requestVersion) {
            setLoading(false);
            updateSummary();
            updateEmptyState();
          }
        }
      }, 280);
    } else if (state.mode === "directory" || state.mode === "offline") {
      refreshDirectoryItems(false);
    }
  }

  function applyEndpoint(endpoint) {
    state.endpoint = endpoint;
    state.baseUrl = endpointUrl(endpoint);
    elements.endpointLabel.textContent = `${endpoint.ip}:${endpoint.port}`;
    elements.openDirect.hidden = false;
    elements.changeEndpoint.textContent = "Đổi máy";
    connectAlbum();
  }

  elements.connectionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const endpoint = validateEndpoint(elements.ipInput.value, elements.portInput.value);
      saveEndpoint(endpoint);
      closeConnectionDialog();
      applyEndpoint(endpoint);
    } catch (error) {
      elements.formError.textContent = error.message;
      elements.formError.hidden = false;
    }
  });

  for (const closeButton of document.querySelectorAll("[data-close-dialog]")) {
    closeButton.addEventListener("click", closeConnectionDialog);
  }

  elements.changeEndpoint.addEventListener("click", showConnectionDialog);
  elements.emptyConnect.addEventListener("click", showConnectionDialog);
  elements.openDirect.addEventListener("click", openDirectly);
  elements.noticeOpenDirect.addEventListener("click", openDirectly);
  elements.retryButton.addEventListener("click", () => connectAlbum());
  elements.refreshButton.addEventListener("click", () => connectAlbum({ force: true }));

  elements.searchInput.addEventListener("input", () => {
    state.query = elements.searchInput.value;
    reloadFromControls();
  });

  for (const button of elements.filterButtons) {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      elements.filterButtons.forEach((filterButton) => filterButton.classList.toggle("is-active", filterButton === button));
      reloadFromControls();
    });
  }

  elements.sortSelect.addEventListener("change", () => {
    state.sort = elements.sortSelect.value;
    reloadFromControls();
  });

  elements.sizeInput.addEventListener("input", () => {
    document.documentElement.style.setProperty("--tile-size", `${elements.sizeInput.value}px`);
  });

  elements.mediaGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".media-card:not(.is-skeleton)");
    if (card) {
      showViewer(Number(card.dataset.index));
    }
  });

  elements.viewerClose.addEventListener("click", closeViewer);
  elements.viewerPrevious.addEventListener("click", () => moveViewer(-1));
  elements.viewerNext.addEventListener("click", () => moveViewer(1));
  elements.viewerDialog.addEventListener("click", (event) => {
    if (event.target === elements.viewerDialog) {
      closeViewer();
    }
  });
  elements.viewerDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeViewer();
  });

  document.addEventListener("keydown", (event) => {
    if (!elements.viewerDialog.open) {
      return;
    }
    if (event.key === "ArrowLeft") {
      moveViewer(-1);
    } else if (event.key === "ArrowRight") {
      moveViewer(1);
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || state.isLoading) {
        return;
      }
      if (state.mode === "api") {
        loadApiPage().catch((error) => {
          showConnectionError(error);
          elements.scanStatus.hidden = true;
        });
      } else if (state.mode === "directory" || state.mode === "offline") {
        renderNextPage();
      }
    },
    { rootMargin: "500px 0px" },
  );
  observer.observe(elements.loadSentinel);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" }).catch(() => {});
    }, { once: true });
  }

  const savedEndpoint = readSavedEndpoint();
  if (savedEndpoint) {
    applyEndpoint(savedEndpoint);
  } else {
    updateSummary();
    updateEmptyState();
    showConnectionDialog();
  }
})();
