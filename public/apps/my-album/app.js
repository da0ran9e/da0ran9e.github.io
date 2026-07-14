(async () => {
  "use strict";

  const CLOUD_ALBUM_URL = "https://photos.vuducan.qzz.io/";
  const CLOUD_ENDPOINT = Object.freeze({
    url: CLOUD_ALBUM_URL,
    label: "photos.vuducan.qzz.io",
    kind: "cloud",
  });
  const HIDDEN_ITEMS_STORAGE_KEY = "my-album-hidden-items-v1";
  const HIDDEN_ITEM_SNAPSHOTS_STORAGE_KEY = "my-album-hidden-item-snapshots-v1";
  const FAVORITE_ITEMS_STORAGE_KEY = "my-album-favorite-items-v1";
  const CUSTOM_COLLECTIONS_STORAGE_KEY = "my-album-custom-collections-v1";
  const THEME_STORAGE_KEY = "my-album-theme-v1";
  const TILE_SIZE_STORAGE_KEY = "my-album-tile-size-v1";
  const PAGE_SIZE = 80;
  const CATALOG_PAGE_SIZE = 200;
  const MAX_CONCURRENT_REQUESTS = 4;
  const MAX_FOLDER_SUMMARY_REQUESTS = 4;
  const PROBE_TIMEOUT_MS = 10000;
  const API_TIMEOUT_MS = 120000;
  const DIRECTORY_TIMEOUT_MS = 15000;
  const VIEWER_CACHE_DELAY_MS = 8000;
  const VIEWED_IMAGE_CACHE_MAX_BYTES = 512 * 1024 * 1024;
  const THUMBNAIL_CACHE_NAME = "my-album-thumbnails-v1";
  const VIEWED_IMAGE_CACHE_NAME = "my-album-viewed-images-v1";
  const CATALOG_CACHE_NAME = "my-album-catalog-v1";
  const IMPORTED_METADATA_CACHE_NAME = "my-album-imported-metadata-v1";
  const IMPORTED_METADATA_CACHE_VERSION = 1;
  const VIEWED_IMAGE_CACHE_INDEX_KEY = "my-album-viewed-images-index-v1";
  const SMART_EVENT_GAP_SECONDS = 36 * 60 * 60;
  const SMART_EVENT_MAX_SPAN_SECONDS = 5 * 24 * 60 * 60;
  const MAPLIBRE_CSS_URL = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css";
  const MAPLIBRE_JS_URL = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js";
  const OPEN_FREE_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
  const IMAGE_EXTENSIONS = new Set([
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif",
  ]);
  const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "avi", "mkv"]);
  const ALLOWED_METADATA_FIELDS = new Set([
    "make", "model", "camera", "lens", "iso", "aperture", "shutter", "focalLength",
    "flash", "duration", "frameRate", "title", "description", "rating", "width", "height",
    "latitude", "longitude", "altitude",
  ]);
  const SKIPPED_DIRECTORIES = new Set([
    "thumbs", "_thumbnails", "_my-album", ".my-album-cache", "__pycache__",
  ]);

  class ApiUnavailableError extends Error {}

  function emptyFacets() {
    return {
      folders: [],
      dates: [],
      cameras: [],
      locations: { with: 0, without: 0 },
      metadata: 0,
    };
  }

  function emptyTimelineFilters() {
    return { folder: "", camera: "", location: "", year: "", month: "", day: "" };
  }

  const state = {
    endpoint: null,
    baseUrl: "",
    mode: null,
    items: [],
    visibleItems: [],
    total: 0,
    stats: null,
    facets: emptyFacets(),
    folderFacets: emptyFacets(),
    hasMore: false,
    filter: "all",
    view: "library",
    query: "",
    sort: "newest",
    timelineFilters: emptyTimelineFilters(),
    metadataStatus: { available: false, items: 0, generatedAt: "" },
    serverMetadataStatus: { available: false, items: 0, generatedAt: "" },
    localMetadataStatus: {
      available: false,
      items: 0,
      generatedAt: "",
      importedAt: 0,
      fileName: "",
      bytes: 0,
    },
    localMetadataByPath: new Map(),
    clientCatalogComplete: false,
    albumMetaToken: 0,
    metadataImporting: false,
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
    hiddenIds: new Set(),
    hiddenItems: new Map(),
    favoriteItems: new Map(),
    customCollections: new Map(),
    activeCollectionId: "",
    activeEventId: "",
    albumViewCounts: { folders: 0, collections: 0, events: 0 },
    folderSummaries: new Map(),
    folderViewCount: 0,
    selectedIds: new Set(),
    selectionMode: false,
    lastSelectedIndex: -1,
    isDownloading: false,
    downloadAbortController: null,
    toastTimer: null,
    isLocalServer: false,
    map: null,
    mapReady: false,
    mapItems: [],
    mapRenderToken: 0,
    mapLastDataKey: "",
  };

  const elements = {
    endpointLabel: document.querySelector("#endpoint-label"),
    metadataButton: document.querySelector("#metadata-button"),
    metadataButtonIndicator: document.querySelector("#metadata-button-indicator"),
    metadataDialog: document.querySelector("#metadata-dialog"),
    metadataClose: document.querySelector("#metadata-close"),
    metadataStatusTitle: document.querySelector("#metadata-status-title"),
    metadataStatusDetail: document.querySelector("#metadata-status-detail"),
    metadataProgress: document.querySelector("#metadata-progress"),
    metadataProgressText: document.querySelector("#metadata-progress-text"),
    metadataProgressValue: document.querySelector("#metadata-progress-value"),
    metadataProgressBar: document.querySelector("#metadata-progress-bar"),
    metadataFileInput: document.querySelector("#metadata-file-input"),
    metadataImport: document.querySelector("#metadata-import"),
    metadataExport: document.querySelector("#metadata-export"),
    metadataRemove: document.querySelector("#metadata-remove"),
    themeToggle: document.querySelector("#theme-toggle"),
    searchInput: document.querySelector("#search-input"),
    navigationButtons: [...document.querySelectorAll("[data-library-nav]")],
    hiddenCount: document.querySelector("#hidden-count"),
    favoriteCount: document.querySelector("#favorite-count"),
    filterButtons: [...document.querySelectorAll("[data-filter]")],
    mediaFilterGroup: document.querySelector("#media-filter-group"),
    sortSelect: document.querySelector("#sort-select"),
    sortField: document.querySelector("#sort-field"),
    timelineFilterButton: document.querySelector("#timeline-filter-button"),
    timelineFilterCount: document.querySelector("#timeline-filter-count"),
    sizeInput: document.querySelector("#size-input"),
    sizeField: document.querySelector("#size-field"),
    libraryToolbar: document.querySelector(".library-toolbar"),
    activeFilters: document.querySelector("#active-filters"),
    timelineRail: document.querySelector("#timeline-rail"),
    mapView: document.querySelector("#map-view"),
    mapCanvas: document.querySelector("#map-canvas"),
    mapEmpty: document.querySelector("#map-empty"),
    mapItemCount: document.querySelector("#map-item-count"),
    connectionNotice: document.querySelector("#connection-notice"),
    noticeTitle: document.querySelector("#notice-title"),
    noticeMessage: document.querySelector("#notice-message"),
    retryButton: document.querySelector("#retry-button"),
    albumSummary: document.querySelector("#album-summary"),
    albumTitle: document.querySelector("#album-title"),
    connectionMode: document.querySelector("#connection-mode"),
    scanStatus: document.querySelector("#scan-status"),
    scanStatusText: document.querySelector("#scan-status-text"),
    refreshButton: document.querySelector("#refresh-button"),
    selectButton: document.querySelector("#select-button"),
    mediaGrid: document.querySelector("#media-grid"),
    emptyState: document.querySelector("#empty-state"),
    emptyTitle: document.querySelector("#empty-state h2"),
    emptyCopy: document.querySelector("#empty-state p"),
    emptyConnect: document.querySelector("#empty-connect"),
    loadSentinel: document.querySelector("#load-sentinel"),
    filterDialog: document.querySelector("#filter-dialog"),
    filterForm: document.querySelector("#filter-form"),
    filterClose: document.querySelector("#filter-close"),
    filterReset: document.querySelector("#filter-reset"),
    folderFilter: document.querySelector("#folder-filter"),
    cameraFilter: document.querySelector("#camera-filter"),
    locationFilter: document.querySelector("#location-filter"),
    yearFilter: document.querySelector("#year-filter"),
    monthFilter: document.querySelector("#month-filter"),
    dayFilter: document.querySelector("#day-filter"),
    viewerDialog: document.querySelector("#viewer-dialog"),
    viewerShell: document.querySelector("#viewer-shell"),
    viewerName: document.querySelector("#viewer-name"),
    viewerFolder: document.querySelector("#viewer-folder"),
    viewerInfoName: document.querySelector("#viewer-info-name"),
    viewerInfoFolder: document.querySelector("#viewer-info-folder"),
    viewerInfoDate: document.querySelector("#viewer-info-date"),
    viewerInfoModified: document.querySelector("#viewer-info-modified"),
    viewerInfoSize: document.querySelector("#viewer-info-size"),
    viewerInfoType: document.querySelector("#viewer-info-type"),
    viewerInfoCapturedRow: document.querySelector("#viewer-info-captured-row"),
    viewerInfoDimensionsRow: document.querySelector("#viewer-info-dimensions-row"),
    viewerInfoDimensions: document.querySelector("#viewer-info-dimensions"),
    viewerInfoCameraRow: document.querySelector("#viewer-info-camera-row"),
    viewerInfoCamera: document.querySelector("#viewer-info-camera"),
    viewerInfoLensRow: document.querySelector("#viewer-info-lens-row"),
    viewerInfoLens: document.querySelector("#viewer-info-lens"),
    viewerInfoSettingsRow: document.querySelector("#viewer-info-settings-row"),
    viewerInfoSettings: document.querySelector("#viewer-info-settings"),
    viewerInfoDurationRow: document.querySelector("#viewer-info-duration-row"),
    viewerInfoDuration: document.querySelector("#viewer-info-duration"),
    viewerInfoLocationRow: document.querySelector("#viewer-info-location-row"),
    viewerInfoLocation: document.querySelector("#viewer-info-location"),
    viewerInfoDescriptionRow: document.querySelector("#viewer-info-description-row"),
    viewerInfoDescription: document.querySelector("#viewer-info-description"),
    viewerFavorite: document.querySelector("#viewer-favorite"),
    viewerHide: document.querySelector("#viewer-hide"),
    viewerInfoToggle: document.querySelector("#viewer-info-toggle"),
    viewerInfoClose: document.querySelector("#viewer-info-close"),
    viewerOpenOriginal: document.querySelector("#viewer-open-original"),
    viewerClose: document.querySelector("#viewer-close"),
    viewerPrevious: document.querySelector("#viewer-previous"),
    viewerNext: document.querySelector("#viewer-next"),
    viewerStage: document.querySelector("#viewer-stage"),
    viewerCount: document.querySelector("#viewer-count"),
    viewerOfflineStatus: document.querySelector("#viewer-offline-status"),
    viewerDownload: document.querySelector("#viewer-download"),
    selectionBar: document.querySelector("#selection-bar"),
    selectionCancel: document.querySelector("#selection-cancel"),
    selectionCount: document.querySelector("#selection-count"),
    selectionProgress: document.querySelector("#selection-progress"),
    selectionProgressBar: document.querySelector("#selection-progress-bar"),
    selectAllButton: document.querySelector("#select-all-button"),
    collectionSelected: document.querySelector("#collection-selected"),
    favoriteSelected: document.querySelector("#favorite-selected"),
    downloadSelected: document.querySelector("#download-selected"),
    hideSelected: document.querySelector("#hide-selected"),
    restoreSelected: document.querySelector("#restore-selected"),
    collectionDialog: document.querySelector("#collection-dialog"),
    collectionForm: document.querySelector("#collection-form"),
    collectionClose: document.querySelector("#collection-close"),
    collectionCancel: document.querySelector("#collection-cancel"),
    collectionSelect: document.querySelector("#collection-select"),
    collectionName: document.querySelector("#collection-name"),
    toast: document.querySelector("#toast"),
    mediaCardTemplate: document.querySelector("#media-card-template"),
  };

  const numberFormatter = new Intl.NumberFormat("vi-VN");
  const textEncoder = new TextEncoder();
  const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const dateTimeFormatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const timelineDateFormatter = new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const monthFormatter = new Intl.DateTimeFormat("vi-VN", { month: "long" });
  const folderCollator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
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
  const folderSummaryQueue = [];
  const folderSummaryWaiters = new Map();
  let activeFolderSummaryRequests = 0;
  let mapLibreLoadPromise = null;
  const folderSummaryObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        folderSummaryObserver.unobserve(entry.target);
        queueFolderSummary(entry.target.dataset.folder, entry.target);
      }
    }, { rootMargin: "500px 0px" })
    : null;

  function preferredTheme() {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    if (savedTheme === "light" || savedTheme === "dark") {
      return savedTheme;
    }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme, persist = false) {
    document.documentElement.dataset.theme = theme;
    elements.themeToggle?.setAttribute(
      "aria-label",
      theme === "dark" ? "Dùng giao diện sáng" : "Dùng giao diện tối",
    );
    elements.themeToggle?.setAttribute(
      "title",
      theme === "dark" ? "Giao diện sáng" : "Giao diện tối",
    );
    document.querySelector('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#111618" : "#f7f8fa",
    );
    if (persist) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }

  applyTheme(preferredTheme());

  function preferredTileSize() {
    const value = Number(localStorage.getItem(TILE_SIZE_STORAGE_KEY));
    return Number.isFinite(value) && value >= 120 && value <= 280 ? value : 180;
  }

  const initialTileSize = preferredTileSize();
  elements.sizeInput.value = String(initialTileSize);
  document.documentElement.style.setProperty("--tile-size", `${initialTileSize}px`);

  function canonicalMetadataPath(value) {
    if (typeof value !== "string") {
      return "";
    }
    const parts = value.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".");
    if (!parts.length || parts.some((part) => part === "..")) {
      return "";
    }
    return parts.map((part) => part.normalize("NFC")).join("/").toLocaleLowerCase("en");
  }

  function metadataPathForItem(item) {
    const relative = canonicalMetadataPath(item.relative);
    if (relative) {
      return relative;
    }
    return canonicalMetadataPath(`${item.folderKey || "."}/${item.name || ""}`);
  }

  function sanitizeImportedMetadata(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const metadata = {};
    if (value.metadata && typeof value.metadata === "object") {
      for (const [key, fieldValue] of Object.entries(value.metadata)) {
        if (ALLOWED_METADATA_FIELDS.has(key) && ["string", "number", "boolean"].includes(typeof fieldValue)) {
          metadata[key] = fieldValue;
        }
      }
    }
    const latitude = Number(metadata.latitude);
    const longitude = Number(metadata.longitude);
    const hasLocation = Boolean(value.hasLocation) && Number.isFinite(latitude) &&
      Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    return {
      hasMetadata: true,
      hasLocation,
      dateTaken: Number(value.dateTaken) || 0,
      dateKey: /^\d{4}-\d{2}-\d{2}$/.test(value.dateKey || "") ? value.dateKey : "",
      dateTakenText: String(value.dateTakenText || ""),
      dateSource: String(value.dateSource || ""),
      camera: String(value.camera || metadata.camera || ""),
      metadata,
    };
  }

  function mergeImportedMetadata(item) {
    const imported = state.localMetadataByPath.get(metadataPathForItem(item));
    if (!imported) {
      return item;
    }
    const metadata = { ...(imported.metadata || {}), ...(item.metadata || {}) };
    const latitude = Number(metadata.latitude);
    const longitude = Number(metadata.longitude);
    const hasLocation = (item.hasLocation || imported.hasLocation) && Number.isFinite(latitude) &&
      Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    return {
      ...item,
      dateTaken: item.dateTaken || imported.dateTaken || 0,
      dateKey: item.dateKey || imported.dateKey || "",
      dateTakenText: item.dateTakenText || imported.dateTakenText || "",
      dateSource: item.dateSource || imported.dateSource || "",
      camera: item.camera || imported.camera || metadata.camera || "",
      hasMetadata: Boolean(item.hasMetadata || imported.hasMetadata),
      hasLocation,
      metadata,
    };
  }

  function syncMetadataStatus() {
    const local = state.localMetadataStatus;
    const server = state.serverMetadataStatus;
    state.metadataStatus = local.available
      ? { ...local, source: server.available ? "local+server" : "local" }
      : { ...server, source: server.available ? "server" : "" };
    updateMetadataManagerUi();
    if (state.mode) {
      setMode(state.mode);
    }
  }

  function updateMetadataManagerUi() {
    const status = state.localMetadataStatus;
    const hasMetadata = status.available && status.items > 0;
    elements.metadataButton.classList.toggle("has-metadata", hasMetadata);
    elements.metadataExport.hidden = !hasMetadata;
    elements.metadataRemove.hidden = !hasMetadata;
    elements.metadataImport.disabled = state.metadataImporting;
    elements.metadataExport.disabled = state.metadataImporting;
    elements.metadataRemove.disabled = state.metadataImporting;

    if (state.metadataImporting) {
      elements.metadataStatusTitle.textContent = "Đang xử lý metadata";
      elements.metadataStatusDetail.textContent = "Ứng dụng vẫn có thể tiếp tục hiển thị ảnh.";
      return;
    }
    if (!hasMetadata) {
      elements.metadataStatusTitle.textContent = "Chưa nhập metadata";
      elements.metadataStatusDetail.textContent = "Chọn file album-metadata.json để bắt đầu.";
      elements.metadataButton.title = "Nhập metadata";
      return;
    }

    elements.metadataStatusTitle.textContent = `${numberFormatter.format(status.items)} mục metadata`;
    const details = [];
    if (status.fileName) details.push(status.fileName);
    if (status.importedAt) details.push(`nhập ${dateTimeFormatter.format(new Date(status.importedAt))}`);
    if (status.bytes) details.push(formatBytes(status.bytes));
    elements.metadataStatusDetail.textContent = details.join(" · ") || "Đã lưu trên thiết bị này.";
    elements.metadataButton.title = `${numberFormatter.format(status.items)} mục metadata cục bộ`;
  }

  function localPageEndpoint() {
    if (window.location.protocol !== "http:") {
      return null;
    }
    return {
      url: new URL("/", window.location.href).href,
      label: `${window.location.host} · Cục bộ`,
      kind: "local",
    };
  }

  function scopedStorageKey(key) {
    return `${key}:${state.baseUrl}`;
  }

  function collectionItemSnapshot(item) {
    return {
      id: item.id,
      url: item.url,
      preview: item.preview,
      thumbnail: item.thumbnail,
      type: item.type,
      extension: item.extension,
      relative: item.relative,
      name: item.name,
      folder: item.folder,
      folderKey: item.folderKey,
      bytes: item.bytes,
      modified: item.modified,
      dateTaken: item.dateTaken,
      dateKey: item.dateKey,
      dateTakenText: item.dateTakenText,
      dateSource: item.dateSource,
      camera: item.camera,
      hasMetadata: item.hasMetadata,
      hasLocation: item.hasLocation,
      metadata: item.metadata,
      source: item.source,
      thumbnailFallback: item.thumbnailFallback,
    };
  }

  function validCollectionItem(item) {
    return item && typeof item.id === "string" && typeof item.url === "string" &&
      typeof item.name === "string" && (item.type === "image" || item.type === "video");
  }

  function loadCollectionMap(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(scopedStorageKey(key)));
      return new Map(
        (Array.isArray(parsed) ? parsed : [])
          .filter(validCollectionItem)
          .map((item) => [item.id, item]),
      );
    } catch {
      return new Map();
    }
  }

  function saveCollectionMap(key, collection, errorMessage) {
    try {
      localStorage.setItem(scopedStorageKey(key), JSON.stringify([...collection.values()]));
      return true;
    } catch {
      showToast(errorMessage);
      return false;
    }
  }

  function loadLocalCollections() {
    state.hiddenItems = loadCollectionMap(HIDDEN_ITEM_SNAPSHOTS_STORAGE_KEY);
    state.favoriteItems = loadCollectionMap(FAVORITE_ITEMS_STORAGE_KEY);
    loadCustomCollections();
    try {
      const legacyIds = JSON.parse(localStorage.getItem(scopedStorageKey(HIDDEN_ITEMS_STORAGE_KEY)));
      state.hiddenIds = new Set([
        ...state.hiddenItems.keys(),
        ...(Array.isArray(legacyIds) ? legacyIds.filter((id) => typeof id === "string") : []),
      ]);
    } catch {
      state.hiddenIds = new Set(state.hiddenItems.keys());
    }
    updateCollectionCounts();
  }

  function saveHiddenItems() {
    try {
      localStorage.setItem(scopedStorageKey(HIDDEN_ITEMS_STORAGE_KEY), JSON.stringify([...state.hiddenIds]));
    } catch {
      showToast("Không thể lưu danh sách đã ẩn trong trình duyệt này.");
      return false;
    }
    const saved = saveCollectionMap(
      HIDDEN_ITEM_SNAPSHOTS_STORAGE_KEY,
      state.hiddenItems,
      "Không thể lưu thông tin các mục đã ẩn.",
    );
    updateCollectionCounts();
    return saved;
  }

  function saveFavoriteItems() {
    const saved = saveCollectionMap(
      FAVORITE_ITEMS_STORAGE_KEY,
      state.favoriteItems,
      "Không thể lưu mục yêu thích trong trình duyệt này.",
    );
    updateCollectionCounts();
    return saved;
  }

  function normalizeCustomCollection(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const name = typeof value.name === "string" ? value.name.trim().slice(0, 80) : "";
    if (!id || !name) {
      return null;
    }
    const snapshotById = new Map(
      (Array.isArray(value.items) ? value.items : [])
        .filter(validCollectionItem)
        .map((item) => [item.id, collectionItemSnapshot(item)]),
    );
    const itemIds = [];
    for (const itemId of Array.isArray(value.itemIds) ? value.itemIds : []) {
      if (typeof itemId === "string" && itemId && !itemIds.includes(itemId)) {
        itemIds.push(itemId);
      }
    }
    for (const itemId of snapshotById.keys()) {
      if (!itemIds.includes(itemId)) {
        itemIds.push(itemId);
      }
    }
    return {
      id,
      name,
      itemIds,
      items: itemIds.map((itemId) => snapshotById.get(itemId)).filter(Boolean),
      createdAt: Number(value.createdAt) || Date.now(),
      updatedAt: Number(value.updatedAt) || Number(value.createdAt) || Date.now(),
    };
  }

  function loadCustomCollections() {
    try {
      const parsed = JSON.parse(localStorage.getItem(scopedStorageKey(CUSTOM_COLLECTIONS_STORAGE_KEY)));
      const collections = (Array.isArray(parsed) ? parsed : [])
        .map(normalizeCustomCollection)
        .filter(Boolean);
      state.customCollections = new Map(collections.map((collection) => [collection.id, collection]));
    } catch {
      state.customCollections = new Map();
    }
  }

  function saveCustomCollections() {
    try {
      localStorage.setItem(
        scopedStorageKey(CUSTOM_COLLECTIONS_STORAGE_KEY),
        JSON.stringify([...state.customCollections.values()]),
      );
      return true;
    } catch {
      showToast("Không thể lưu bộ sưu tập này trên thiết bị.");
      return false;
    }
  }

  function customCollectionsByRecentUpdate() {
    return [...state.customCollections.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt || folderCollator.compare(left.name, right.name));
  }

  function customCollectionItems(collectionId) {
    const collection = state.customCollections.get(collectionId);
    if (!collection) {
      return [];
    }
    const liveItems = new Map(state.items.map((item) => [item.id, item]));
    const snapshots = new Map(collection.items.map((item) => [item.id, item]));
    return collection.itemIds
      .map((itemId) => liveItems.get(itemId) || snapshots.get(itemId))
      .filter(validCollectionItem)
      .map(mergeImportedMetadata);
  }

  function makeCustomCollectionId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `collection-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function updateCollectionCounts() {
    const hiddenCount = state.hiddenIds.size;
    elements.hiddenCount.textContent = numberFormatter.format(hiddenCount);
    elements.hiddenCount.hidden = hiddenCount === 0;
    const favoriteCount = state.favoriteItems.size;
    elements.favoriteCount.textContent = numberFormatter.format(favoriteCount);
    elements.favoriteCount.hidden = favoriteCount === 0;
  }

  function updateNavigationUi() {
    for (const button of elements.navigationButtons) {
      const targetView = button.dataset.navView;
      const targetFilter = button.dataset.navFilter;
      const isActive = targetView === "library"
        ? state.view === "library" && targetFilter === state.filter
        : targetView === "albums"
          ? ["albums", "collection", "event"].includes(state.view)
          : state.view === targetView;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    }
    for (const button of elements.filterButtons) {
      button.classList.toggle("is-active", button.dataset.filter === state.filter);
    }
  }

  function activeTimelineFilterCount() {
    return Object.values(state.timelineFilters).filter(Boolean).length;
  }

  function collectionItemsForCurrentView() {
    if (state.view === "favorites") {
      return storedViewItems(state.favoriteItems).filter((item) => !state.hiddenIds.has(item.id));
    }
    if (state.view === "hidden") {
      return storedViewItems(state.hiddenItems, state.hiddenIds);
    }
    if (state.view === "collection") {
      return customCollectionItems(state.activeCollectionId).filter((item) => !state.hiddenIds.has(item.id));
    }
    if (state.view === "event") {
      const event = smartEvents().find((candidate) => candidate.id === state.activeEventId);
      return event ? event.items.filter((item) => !state.hiddenIds.has(item.id)) : [];
    }
    return null;
  }

  function timelineFacetsForCurrentView() {
    const collectionItems = collectionItemsForCurrentView();
    return collectionItems ? deriveFacets(collectionItems) : state.facets;
  }

  function updateTimelineFilterUi() {
    const count = activeTimelineFilterCount();
    const currentFacets = timelineFacetsForCurrentView();
    const hasAvailableFilters = currentFacets.folders.length > 0 || currentFacets.dates.length > 0 ||
      currentFacets.cameras.length > 0 || currentFacets.metadata > 0;
    elements.timelineFilterButton.hidden = ["albums", "map"].includes(state.view) || !state.mode ||
      (!hasAvailableFilters && count === 0);
    elements.timelineFilterButton.classList.toggle("is-active", count > 0);
    elements.timelineFilterButton.setAttribute("aria-pressed", String(count > 0));
    elements.timelineFilterCount.textContent = String(count);
    elements.timelineFilterCount.hidden = count === 0;
    renderActiveFilters();
    renderTimelineRail();
  }

  function renderActiveFilters() {
    const filters = [];
    const { folder, camera, location, year, month, day } = state.timelineFilters;
    if (folder) {
      filters.push({ key: "folder", label: folderFilterLabel(folder) });
    }
    if (camera) {
      filters.push({ key: "camera", label: `Máy ảnh: ${camera}` });
    }
    if (location) {
      filters.push({
        key: "location",
        label: location === "with" ? "Có GPS" : "Không có GPS",
      });
    }
    if (year) {
      filters.push({ key: "year", label: `Năm ${year}` });
    }
    if (month) {
      const label = monthFormatter.format(new Date(2024, Number(month) - 1, 1));
      filters.push({ key: "month", label: label.charAt(0).toLocaleUpperCase("vi") + label.slice(1) });
    }
    if (day) {
      filters.push({ key: "day", label: `Ngày ${Number(day)}` });
    }

    elements.activeFilters.replaceChildren();
    elements.activeFilters.hidden = filters.length === 0 || ["albums", "map"].includes(state.view);
    if (elements.activeFilters.hidden) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const filter of filters) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "active-filter-chip";
      button.dataset.clearFilter = filter.key;
      button.setAttribute("aria-label", `Bỏ bộ lọc ${filter.label}`);
      const label = document.createElement("span");
      label.textContent = filter.label;
      button.append(label);
      button.insertAdjacentHTML(
        "beforeend",
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg>',
      );
      fragment.append(button);
    }
    const clearAll = document.createElement("button");
    clearAll.type = "button";
    clearAll.className = "active-filters-clear";
    clearAll.dataset.clearFilter = "all";
    clearAll.textContent = "Xóa tất cả";
    fragment.append(clearAll);
    elements.activeFilters.append(fragment);
  }

  function renderTimelineRail() {
    const currentFacets = timelineFacetsForCurrentView();
    const years = [...new Set(currentFacets.dates.map((date) => date.slice(0, 4)))].sort().reverse();
    const shouldShow = state.mode && !["albums", "map"].includes(state.view) && years.length > 1 &&
      state.sort !== "name-asc" && state.sort !== "name-desc";
    elements.timelineRail.hidden = !shouldShow;
    elements.timelineRail.replaceChildren();
    if (!shouldShow) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const allYears = document.createElement("button");
    allYears.type = "button";
    allYears.dataset.timelineYear = "";
    allYears.className = !state.timelineFilters.year ? "is-active" : "";
    allYears.textContent = "Tất cả";
    fragment.append(allYears);
    for (const year of years) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.timelineYear = year;
      button.className = state.timelineFilters.year === year ? "is-active" : "";
      button.textContent = year;
      fragment.append(button);
    }
    elements.timelineRail.append(fragment);
  }

  function updateViewUi() {
    const isAlbumsView = state.view === "albums";
    const isMapView = state.view === "map";
    const isCollectionView = ["collection", "event"].includes(state.view);
    elements.libraryToolbar.hidden = isAlbumsView || isMapView;
    elements.mediaGrid.hidden = isMapView;
    elements.mapView.hidden = !isMapView;
    elements.searchInput.placeholder = isAlbumsView
      ? "Tìm bộ sưu tập, sự kiện hoặc thư mục"
      : isCollectionView
        ? "Tìm trong bộ sưu tập"
        : isMapView
          ? "Tìm ảnh có vị trí"
          : "Tìm ảnh, video hoặc thư mục";
    elements.mediaGrid.setAttribute("aria-label", isAlbumsView ? "Danh sách album" : "Ảnh và video");
    document.body.classList.toggle("view-albums", isAlbumsView);
    document.body.classList.toggle("view-map", isMapView);
    updateTimelineFilterUi();
  }

  function showToast(message, duration = 3200) {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    state.toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, duration);
  }

  function endpointUrl(endpoint) {
    return new URL(endpoint.url).href;
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
    const isCloud = state.endpoint?.kind === "cloud";
    const labels = {
      api: isCloud ? "Cloud API" : "LAN API",
      album: isCloud ? "Album Cloud" : "Album",
      directory: isCloud ? "Thư mục Cloud" : "Thư mục LAN",
      offline: "Ngoại tuyến",
    };
    const metadataLabel = state.metadataStatus.available ? " · EXIF" : "";
    elements.connectionMode.textContent = `${labels[mode] || ""}${mode === "api" || mode === "album" || mode === "offline" ? metadataLabel : ""}`;
    elements.connectionMode.title = state.metadataStatus.available
      ? `${numberFormatter.format(state.metadataStatus.items)} mục có metadata`
      : "";
    elements.refreshButton.hidden = !mode;
    updateTimelineFilterUi();
  }

  function hideNotice() {
    elements.connectionNotice.hidden = true;
  }

  function showConnectionError(error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (state.isLocalServer) {
      elements.noticeTitle.textContent = "Chưa kết nối được server album";
      elements.noticeMessage.textContent =
        `Không đọc được API tại ${state.baseUrl} (${detail}). Hãy kiểm tra cửa sổ My Album trên máy Windows rồi thử lại.`;
    } else {
      elements.noticeTitle.textContent = "Kho ảnh không phản hồi";
      elements.noticeMessage.textContent =
        `Không đọc được ${state.baseUrl} (${detail}). ` +
        "Hãy kiểm tra server thư mục và Cloudflare Tunnel trên máy Windows rồi thử lại.";
    }
    elements.connectionNotice.hidden = false;
  }

  function showOfflineNotice(error) {
    const detail = error instanceof Error ? error.message : String(error);
    elements.noticeTitle.textContent = "Đang dùng album ngoại tuyến";
    elements.noticeMessage.textContent =
      `Không kết nối được ${state.baseUrl} (${detail}). ` +
      "Những thumbnail và ảnh đã lưu vẫn có thể mở; bấm làm mới khi kho ảnh hoạt động lại.";
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

  function formatDateTime(timestamp) {
    return Number.isFinite(timestamp) && timestamp > 0
      ? dateTimeFormatter.format(new Date(timestamp * 1000))
      : "";
  }

  function itemTimestamp(item) {
    return Number(item.dateTaken) || Number(item.modified) || 0;
  }

  function itemDateKey(item) {
    return /^\d{4}-\d{2}-\d{2}$/.test(item.dateKey || "")
      ? item.dateKey
      : localDateKey(itemTimestamp(item));
  }

  function itemDetail(item) {
    return [formatDate(itemTimestamp(item)), formatBytes(item.bytes)].filter(Boolean).join(" · ");
  }

  function localDateKey(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return "";
    }
    const date = new Date(timestamp * 1000);
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function itemFolderKey(item) {
    return String(item.folderKey || item.folder || "Thư mục gốc");
  }

  function itemMatchesTimelineFilters(item) {
    const filters = state.timelineFilters;
    if (filters.folder && itemFolderKey(item) !== filters.folder) {
      return false;
    }
    if (filters.camera && item.camera !== filters.camera) {
      return false;
    }
    if (filters.location === "with" && !item.hasLocation) {
      return false;
    }
    if (filters.location === "without" && item.hasLocation) {
      return false;
    }
    if (!filters.year) {
      return true;
    }
    const dateKey = itemDateKey(item);
    if (!dateKey || dateKey.slice(0, 4) !== filters.year) {
      return false;
    }
    if (filters.month && dateKey.slice(5, 7) !== filters.month.padStart(2, "0")) {
      return false;
    }
    return !filters.day || dateKey.slice(8, 10) === filters.day.padStart(2, "0");
  }

  function deriveFacets(items) {
    const folders = new Set();
    const dates = new Set();
    const cameras = new Set();
    let withLocation = 0;
    let metadata = 0;
    for (const item of items) {
      folders.add(itemFolderKey(item));
      const dateKey = itemDateKey(item);
      if (dateKey) {
        dates.add(dateKey);
      }
      if (item.camera) {
        cameras.add(item.camera);
      }
      if (item.hasLocation) {
        withLocation += 1;
      }
      if (item.hasMetadata) {
        metadata += 1;
      }
    }
    return {
      folders: [...folders].sort(folderCollator.compare),
      dates: [...dates].sort().reverse(),
      cameras: [...cameras].sort(folderCollator.compare),
      locations: { with: withLocation, without: items.length - withLocation },
      metadata,
    };
  }

  function deriveStats(items) {
    return {
      total: items.length,
      images: items.filter((item) => item.type === "image").length,
      videos: items.filter((item) => item.type === "video").length,
      metadata: items.filter((item) => item.hasMetadata).length,
      captured: items.filter((item) => item.dateTaken).length,
      locations: items.filter((item) => item.hasLocation).length,
    };
  }

  function normalizeFacets(rawFacets) {
    const folders = Array.isArray(rawFacets?.folders)
      ? rawFacets.folders.map(String).filter(Boolean).sort(folderCollator.compare)
      : [];
    const dates = Array.isArray(rawFacets?.dates)
      ? rawFacets.dates.map(String).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().reverse()
      : [];
    const cameras = Array.isArray(rawFacets?.cameras)
      ? rawFacets.cameras.map(String).filter(Boolean).sort(folderCollator.compare)
      : [];
    return {
      folders: [...new Set(folders)],
      dates: [...new Set(dates)],
      cameras: [...new Set(cameras)],
      locations: {
        with: Math.max(0, Number(rawFacets?.locations?.with) || 0),
        without: Math.max(0, Number(rawFacets?.locations?.without) || 0),
      },
      metadata: Math.max(0, Number(rawFacets?.metadata) || 0),
    };
  }

  function normalizeMetadataStatus(rawStatus) {
    return {
      available: Boolean(rawStatus?.available),
      items: Math.max(0, Number(rawStatus?.items) || 0),
      generatedAt: typeof rawStatus?.generatedAt === "string" ? rawStatus.generatedAt : "",
    };
  }

  function folderFilterLabel(folder) {
    return folder === "." ? "Thư mục gốc" : folder.replaceAll("/", " / ");
  }

  function setSelectOptions(select, placeholder, values, selected, labelForValue = String) {
    const normalizedValues = [...new Set(values.map(String))];
    if (selected && !normalizedValues.includes(selected)) {
      normalizedValues.push(selected);
    }
    const fragment = document.createDocumentFragment();
    fragment.append(new Option(placeholder, ""));
    for (const value of normalizedValues) {
      fragment.append(new Option(labelForValue(value), value));
    }
    select.replaceChildren(fragment);
    select.value = selected && normalizedValues.includes(selected) ? selected : "";
    return select.value;
  }

  function populateTimelineFilterDialog(filters = state.timelineFilters) {
    const currentFacets = timelineFacetsForCurrentView();
    const folders = [...currentFacets.folders].sort(folderCollator.compare);
    setSelectOptions(
      elements.folderFilter,
      "Tất cả thư mục",
      folders,
      filters.folder,
      folderFilterLabel,
    );
    setSelectOptions(
      elements.cameraFilter,
      "Tất cả máy ảnh",
      currentFacets.cameras,
      filters.camera,
    );
    elements.cameraFilter.disabled = currentFacets.cameras.length === 0 && !filters.camera;
    elements.locationFilter.value = ["with", "without"].includes(filters.location)
      ? filters.location
      : "";
    elements.locationFilter.disabled = currentFacets.metadata === 0 && !filters.location;

    const years = [...new Set(currentFacets.dates.map((date) => date.slice(0, 4)))].sort().reverse();
    const year = setSelectOptions(elements.yearFilter, "Tất cả năm", years, filters.year);
    const months = year
      ? [...new Set(currentFacets.dates
        .filter((date) => date.startsWith(`${year}-`))
        .map((date) => date.slice(5, 7)))].sort((left, right) => Number(left) - Number(right))
      : [];
    const month = setSelectOptions(
      elements.monthFilter,
      "Tất cả tháng",
      months,
      year ? filters.month : "",
      (value) => monthFormatter.format(new Date(2024, Number(value) - 1, 1)),
    );
    elements.monthFilter.disabled = !year || months.length === 0;

    const days = year && month
      ? [...new Set(currentFacets.dates
        .filter((date) => date.startsWith(`${year}-${month.padStart(2, "0")}-`))
        .map((date) => date.slice(8, 10)))].sort((left, right) => Number(left) - Number(right))
      : [];
    setSelectOptions(
      elements.dayFilter,
      "Tất cả ngày",
      days,
      year && month ? filters.day : "",
      (value) => `Ngày ${Number(value)}`,
    );
    elements.dayFilter.disabled = !year || !month || days.length === 0;
  }

  function showTimelineFilterDialog() {
    populateTimelineFilterDialog();
    elements.filterDialog.showModal();
    requestAnimationFrame(() => elements.folderFilter.focus());
  }

  function closeTimelineFilterDialog() {
    if (elements.filterDialog.open) {
      elements.filterDialog.close();
    }
  }

  function readTimelineFilterForm() {
    return {
      folder: elements.folderFilter.value,
      camera: elements.cameraFilter.value,
      location: elements.locationFilter.value,
      year: elements.yearFilter.value,
      month: elements.yearFilter.value ? elements.monthFilter.value : "",
      day: elements.yearFilter.value && elements.monthFilter.value ? elements.dayFilter.value : "",
    };
  }

  function clearTimelineFilter(key) {
    if (key === "all") {
      state.timelineFilters = emptyTimelineFilters();
    } else if (key === "year") {
      state.timelineFilters = { ...state.timelineFilters, year: "", month: "", day: "" };
    } else if (key === "month") {
      state.timelineFilters = { ...state.timelineFilters, month: "", day: "" };
    } else if (["day", "folder", "camera", "location"].includes(key)) {
      state.timelineFilters = { ...state.timelineFilters, [key]: "" };
    } else {
      return;
    }
    exitSelectionMode();
    updateTimelineFilterUi();
    reloadFromControls();
  }

  function selectTimelineYear(year) {
    state.timelineFilters = {
      ...state.timelineFilters,
      year,
      month: "",
      day: "",
    };
    exitSelectionMode();
    updateTimelineFilterUi();
    reloadFromControls();
  }

  function smartEventName(start, end) {
    if (localDateKey(start) === localDateKey(end)) {
      return `Sự kiện ${formatDate(start)}`;
    }
    return `Sự kiện ${formatDate(start)} - ${formatDate(end)}`;
  }

  function smartEvents() {
    const candidates = state.items
      .filter((item) => !state.hiddenIds.has(item.id))
      .filter((item) => itemTimestamp(item) > 0)
      .slice()
      .sort((left, right) => itemTimestamp(left) - itemTimestamp(right));
    const events = [];
    let group = [];
    let groupStart = 0;
    let previous = 0;

    const commit = () => {
      if (group.length < 2) {
        group = [];
        return;
      }
      const items = group.slice().sort((left, right) => itemTimestamp(right) - itemTimestamp(left));
      const start = itemTimestamp(group[0]);
      const end = itemTimestamp(group.at(-1));
      const folderKeys = [...new Set(items.map(itemFolderKey))];
      const folderDetail = folderKeys.length === 1
        ? folderFilterLabel(folderKeys[0])
        : `${numberFormatter.format(folderKeys.length)} thư mục`;
      events.push({
        id: `event-${start}-${group[0].id}`,
        items,
        start,
        end,
        name: smartEventName(start, end),
        detail: `${numberFormatter.format(items.length)} mục · ${folderDetail}`,
        cover: items[0],
      });
      group = [];
    };

    for (const item of candidates) {
      const timestamp = itemTimestamp(item);
      const startsNewEvent = group.length > 0 && (
        timestamp - previous > SMART_EVENT_GAP_SECONDS ||
        timestamp - groupStart > SMART_EVENT_MAX_SPAN_SECONDS
      );
      if (startsNewEvent) {
        commit();
      }
      if (group.length === 0) {
        groupStart = timestamp;
      }
      group.push(item);
      previous = timestamp;
    }
    commit();
    return events.sort((left, right) => right.end - left.end);
  }

  function createCollectionCard({ kind, id, name, detail, cover }) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `folder-card collection-card collection-card-${kind}`;
    if (kind === "custom") {
      card.dataset.collectionCard = id;
      card.setAttribute("aria-label", `Mở bộ sưu tập ${name}`);
    } else {
      card.dataset.eventCard = id;
      card.setAttribute("aria-label", `Mở ${name}`);
    }

    const preview = document.createElement("span");
    preview.className = "media-preview folder-cover collection-cover";
    const iconPath = kind === "custom"
      ? '<path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" /><path d="M12 12v6M9 15h6" />'
      : '<path d="M12 3v3M12 18v3M4.2 7.2l2.1 2.1M17.7 16.7l2.1 2.1M3 12h3M18 12h3M4.2 16.8l2.1-2.1M17.7 7.3l2.1-2.1" /><circle cx="12" cy="12" r="4" />';
    preview.innerHTML = `<span class="folder-cover-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24">${iconPath}</svg></span>`;

    const copy = document.createElement("span");
    copy.className = "folder-card-copy";
    const title = document.createElement("strong");
    title.textContent = name;
    const count = document.createElement("small");
    count.className = "folder-count";
    count.textContent = detail;
    copy.append(title, count);
    card.append(preview, copy);
    if (cover) {
      preview.dataset.coverId = cover.id;
      preview.classList.add("has-cover");
      addPreviewImage(preview, cover);
    }
    return card;
  }

  function createOrganizeSection(title, description, cards, kind) {
    const section = document.createElement("section");
    section.className = `collection-section collection-section-${kind}`;
    const header = document.createElement("header");
    header.className = "collection-section-header";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = description;
    header.append(heading, copy);
    const grid = document.createElement("div");
    grid.className = "folder-grid collection-grid";
    grid.append(...cards);
    section.append(header, grid);
    return section;
  }

  function openCustomCollection(collectionId) {
    const collection = state.customCollections.get(collectionId);
    if (!collection) {
      return;
    }
    exitSelectionMode();
    state.view = "collection";
    state.activeCollectionId = collection.id;
    state.activeEventId = "";
    state.filter = "all";
    state.query = "";
    elements.searchInput.value = "";
    state.timelineFilters = emptyTimelineFilters();
    updateNavigationUi();
    updateViewUi();
    reloadFromControls();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSmartEvent(eventId) {
    if (!smartEvents().some((event) => event.id === eventId)) {
      return;
    }
    exitSelectionMode();
    state.view = "event";
    state.activeEventId = eventId;
    state.activeCollectionId = "";
    state.filter = "all";
    state.query = "";
    elements.searchInput.value = "";
    state.timelineFilters = emptyTimelineFilters();
    updateNavigationUi();
    updateViewUi();
    reloadFromControls();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function populateCollectionDialog() {
    const selected = elements.collectionSelect.value;
    const fragment = document.createDocumentFragment();
    fragment.append(new Option("Tạo bộ sưu tập mới", ""));
    for (const collection of customCollectionsByRecentUpdate()) {
      fragment.append(new Option(collection.name, collection.id));
    }
    elements.collectionSelect.replaceChildren(fragment);
    elements.collectionSelect.value = state.customCollections.has(selected) ? selected : "";
    updateCollectionDialogName();
  }

  function updateCollectionDialogName() {
    const existing = state.customCollections.get(elements.collectionSelect.value);
    elements.collectionName.disabled = Boolean(existing);
    elements.collectionName.required = !existing;
    elements.collectionName.value = existing ? existing.name : "";
    elements.collectionName.placeholder = existing ? "" : "Ví dụ: Da Lat mùa mưa";
  }

  function closeCollectionDialog() {
    if (elements.collectionDialog.open) {
      elements.collectionDialog.close();
    }
  }

  function showCollectionDialog() {
    const selectedItems = state.visibleItems.filter((item) => state.selectedIds.has(item.id));
    if (selectedItems.length === 0) {
      showToast("Chọn ít nhất một ảnh hoặc video trước.");
      return;
    }
    elements.collectionSelect.value = "";
    populateCollectionDialog();
    elements.collectionDialog.showModal();
    requestAnimationFrame(() => elements.collectionName.focus());
  }

  function saveSelectedToCollection() {
    const selectedItems = state.visibleItems.filter((item) => state.selectedIds.has(item.id));
    if (selectedItems.length === 0) {
      closeCollectionDialog();
      return;
    }
    const existing = state.customCollections.get(elements.collectionSelect.value);
    const name = existing ? existing.name : elements.collectionName.value.trim().slice(0, 80);
    if (!name) {
      elements.collectionName.focus();
      return;
    }
    const now = Date.now();
    const itemIds = existing ? [...existing.itemIds] : [];
    const snapshots = new Map((existing?.items || []).map((item) => [item.id, item]));
    let addedCount = 0;
    for (const item of selectedItems) {
      if (!itemIds.includes(item.id)) {
        itemIds.push(item.id);
        addedCount += 1;
      }
      snapshots.set(item.id, collectionItemSnapshot(item));
    }
    const collection = {
      id: existing?.id || makeCustomCollectionId(),
      name,
      itemIds,
      items: itemIds.map((itemId) => snapshots.get(itemId)).filter(Boolean),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    state.customCollections.set(collection.id, collection);
    if (!saveCustomCollections()) {
      return;
    }
    closeCollectionDialog();
    exitSelectionMode();
    if (state.view === "albums") {
      renderFolderView();
      updateSummary();
      updateEmptyState();
    }
    showToast(addedCount > 0
      ? `Đã thêm ${numberFormatter.format(addedCount)} mục vào ${collection.name}.`
      : `Các mục đã có trong ${collection.name}.`);
  }

  function openFolderAlbum(folder) {
    exitSelectionMode();
    state.view = "library";
    state.activeCollectionId = "";
    state.activeEventId = "";
    state.filter = "all";
    state.query = "";
    elements.searchInput.value = "";
    state.timelineFilters = { ...emptyTimelineFilters(), folder };
    updateNavigationUi();
    updateViewUi();
    reloadFromControls();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function canUseCacheStorage() {
    return "caches" in window && typeof window.caches?.open === "function";
  }

  function importedMetadataCacheUrl() {
    const url = new URL("./__offline/imported-metadata.json", window.location.href);
    url.search = "";
    return url.href;
  }

  function importedMetadataPayload() {
    return {
      format: "my-album-compact-metadata",
      version: IMPORTED_METADATA_CACHE_VERSION,
      generatedAt: state.localMetadataStatus.generatedAt,
      importedAt: state.localMetadataStatus.importedAt,
      fileName: state.localMetadataStatus.fileName,
      sourceBytes: state.localMetadataStatus.bytes,
      items: [...state.localMetadataByPath.entries()],
    };
  }

  async function saveImportedMetadata() {
    if (!canUseCacheStorage()) {
      return false;
    }
    const cache = await caches.open(IMPORTED_METADATA_CACHE_NAME);
    await cache.put(importedMetadataCacheUrl(), new Response(JSON.stringify(importedMetadataPayload()), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }));
    return true;
  }

  async function loadImportedMetadata() {
    if (!canUseCacheStorage()) {
      updateMetadataManagerUi();
      return false;
    }
    try {
      const cache = await caches.open(IMPORTED_METADATA_CACHE_NAME);
      const response = await cache.match(importedMetadataCacheUrl());
      if (!response) {
        updateMetadataManagerUi();
        return false;
      }
      const payload = await response.json();
      if (payload?.format !== "my-album-compact-metadata" ||
        payload.version !== IMPORTED_METADATA_CACHE_VERSION || !Array.isArray(payload.items)) {
        return false;
      }
      const entries = [];
      for (const entry of payload.items) {
        const path = canonicalMetadataPath(Array.isArray(entry) ? entry[0] : "");
        const metadata = sanitizeImportedMetadata(Array.isArray(entry) ? entry[1] : null);
        if (path && metadata) {
          entries.push([path, metadata]);
        }
      }
      state.localMetadataByPath = new Map(entries);
      state.localMetadataStatus = {
        available: entries.length > 0,
        items: entries.length,
        generatedAt: String(payload.generatedAt || ""),
        importedAt: Number(payload.importedAt) || 0,
        fileName: String(payload.fileName || "album-metadata.json"),
        bytes: Number(payload.sourceBytes) || 0,
      };
      syncMetadataStatus();
      return entries.length > 0;
    } catch {
      updateMetadataManagerUi();
      return false;
    }
  }

  function setMetadataProgress(percent, text, value = "") {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    elements.metadataProgress.hidden = false;
    elements.metadataProgressText.textContent = text;
    elements.metadataProgressValue.textContent = value;
    elements.metadataProgressBar.style.width = `${safePercent}%`;
  }

  function processMetadataFile(file) {
    return new Promise(async (resolve, reject) => {
      let worker = null;
      try {
        setMetadataProgress(4, "Đang đọc file…", formatBytes(file.size));
        const buffer = await file.arrayBuffer();
        worker = new Worker(new URL("./metadata-worker.js?v=album-ux-25", window.location.href));
        worker.addEventListener("message", (event) => {
          const message = event.data || {};
          if (message.type === "progress") {
            const total = Math.max(1, Number(message.total) || 1);
            const processed = Math.max(0, Number(message.processed) || 0);
            setMetadataProgress(
              12 + (processed / total) * 82,
              "Đang rút gọn metadata…",
              `${numberFormatter.format(processed)} / ${numberFormatter.format(total)}`,
            );
            return;
          }
          if (message.type === "complete") {
            resolve({
              entries: Array.isArray(message.entries) ? message.entries : [],
              generatedAt: String(message.generatedAt || ""),
            });
            worker?.terminate();
            return;
          }
          if (message.type === "error") {
            reject(new Error(String(message.message || "Không đọc được metadata.")));
            worker?.terminate();
          }
        });
        worker.addEventListener("error", () => {
          reject(new Error("Worker xử lý metadata gặp lỗi."));
          worker?.terminate();
        });
        worker.postMessage({ buffer }, [buffer]);
      } catch (error) {
        worker?.terminate();
        reject(error);
      }
    });
  }

  async function importMetadataFile(file) {
    if (!file || state.metadataImporting) {
      return;
    }
    state.metadataImporting = true;
    updateMetadataManagerUi();
    setMetadataProgress(1, "Đang chuẩn bị…");
    try {
      const result = await processMetadataFile(file);
      const entries = [];
      for (const entry of result.entries) {
        const path = canonicalMetadataPath(Array.isArray(entry) ? entry[0] : "");
        const metadata = sanitizeImportedMetadata(Array.isArray(entry) ? entry[1] : null);
        if (path && metadata) entries.push([path, metadata]);
      }
      if (entries.length === 0) {
        throw new Error("Không tìm thấy mục ảnh hoặc video có _album.path trong file JSON.");
      }

      setMetadataProgress(96, "Đang lưu bản rút gọn…", `${numberFormatter.format(entries.length)} mục`);
      state.localMetadataByPath = new Map(entries);
      state.localMetadataStatus = {
        available: true,
        items: entries.length,
        generatedAt: result.generatedAt,
        importedAt: Date.now(),
        fileName: file.name,
        bytes: file.size,
      };
      let persisted = false;
      try {
        persisted = await saveImportedMetadata();
      } catch {
        persisted = false;
      }
      state.clientCatalogComplete = false;
      syncMetadataStatus();
      setMetadataProgress(100, "Đã áp dụng metadata", `${numberFormatter.format(entries.length)} mục`);
      showToast(persisted
        ? `Đã lưu ${numberFormatter.format(entries.length)} mục metadata trên thiết bị này.`
        : "Metadata đã áp dụng cho phiên này nhưng trình duyệt không cho phép lưu lâu dài.");
      await connectAlbum();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Không nhập được metadata.");
      elements.metadataProgress.hidden = true;
    } finally {
      state.metadataImporting = false;
      elements.metadataFileInput.value = "";
      updateMetadataManagerUi();
    }
  }

  async function exportImportedMetadata() {
    if (!state.localMetadataStatus.available) {
      return;
    }
    const blob = new Blob([JSON.stringify(importedMetadataPayload())], {
      type: "application/json;charset=utf-8",
    });
    const file = new File([blob], "my-album-metadata-compact.json", { type: blob.type });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My Album metadata" });
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function removeImportedMetadata() {
    if (!state.localMetadataStatus.available || state.metadataImporting) {
      return;
    }
    if (!window.confirm("Xóa metadata đã lưu khỏi trình duyệt này?")) {
      return;
    }
    if (canUseCacheStorage()) {
      const cache = await caches.open(IMPORTED_METADATA_CACHE_NAME);
      await cache.delete(importedMetadataCacheUrl());
    }
    state.localMetadataByPath = new Map();
    state.localMetadataStatus = {
      available: false,
      items: 0,
      generatedAt: "",
      importedAt: 0,
      fileName: "",
      bytes: 0,
    };
    state.clientCatalogComplete = false;
    syncMetadataStatus();
    elements.metadataProgress.hidden = true;
    showToast("Đã xóa metadata khỏi thiết bị này.");
    await connectAlbum();
  }

  function showMetadataDialog() {
    updateMetadataManagerUi();
    if (!elements.metadataDialog.open) {
      elements.metadataDialog.showModal();
    }
  }

  function closeMetadataDialog() {
    if (!state.metadataImporting && elements.metadataDialog.open) {
      elements.metadataDialog.close();
    }
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
      credentials: state.endpoint?.kind === "cloud" ? "include" : "same-origin",
      mode: "cors",
      signal,
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
    const folderKey = parts.map(safeDecode).join("/") || ".";
    const folder = folderFilterLabel(folderKey);

    return mergeImportedMetadata({
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
      folderKey,
      dateTaken: 0,
      dateKey: "",
      dateTakenText: "",
      dateSource: "",
      camera: "",
      hasMetadata: false,
      hasLocation: false,
      metadata: {},
      source: "directory",
      thumbnailFallback: type === "image" ? makeDirectoryThumbnailUrl(relative) : null,
    });
  }

  function normalizeApiItem(rawItem, baseUrl = state.baseUrl) {
    const name = String(rawItem.fileName || rawItem.name || "Không tên");
    const folderKey = rawItem.folder ? String(rawItem.folder) : ".";
    const folder = folderKey !== "." ? folderKey.replaceAll("/", " / ") : "Thư mục gốc";
    const metadata = {};
    if (rawItem.metadata && typeof rawItem.metadata === "object") {
      for (const [key, value] of Object.entries(rawItem.metadata)) {
        if (ALLOWED_METADATA_FIELDS.has(key) && ["string", "number", "boolean"].includes(typeof value)) {
          metadata[key] = value;
        }
      }
    }
    const latitude = Number(metadata.latitude);
    const longitude = Number(metadata.longitude);
    const hasLocation = Boolean(rawItem.hasLocation) && Number.isFinite(latitude) &&
      Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
    return mergeImportedMetadata({
      id: String(rawItem.id),
      url: new URL(String(rawItem.media), baseUrl).href,
      preview: new URL(String(rawItem.view || rawItem.media), baseUrl).href,
      thumbnail: new URL(String(rawItem.thumbnail), baseUrl).href,
      type: rawItem.type === "video" ? "video" : "image",
      extension: String(rawItem.extension || mediaExtension(name)),
      relative: `${rawItem.folder || ""}/${name}`,
      name,
      folder,
      folderKey,
      bytes: Number(rawItem.bytes) || 0,
      modified: Number(rawItem.modified) || 0,
      dateTaken: Number(rawItem.dateTaken) || 0,
      dateKey: /^\d{4}-\d{2}-\d{2}$/.test(rawItem.dateKey || "") ? rawItem.dateKey : "",
      dateTakenText: String(rawItem.dateTakenText || ""),
      dateSource: String(rawItem.dateSource || ""),
      camera: String(rawItem.camera || metadata.camera || ""),
      hasMetadata: Boolean(rawItem.hasMetadata),
      hasLocation,
      metadata,
      source: "api",
      thumbnailFallback: null,
    });
  }

  // === Album static index (album/layout.json + album/meta/NNNN.json) ===
  // The cloud host at photos.vuducan.qzz.io is a plain static server (no /api).
  // layout.json holds parallel arrays for instant placeholders; meta pages hold
  // the per-item details filled in progressively. See memory: my-album-data-contract.
  function albumIndexUrl() {
    return new URL("album/layout.json", state.baseUrl).href;
  }

  function albumMetaUrl(page) {
    return new URL(`album/meta/${String(page).padStart(4, "0")}.json`, state.baseUrl).href;
  }

  function albumThumbnailUrl(id) {
    return new URL(`thumbs/${id}.jpg`, state.baseUrl).href;
  }

  function albumMediaUrl(dir, file) {
    // macOS/APFS filenames on the server are stored NFD-decomposed; the meta JSON
    // reports NFC, so normalize before encoding or the path 404s.
    const relative = `${dir ? `${dir}/` : ""}${file}`.normalize("NFD");
    const encoded = relative.split("/").map(encodeURIComponent).join("/");
    return new URL(encoded, state.baseUrl).href;
  }

  function albumDateToTimestamp(dateKey) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || "")) {
      return 0;
    }
    const [year, month, day] = dateKey.split("-").map(Number);
    return Math.floor(new Date(year, month - 1, day, 12, 0, 0).getTime() / 1000);
  }

  function buildAlbumItem(layout, index, pageSize) {
    const id = String(layout.id[index]);
    const width = Number(layout.w?.[index]) || 0;
    const height = Number(layout.h?.[index]) || 0;
    const color = typeof layout.c?.[index] === "string" ? layout.c[index] : "";
    const kind = Number(layout.k?.[index]) || 0;
    const duration = Number(layout.dur?.[index]) || 0;
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(layout.d?.[index] || "") ? layout.d[index] : "";
    const type = kind === 1 ? "video" : "image";
    const metadata = {};
    if (width > 0) metadata.width = width;
    if (height > 0) metadata.height = height;
    if (duration > 0) metadata.duration = duration;
    return {
      id,
      url: "",
      preview: "",
      thumbnail: albumThumbnailUrl(id),
      type,
      extension: "",
      relative: "",
      name: "",
      folder: "Thư mục gốc",
      folderKey: ".",
      bytes: 0,
      modified: 0,
      dateTaken: albumDateToTimestamp(dateKey),
      dateKey,
      dateTakenText: "",
      dateSource: dateKey ? "album" : "",
      camera: "",
      hasMetadata: true,
      hasLocation: false,
      metadata,
      color,
      metaPage: Math.floor(index / pageSize),
      metaPending: true,
      source: "album",
      thumbnailFallback: null,
    };
  }

  function applyAlbumMeta(item, entry) {
    if (!item || !entry) {
      return;
    }
    const file = String(entry.f || "");
    const dir = String(entry.dir || "");
    const folderKey = dir || ".";
    item.name = file || item.name;
    item.folderKey = folderKey;
    item.folder = folderKey !== "." ? folderKey.replaceAll("/", " / ") : "Thư mục gốc";
    item.relative = `${dir ? `${dir}/` : ""}${file}`;
    item.camera = String(entry.cam || "");
    item.bytes = Number(entry.b) || 0;
    const extension = String(entry.e || "").replace(/^\./, "");
    if (extension) {
      item.extension = extension;
    }
    const parsed = Date.parse(entry.t);
    if (Number.isFinite(parsed)) {
      item.dateTaken = Math.floor(parsed / 1000);
      item.dateTakenText = String(entry.t);
      item.dateSource = "exif";
      const dateKey = localDateKey(item.dateTaken);
      if (dateKey) {
        item.dateKey = dateKey;
      }
    }
    const mediaUrl = albumMediaUrl(dir, file);
    item.url = mediaUrl;
    item.preview = mediaUrl;
    item.metaPending = false;

    // If the user imported the richer album-metadata.json (which can carry GPS,
    // lens, etc.), fold those fields in now that we know the item's path.
    const imported = state.localMetadataByPath.get(metadataPathForItem(item));
    if (imported) {
      item.metadata = { ...(imported.metadata || {}), ...item.metadata };
      const latitude = Number(item.metadata.latitude);
      const longitude = Number(item.metadata.longitude);
      item.hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
      if (!item.camera) {
        item.camera = imported.camera || item.metadata.camera || "";
      }
    }
  }

  async function loadAlbumIndex(version) {
    let response;
    try {
      response = await fetchWithTimeout(albumIndexUrl(), PROBE_TIMEOUT_MS);
    } catch (error) {
      throw new ApiUnavailableError(`album layout: ${error.message}`);
    }
    if (!response.ok) {
      throw new ApiUnavailableError(`album layout HTTP ${response.status}`);
    }
    let layout;
    try {
      layout = await response.json();
    } catch {
      throw new ApiUnavailableError("album layout không hợp lệ");
    }
    if (!layout || !Array.isArray(layout.id) || layout.id.length === 0) {
      throw new ApiUnavailableError("album layout trống");
    }
    if (version !== state.requestVersion) {
      return true;
    }

    const pageSize = Number(layout.page) || 500;
    const count = layout.id.length;
    const items = new Array(count);
    const byId = new Map();
    for (let index = 0; index < count; index += 1) {
      const item = buildAlbumItem(layout, index, pageSize);
      items[index] = item;
      byId.set(item.id, item);
    }

    state.items = items;
    state.total = count;
    state.stats = deriveStats(items);
    state.facets = deriveFacets(items);
    state.folderFacets = state.facets;
    state.hasMore = false;
    state.clientCatalogComplete = true;
    state.serverMetadataStatus = { available: true, items: count, generatedAt: "" };
    state.renderedCount = 0;
    setMode("album");
    syncMetadataStatus();
    refreshDirectoryItems(false);

    // Enrich progressively from the meta pages without blocking the first paint.
    loadAlbumMeta(version, count, pageSize, byId).catch(() => {});
    return true;
  }

  async function loadAlbumMeta(version, count, pageSize, byId) {
    const pageCount = Math.ceil(count / pageSize);
    const token = ++state.albumMetaToken;
    const queue = [];
    for (let page = 0; page < pageCount; page += 1) {
      queue.push(page);
    }
    const worker = async () => {
      while (queue.length > 0) {
        if (token !== state.albumMetaToken || version !== state.requestVersion) {
          return;
        }
        const page = queue.shift();
        try {
          const response = await fetchWithTimeout(albumMetaUrl(page), API_TIMEOUT_MS);
          if (!response.ok) {
            continue;
          }
          const entries = await response.json();
          if (!Array.isArray(entries) || token !== state.albumMetaToken) {
            continue;
          }
          for (const entry of entries) {
            const item = byId.get(String(entry.id));
            if (item) {
              applyAlbumMeta(item, entry);
            }
          }
        } catch {
          // Skip a page we could not read; the rest still enrich the catalog.
        }
      }
    };
    const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, pageCount);
    await Promise.all(Array.from({ length: workerCount }, worker));
    if (token !== state.albumMetaToken || version !== state.requestVersion) {
      return;
    }

    // Reconcile once all detail is in: rebuild facets and re-render so folder
    // labels, camera filters, smart events and precise ordering are correct.
    state.facets = deriveFacets(state.items);
    state.folderFacets = state.facets;
    state.stats = deriveStats(state.items);
    renderTimelineRail();
    if (!["albums", "map"].includes(state.view)) {
      refreshDirectoryItems(true);
    }
    updateSummary();
    saveCachedCatalog().catch(() => {});
  }

  async function ensureAlbumItemMeta(item) {
    if (!item || item.source !== "album" || !item.metaPending) {
      return;
    }
    try {
      const response = await fetchWithTimeout(albumMetaUrl(item.metaPage || 0), API_TIMEOUT_MS);
      if (!response.ok) {
        return;
      }
      const entries = await response.json();
      if (!Array.isArray(entries)) {
        return;
      }
      for (const entry of entries) {
        if (String(entry.id) === item.id) {
          applyAlbumMeta(item, entry);
          break;
        }
      }
    } catch {
      // Leave metaPending set; the viewer will show its error state.
    }
  }

  function catalogCacheUrl() {
    const url = new URL("./__offline/catalog.json", window.location.href);
    url.search = "";
    url.searchParams.set("endpoint", state.baseUrl);
    return url.href;
  }

  async function saveCachedCatalog() {
    if (!canUseCacheStorage() || !state.endpoint || !["api", "album", "directory"].includes(state.mode)) {
      return;
    }
    if (state.mode === "api" && (state.view !== "library" ||
      state.filter !== "all" || state.query.trim() || activeTimelineFilterCount() > 0
    )) {
      return;
    }

    const cache = await caches.open(CATALOG_CACHE_NAME);
    const payload = {
      version: 4,
      endpoint: state.baseUrl,
      savedAt: Date.now(),
      sourceMode: state.mode,
      items: state.items,
      stats: state.stats,
      facets: state.facets,
      metadataStatus: state.metadataStatus,
      serverMetadataStatus: state.serverMetadataStatus,
      catalogComplete: state.clientCatalogComplete,
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
      if (![1, 2, 3, 4].includes(payload?.version) || payload.endpoint !== state.baseUrl || !Array.isArray(payload.items)) {
        return false;
      }

      const items = payload.items.filter((item) =>
        item && typeof item.url === "string" && typeof item.name === "string" &&
        (item.type === "image" || item.type === "video")).map(mergeImportedMetadata);
      if (items.length === 0) {
        return false;
      }

      state.items = items;
      state.visibleItems = items;
      state.total = items.length;
      state.stats = state.localMetadataStatus.available ? deriveStats(items) : (payload.stats || deriveStats(items));
      state.hasMore = false;
      state.clientCatalogComplete = Boolean(payload.catalogComplete);
      state.renderedCount = 0;
      state.facets = state.localMetadataStatus.available ? deriveFacets(items) : (payload.version >= 2 && payload.facets
        ? normalizeFacets(payload.facets)
        : deriveFacets(items));
      state.folderFacets = state.facets;
      state.serverMetadataStatus = payload.version >= 4
        ? normalizeMetadataStatus(payload.serverMetadataStatus)
        : (payload.version >= 3
        ? normalizeMetadataStatus(payload.metadataStatus)
        : { available: false, items: 0, generatedAt: "" });
      syncMetadataStatus();
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
        credentials: state.endpoint?.kind === "cloud" ? "include" : "same-origin",
        mode: "cors",
        signal: controller.signal,
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
    state.serverMetadataStatus = normalizeMetadataStatus(payload.metadata);
    syncMetadataStatus();
  }

  function apiItemsUrl({ offset, force, catalog = false }) {
    const url = new URL("api/items", state.baseUrl);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(catalog ? CATALOG_PAGE_SIZE : PAGE_SIZE));
    url.searchParams.set("type", catalog ? "all" : state.filter);
    url.searchParams.set("sort", catalog ? "name-asc" : state.sort);
    if (!catalog && state.query.trim()) {
      url.searchParams.set("q", state.query.trim());
    }
    if (!catalog) {
      for (const [name, value] of Object.entries(state.timelineFilters)) {
        if (value) {
          url.searchParams.set(name, value);
        }
      }
    }
    if (force) {
      url.searchParams.set("refresh", "1");
    }
    return url;
  }

  async function fetchApiPage({ offset, force, version, catalog = false }) {
    const response = await fetchWithTimeout(apiItemsUrl({ offset, force, catalog }), API_TIMEOUT_MS);
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
      const nextItems = payload.items.map((item) => normalizeApiItem(item));
      state.items = reset ? nextItems : [...state.items, ...nextItems];
      state.total = Number(payload.total) || 0;
      state.stats = state.localMetadataStatus.available ? deriveStats(state.items) : (payload.stats || null);
      if (payload.metadata) {
        state.serverMetadataStatus = normalizeMetadataStatus(payload.metadata);
        syncMetadataStatus();
      }
      state.hasMore = Boolean(payload.hasMore);
      if (payload.facets) {
        state.facets = state.localMetadataStatus.available
          ? deriveFacets(state.items)
          : normalizeFacets(payload.facets);
        if (state.filter === "all" && !state.query.trim()) {
          state.folderFacets = state.facets;
        }
      }
      setMode("api");

      if (reset) {
        clearMediaGrid();
        state.renderedCount = 0;
      }
      if (state.view === "albums") {
        renderFolderView();
      } else if (state.view === "map") {
        renderMapView();
      } else {
        updateVisibleItems();
        renderNextPage(Math.max(nextItems.length || PAGE_SIZE, state.visibleItems.length - state.renderedCount));
      }
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

  async function loadFullApiCatalog({ force = false, version = state.requestVersion } = {}) {
    const items = [];
    let offset = 0;
    let total = 0;
    state.clientCatalogComplete = false;
    state.isLoadingMore = true;

    try {
      do {
        const payload = await fetchApiPage({
          offset,
          force: force && offset === 0,
          version,
          catalog: true,
        });
        if (!payload || version !== state.requestVersion) {
          return false;
        }
        items.push(...payload.items.map((item) => normalizeApiItem(item)));
        total = Number(payload.total) || items.length;
        offset += payload.items.length;
        if (payload.metadata) {
          state.serverMetadataStatus = normalizeMetadataStatus(payload.metadata);
          syncMetadataStatus();
        }
        elements.scanStatusText.textContent =
          `Đang chuẩn bị ${numberFormatter.format(items.length)} / ${numberFormatter.format(total)} mục…`;
        if (!payload.hasMore || payload.items.length === 0) {
          break;
        }
      } while (offset < total);

      if (version !== state.requestVersion) {
        return false;
      }
      state.items = items;
      state.total = items.length;
      state.stats = deriveStats(items);
      state.facets = deriveFacets(items);
      state.folderFacets = state.facets;
      state.hasMore = false;
      state.clientCatalogComplete = true;
      setMode("api");
      clearMediaGrid();
      state.renderedCount = 0;
      if (state.view === "albums") {
        renderFolderView();
      } else if (state.view === "map") {
        renderMapView();
      } else {
        updateVisibleItems();
        renderNextPage(PAGE_SIZE);
      }
      updateSummary();
      updateEmptyState();
      saveCachedCatalog().catch(() => {});
      return true;
    } finally {
      state.isLoadingMore = false;
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
    state.stats = deriveStats(state.items);
    state.facets = deriveFacets(state.items);
    state.folderFacets = state.facets;
    updateTimelineFilterUi();
    refreshDirectoryItems(false);
    saveCachedCatalog().catch(() => {});
  }

  function renderSkeletons() {
    clearMediaGrid();
    const fragment = document.createDocumentFragment();
    const grid = document.createElement("div");
    grid.className = "skeleton-grid";
    for (let index = 0; index < 12; index += 1) {
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
      grid.append(card);
    }
    fragment.append(grid);
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
    if (state.sort === "newest" || state.sort === "oldest") {
      const direction = state.sort === "newest" ? -1 : 1;
      const dateDifference = (itemTimestamp(left) - itemTimestamp(right)) * direction;
      if (dateDifference !== 0) {
        return dateDifference;
      }
    }
    return collator.compare(left.relative, right.relative);
  }

  function storedViewItems(collection, ids = new Set(collection.keys())) {
    const merged = new Map(collection);
    for (const item of state.items) {
      if (ids.has(item.id)) {
        merged.set(item.id, item);
      }
    }
    return [...merged.values()].filter(validCollectionItem).map(mergeImportedMetadata);
  }

  function itemSearchText(item) {
    const metadataText = item.metadata && typeof item.metadata === "object"
      ? Object.values(item.metadata).filter((value) => ["string", "number"].includes(typeof value)).join(" ")
      : "";
    return `${item.name} ${item.folder} ${item.camera || ""} ${metadataText}`.toLocaleLowerCase("vi");
  }

  function updateVisibleItems() {
    const normalizedQuery = state.query.trim().toLocaleLowerCase("vi");
    const collectionItems = collectionItemsForCurrentView();
    const sourceItems = collectionItems || state.items;
    state.visibleItems = sourceItems
      .filter((item) => state.view === "hidden" || !state.hiddenIds.has(item.id))
      .filter((item) => state.filter === "all" || item.type === state.filter)
      .filter(itemMatchesTimelineFilters)
      .filter((item) => !normalizedQuery || itemSearchText(item).includes(normalizedQuery))
      .sort(compareDirectoryItems);
  }

  function refreshDirectoryItems(keepRenderLimit = false) {
    updateViewUi();
    if (state.view === "albums") {
      renderFolderView();
      updateSummary();
      updateEmptyState();
      return;
    }
    if (state.view === "map") {
      renderMapView();
      updateSummary();
      updateEmptyState();
      return;
    }
    updateVisibleItems();
    if (state.mode !== "api" || state.view !== "library") {
      state.total = state.visibleItems.length;
    }

    const targetCount = keepRenderLimit ? Math.max(state.renderedCount, PAGE_SIZE) : PAGE_SIZE;
    state.renderedCount = 0;
    clearMediaGrid();
    renderNextPage(targetCount);
    updateSummary();
    updateEmptyState();
  }

  function itemCoordinates(item) {
    const latitude = Number(item.metadata?.latitude);
    const longitude = Number(item.metadata?.longitude);
    if (!item.hasLocation || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return null;
    }
    return [longitude, latitude];
  }

  function mapItemsForCurrentFilters() {
    const normalizedQuery = state.query.trim().toLocaleLowerCase("vi");
    return state.items
      .filter((item) => !state.hiddenIds.has(item.id))
      .filter((item) => state.filter === "all" || item.type === state.filter)
      .filter(itemMatchesTimelineFilters)
      .filter((item) => !normalizedQuery || itemSearchText(item).includes(normalizedQuery))
      .filter((item) => itemCoordinates(item))
      .sort(compareDirectoryItems);
  }

  function setMapEmptyState(title, copy) {
    const heading = elements.mapEmpty.querySelector("strong");
    const description = elements.mapEmpty.querySelector("p");
    if (heading) heading.textContent = title;
    if (description) description.textContent = copy;
    elements.mapEmpty.hidden = false;
    elements.mapCanvas.hidden = true;
  }

  function loadMapLibre() {
    if (window.maplibregl) {
      return Promise.resolve(window.maplibregl);
    }
    if (mapLibreLoadPromise) {
      return mapLibreLoadPromise;
    }
    mapLibreLoadPromise = new Promise((resolve, reject) => {
      if (!document.querySelector("#my-album-maplibre-css")) {
        const stylesheet = document.createElement("link");
        stylesheet.id = "my-album-maplibre-css";
        stylesheet.rel = "stylesheet";
        stylesheet.href = MAPLIBRE_CSS_URL;
        document.head.append(stylesheet);
      }
      const existingScript = document.querySelector("#my-album-maplibre-js");
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(window.maplibregl), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("Không tải được thư viện bản đồ.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.id = "my-album-maplibre-js";
      script.src = MAPLIBRE_JS_URL;
      script.async = true;
      script.addEventListener("load", () => {
        if (window.maplibregl) {
          resolve(window.maplibregl);
        } else {
          reject(new Error("Thư viện bản đồ không hợp lệ."));
        }
      }, { once: true });
      script.addEventListener("error", () => reject(new Error("Không tải được thư viện bản đồ.")), { once: true });
      document.head.append(script);
    }).catch((error) => {
      mapLibreLoadPromise = null;
      throw error;
    });
    return mapLibreLoadPromise;
  }

  function mapFeatureCollection() {
    return {
      type: "FeatureCollection",
      features: state.mapItems.map((item) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: itemCoordinates(item) },
        properties: {
          id: item.id,
          name: item.name,
          folder: item.folder,
          detail: itemDetail(item),
          type: item.type,
        },
      })),
    };
  }

  function showMapItem(itemId) {
    const index = state.mapItems.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return;
    }
    state.visibleItems = state.mapItems;
    showViewer(index);
  }

  function showMapPopup(feature, coordinates) {
    const itemId = String(feature.properties?.id || "");
    const item = state.mapItems.find((candidate) => candidate.id === itemId);
    if (!item || !state.map || !window.maplibregl) {
      return;
    }
    const content = document.createElement("button");
    content.type = "button";
    content.className = "map-popup";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const detail = document.createElement("span");
    detail.textContent = [item.folder, itemDetail(item)].filter(Boolean).join(" · ");
    content.append(name, detail);
    content.addEventListener("click", () => showMapItem(item.id));
    new window.maplibregl.Popup({ closeButton: false, offset: 16 })
      .setLngLat(coordinates)
      .setDOMContent(content)
      .addTo(state.map);
  }

  function installMapLayers(map) {
    if (map.getSource("album-media")) {
      return;
    }
    map.addSource("album-media", {
      type: "geojson",
      data: mapFeatureCollection(),
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 44,
    });
    map.addLayer({
      id: "album-clusters",
      type: "circle",
      source: "album-media",
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#197f6c",
        "circle-radius": ["step", ["get", "point_count"], 17, 10, 21, 40, 26],
        "circle-opacity": 0.92,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: "album-cluster-count",
      type: "symbol",
      source: "album-media",
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-font": ["Noto Sans Regular"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: "album-point",
      type: "circle",
      source: "album-media",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["case", ["==", ["get", "type"], "video"], "#d4665b", "#216ea8"],
        "circle-radius": 8,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });
    map.on("click", "album-clusters", (event) => {
      const feature = map.queryRenderedFeatures(event.point, { layers: ["album-clusters"] })[0];
      const clusterId = feature?.properties?.cluster_id;
      const source = map.getSource("album-media");
      if (!source || clusterId === undefined) {
        return;
      }
      Promise.resolve(source.getClusterExpansionZoom(Number(clusterId)))
        .then((zoom) => {
          if (feature?.geometry?.type === "Point") {
            map.easeTo({ center: feature.geometry.coordinates, zoom });
          }
        })
        .catch(() => {});
    });
    map.on("click", "album-point", (event) => {
      const feature = event.features?.[0];
      if (!feature || feature.geometry?.type !== "Point") {
        return;
      }
      const coordinates = feature.geometry.coordinates.slice();
      while (Math.abs(event.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += event.lngLat.lng > coordinates[0] ? 360 : -360;
      }
      showMapPopup(feature, coordinates);
    });
    for (const layerId of ["album-clusters", "album-point"]) {
      map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
    }
  }

  function updateMapData() {
    if (!state.map || !state.mapReady) {
      return;
    }
    try {
      installMapLayers(state.map);
      const data = mapFeatureCollection();
      state.map.getSource("album-media")?.setData(data);
      const dataKey = state.mapItems.map((item) => item.id).join("|");
      if (data.features.length > 0 && dataKey !== state.mapLastDataKey) {
        state.mapLastDataKey = dataKey;
        if (data.features.length === 1) {
          state.map.easeTo({ center: data.features[0].geometry.coordinates, zoom: 13 });
        } else {
          const bounds = data.features.reduce((result, feature) => result.extend(feature.geometry.coordinates),
            new window.maplibregl.LngLatBounds(data.features[0].geometry.coordinates, data.features[0].geometry.coordinates));
          state.map.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 550 });
        }
      }
      window.setTimeout(() => state.map?.resize(), 0);
    } catch {
      setMapEmptyState("Chưa tải được bản đồ", "Thử lại khi có kết nối Internet.");
    }
  }

  function ensureMap() {
    if (state.map || !window.maplibregl) {
      return state.map;
    }
    const map = new window.maplibregl.Map({
      container: elements.mapCanvas,
      style: OPEN_FREE_MAP_STYLE_URL,
      center: [105.8342, 21.0285],
      zoom: 4,
      attributionControl: true,
    });
    state.map = map;
    map.addControl(new window.maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      state.mapReady = true;
      updateMapData();
    });
    return map;
  }

  function renderMapView() {
    const mapItems = mapItemsForCurrentFilters();
    state.mapItems = mapItems;
    elements.mapItemCount.textContent = `${numberFormatter.format(mapItems.length)} mục có GPS`;
    if (mapItems.length === 0) {
      setMapEmptyState("Chưa có ảnh có GPS", "Nhập metadata có tọa độ để xem ảnh theo vị trí.");
      return;
    }
    elements.mapEmpty.hidden = true;
    elements.mapCanvas.hidden = false;
    const renderToken = ++state.mapRenderToken;
    loadMapLibre()
      .then(() => {
        if (renderToken !== state.mapRenderToken || state.view !== "map") {
          return;
        }
        ensureMap();
        updateMapData();
      })
      .catch(() => {
        if (renderToken === state.mapRenderToken) {
          setMapEmptyState("Chưa tải được bản đồ", "Thử lại khi có kết nối Internet.");
        }
      });
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
    image.albumThumbnail?.preview?.classList.remove("is-thumbnail-ready");
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
    for (const card of elements.mediaGrid.querySelectorAll("[data-folder-card]")) {
      folderSummaryObserver?.unobserve(card);
    }
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
        image.albumThumbnail?.preview?.classList.add("is-thumbnail-ready");
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

  function folderSummaryFromLoadedItems(folder) {
    const items = state.items.filter((item) => itemFolderKey(item) === folder);
    items.sort((left, right) => itemTimestamp(right) - itemTimestamp(left));
    const complete = state.mode !== "api" || state.clientCatalogComplete;
    return {
      complete,
      count: complete ? items.length : null,
      cover: items[0] || null,
    };
  }

  function updateFolderCard(card, summary) {
    if (!card) {
      return;
    }
    const count = card.querySelector(".folder-count");
    count.textContent = Number.isFinite(summary.count)
      ? `${numberFormatter.format(summary.count)} mục`
      : "Đang tải ảnh bìa";

    const cover = card.querySelector(".folder-cover");
    if (!summary.cover || cover.dataset.coverId === summary.cover.id) {
      cover.classList.toggle("has-cover", Boolean(summary.cover));
      return;
    }
    const previousImage = cover.querySelector("img");
    if (previousImage) {
      releaseThumbnailImage(previousImage);
      previousImage.remove();
    }
    cover.dataset.coverId = summary.cover.id;
    cover.classList.add("has-cover");
    addPreviewImage(cover, summary.cover);
  }

  function createFolderCard(folder, summary) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "folder-card";
    card.dataset.folderCard = "";
    card.dataset.folder = folder;
    const label = folderFilterLabel(folder);
    card.setAttribute("aria-label", `Mở album ${label}`);

    const cover = document.createElement("span");
    cover.className = "media-preview folder-cover";
    cover.innerHTML = '<span class="folder-cover-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" /></svg></span>';

    const copy = document.createElement("span");
    copy.className = "folder-card-copy";
    const title = document.createElement("strong");
    title.textContent = label;
    const count = document.createElement("small");
    count.className = "folder-count";
    copy.append(title, count);
    card.append(cover, copy);
    updateFolderCard(card, summary);
    return card;
  }

  function folderSummaryUrl(folder, baseUrl = state.baseUrl, offset = 1) {
    const url = new URL("api/items", baseUrl);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", "1");
    url.searchParams.set("type", "all");
    url.searchParams.set("sort", "newest");
    url.searchParams.set("folder", folder);
    return url;
  }

  async function fetchFolderSummaryPage(folder, baseUrl, offset) {
    const response = await fetchWithTimeout(folderSummaryUrl(folder, baseUrl, offset), API_TIMEOUT_MS);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error(`Album HTTP ${response.status}`);
    }
    return response.json();
  }

  async function fetchFolderSummary(folder, baseUrl) {
    let payload = await fetchFolderSummaryPage(folder, baseUrl, 1);
    const count = Number(payload.total) || 0;
    if (count === 1 && (!Array.isArray(payload.items) || payload.items.length === 0)) {
      payload = await fetchFolderSummaryPage(folder, baseUrl, 0);
    }
    return {
      complete: true,
      count,
      cover: Array.isArray(payload.items) && payload.items[0]
        ? normalizeApiItem(payload.items[0], baseUrl)
        : null,
    };
  }

  async function refreshFolderOverview(version) {
    const url = new URL("api/items", state.baseUrl);
    url.searchParams.set("offset", "0");
    url.searchParams.set("limit", "1");
    url.searchParams.set("type", "all");
    url.searchParams.set("sort", "newest");
    const response = await fetchWithTimeout(url, API_TIMEOUT_MS);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error(`Danh sách album HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (version !== state.requestVersion || state.view !== "albums") {
      return false;
    }
    state.folderFacets = normalizeFacets(payload.facets);
    state.stats = payload.stats || state.stats;
    renderFolderView();
    updateSummary();
    updateEmptyState();
    return true;
  }

  function folderSummaryTaskKey(baseUrl, folder) {
    return `${baseUrl}\n${folder}`;
  }

  function drainFolderSummaryQueue() {
    while (activeFolderSummaryRequests < MAX_FOLDER_SUMMARY_REQUESTS && folderSummaryQueue.length > 0) {
      const task = folderSummaryQueue.shift();
      activeFolderSummaryRequests += 1;
      fetchFolderSummary(task.folder, task.baseUrl)
        .then((summary) => {
          if (task.baseUrl === state.baseUrl) {
            state.folderSummaries.set(task.folder, summary);
          }
          for (const card of folderSummaryWaiters.get(task.key) || []) {
            if (card.isConnected && card.dataset.folder === task.folder) {
              updateFolderCard(card, summary);
            }
          }
        })
        .catch(() => {
          for (const card of folderSummaryWaiters.get(task.key) || []) {
            if (card.isConnected) {
              const count = card.querySelector(".folder-count");
              count.textContent = "Không đọc được album";
            }
          }
        })
        .finally(() => {
          activeFolderSummaryRequests -= 1;
          folderSummaryWaiters.delete(task.key);
          drainFolderSummaryQueue();
        });
    }
  }

  function queueFolderSummary(folder, card) {
    if (!folder || !card) {
      return;
    }
    const cached = state.folderSummaries.get(folder);
    if (cached?.complete) {
      updateFolderCard(card, cached);
      return;
    }
    const key = folderSummaryTaskKey(state.baseUrl, folder);
    const waiters = folderSummaryWaiters.get(key);
    if (waiters) {
      waiters.add(card);
      return;
    }
    folderSummaryWaiters.set(key, new Set([card]));
    folderSummaryQueue.push({ key, folder, baseUrl: state.baseUrl });
    drainFolderSummaryQueue();
  }

  function renderFolderView() {
    clearMediaGrid();
    state.visibleItems = [];
    state.renderedCount = 0;
    const query = state.query.trim().toLocaleLowerCase("vi");
    const availableFolders = state.folderFacets.folders.length > 0
      ? state.folderFacets.folders
      : state.facets.folders;
    const folders = availableFolders
      .filter((folder) => !query || folderFilterLabel(folder).toLocaleLowerCase("vi").includes(query))
      .sort(folderCollator.compare);
    const customCollections = customCollectionsByRecentUpdate()
      .filter((collection) => !query || collection.name.toLocaleLowerCase("vi").includes(query));
    const events = smartEvents().filter((event) => !query ||
      `${event.name} ${event.detail}`.toLocaleLowerCase("vi").includes(query));
    state.folderViewCount = folders.length;
    state.albumViewCounts = {
      folders: folders.length,
      collections: customCollections.length,
      events: events.length,
    };
    if (folders.length === 0 && customCollections.length === 0 && events.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    if (customCollections.length > 0) {
      const cards = customCollections.map((collection) => {
        const items = customCollectionItems(collection.id);
        const cover = items.slice().sort((left, right) => itemTimestamp(right) - itemTimestamp(left))[0] || collection.items[0];
        return createCollectionCard({
          kind: "custom",
          id: collection.id,
          name: collection.name,
          detail: `${numberFormatter.format(items.length || collection.itemIds.length)} mục`,
          cover,
        });
      });
      fragment.append(createOrganizeSection(
        "Bộ sưu tập",
        `${numberFormatter.format(customCollections.length)} nhóm`,
        cards,
        "custom",
      ));
    }
    if (events.length > 0) {
      const cards = events.map((event) => createCollectionCard({
        kind: "event",
        id: event.id,
        name: event.name,
        detail: event.detail,
        cover: event.cover,
      }));
      fragment.append(createOrganizeSection(
        "Sự kiện",
        `${numberFormatter.format(events.length)} nhóm`,
        cards,
        "events",
      ));
    }
    if (folders.length === 0) {
      elements.mediaGrid.append(fragment);
      return;
    }

    const folderSection = document.createElement("section");
    folderSection.className = "collection-section collection-section-folders";
    const header = document.createElement("header");
    header.className = "collection-section-header";
    const heading = document.createElement("h2");
    heading.textContent = "Thư mục";
    const description = document.createElement("p");
    description.textContent = `${numberFormatter.format(folders.length)} thư mục`;
    header.append(heading, description);
    const grid = document.createElement("div");
    grid.className = "folder-grid collection-grid";
    for (const folder of folders) {
      const loadedSummary = folderSummaryFromLoadedItems(folder);
      const summary = state.folderSummaries.get(folder) || loadedSummary;
      if (loadedSummary.complete && !state.folderSummaries.has(folder)) {
        state.folderSummaries.set(folder, loadedSummary);
      }
      const card = createFolderCard(folder, summary);
      grid.append(card);
      if (state.mode === "api" && !summary.complete) {
        if (folderSummaryObserver) {
          folderSummaryObserver.observe(card);
        } else {
          queueFolderSummary(folder, card);
        }
      }
    }
    folderSection.append(header, grid);
    fragment.append(folderSection);
    elements.mediaGrid.append(fragment);
  }

  function updateSelectionUi() {
    const selectedCount = state.selectedIds.size;
    const selectedItems = state.visibleItems.filter((item) => state.selectedIds.has(item.id));
    const allSelectedFavorited = selectedItems.length > 0 &&
      selectedItems.every((item) => state.favoriteItems.has(item.id));
    const allVisibleSelected = state.visibleItems.length > 0 &&
      state.visibleItems.every((item) => state.selectedIds.has(item.id));

    elements.mediaGrid.classList.toggle("is-selecting", state.selectionMode);
    document.body.classList.toggle("has-selection", state.selectionMode);
    elements.selectionBar.hidden = !state.selectionMode;
    elements.selectButton.hidden = ["albums", "map"].includes(state.view) || !state.mode ||
      state.visibleItems.length === 0 || state.selectionMode;
    elements.selectionCount.textContent = `${numberFormatter.format(selectedCount)} mục đã chọn`;
    elements.selectAllButton.textContent = allVisibleSelected ? "Bỏ chọn tất cả" : "Chọn tất cả";
    elements.selectAllButton.disabled = state.visibleItems.length === 0 || state.isDownloading;
    elements.downloadSelected.disabled = selectedCount === 0 || state.isDownloading;
    elements.collectionSelected.disabled = selectedCount === 0 || state.isDownloading;
    elements.favoriteSelected.disabled = selectedCount === 0 || state.isDownloading;
    elements.favoriteSelected.querySelector("span").textContent = allSelectedFavorited
      ? "Bỏ yêu thích"
      : "Yêu thích";
    elements.favoriteSelected.classList.toggle("is-active", allSelectedFavorited);
    elements.hideSelected.disabled = selectedCount === 0 || state.isDownloading;
    elements.restoreSelected.disabled = selectedCount === 0 || state.isDownloading;
    elements.hideSelected.hidden = state.view === "hidden";
    elements.restoreSelected.hidden = state.view !== "hidden";

    for (const card of elements.mediaGrid.querySelectorAll(".media-card:not(.is-skeleton)")) {
      const item = state.visibleItems[Number(card.dataset.index)];
      const isSelected = Boolean(item && state.selectedIds.has(item.id));
      card.classList.toggle("is-selected", isSelected);
      card.classList.toggle("is-favorite", Boolean(item && state.favoriteItems.has(item.id)));
      if (state.selectionMode) {
        card.setAttribute("aria-pressed", String(isSelected));
        card.setAttribute("aria-label", `${isSelected ? "Bỏ chọn" : "Chọn"} ${item?.name || "mục"}`);
      } else {
        card.removeAttribute("aria-pressed");
        if (item) {
          card.setAttribute("aria-label", `Mở ${item.name}`);
        }
      }
    }

    const groupSelection = new Map();
    for (const item of state.visibleItems) {
      const key = timelineGroupKey(item);
      const status = groupSelection.get(key) || { total: 0, selected: 0 };
      status.total += 1;
      if (state.selectedIds.has(item.id)) {
        status.selected += 1;
      }
      groupSelection.set(key, status);
    }
    for (const button of elements.mediaGrid.querySelectorAll("[data-select-group]")) {
      const status = groupSelection.get(button.dataset.selectGroup);
      const isSelected = Boolean(status && status.total > 0 && status.selected === status.total);
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
    }
  }

  function enterSelectionMode(initialIndex = -1) {
    if (state.visibleItems.length === 0) {
      return;
    }
    state.selectionMode = true;
    state.lastSelectedIndex = -1;
    if (initialIndex >= 0 && state.visibleItems[initialIndex]) {
      state.selectedIds.add(state.visibleItems[initialIndex].id);
      state.lastSelectedIndex = initialIndex;
    }
    updateSelectionUi();
  }

  function exitSelectionMode() {
    state.downloadAbortController?.abort();
    state.downloadAbortController = null;
    state.isDownloading = false;
    state.selectionMode = false;
    state.selectedIds.clear();
    state.lastSelectedIndex = -1;
    elements.selectionBar.classList.remove("is-busy");
    elements.selectionProgress.hidden = true;
    elements.selectionProgressBar.style.width = "0%";
    updateSelectionUi();
  }

  function toggleItemSelection(index, useRange = false) {
    const item = state.visibleItems[index];
    if (!item) {
      return;
    }

    if (useRange && state.lastSelectedIndex >= 0) {
      const start = Math.min(state.lastSelectedIndex, index);
      const end = Math.max(state.lastSelectedIndex, index);
      for (let cursor = start; cursor <= end; cursor += 1) {
        state.selectedIds.add(state.visibleItems[cursor].id);
      }
    } else if (state.selectedIds.has(item.id)) {
      state.selectedIds.delete(item.id);
    } else {
      state.selectedIds.add(item.id);
    }

    state.lastSelectedIndex = index;
    updateSelectionUi();
  }

  function toggleSelectAll() {
    const allSelected = state.visibleItems.length > 0 &&
      state.visibleItems.every((item) => state.selectedIds.has(item.id));
    for (const item of state.visibleItems) {
      if (allSelected) {
        state.selectedIds.delete(item.id);
      } else {
        state.selectedIds.add(item.id);
      }
    }
    state.lastSelectedIndex = -1;
    updateSelectionUi();
  }

  function toggleTimelineGroup(groupKey) {
    const groupItems = state.visibleItems.filter((item) => timelineGroupKey(item) === groupKey);
    if (groupItems.length === 0) {
      return;
    }
    const allSelected = groupItems.every((item) => state.selectedIds.has(item.id));
    state.selectionMode = true;
    state.lastSelectedIndex = -1;
    for (const item of groupItems) {
      if (allSelected) {
        state.selectedIds.delete(item.id);
      } else {
        state.selectedIds.add(item.id);
      }
    }
    updateSelectionUi();
  }

  function updateFavoriteUi() {
    updateCollectionCounts();
    for (const card of elements.mediaGrid.querySelectorAll(".media-card:not(.is-skeleton)")) {
      const item = state.visibleItems[Number(card.dataset.index)];
      card.classList.toggle("is-favorite", Boolean(item && state.favoriteItems.has(item.id)));
    }
    const viewerItem = state.visibleItems[state.viewerIndex];
    if (viewerItem && elements.viewerDialog.open) {
      updateViewerActionUi(viewerItem);
    }
  }

  function setItemsFavorite(items, shouldFavorite) {
    if (items.length === 0) {
      return false;
    }
    const previous = new Map(state.favoriteItems);
    for (const item of items) {
      if (shouldFavorite) {
        state.favoriteItems.set(item.id, collectionItemSnapshot(item));
      } else {
        state.favoriteItems.delete(item.id);
      }
    }
    if (!saveFavoriteItems()) {
      state.favoriteItems = previous;
      updateFavoriteUi();
      return false;
    }
    updateFavoriteUi();
    return true;
  }

  function toggleSelectedFavorites() {
    const items = state.visibleItems.filter((item) => state.selectedIds.has(item.id));
    const shouldFavorite = !items.every((item) => state.favoriteItems.has(item.id));
    if (!setItemsFavorite(items, shouldFavorite)) {
      return;
    }
    const count = items.length;
    exitSelectionMode();
    if (state.view === "favorites" && !shouldFavorite) {
      refreshDirectoryItems(false);
    }
    showToast(shouldFavorite
      ? `Đã thêm ${numberFormatter.format(count)} mục vào yêu thích.`
      : `Đã bỏ yêu thích ${numberFormatter.format(count)} mục.`);
  }

  function applyHiddenAction(shouldHide) {
    const selectedItems = state.visibleItems.filter((item) => state.selectedIds.has(item.id));
    if (selectedItems.length === 0) {
      return;
    }

    const previousHiddenIds = new Set(state.hiddenIds);
    const previousHiddenItems = new Map(state.hiddenItems);
    for (const item of selectedItems) {
      if (shouldHide) {
        state.hiddenIds.add(item.id);
        state.hiddenItems.set(item.id, collectionItemSnapshot(item));
      } else {
        state.hiddenIds.delete(item.id);
        state.hiddenItems.delete(item.id);
      }
    }
    if (!saveHiddenItems()) {
      state.hiddenIds = previousHiddenIds;
      state.hiddenItems = previousHiddenItems;
      updateCollectionCounts();
      return;
    }

    const count = selectedItems.length;
    exitSelectionMode();
    refreshDirectoryItems(false);
    showToast(shouldHide
      ? `Đã ẩn ${numberFormatter.format(count)} mục khỏi thư viện.`
      : `Đã đưa ${numberFormatter.format(count)} mục trở lại thư viện.`);
  }

  function timelineGroupKey(item) {
    if (state.sort === "name-asc" || state.sort === "name-desc") {
      const firstCharacter = item.name.trim().charAt(0).toLocaleUpperCase("vi") || "#";
      return `name:${firstCharacter}`;
    }
    const dateKey = itemDateKey(item);
    if (dateKey) {
      return `date:${dateKey}`;
    }
    return `folder:${item.folder || "Thư mục gốc"}`;
  }

  function timelineGroup(item) {
    const key = timelineGroupKey(item);
    if (key.startsWith("name:")) {
      return { key, title: key.slice(5) };
    }
    if (key.startsWith("date:")) {
      const date = new Date(`${key.slice(5)}T12:00:00`);
      const formatted = timelineDateFormatter.format(date);
      return { key, title: formatted.charAt(0).toLocaleUpperCase("vi") + formatted.slice(1) };
    }
    return { key, title: item.folder || "Thư mục gốc" };
  }

  function createTimelineSection(group) {
    const section = document.createElement("section");
    section.className = "timeline-section";
    section.dataset.groupKey = group.key;

    const header = document.createElement("header");
    header.className = "timeline-header";
    const select = document.createElement("button");
    select.type = "button";
    select.className = "timeline-select-button";
    select.dataset.selectGroup = group.key;
    select.setAttribute("aria-label", `Chọn nhóm ${group.title}`);
    select.setAttribute("aria-pressed", "false");
    select.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 12 3 3 7-7" /></svg>';
    const title = document.createElement("h2");
    title.textContent = group.title;
    const count = document.createElement("span");
    count.className = "timeline-count";
    count.dataset.count = "0";
    count.textContent = "0 mục";
    header.append(select, title, count);

    const grid = document.createElement("div");
    grid.className = "timeline-grid";
    section.append(header, grid);
    return section;
  }

  function increaseTimelineCount(section) {
    const count = section.querySelector(".timeline-count");
    const nextCount = Number(count.dataset.count || 0) + 1;
    count.dataset.count = String(nextCount);
    count.textContent = `${numberFormatter.format(nextCount)} mục`;
  }

  function metadataPlaceholderTone(item) {
    const tones = ["#477d8a", "#66799f", "#8a6f59", "#667f6a", "#8a6679", "#847252"];
    const source = `${item.relative || item.name || item.id}`;
    let hash = 0;
    for (const character of source) {
      hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
    }
    return tones[hash % tones.length];
  }

  function addMetadataPlaceholder(preview, item) {
    if (!item.hasMetadata) {
      return;
    }
    const metadata = item.metadata || {};
    const width = Number(metadata.width);
    const height = Number(metadata.height);
    const dimensions = width > 0 && height > 0
      ? `${numberFormatter.format(width)} × ${numberFormatter.format(height)}`
      : item.type === "video" ? "Video" : "Ảnh";
    const placeholder = document.createElement("span");
    placeholder.className = "metadata-placeholder";
    const tone = /^[0-9a-fA-F]{6}$/.test(item.color || "")
      ? `#${item.color}`
      : metadataPlaceholderTone(item);
    placeholder.style.setProperty("--metadata-placeholder-tone", tone);
    placeholder.dataset.orientation = width > height ? "landscape" : height > width ? "portrait" : "square";

    const primary = document.createElement("strong");
    primary.textContent = item.dateKey?.slice(0, 4) || item.camera || (item.type === "video" ? "Video" : "Ảnh");
    const secondary = document.createElement("small");
    secondary.textContent = dimensions;
    placeholder.append(primary, secondary);
    preview.prepend(placeholder);
  }

  function createMediaCard(item, index) {
    const fragment = elements.mediaCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".media-card");
    const preview = fragment.querySelector(".media-preview");
    const name = fragment.querySelector(".media-name");
    const folder = fragment.querySelector(".media-folder");
    const detail = fragment.querySelector(".media-detail");

    card.dataset.index = String(index);
    card.dataset.itemId = item.id;
    card.setAttribute("aria-label", `Mở ${item.name}`);
    name.textContent = item.name;
    folder.textContent = item.folder;
    detail.textContent = itemDetail(item);
    card.classList.toggle("has-metadata", Boolean(item.hasMetadata));
    addMetadataPlaceholder(preview, item);

    const typeBadge = document.createElement("span");
    typeBadge.className = "media-type";
    typeBadge.textContent = item.extension;
    preview.append(typeBadge);
    addPreviewImage(preview, item);

    if (state.selectedIds.has(item.id)) {
      card.classList.add("is-selected");
      card.setAttribute("aria-pressed", "true");
    }
    card.classList.toggle("is-favorite", state.favoriteItems.has(item.id));

    return fragment;
  }

  function renderNextPage(targetCount = PAGE_SIZE) {
    if (state.renderedCount >= state.visibleItems.length) {
      return;
    }
    const end = Math.min(state.renderedCount + targetCount, state.visibleItems.length);
    let activeSection = elements.mediaGrid.lastElementChild?.classList.contains("timeline-section")
      ? elements.mediaGrid.lastElementChild
      : null;
    for (let index = state.renderedCount; index < end; index += 1) {
      const item = state.visibleItems[index];
      const group = timelineGroup(item);
      if (!activeSection || activeSection.dataset.groupKey !== group.key) {
        activeSection = createTimelineSection(group);
        elements.mediaGrid.append(activeSection);
      }
      activeSection.querySelector(".timeline-grid").append(createMediaCard(item, index));
      increaseTimelineCount(activeSection);
    }
    state.renderedCount = end;
    updateSelectionUi();
  }

  function updateSummary() {
    const collectionTitles = {
      albums: "Album",
      favorites: "Yêu thích",
      hidden: "Đã ẩn",
      map: "Bản đồ ảnh",
    };
    const customCollection = state.view === "collection"
      ? state.customCollections.get(state.activeCollectionId)
      : null;
    const event = state.view === "event"
      ? smartEvents().find((candidate) => candidate.id === state.activeEventId)
      : null;
    elements.albumTitle.textContent = customCollection?.name || event?.name || collectionTitles[state.view] || (
      state.filter === "image" ? "Ảnh" : state.filter === "video" ? "Video" : "Dòng thời gian"
    );
    if (!state.endpoint) {
      elements.albumSummary.textContent = "Nhập IP và cổng của máy lưu album để bắt đầu.";
      return;
    }

    if (state.view === "albums") {
      const total = Number(state.stats?.total) || state.items.length;
      const groups = [];
      if (state.albumViewCounts.collections) {
        groups.push(`${numberFormatter.format(state.albumViewCounts.collections)} bộ sưu tập`);
      }
      if (state.albumViewCounts.events) {
        groups.push(`${numberFormatter.format(state.albumViewCounts.events)} sự kiện`);
      }
      if (state.albumViewCounts.folders) {
        groups.push(`${numberFormatter.format(state.albumViewCounts.folders)} thư mục`);
      }
      elements.albumSummary.textContent = `${groups.join(" · ") || "Chưa có nhóm"} · ${numberFormatter.format(total)} ảnh và video`;
      return;
    }

    if (state.view === "map") {
      elements.albumSummary.textContent = state.mapItems.length > 0
        ? `${numberFormatter.format(state.mapItems.length)} ảnh và video có vị trí`
        : "Ảnh và video có tọa độ sẽ xuất hiện ở đây.";
      return;
    }

    if (state.view === "collection" || state.view === "event") {
      const qualifier = state.filter !== "all" || state.query.trim() || activeTimelineFilterCount() > 0
        ? " phù hợp"
        : "";
      const suffix = state.view === "collection"
        ? "Lưu trên thiết bị này"
        : event?.detail || "Theo thời điểm chụp";
      elements.albumSummary.textContent =
        `${numberFormatter.format(state.visibleItems.length)} mục${qualifier} · ${suffix}`;
      return;
    }

    if (state.view === "favorites" || state.view === "hidden") {
      const qualifier = state.filter !== "all" || state.query.trim() || activeTimelineFilterCount() > 0
        ? " phù hợp"
        : "";
      elements.albumSummary.textContent =
        state.view === "favorites"
          ? `${numberFormatter.format(state.visibleItems.length)} mục${qualifier} · Lưu trên trình duyệt này`
          : `${numberFormatter.format(state.visibleItems.length)} mục${qualifier} · Chỉ ẩn trên trình duyệt này`;
      return;
    }

    const stats = state.stats || { images: 0, videos: 0 };
    const hiddenLoadedItems = state.items.filter((item) => state.hiddenIds.has(item.id));
    const hiddenImages = hiddenLoadedItems.filter((item) => item.type === "image").length;
    const hiddenVideos = hiddenLoadedItems.filter((item) => item.type === "video").length;
    const visibleImages = Math.max(0, (stats.images || 0) - hiddenImages);
    const visibleVideos = Math.max(0, (stats.videos || 0) - hiddenVideos);
    const baseSummary = `${numberFormatter.format(visibleImages)} ảnh · ${numberFormatter.format(visibleVideos)} video`;
    const hasActiveQuery = state.filter !== "all" || Boolean(state.query.trim()) || activeTimelineFilterCount() > 0;
    elements.albumSummary.textContent = hasActiveQuery
      ? `${numberFormatter.format(state.total)} kết quả · ${baseSummary}`
      : baseSummary;
  }

  function updateEmptyState() {
    if (state.view === "map") {
      elements.emptyState.hidden = true;
      updateSelectionUi();
      return;
    }
    const hasVisibleItems = state.view === "albums"
      ? Object.values(state.albumViewCounts).some(Boolean)
      : state.visibleItems.length > 0;
    elements.emptyState.hidden = hasVisibleItems || state.isLoading;
    elements.emptyConnect.textContent = state.endpoint ? "Đổi IP và cổng" : "Nhập IP và cổng";
    elements.emptyConnect.hidden = Boolean(state.endpoint);
    if (state.endpoint && state.mode && state.view === "albums" && !hasVisibleItems) {
      elements.emptyTitle.textContent = state.query.trim() ? "Không tìm thấy album" : "Chưa có album";
      elements.emptyCopy.textContent = state.query.trim()
        ? "Thử một tên bộ sưu tập, sự kiện hoặc thư mục khác."
        : "Các nhóm ảnh và video sẽ xuất hiện ở đây.";
    } else if (state.endpoint && state.mode && state.view === "collection" && !hasVisibleItems) {
      elements.emptyTitle.textContent = "Bộ sưu tập này đang trống";
      elements.emptyCopy.textContent = "Chọn ảnh hoặc video rồi thêm chúng vào bộ sưu tập.";
    } else if (state.endpoint && state.mode && state.view === "event" && !hasVisibleItems) {
      elements.emptyTitle.textContent = "Không còn mục trong sự kiện này";
      elements.emptyCopy.textContent = "Có thể các mục đã bị ẩn hoặc không còn trong kho ảnh.";
    } else if (state.endpoint && state.mode && state.view === "favorites" && !hasVisibleItems) {
      elements.emptyTitle.textContent = state.query.trim() || activeTimelineFilterCount() > 0
        ? "Không có kết quả"
        : "Chưa có mục yêu thích";
      elements.emptyCopy.textContent = state.query.trim() || activeTimelineFilterCount() > 0
        ? "Thử từ khóa khác hoặc xóa bớt bộ lọc."
        : "Nhấn biểu tượng trái tim trong trình xem hoặc khi chọn nhiều mục.";
    } else if (state.endpoint && state.mode && state.view === "hidden" && !hasVisibleItems) {
      elements.emptyTitle.textContent = state.filter !== "all" || state.query.trim()
        ? "Không có kết quả"
        : "Chưa có mục đã ẩn";
      elements.emptyCopy.textContent = state.filter !== "all" || state.query.trim()
        ? "Thử từ khóa khác hoặc đổi bộ lọc nội dung."
        : "Ảnh và video bạn ẩn sẽ xuất hiện ở đây để có thể khôi phục bất cứ lúc nào.";
    } else if (state.endpoint && state.mode && !hasVisibleItems) {
      elements.emptyTitle.textContent = "Không có kết quả";
      elements.emptyCopy.textContent = "Thử từ khóa khác, đổi bộ lọc hoặc làm mới album.";
    } else {
      elements.emptyTitle.textContent = "Chưa có nội dung";
      elements.emptyCopy.textContent = "Kết nối tới máy lưu album để xem ảnh và video.";
    }
    updateSelectionUi();
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

  function setViewerInfoVisible(visible) {
    elements.viewerShell.classList.toggle("show-info", visible);
    elements.viewerInfoToggle.setAttribute("aria-pressed", String(visible));
    elements.viewerInfoToggle.setAttribute("aria-label", visible ? "Ẩn thông tin" : "Hiện thông tin");
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

  function updateViewerActionUi(item) {
    const isFavorite = state.favoriteItems.has(item.id);
    const isHidden = state.hiddenIds.has(item.id);
    elements.viewerFavorite.setAttribute("aria-pressed", String(isFavorite));
    elements.viewerFavorite.setAttribute(
      "aria-label",
      isFavorite ? "Bỏ khỏi yêu thích" : "Thêm vào yêu thích",
    );
    elements.viewerFavorite.title = isFavorite ? "Bỏ yêu thích" : "Yêu thích";
    elements.viewerHide.classList.toggle("is-restore", isHidden);
    elements.viewerHide.innerHTML = isHidden
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3-6 10-6 10 6 10 6-3 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2 2 20 20M6.7 6.7C4.9 7.9 3.3 9.7 2 12c2.1 3.8 5.7 6 10 6 1.6 0 3-.3 4.3-.9M10.7 4.1c.4-.1.9-.1 1.3-.1 4.3 0 7.9 2.2 10 6-.7 1.3-1.6 2.4-2.6 3.3M14.1 14.1a3 3 0 0 1-4.2-4.2" /></svg>';
    elements.viewerHide.setAttribute("aria-label", isHidden ? "Hiện lại trong thư viện" : "Ẩn khỏi thư viện");
    elements.viewerHide.title = isHidden ? "Hiện lại" : "Ẩn khỏi thư viện";
  }

  function toggleViewerFavorite() {
    const item = state.visibleItems[state.viewerIndex];
    if (!item) {
      return;
    }
    const shouldFavorite = !state.favoriteItems.has(item.id);
    if (!setItemsFavorite([item], shouldFavorite)) {
      return;
    }
    showToast(shouldFavorite ? "Đã thêm vào yêu thích." : "Đã bỏ khỏi yêu thích.");
    if (!shouldFavorite && state.view === "favorites") {
      closeViewer();
      refreshDirectoryItems(false);
    }
  }

  function toggleViewerHidden() {
    const item = state.visibleItems[state.viewerIndex];
    if (!item) {
      return;
    }
    const shouldHide = !state.hiddenIds.has(item.id);
    const previousHiddenIds = new Set(state.hiddenIds);
    const previousHiddenItems = new Map(state.hiddenItems);
    if (shouldHide) {
      state.hiddenIds.add(item.id);
      state.hiddenItems.set(item.id, collectionItemSnapshot(item));
    } else {
      state.hiddenIds.delete(item.id);
      state.hiddenItems.delete(item.id);
    }
    if (!saveHiddenItems()) {
      state.hiddenIds = previousHiddenIds;
      state.hiddenItems = previousHiddenItems;
      updateCollectionCounts();
      return;
    }
    closeViewer();
    refreshDirectoryItems(false);
    showToast(shouldHide ? "Đã ẩn mục khỏi thư viện." : "Đã đưa mục trở lại thư viện.");
  }

  function setViewerInfoRow(row, valueElement, value) {
    const text = String(value || "").trim();
    row.hidden = !text;
    valueElement.textContent = text;
  }

  function captureSettingsText(metadata) {
    const values = [];
    if (metadata.shutter) {
      const shutter = String(metadata.shutter);
      values.push(/[a-z]/i.test(shutter) ? shutter : `${shutter}s`);
    }
    if (metadata.aperture) {
      const aperture = String(metadata.aperture);
      values.push(aperture.toLocaleLowerCase("vi").startsWith("f/") ? aperture : `f/${aperture}`);
    }
    if (metadata.iso) {
      const iso = String(metadata.iso);
      values.push(iso.toLocaleUpperCase("vi").startsWith("ISO") ? iso : `ISO ${iso}`);
    }
    if (metadata.focalLength) {
      const focalLength = String(metadata.focalLength);
      values.push(/[a-z]/i.test(focalLength) ? focalLength : `${focalLength} mm`);
    }
    return values.join(" · ");
  }

  function updateViewerMetadata(item) {
    const metadata = item.metadata || {};
    const captured = item.dateTaken ? formatDateTime(item.dateTaken) : "";
    setViewerInfoRow(elements.viewerInfoCapturedRow, elements.viewerInfoDate, captured);
    elements.viewerInfoCapturedRow.title = item.dateSource || "";
    elements.viewerInfoModified.textContent = formatDateTime(Number(item.modified)) || "Không có thông tin";

    const width = Number(metadata.width);
    const height = Number(metadata.height);
    const dimensions = width > 0 && height > 0
      ? `${numberFormatter.format(width)} × ${numberFormatter.format(height)} px`
      : "";
    setViewerInfoRow(elements.viewerInfoDimensionsRow, elements.viewerInfoDimensions, dimensions);
    setViewerInfoRow(elements.viewerInfoCameraRow, elements.viewerInfoCamera, item.camera);
    setViewerInfoRow(elements.viewerInfoLensRow, elements.viewerInfoLens, metadata.lens);
    setViewerInfoRow(
      elements.viewerInfoSettingsRow,
      elements.viewerInfoSettings,
      captureSettingsText(metadata),
    );
    setViewerInfoRow(elements.viewerInfoDurationRow, elements.viewerInfoDuration, metadata.duration);

    const latitude = Number(metadata.latitude);
    const longitude = Number(metadata.longitude);
    const hasLocation = item.hasLocation && Number.isFinite(latitude) && Number.isFinite(longitude);
    elements.viewerInfoLocationRow.hidden = !hasLocation;
    if (hasLocation) {
      const latitudeText = latitude.toFixed(6);
      const longitudeText = longitude.toFixed(6);
      const coordinates = `${latitudeText}, ${longitudeText}`;
      const altitude = Number(metadata.altitude);
      elements.viewerInfoLocation.textContent = Number.isFinite(altitude)
        ? `${coordinates} · ${numberFormatter.format(altitude)} m`
        : coordinates;
      elements.viewerInfoLocation.href = `https://www.openstreetmap.org/?mlat=${latitudeText}&mlon=${longitudeText}#map=16/${latitudeText}/${longitudeText}`;
    } else {
      elements.viewerInfoLocation.textContent = "";
      elements.viewerInfoLocation.removeAttribute("href");
    }

    const description = [metadata.title, metadata.description]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join("\n");
    setViewerInfoRow(
      elements.viewerInfoDescriptionRow,
      elements.viewerInfoDescription,
      description,
    );
  }

  function showViewer(index) {
    const item = state.visibleItems[index];
    if (!item) {
      return;
    }

    releaseViewerMedia();
    state.viewerIndex = index;
    const token = state.viewerLoadToken;
    const viewerTotal = state.mode === "api" && state.view === "library"
      ? state.total
      : state.visibleItems.length;
    elements.viewerName.textContent = item.name;
    elements.viewerFolder.textContent = item.folder;
    elements.viewerInfoName.textContent = item.name;
    elements.viewerInfoFolder.textContent = item.folder;
    elements.viewerInfoSize.textContent = formatBytes(item.bytes) || "Không có thông tin";
    elements.viewerInfoType.textContent = `${item.type === "video" ? "Video" : "Ảnh"} · ${item.extension.toUpperCase()}`;
    updateViewerMetadata(item);
    elements.viewerOpenOriginal.href = item.url;
    elements.viewerCount.textContent = `${numberFormatter.format(index + 1)} / ${numberFormatter.format(viewerTotal)}`;
    elements.viewerPrevious.disabled = index === 0;
    elements.viewerNext.disabled = index >= viewerTotal - 1;

    if (!elements.viewerDialog.open) {
      elements.viewerDialog.showModal();
    }
    updateViewerActionUi(item);

    // Album items resolve their original-media URL from a meta page, which may
    // not have streamed in yet. Fetch just this item's page before loading.
    if (item.source === "album" && item.metaPending) {
      renderViewerLoading();
      ensureAlbumItemMeta(item).then(() => {
        if (state.viewerIndex !== index || !elements.viewerDialog.open) {
          return;
        }
        elements.viewerName.textContent = item.name;
        elements.viewerFolder.textContent = item.folder;
        elements.viewerInfoName.textContent = item.name;
        elements.viewerInfoFolder.textContent = item.folder;
        elements.viewerInfoSize.textContent = formatBytes(item.bytes) || "Không có thông tin";
        elements.viewerInfoType.textContent = `${item.type === "video" ? "Video" : "Ảnh"} · ${item.extension.toUpperCase()}`;
        updateViewerMetadata(item);
        elements.viewerOpenOriginal.href = item.url;
        startViewerMedia(item, index, token);
      });
      return;
    }

    startViewerMedia(item, index, token);
  }

  function startViewerMedia(item, index, token) {
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
    if (offset > 0 && nextIndex >= state.visibleItems.length && state.mode === "api" &&
      state.view === "library" && state.hasMore) {
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
    setViewerInfoVisible(false);
    if (elements.viewerDialog.open) {
      elements.viewerDialog.close();
    }
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function downloadMediaItem(item, signal) {
    const response = await fetchMediaResponse(item.url, signal);
    const blob = await response.blob();
    if (signal?.aborted) {
      throw new DOMException("Đã dừng tải xuống", "AbortError");
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = item.name.replaceAll("/", "_").replaceAll("\\", "_") || "media";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    await wait(350);
    URL.revokeObjectURL(objectUrl);
  }

  async function downloadViewerItem() {
    const item = state.visibleItems[state.viewerIndex];
    if (!item || elements.viewerDownload.disabled) {
      return;
    }

    const controller = new AbortController();
    elements.viewerDownload.disabled = true;
    try {
      await downloadMediaItem(item, controller.signal);
      showToast(`Đã gửi ${item.name} tới trình tải xuống.`);
    } catch (error) {
      if (error?.name !== "AbortError") {
        showToast(`Không tải được ${item.name}.`);
      }
    } finally {
      elements.viewerDownload.disabled = false;
    }
  }

  async function downloadSelectedItems() {
    const selectedItems = state.visibleItems.filter((item) => state.selectedIds.has(item.id));
    if (selectedItems.length === 0 || state.isDownloading) {
      return;
    }

    const controller = new AbortController();
    state.downloadAbortController = controller;
    state.isDownloading = true;
    elements.selectionBar.classList.add("is-busy");
    elements.selectionProgress.hidden = false;
    elements.selectionProgressBar.style.width = "0%";
    updateSelectionUi();

    let completed = 0;
    let failed = 0;
    for (const item of selectedItems) {
      if (controller.signal.aborted) {
        break;
      }
      const current = completed + failed + 1;
      elements.selectionProgress.textContent =
        `Đang chuẩn bị ${numberFormatter.format(current)} / ${numberFormatter.format(selectedItems.length)}`;
      try {
        await downloadMediaItem(item, controller.signal);
        completed += 1;
      } catch (error) {
        if (error?.name === "AbortError") {
          break;
        }
        failed += 1;
      }
      const processed = completed + failed;
      elements.selectionProgressBar.style.width = `${(processed / selectedItems.length) * 100}%`;
    }

    if (state.downloadAbortController === controller) {
      state.downloadAbortController = null;
      state.isDownloading = false;
      elements.selectionBar.classList.remove("is-busy");
      updateSelectionUi();
    }

    if (controller.signal.aborted) {
      showToast("Đã dừng tải xuống.");
      return;
    }

    elements.selectionProgress.textContent = failed > 0
      ? `Đã gửi ${numberFormatter.format(completed)} mục · ${numberFormatter.format(failed)} lỗi`
      : `Đã gửi ${numberFormatter.format(completed)} mục tới trình tải xuống`;
    elements.selectionProgressBar.style.width = "100%";
    showToast(failed > 0
      ? `Đã tải ${numberFormatter.format(completed)} mục, ${numberFormatter.format(failed)} mục bị lỗi.`
      : `Đã gửi ${numberFormatter.format(completed)} mục tới trình tải xuống.`);
  }

  function resetAlbumState() {
    closeViewer();
    exitSelectionMode();
    state.items = [];
    state.visibleItems = [];
    state.total = 0;
    state.stats = null;
    state.facets = emptyFacets();
    state.folderFacets = emptyFacets();
    state.serverMetadataStatus = { available: false, items: 0, generatedAt: "" };
    state.folderSummaries.clear();
    state.folderViewCount = 0;
    state.albumViewCounts = { folders: 0, collections: 0, events: 0 };
    state.hasMore = false;
    state.clientCatalogComplete = false;
    state.mapItems = [];
    state.mapLastDataKey = "";
    state.renderedCount = 0;
    state.viewerIndex = -1;
    state.isLoadingMore = false;
    clearMediaGrid();
    setMode(null);
    syncMetadataStatus();
  }

  async function connectAlbum({ force = false } = {}) {
    if (!state.endpoint) {
      return;
    }

    state.requestVersion += 1;
    const version = state.requestVersion;
    resetAlbumState();
    hideNotice();
    renderSkeletons();
    setLoading(true, state.isLocalServer ? "Đang tìm server LAN…" : "Đang kết nối kho ảnh…");

    try {
      try {
        // Preferred path on the static cloud host: the pre-generated album index.
        elements.scanStatusText.textContent = "Đang dựng placeholder từ metadata…";
        await loadAlbumIndex(version);
      } catch (albumError) {
        if (!(albumError instanceof ApiUnavailableError)) {
          throw albumError;
        }
        try {
          await probeApi();
          if (version !== state.requestVersion) {
            return;
          }
          elements.scanStatusText.textContent = state.localMetadataStatus.available
            ? "Đang tạo placeholder từ metadata…"
            : "Đang lập chỉ mục album…";
          if (state.localMetadataStatus.available) {
            await loadFullApiCatalog({ force, version });
          } else {
            await loadApiPage({ reset: true, force, version });
          }
        } catch (error) {
          if (!(error instanceof ApiUnavailableError)) {
            throw error;
          }
          elements.scanStatusText.textContent = "Đang quét thư mục…";
          await scanDirectory(version);
        }
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
    if (state.mode === "api" && state.view === "albums") {
      refreshDirectoryItems(false);
      if (state.folderFacets.folders.length > 0) {
        return;
      }
      state.requestVersion += 1;
      const version = state.requestVersion;
      controlTimer = setTimeout(async () => {
        setLoading(true, "Đang tải danh sách album…");
        try {
          await refreshFolderOverview(version);
        } catch {
          if (version === state.requestVersion) {
            showToast("Chưa cập nhật được đầy đủ danh sách album.");
          }
        } finally {
          if (version === state.requestVersion) {
            setLoading(false);
          }
        }
      }, 120);
    } else if (state.mode === "api" && ["library", "collection", "event", "map"].includes(state.view) && state.clientCatalogComplete) {
      refreshDirectoryItems(false);
    } else if (state.mode === "api" && state.view === "library") {
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
    } else if (["api", "album", "directory", "offline"].includes(state.mode)) {
      refreshDirectoryItems(false);
    }
  }

  function applyEndpoint(endpoint) {
    state.endpoint = endpoint;
    state.baseUrl = endpointUrl(endpoint);
    state.isLocalServer = endpoint.kind === "local";
    state.view = "library";
    state.activeCollectionId = "";
    state.activeEventId = "";
    state.filter = "all";
    state.query = "";
    elements.searchInput.value = "";
    state.timelineFilters = emptyTimelineFilters();
    state.folderSummaries.clear();
    updateNavigationUi();
    loadLocalCollections();
    updateViewUi();
    elements.endpointLabel.textContent = endpoint.label;
    connectAlbum();
  }

  elements.timelineFilterButton.addEventListener("click", showTimelineFilterDialog);
  elements.filterClose.addEventListener("click", closeTimelineFilterDialog);
  elements.metadataButton.addEventListener("click", showMetadataDialog);
  elements.metadataClose.addEventListener("click", closeMetadataDialog);
  elements.metadataImport.addEventListener("click", () => elements.metadataFileInput.click());
  elements.metadataFileInput.addEventListener("change", () => {
    const [file] = elements.metadataFileInput.files || [];
    importMetadataFile(file);
  });
  elements.metadataExport.addEventListener("click", exportImportedMetadata);
  elements.metadataRemove.addEventListener("click", () => {
    removeImportedMetadata().catch(() => showToast("Không thể xóa metadata đã lưu."));
  });
  elements.metadataDialog.addEventListener("click", (event) => {
    if (event.target === elements.metadataDialog) {
      closeMetadataDialog();
    }
  });
  elements.metadataDialog.addEventListener("cancel", (event) => {
    if (state.metadataImporting) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    closeMetadataDialog();
  });
  elements.collectionSelected.addEventListener("click", showCollectionDialog);
  elements.collectionClose.addEventListener("click", closeCollectionDialog);
  elements.collectionCancel.addEventListener("click", closeCollectionDialog);
  elements.collectionSelect.addEventListener("change", updateCollectionDialogName);
  elements.collectionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSelectedToCollection();
  });
  elements.collectionDialog.addEventListener("click", (event) => {
    if (event.target === elements.collectionDialog) {
      closeCollectionDialog();
    }
  });
  elements.collectionDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCollectionDialog();
  });
  elements.yearFilter.addEventListener("change", () => {
    const filters = readTimelineFilterForm();
    filters.month = "";
    filters.day = "";
    populateTimelineFilterDialog(filters);
  });
  elements.monthFilter.addEventListener("change", () => {
    const filters = readTimelineFilterForm();
    filters.day = "";
    populateTimelineFilterDialog(filters);
  });
  elements.filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextFilters = readTimelineFilterForm();
    if (JSON.stringify(nextFilters) === JSON.stringify(state.timelineFilters)) {
      closeTimelineFilterDialog();
      return;
    }
    exitSelectionMode();
    state.timelineFilters = nextFilters;
    closeTimelineFilterDialog();
    updateTimelineFilterUi();
    reloadFromControls();
  });
  elements.filterReset.addEventListener("click", () => {
    const hadActiveFilters = activeTimelineFilterCount() > 0;
    state.timelineFilters = emptyTimelineFilters();
    populateTimelineFilterDialog();
    updateTimelineFilterUi();
    if (hadActiveFilters) {
      closeTimelineFilterDialog();
      reloadFromControls();
    }
  });
  elements.activeFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-clear-filter]");
    if (button) {
      clearTimelineFilter(button.dataset.clearFilter);
    }
  });
  elements.timelineRail.addEventListener("click", (event) => {
    const button = event.target.closest("[data-timeline-year]");
    if (button) {
      selectTimelineYear(button.dataset.timelineYear);
    }
  });

  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme, true);
  });
  elements.emptyConnect.addEventListener("click", () => connectAlbum());
  elements.retryButton.addEventListener("click", () => connectAlbum());
  elements.refreshButton.addEventListener("click", () => connectAlbum({ force: true }));

  elements.searchInput.addEventListener("input", () => {
    if (state.selectionMode) {
      exitSelectionMode();
    }
    state.query = elements.searchInput.value;
    reloadFromControls();
  });

  for (const button of elements.navigationButtons) {
    button.addEventListener("click", () => {
      const nextView = button.dataset.navView;
      const nextFilter = button.dataset.navFilter;
      const sameDestination = nextView === state.view && nextFilter === state.filter;
      const hasTransientFilters = Boolean(state.query.trim()) || activeTimelineFilterCount() > 0;
      if (sameDestination && !hasTransientFilters) {
        return;
      }
      exitSelectionMode();
      if (!state.isLoading) {
        state.requestVersion += 1;
      }
      state.query = "";
      elements.searchInput.value = "";
      state.timelineFilters = emptyTimelineFilters();
      state.view = nextView;
      state.filter = nextFilter;
      state.activeCollectionId = "";
      state.activeEventId = "";
      updateNavigationUi();
      updateViewUi();
      reloadFromControls();
    });
  }

  for (const button of elements.filterButtons) {
    button.addEventListener("click", () => {
      if (state.selectionMode) {
        exitSelectionMode();
      }
      state.filter = button.dataset.filter;
      updateNavigationUi();
      reloadFromControls();
    });
  }

  elements.sortSelect.addEventListener("change", () => {
    if (state.selectionMode) {
      exitSelectionMode();
    }
    state.sort = elements.sortSelect.value;
    reloadFromControls();
  });

  elements.sizeInput.addEventListener("input", () => {
    document.documentElement.style.setProperty("--tile-size", `${elements.sizeInput.value}px`);
    try {
      localStorage.setItem(TILE_SIZE_STORAGE_KEY, elements.sizeInput.value);
    } catch {
      // The visual setting still applies for the current session.
    }
  });

  elements.mediaGrid.addEventListener("click", (event) => {
    const collectionCard = event.target.closest("[data-collection-card]");
    if (collectionCard) {
      openCustomCollection(collectionCard.dataset.collectionCard);
      return;
    }
    const eventCard = event.target.closest("[data-event-card]");
    if (eventCard) {
      openSmartEvent(eventCard.dataset.eventCard);
      return;
    }
    const folderCard = event.target.closest("[data-folder-card]");
    if (folderCard) {
      openFolderAlbum(folderCard.dataset.folder);
      return;
    }
    const groupButton = event.target.closest("[data-select-group]");
    if (groupButton) {
      toggleTimelineGroup(groupButton.dataset.selectGroup);
      return;
    }
    const card = event.target.closest(".media-card:not(.is-skeleton)");
    if (!card) {
      return;
    }
    const index = Number(card.dataset.index);
    if (state.selectionMode) {
      toggleItemSelection(index, event.shiftKey);
    } else if (event.target.closest(".selection-check")) {
      enterSelectionMode(index);
    } else {
      showViewer(index);
    }
  });

  elements.selectButton.addEventListener("click", () => enterSelectionMode());
  elements.selectionCancel.addEventListener("click", exitSelectionMode);
  elements.selectAllButton.addEventListener("click", toggleSelectAll);
  elements.favoriteSelected.addEventListener("click", toggleSelectedFavorites);
  elements.hideSelected.addEventListener("click", () => applyHiddenAction(true));
  elements.restoreSelected.addEventListener("click", () => applyHiddenAction(false));
  elements.downloadSelected.addEventListener("click", downloadSelectedItems);

  elements.viewerClose.addEventListener("click", closeViewer);
  elements.viewerFavorite.addEventListener("click", toggleViewerFavorite);
  elements.viewerHide.addEventListener("click", toggleViewerHidden);
  elements.viewerInfoToggle.addEventListener("click", () => {
    setViewerInfoVisible(!elements.viewerShell.classList.contains("show-info"));
  });
  elements.viewerInfoClose.addEventListener("click", () => setViewerInfoVisible(false));
  elements.viewerDownload.addEventListener("click", downloadViewerItem);
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
    if (elements.viewerDialog.open) {
      if (event.key === "ArrowLeft") {
        moveViewer(-1);
      } else if (event.key === "ArrowRight") {
        moveViewer(1);
      }
      return;
    }
    if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLSelectElement)) {
        event.preventDefault();
        elements.searchInput.focus();
      }
      return;
    }
    if (event.key === "Escape" && state.selectionMode) {
      exitSelectionMode();
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || state.isLoading) {
        return;
      }
      if (state.mode === "api" && state.view === "library" && state.clientCatalogComplete) {
        renderNextPage();
      } else if (state.mode === "api" && state.view === "library") {
        loadApiPage().catch((error) => {
          showConnectionError(error);
          elements.scanStatus.hidden = true;
        });
      } else if ((state.mode === "album" || state.mode === "directory" || state.mode === "offline") && !["albums", "map"].includes(state.view)) {
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

  await loadImportedMetadata();
  const currentPageEndpoint = localPageEndpoint();
  const initialEndpoint = currentPageEndpoint || CLOUD_ENDPOINT;
  document.body.classList.toggle("is-local-server", Boolean(currentPageEndpoint));
  applyEndpoint(initialEndpoint);
})();
