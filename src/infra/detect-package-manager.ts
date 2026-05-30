import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readPackageManagerSpec } from "./package-json.js";

type DetectedPackageManager = "pnpm" | "bun" | "npm";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function resolvePnpmGlobalDirFromGlobalRoot(globalRoot?: string | null): string | null {
  const trimmed = globalRoot?.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = path.resolve(trimmed);
  if (path.basename(normalized) !== "node_modules") {
    return null;
  }
  const layoutDir = path.dirname(normalized);
  return /^\d+$/u.test(path.basename(layoutDir)) ? path.dirname(layoutDir) : null;
}

function inferPnpmGlobalRootFromPackageRoot(pkgRoot: string): string | null {
  const normalized = path.resolve(pkgRoot);
  const parts = normalized.split(path.sep);
  const pnpmIndex = parts.lastIndexOf(".pnpm");
  if (pnpmIndex > 0 && parts[pnpmIndex + 2] === "node_modules") {
    const layoutDir = parts.slice(0, pnpmIndex).join(path.sep) || path.sep;
    const globalRoot =
      path.basename(layoutDir) === "node_modules"
        ? layoutDir
        : path.join(layoutDir, "node_modules");
    return resolvePnpmGlobalDirFromGlobalRoot(globalRoot) ? globalRoot : null;
  }

  const directGlobalRoot = path.dirname(normalized);
  return resolvePnpmGlobalDirFromGlobalRoot(directGlobalRoot) ? directGlobalRoot : null;
}

async function isPnpmOwnedPackageRoot(root: string): Promise<boolean> {
  const globalRoot = inferPnpmGlobalRootFromPackageRoot(root);
  if (!globalRoot) {
    return false;
  }
  const layoutDir = path.dirname(globalRoot);
  return (
    (await exists(path.join(globalRoot, ".modules.yaml"))) &&
    ((await exists(path.join(layoutDir, "pnpm-lock.yaml"))) ||
      (await exists(path.join(layoutDir, "package.json"))))
  );
}

function resolveBunGlobalRoot(): string {
  const bunInstall = process.env.BUN_INSTALL?.trim() || path.join(os.homedir(), ".bun");
  return path.join(bunInstall, "install", "global", "node_modules");
}

function isBunOwnedPackageRoot(root: string): boolean {
  return path.resolve(path.dirname(root)) === path.resolve(resolveBunGlobalRoot());
}

export async function detectPackageManager(root: string): Promise<DetectedPackageManager | null> {
  const files = await fs.readdir(root).catch((): string[] => []);
  const pm = (await readPackageManagerSpec(root))?.split("@")[0]?.trim();
  if (files.includes("npm-shrinkwrap.json") && !files.includes(".git")) {
    if (pm === "pnpm" && (await isPnpmOwnedPackageRoot(root))) {
      return "pnpm";
    }
    if (pm === "bun" && isBunOwnedPackageRoot(root)) {
      return "bun";
    }
    return "npm";
  }

  if (pm === "pnpm" || pm === "bun" || pm === "npm") {
    return pm;
  }

  if (files.includes("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (files.includes("bun.lock") || files.includes("bun.lockb")) {
    return "bun";
  }
  if (files.includes("package-lock.json") || files.includes("npm-shrinkwrap.json")) {
    return "npm";
  }
  return null;
}
