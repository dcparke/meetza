import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const normalizePath = (file) => file.replaceAll("\\", "/");

const read = (file) =>
  fs.readFile(path.join(root, file), "utf8");

async function filesUnder(folder, extension) {
  const found = [];
  const absoluteFolder = path.join(root, folder);

  for (const entry of await fs.readdir(absoluteFolder, {
    withFileTypes: true
  })) {
    const name = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      found.push(...await filesUnder(name, extension));
      continue;
    }

    if (entry.name.endsWith(extension)) {
      found.push(normalizePath(name));
    }
  }

  return found;
}

const sourceFiles = await filesUnder("src", ".js");

const sources = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => [
      normalizePath(file),
      await read(file)
    ])
  )
);

function requireSource(file) {
  const source = sources[file];

  assert.equal(
    typeof source,
    "string",
    `Security audit could not load ${file}`
  );

  return source;
}

const content = requireSource("src/content.js");
const contentApi = requireSource("src/content-api.js");
const background = requireSource("src/background.js");
const common = requireSource("src/common.js");
const pkce = requireSource("src/auth/pkce.js");

const manifests = await Promise.all(
  ["chrome", "edge", "firefox"].map((name) =>
    read(`manifests/${name}.json`).then(JSON.parse)
  )
);

const [chromeManifest, edgeManifest, firefoxManifest] = manifests;

for (const [file, text] of Object.entries(sources)) {
  assert(!/\beval\s*\(/.test(text), `${file} uses eval`);
  assert(!/new\s+Function\s*\(/.test(text), `${file} uses new Function`);
  assert(!/\.innerHTML\s*=/.test(text), `${file} writes innerHTML`);
  assert(!/\.outerHTML\s*=/.test(text), `${file} writes outerHTML`);
  assert(!/document\.write\s*\(/.test(text), `${file} uses document.write`);
}

const gmailSide = content + contentApi;

assert(
  !/\bfetch\s*\(/.test(gmailSide),
  "Gmail-side code performs network requests"
);

assert(
  !/XMLHttpRequest/.test(gmailSide),
  "Gmail-side code uses XMLHttpRequest"
);

assert(
  !/storage\.(local|sync|session)/.test(gmailSide),
  "Gmail-side code reads extension storage"
);

assert(
  !/\b(tabs|scripting|permissions)\./.test(contentApi),
  "content API exposes privileged browser APIs"
);

assert(
  !/postMessage\s*\(/.test(gmailSide),
  "Gmail-side code uses postMessage"
);

assert(
  !/\biframe\b/i.test(content),
  "content script creates an iframe"
);

assert.equal(
  (content.match(/document\.querySelectorAll\s*\(/g) || []).length,
  1,
  "content script added another Gmail DOM query"
);

assert(
  content.includes(`const ATTACH_SELECTOR = '[command="Files"]'`),
  "Gmail anchor selector changed"
);

assert(
  !/\.innerText\b/.test(content),
  "content script reads innerText"
);

assert.equal(
  (background.match(/\bfetch\s*\(/g) || []).length,
  1,
  "background fetch count changed"
);

assert(
  background.includes("FREEBUSY_URL"),
  "background fetch is not tied to the FreeBusy constant"
);

assert(
  background.includes("for (const date of request.dates)"),
  "FreeBusy is not queried per selected day"
);

assert(
  !background.includes("overallStart"),
  "background reintroduced wide date-range querying"
);

assert(
  background.includes('accessLevel: "TRUSTED_CONTEXTS"'),
  "storage is not locked to trusted contexts"
);

assert(
  background.includes("globalHistory"),
  "global rate limiting is missing"
);

assert(
  background.includes("activeRequests"),
  "one-active-request control is missing"
);

assert(
  background.includes(
    'js: ["content-api.js", "common.js", "content.js"]'
  ),
  "dynamic content registration changed"
);

assert.equal(
  (pkce.match(/\bfetch\s*\(/g) || []).length,
  1,
  "PKCE token fetch count changed"
);

assert(
  pkce.includes("TOKEN_URL"),
  "PKCE fetch is not tied to the token endpoint constant"
);

assert(
  pkce.includes('code_challenge_method", "S256'),
  "PKCE S256 is missing"
);

assert(
  pkce.includes("AbortController"),
  "PKCE token exchange has no timeout"
);

assert(
  common.includes("enabled: false"),
  "Gmail access must default off"
);

assert(
  common.includes("rememberRecentPeople: false"),
  "recent people must default off"
);

assert(
  common.includes("isWeekend(next)"),
  "Add Day no longer skips weekends"
);

assert.deepEqual(
  chromeManifest.host_permissions,
  ["https://www.googleapis.com/*"]
);

for (const manifest of [edgeManifest, firefoxManifest]) {
  assert.deepEqual(
    [...manifest.host_permissions].sort(),
    [
      "https://oauth2.googleapis.com/*",
      "https://www.googleapis.com/*"
    ]
  );
}

for (const manifest of manifests) {
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ["identity", "scripting", "storage"]
  );

  assert.deepEqual(
    manifest.optional_host_permissions,
    ["https://mail.google.com/*"]
  );

  assert(
    !manifest.content_scripts,
    "Gmail content scripts must be registered at runtime"
  );

  assert(
    !JSON.stringify(manifest).includes("<all_urls>"),
    "manifest requests all URLs"
  );

  const resources = manifest.web_accessible_resources
    .flatMap((item) => item.resources)
    .sort();

  assert.deepEqual(
    resources,
    ["content.css", "icons/icon32.png"]
  );

  const csp = manifest.content_security_policy.extension_pages;

  for (const directive of [
    "default-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ]) {
    assert(
      csp.includes(directive),
      `CSP is missing ${directive}`
    );
  }
}

assert.equal(
  chromeManifest.oauth2.scopes[0],
  "https://www.googleapis.com/auth/calendar.events.freebusy"
);

assert.deepEqual(
  [
    ...firefoxManifest.browser_specific_settings.gecko
      .data_collection_permissions.required
  ].sort(),
  ["authenticationInfo", "personallyIdentifyingInfo"]
);

const workflow = await read(".github/workflows/ci.yml");

assert(
  !/uses:\s+[^\s]+@v\d+/.test(workflow),
  "CI actions must be pinned to commit SHAs"
);

console.log("Security audit passed.");