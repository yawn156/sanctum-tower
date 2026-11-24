import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { USER_AGENT } from "../config.js";

export interface FetchCachedOptions {
  refresh?: boolean;
  delayMs?: number;
  headers?: Record<string, string>;
}

export interface DownloadCachedOptions extends FetchCachedOptions {
  allow404?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let networkFetchCount = 0;

export function getNetworkFetchCount(): number {
  return networkFetchCount;
}

export function resetNetworkFetchCount(): void {
  networkFetchCount = 0;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function fetchCached(
  url: string,
  cachePath: string,
  opts: FetchCachedOptions = {}
): Promise<{ content: string; fromCache: boolean }> {
  const { refresh = false, delayMs = 300, headers = {} } = opts;

  if (!refresh && (await fileExists(cachePath))) {
    const content = await fs.readFile(cachePath, "utf8");
    return { content, fromCache: true };
  }

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  networkFetchCount++;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} fetching ${url}`
    );
  }

  const content = await response.text();
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, content, "utf8");
  return { content, fromCache: false };
}

export async function downloadFileCached(
  url: string,
  cachePath: string,
  opts: DownloadCachedOptions = {}
): Promise<{ path: string; fromCache: boolean; notFound?: boolean }> {
  const { refresh = false, delayMs = 200, headers = {}, allow404 = false } =
    opts;

  if (!refresh && (await fileExists(cachePath))) {
    return { path: cachePath, fromCache: true };
  }

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  networkFetchCount++;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      ...headers,
    },
  });

  if (allow404 && response.status === 404) {
    await response.body?.cancel();
    return { path: cachePath, fromCache: false, notFound: true };
  }

  if (!response.ok || !response.body) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} fetching ${url}`
    );
  }

  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const tmpPath = `${cachePath}.tmp`;
  try {
    const readable = Readable.fromWeb(
      response.body as unknown as NodeWebReadableStream<Uint8Array>
    );
    await pipeline(readable, createWriteStream(tmpPath));
    await fs.rename(tmpPath, cachePath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }

  return { path: cachePath, fromCache: false };
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJson(
  filePath: string,
  data: unknown,
  pretty = true
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  await fs.writeFile(filePath, serialized + "\n", "utf8");
}
