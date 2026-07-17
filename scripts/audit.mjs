import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const normalize = (file) => file.replaceAll("\\", "/");
const read = (file) =>
  fs.readFile(path.join(root, file), "utf8");

const readJson = async (file) =>
  JSON.parse(await read(file));

async function filesUnder(folder, extension) {
  const files = [];

  const entries = await fs.readdir(
    path.join(root, folder),
    { withFileTypes: true }
  );

  for (const entry of entries) {
    const file = normalize(
      path.join(folder, entry.name)
    );

    if (entry.isDirectory()) {
      files.push(
        ...await filesUnder(file, extension)
      );
    } else if (
      entry.name.endsWith(extension)
    ) {
      files.push(file);
    }
  }

  return files;
}

const jsFiles = await filesUnder("src", ".js");

const sources = Object.fromEntries(
  await Promise.all(
    jsFiles.map(async (file) => [
      file,
      await read(file)
    ])
  )
);

function source(file) {
  assert.equal(
    typeof sources[file],
    "string",
    `Could not load ${file}`
  );

  return sources[file];
}

/*
 * Dangerous JavaScript patterns.
 *
 * Meetza should not evaluate strings as code, inject HTML,
 * or load JavaScript from remote servers.
 */
const forbiddenJavaScript = [
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\s*\(/, "new Function"],
  [/\.innerHTML\s*=/, "innerHTML assignment"],
  [/\.outerHTML\s*=/, "outerHTML assignment"],
  [/document\.write\s*\(/, "document.write"],

  [
    /\bimportScripts\s*\(\s*["'`]https?:\/\//,
    "remote importScripts"
  ],

  [
    /\bimport\s*\(\s*["'`]https?:\/\//,
    "remote dynamic import"
  ]
];

for (const [file, code] of Object.entries(sources)) {
  for (const [pattern, label] of forbiddenJavaScript) {
    assert(
      !pattern.test(code),
      `${file} uses ${label}`
    );
  }
}

/*
 * Gmail-side restrictions.
 *
 * Code running beside Gmail should not have network,
 * storage, or privileged extension capabilities.
 */
const gmailCode =
  source("src/content.js") +
  source("src/content-api.js");

const forbiddenInGmail = [
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\s*\(/, "sendBeacon"],

  [
    /storage\.(local|sync|session)/,
    "extension storage"
  ],

  [
    /\b(?:chrome|browser)\.(tabs|scripting|permissions)\b/,
    "privileged browser API"
  ],

  [/\bpostMessage\s*\(/, "postMessage"],

  [
    /createElement\s*\(\s*["']iframe["']\s*\)/i,
    "iframe creation"
  ]
];

for (const [pattern, label] of forbiddenInGmail) {
  assert(
    !pattern.test(gmailCode),
    `Gmail-side code uses ${label}`
  );
}

assert(
  source("src/content.js").includes(
    `const ATTACH_SELECTOR = '[command="Files"]'`
  ),
  "The Gmail anchor selector changed"
);

/*
 * Manifest policy.
 */
const manifests = Object.fromEntries(
  await Promise.all(
    ["chrome", "edge", "firefox"].map(
      async (name) => [
        name,
        await readJson(
          `manifests/${name}.json`
        )
      ]
    )
  )
);

const expectedPermissions = [
  "identity",
  "scripting",
  "storage"
];

const expectedGmailPermission = [
  "https://mail.google.com/*"
];

const expectedHosts = {
  chrome: [
    "https://www.googleapis.com/*"
  ],

  edge: [
    "https://oauth2.googleapis.com/*",
    "https://www.googleapis.com/*"
  ],

  firefox: [
    "https://oauth2.googleapis.com/*",
    "https://www.googleapis.com/*"
  ]
};

for (const [name, manifest] of Object.entries(manifests)) {
  assert.deepEqual(
    [...manifest.permissions].sort(),
    [...expectedPermissions].sort(),
    `${name} permissions changed`
  );

  assert.deepEqual(
    manifest.optional_host_permissions,
    expectedGmailPermission,
    `${name} Gmail permission must remain optional`
  );

  assert.deepEqual(
    [...manifest.host_permissions].sort(),
    [...expectedHosts[name]].sort(),
    `${name} host permissions changed`
  );

  assert(
    !manifest.content_scripts,
    `${name} must not statically run on Gmail`
  );

  assert(
    !JSON.stringify(manifest).includes("<all_urls>"),
    `${name} requests all URLs`
  );

  const resources = (
    manifest.web_accessible_resources || []
  )
    .flatMap(
      (entry) => entry.resources || []
    )
    .sort();

  assert.deepEqual(
    resources,
    [
      "content.css",
      "icons/icon32.png"
    ],
    `${name} web-accessible resources changed`
  );

  const csp =
    manifest.content_security_policy
      ?.extension_pages || "";

  for (const directive of [
    "default-src 'none'",
    "script-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ]) {
    assert(
      csp.includes(directive),
      `${name} CSP is missing ${directive}`
    );
  }
}

/*
 * Chrome must retain the narrow FreeBusy-only scope.
 */
assert.deepEqual(
  manifests.chrome.oauth2?.scopes,
  [
    "https://www.googleapis.com/auth/calendar.events.freebusy"
  ],
  "Chrome OAuth scope must remain FreeBusy-only"
);

/*
 * Meetza intentionally has no runtime dependencies.
 */
const packageJson =
  await readJson("package.json");

assert.equal(
  Object.keys(
    packageJson.dependencies || {}
  ).length,
  0,
  "Runtime dependencies were added"
);

assert.equal(
  Object.keys(
    packageJson.optionalDependencies || {}
  ).length,
  0,
  "Optional runtime dependencies were added"
);

/*
 * CI actions should use immutable commit SHAs.
 */
try {
  const workflow = await read(
    ".github/workflows/ci.yml"
  );

  assert(
    !/uses:\s+[^\s]+@v\d+/i.test(workflow),
    "GitHub Actions must be pinned to commit SHAs"
  );
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

console.log("Security policy audit passed.");