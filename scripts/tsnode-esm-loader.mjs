import { resolve as resolveTs } from "ts-node/esm";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join, resolve as resolvePath } from "node:path";
import { existsSync, lstatSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export { load, transformSource } from "ts-node/esm";

/**
 * Resolve file path with various extensions
 */
function resolveWithExtensions(basePath) {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ""];

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (existsSync(fullPath)) {
      // Don't return directories as files (avoid EISDIR in ESM loader)
      try {
        if (!lstatSync(fullPath).isDirectory()) {
          return pathToFileURL(fullPath).href;
        }
      } catch (e) {
        // If we can't stat the file, skip this candidate
      }
    }
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = join(basePath, "index" + ext);
    if (existsSync(indexPath)) {
      try {
        if (!lstatSync(indexPath).isDirectory()) {
          return pathToFileURL(indexPath).href;
        }
      } catch (e) {
        // skip
      }
    }
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  // Handle path alias @/*
  if (specifier.startsWith("@/")) {
    const relativePath = specifier.replace(/^@\//, "");
    const absolutePath = resolvePath(__dirname, "..", "src", relativePath);

    const resolved = resolveWithExtensions(absolutePath);
    if (resolved) {
      return {
        url: resolved,
        shortCircuit: true,
      };
    }
  }

  // Handle relative imports without extensions
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    // Get the parent URL path
    const parentPath = context.parentURL
      ? fileURLToPath(context.parentURL)
      : __dirname;
    const parentDir = dirname(parentPath);
    const absolutePath = resolvePath(parentDir, specifier);

    const resolved = resolveWithExtensions(absolutePath);
    if (resolved) {
      return {
        url: resolved,
        shortCircuit: true,
      };
    }
  }

  // Fall back to ts-node's default resolution
  return resolveTs(specifier, context, nextResolve);
}
