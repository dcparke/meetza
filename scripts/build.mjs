import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const targets = {
  chrome: {
    manifest: "chrome.json",
    auth: "chrome.js",
    clientId: process.env.MEETZA_CHROME_CLIENT_ID || "REPLACE_ME_CHROME_CLIENT_ID"
  },
  edge: {
    manifest: "edge.json",
    auth: "pkce.js",
    clientId: process.env.MEETZA_EDGE_CLIENT_ID || "REPLACE_ME_EDGE_CLIENT_ID"
  },
  firefox: {
    manifest: "firefox.json",
    auth: "pkce.js",
    clientId: process.env.MEETZA_FIREFOX_CLIENT_ID || "REPLACE_ME_FIREFOX_CLIENT_ID"
  }
};

const requested = process.argv[2];
const names = requested ? [requested] : Object.keys(targets);

for (const name of names) {
  if (!targets[name]) {
    throw new Error(`Unknown target: ${name}`);
  }
}

await fs.mkdir(dist, { recursive: true });

for (const name of names) {
  await build(name, targets[name]);
}

async function build(name, target) {
  const output = path.join(dist, name);
  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(path.join(output, "icons"), { recursive: true });

  const sourceFiles = [
    "platform.js",
    "content-api.js",
    "common.js",
    "background.js",
    "content.js",
    "content.css",
    "popup.html",
    "popup.css",
    "popup.js"
  ];

  for (const file of sourceFiles) {
    await fs.copyFile(path.join(root, "src", file), path.join(output, file));
  }

  for (const file of await fs.readdir(path.join(root, "icons"))) {
    await fs.copyFile(path.join(root, "icons", file), path.join(output, "icons", file));
  }

  await fs.copyFile(
    path.join(root, "src", "auth", target.auth),
    path.join(output, "auth.js")
  );

  await fs.writeFile(
    path.join(output, "build-config.js"),
    `globalThis.MeetzaBuild = Object.freeze(${JSON.stringify({
      target: name,
      oauthClientId: target.clientId
    })});\n`
  );

  const manifestText = await fs.readFile(
    path.join(root, "manifests", target.manifest),
    "utf8"
  );
  const manifest = manifestText.replaceAll("__OAUTH_CLIENT_ID__", target.clientId);
  await fs.writeFile(path.join(output, "manifest.json"), manifest);

  console.log(`Built ${name}: ${path.relative(root, output)}`);
}
