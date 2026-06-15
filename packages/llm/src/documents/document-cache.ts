// @ts-nocheck
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const DOCUMENT_CACHE_SCHEMA_VERSION = 1;

export function createFileSystemDocumentCache({
  rootDir = path.join(".cache", "llm-proxy", "document-parser"),
  namespace = "default"
} = {}) {
  return {
    type: "filesystem",
    rootDir,
    namespace,
    async getJson(key) {
      try {
        const raw = await readFile(cacheFilePath({ rootDir, namespace, key }), "utf8");
        return JSON.parse(raw).value;
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async setJson(key, value) {
      const filePath = cacheFilePath({ rootDir, namespace, key });
      await mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tempPath, JSON.stringify({
        schema_version: DOCUMENT_CACHE_SCHEMA_VERSION,
        key,
        stored_at: new Date().toISOString(),
        value
      }));
      await rename(tempPath, filePath);
    }
  };
}

export function createDocumentCacheKey(parts) {
  return sha256Json({
    schema_version: DOCUMENT_CACHE_SCHEMA_VERSION,
    ...parts
  });
}

export function sha256Text(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function stableStringify(value) {
  return JSON.stringify(sortForJson(value));
}

function sha256Json(value) {
  return sha256Text(stableStringify(value));
}

function cacheFilePath({ rootDir, namespace, key }) {
  const safeNamespace = String(namespace || "default").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return path.join(rootDir, safeNamespace, key.slice(0, 2), `${key}.json`);
}

function sortForJson(value) {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortForJson(nested)])
  );
}
