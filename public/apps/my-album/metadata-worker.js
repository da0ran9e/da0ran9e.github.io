"use strict";

const DATE_TAGS = [
  "SubSecDateTimeOriginal",
  "DateTimeOriginal",
  "DateCreated",
  "CreateDate",
  "ContentCreateDate",
  "MediaCreateDate",
  "TrackCreateDate",
  "CreationDate",
  "ModifyDate",
];

const ALLOWED_METADATA_FIELDS = new Set([
  "make", "model", "camera", "lens", "iso", "aperture", "shutter", "focalLength",
  "flash", "duration", "frameRate", "title", "description", "rating", "width", "height",
  "latitude", "longitude", "altitude",
]);

const NUMBER_PATTERN = /[-+]?\d+(?:\.\d+)?/g;
const DATE_PATTERN = /(\d{4})[:/-](\d{2})[:/-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function scalarText(value, maxLength = 300) {
  if (typeof value === "boolean") {
    return value ? "Có" : "Không";
  }
  if (["string", "number"].includes(typeof value)) {
    return String(value).trim().slice(0, maxLength);
  }
  return "";
}

function tagValues(item) {
  const tags = new Map();
  for (const [key, value] of Object.entries(item)) {
    if (key === "_album") {
      continue;
    }
    const tag = key.split(":").at(-1).toLocaleLowerCase("en");
    const values = tags.get(tag) || [];
    values.push(value);
    tags.set(tag, values);
  }
  return tags;
}

function firstValue(tags, ...names) {
  for (const name of names) {
    for (const value of tags.get(name.toLocaleLowerCase("en")) || []) {
      if (scalarText(value)) {
        return value;
      }
    }
  }
  return null;
}

function firstText(tags, names, maxLength = 300) {
  return scalarText(firstValue(tags, ...names), maxLength);
}

function finiteNumber(value) {
  if (typeof value === "boolean") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const match = scalarText(value).replaceAll(",", "").match(/[-+]?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value) {
  const number = finiteNumber(value);
  if (number === null) {
    return null;
  }
  const rounded = Math.round(number);
  return rounded > 0 ? rounded : null;
}

function parseCoordinate(value, reference) {
  if (typeof value === "boolean") {
    return null;
  }
  const text = scalarText(value);
  const matches = text.replaceAll(",", ".").match(NUMBER_PATTERN);
  if (!matches?.length) {
    return null;
  }
  const parts = matches.slice(0, 3).map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  let coordinate = Math.abs(parts[0]);
  coordinate += Math.abs(parts[1] || 0) / 60;
  coordinate += Math.abs(parts[2] || 0) / 3600;
  const direction = `${text} ${scalarText(reference)}`.toLocaleUpperCase("en");
  if (parts[0] < 0 || /\b[SW]\b/.test(direction)) {
    coordinate *= -1;
  }
  return Number(coordinate.toFixed(7));
}

function parseDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) {
      return {
        dateTaken: Math.floor(date.getTime() / 1000),
        dateKey: localDateKey(date),
        dateTakenText: localDateTimeText(date),
      };
    }
  }

  const match = scalarText(value, 100).match(DATE_PATTERN);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return {
    dateTaken: Math.floor(date.getTime() / 1000),
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    dateTakenText: localDateTimeText(date),
  };
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDateTimeText(date) {
  return `${localDateKey(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
}

function cameraLabel(make, model) {
  if (!make) {
    return model;
  }
  if (!model) {
    return make;
  }
  return model.toLocaleLowerCase("en").startsWith(make.toLocaleLowerCase("en"))
    ? model
    : `${make} ${model}`;
}

function compactMetadata(item) {
  const tags = tagValues(item);
  const result = { hasMetadata: true, hasLocation: false, metadata: {} };

  for (const tag of DATE_TAGS) {
    for (const value of tags.get(tag.toLocaleLowerCase("en")) || []) {
      const parsed = parseDate(value);
      if (parsed) {
        Object.assign(result, parsed, { dateSource: tag });
        break;
      }
    }
    if (result.dateTaken) {
      break;
    }
  }

  const make = firstText(tags, ["Make"], 100);
  const model = firstText(tags, ["Model", "CameraModelName"], 140);
  const camera = cameraLabel(make, model);
  const lens = firstText(tags, ["LensModel", "Lens", "LensID"], 180);
  if (make) result.metadata.make = make;
  if (model) result.metadata.model = model;
  if (camera) {
    result.camera = camera;
    result.metadata.camera = camera;
  }
  if (lens) result.metadata.lens = lens;

  const textFields = {
    iso: ["ISO", "ISOSetting"],
    aperture: ["FNumber", "Aperture"],
    shutter: ["ExposureTime", "ShutterSpeed"],
    focalLength: ["FocalLength", "FocalLengthIn35mmFormat"],
    flash: ["Flash"],
    duration: ["Duration", "TrackDuration", "MediaDuration"],
    frameRate: ["VideoFrameRate", "VideoFrameRateMode"],
    title: ["Title", "Headline", "ObjectName"],
    description: ["Description", "Caption-Abstract", "ImageDescription"],
    rating: ["Rating"],
  };
  for (const [field, names] of Object.entries(textFields)) {
    const value = firstText(tags, names, field === "description" ? 500 : 180);
    if (value) result.metadata[field] = value;
  }

  let width = positiveInteger(firstValue(tags, "ImageWidth", "ExifImageWidth", "SourceImageWidth", "VideoFrameWidth"));
  let height = positiveInteger(firstValue(tags, "ImageHeight", "ExifImageHeight", "SourceImageHeight", "VideoFrameHeight"));
  if (!width || !height) {
    const size = firstText(tags, ["ImageSize"]);
    const match = size.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (match) {
      width ||= Number(match[1]);
      height ||= Number(match[2]);
    }
  }
  if (width) result.metadata.width = width;
  if (height) result.metadata.height = height;

  const latitude = parseCoordinate(firstValue(tags, "GPSLatitude"), firstValue(tags, "GPSLatitudeRef"));
  const longitude = parseCoordinate(firstValue(tags, "GPSLongitude"), firstValue(tags, "GPSLongitudeRef"));
  if (latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    result.hasLocation = true;
    result.metadata.latitude = latitude;
    result.metadata.longitude = longitude;
    const altitude = finiteNumber(firstValue(tags, "GPSAltitude"));
    if (altitude !== null) result.metadata.altitude = Number(altitude.toFixed(2));
  }

  return result;
}

function normalizePath(value) {
  if (typeof value !== "string") {
    return "";
  }
  const parts = value.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === "..")) {
    return "";
  }
  return parts.map((part) => part.normalize("NFC")).join("/").toLocaleLowerCase("en");
}

function sanitizeCompact(value) {
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
  return {
    hasMetadata: true,
    hasLocation: Boolean(value.hasLocation),
    dateTaken: Number(value.dateTaken) || 0,
    dateKey: /^\d{4}-\d{2}-\d{2}$/.test(value.dateKey || "") ? value.dateKey : "",
    dateTakenText: scalarText(value.dateTakenText, 100),
    dateSource: scalarText(value.dateSource, 100),
    camera: scalarText(value.camera || metadata.camera, 300),
    metadata,
  };
}

function compactPayload(payload) {
  if (payload?.format === "my-album-compact-metadata" && Array.isArray(payload.items)) {
    const entries = [];
    for (const entry of payload.items) {
      const path = normalizePath(Array.isArray(entry) ? entry[0] : entry?.path);
      const compact = sanitizeCompact(Array.isArray(entry) ? entry[1] : entry?.metadata);
      if (path && compact) entries.push([path, compact]);
    }
    return { entries, generatedAt: scalarText(payload.generatedAt, 100) };
  }

  const rawItems = Array.isArray(payload) ? payload : payload?.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("JSON không có danh sách metadata hợp lệ.");
  }
  const indexed = new Map();
  const total = rawItems.length;
  rawItems.forEach((item, index) => {
    if (item && typeof item === "object") {
      const path = normalizePath(item._album?.path || item.SourceFile);
      if (path) indexed.set(path, compactMetadata(item));
    }
    if ((index + 1) % 500 === 0 || index + 1 === total) {
      self.postMessage({ type: "progress", processed: index + 1, total });
    }
  });
  return {
    entries: [...indexed.entries()],
    generatedAt: scalarText(payload?.generatedAt, 100),
  };
}

self.addEventListener("message", (event) => {
  try {
    const text = new TextDecoder("utf-8").decode(event.data.buffer);
    const payload = JSON.parse(text);
    const result = compactPayload(payload);
    self.postMessage({ type: "complete", ...result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Không đọc được metadata.",
    });
  }
});
