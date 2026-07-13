(() => {
  "use strict";

  const STORAGE_KEY = "my-album-endpoint-v1";
  const PAGE_SIZE = 80;
  const MAX_CONCURRENT_REQUESTS = 4;
  const REQUEST_TIMEOUT_MS = 12000;
  const IMAGE_EXTENSIONS = new Set([
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif",
  ]);
  const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "avi", "mkv"]);
  const SKIPPED_DIRECTORIES = new Set(["_thumbnails", ".my-album-cache", "__pycache__"]);

  const state = {
    endpoint: null,
    baseUrl: "",
    items: [],
    visibleItems: [],
    filter: "all",
    query: "",
    sort: "path-asc",
    renderedCount: 0,
    scanId: 0,
    isScanning: false,
    viewerIndex: -1,
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
    scanStatus: document.querySelector("#scan-status"),
    scanStatusText: document.querySelector("#scan-status-text"),
    mediaGrid: document.querySelector("#media-grid"),
    emptyState: document.querySelector("#empty-state"),
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
    viewerOpenOriginal: document.querySelector("#viewer-open-original"),
    viewerClose: document.querySelector("#viewer-close"),
    viewerPrevious: document.querySelector("#viewer-previous"),
    viewerNext: document.querySelector("#viewer-next"),
    viewerStage: document.querySelector("#viewer-stage"),
    viewerCount: document.querySelector("#viewer-count"),
    mediaCardTemplate: document.querySelector("#media-card-template"),
  };

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

  function setScanning(isScanning, message = "Đang quét…") {
    state.isScanning = isScanning;
    elements.scanStatus.hidden = !isScanning;
    elements.scanStatusText.textContent = message;
  }

  function hideNotice() {
    elements.connectionNotice.hidden = true;
  }

  function showConnectionError(error) {
    const detail = error instanceof Error ? error.message : String(error);
    elements.noticeTitle.textContent = "Trình duyệt chưa đọc được album";
    elements.noticeMessage.textContent =
      `Không thể tải ${state.baseUrl} (${detail}). Hãy chắc rằng máy Windows và thiết bị này cùng mạng, ` +
      "server vẫn đang chạy, rồi cấp quyền truy cập mạng nội bộ nếu trình duyệt hỏi. Nếu server không hỗ trợ CORS, bạn vẫn có thể mở thư mục trực tiếp.";
    elements.connectionNotice.hidden = false;
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

  function makeThumbnailUrl(relative) {
    const base = new URL(state.baseUrl);
    const encoded = relative
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return new URL(`_thumbnails/${encoded}.jpg`, base).href;
  }

  function itemFromUrl(url) {
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
      url,
      type,
      extension,
      relative,
      name,
      folder,
      thumbnail: type === "image" ? makeThumbnailUrl(relative) : null,
    };
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
      const lastPart = decodedParts.at(-1) ?? "";
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

      const item = itemFromUrl(candidate.href);
      if (item) {
        media.push(item);
      }
    }

    return { directories, media };
  }

  async function fetchDirectory(url, scanId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        cache: "no-store",
        mode: "cors",
        signal: controller.signal,
        targetAddressSpace: "local",
      });
      if (scanId !== state.scanId) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const html = await response.text();
      return parseDirectory(html, url);
    } finally {
      clearTimeout(timeout);
    }
  }

  let refreshTimer = null;

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refreshVisibleItems(false), 120);
  }

  async function scanAlbum() {
    if (!state.endpoint) {
      showConnectionDialog();
      return;
    }

    state.scanId += 1;
    const scanId = state.scanId;
    state.items = [];
    state.visibleItems = [];
    state.renderedCount = 0;
    elements.mediaGrid.replaceChildren();
    hideNotice();
    updateEmptyState();
    setScanning(true, "Đang kết nối…");

    const pending = [state.baseUrl];
    const queued = new Set(pending);
    const visited = new Set();
    const mediaUrls = new Set();
    let completedDirectories = 0;

    try {
      while (pending.length > 0 && scanId === state.scanId) {
        const batch = pending.splice(0, MAX_CONCURRENT_REQUESTS);
        const results = await Promise.all(batch.map((url) => fetchDirectory(url, scanId)));

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
          `${state.items.length.toLocaleString("vi-VN")} mục · ${completedDirectories} thư mục`;
        scheduleRefresh();
      }

      if (scanId === state.scanId) {
        clearTimeout(refreshTimer);
        refreshVisibleItems(false);
        setScanning(false);
      }
    } catch (error) {
      if (scanId !== state.scanId) {
        return;
      }
      clearTimeout(refreshTimer);
      setScanning(false);
      refreshVisibleItems(false);
      showConnectionError(error);
    }
  }

  function compareItems(left, right) {
    const collator = compareItems.collator ??= new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
    if (state.sort === "name-asc") {
      return collator.compare(left.name, right.name);
    }
    if (state.sort === "name-desc") {
      return collator.compare(right.name, left.name);
    }
    return collator.compare(left.relative, right.relative);
  }

  function refreshVisibleItems(keepRenderLimit = false) {
    const normalizedQuery = state.query.trim().toLocaleLowerCase("vi");
    state.visibleItems = state.items
      .filter((item) => state.filter === "all" || item.type === state.filter)
      .filter((item) => !normalizedQuery || `${item.name} ${item.folder}`.toLocaleLowerCase("vi").includes(normalizedQuery))
      .sort(compareItems);

    const targetCount = keepRenderLimit ? Math.max(state.renderedCount, PAGE_SIZE) : PAGE_SIZE;
    state.renderedCount = 0;
    elements.mediaGrid.replaceChildren();
    renderNextPage(targetCount);
    updateSummary();
    updateEmptyState();
  }

  function createMediaCard(item, index) {
    const fragment = elements.mediaCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".media-card");
    const preview = fragment.querySelector(".media-preview");
    const name = fragment.querySelector(".media-name");
    const folder = fragment.querySelector(".media-folder");

    card.dataset.index = String(index);
    card.setAttribute("aria-label", `Mở ${item.name}`);
    name.textContent = item.name;
    folder.textContent = item.folder;

    const typeBadge = document.createElement("span");
    typeBadge.className = "media-type";
    typeBadge.textContent = item.extension;
    preview.append(typeBadge);

    if (item.type === "image") {
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.src = item.thumbnail;
      image.addEventListener(
        "error",
        () => {
          if (image.src !== item.url) {
            image.src = item.url;
          }
        },
        { once: true },
      );
      preview.prepend(image);
    } else {
      preview.classList.add("video-preview");
    }

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

    const imageCount = state.items.filter((item) => item.type === "image").length;
    const videoCount = state.items.length - imageCount;
    const filtered = state.visibleItems.length !== state.items.length ? ` · đang hiện ${state.visibleItems.length.toLocaleString("vi-VN")}` : "";
    elements.albumSummary.textContent =
      `${imageCount.toLocaleString("vi-VN")} ảnh · ${videoCount.toLocaleString("vi-VN")} video${filtered}`;
  }

  function updateEmptyState() {
    const hasVisibleItems = state.visibleItems.length > 0;
    elements.emptyState.hidden = hasVisibleItems || state.isScanning;
    elements.emptyConnect.textContent = state.endpoint ? "Đổi IP và cổng" : "Nhập IP và cổng";
  }

  function showViewer(index) {
    const item = state.visibleItems[index];
    if (!item) {
      return;
    }

    state.viewerIndex = index;
    elements.viewerStage.replaceChildren();
    elements.viewerName.textContent = item.name;
    elements.viewerFolder.textContent = item.folder;
    elements.viewerOpenOriginal.href = item.url;
    elements.viewerCount.textContent = `${index + 1} / ${state.visibleItems.length}`;
    elements.viewerPrevious.disabled = index === 0;
    elements.viewerNext.disabled = index === state.visibleItems.length - 1;

    if (item.type === "image") {
      const image = document.createElement("img");
      image.alt = item.name;
      image.src = item.url;
      elements.viewerStage.append(image);
    } else {
      const video = document.createElement("video");
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = item.url;
      elements.viewerStage.append(video);
    }

    if (!elements.viewerDialog.open) {
      elements.viewerDialog.showModal();
    }
  }

  function moveViewer(offset) {
    const nextIndex = state.viewerIndex + offset;
    if (nextIndex >= 0 && nextIndex < state.visibleItems.length) {
      showViewer(nextIndex);
    }
  }

  function closeViewer() {
    elements.viewerStage.replaceChildren();
    if (elements.viewerDialog.open) {
      elements.viewerDialog.close();
    }
  }

  function applyEndpoint(endpoint) {
    state.endpoint = endpoint;
    state.baseUrl = endpointUrl(endpoint);
    elements.endpointLabel.textContent = `${endpoint.ip}:${endpoint.port}`;
    elements.openDirect.hidden = false;
    elements.changeEndpoint.textContent = "Đổi máy";
    scanAlbum();
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
  elements.retryButton.addEventListener("click", scanAlbum);

  elements.searchInput.addEventListener("input", () => {
    state.query = elements.searchInput.value;
    refreshVisibleItems(false);
  });

  for (const button of elements.filterButtons) {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      elements.filterButtons.forEach((filterButton) => filterButton.classList.toggle("is-active", filterButton === button));
      refreshVisibleItems(false);
    });
  }

  elements.sortSelect.addEventListener("change", () => {
    state.sort = elements.sortSelect.value;
    refreshVisibleItems(true);
  });

  elements.sizeInput.addEventListener("input", () => {
    document.documentElement.style.setProperty("--tile-size", `${elements.sizeInput.value}px`);
  });

  elements.mediaGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".media-card");
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
      if (entries.some((entry) => entry.isIntersecting)) {
        renderNextPage();
      }
    },
    { rootMargin: "500px 0px" },
  );
  observer.observe(elements.loadSentinel);

  const savedEndpoint = readSavedEndpoint();
  if (savedEndpoint) {
    applyEndpoint(savedEndpoint);
  } else {
    updateSummary();
    updateEmptyState();
    showConnectionDialog();
  }
})();
