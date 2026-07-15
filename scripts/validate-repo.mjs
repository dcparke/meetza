import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8")
);

const expectedScope =
  "https://www.googleapis.com/auth/calendar.events.freebusy";
const expectedGoogleHost = "https://www.googleapis.com/*";
const expectedGmailHost = "https://mail.google.com/*";

assert(!manifest.content_scripts, "Static Gmail content scripts are not allowed.");
assert(
  JSON.stringify(manifest.host_permissions) === JSON.stringify([expectedGoogleHost]),
  "Required host permissions must remain limited to Google APIs."
);
assert(
  JSON.stringify(manifest.optional_host_permissions) ===
    JSON.stringify([expectedGmailHost]),
  "Gmail access must remain optional and limited to mail.google.com."
);
assert(
  JSON.stringify(manifest.oauth2?.scopes) === JSON.stringify([expectedScope]),
  "OAuth scope must remain FreeBusy-only."
);
assert(
  manifest.permissions?.includes("scripting") &&
    manifest.permissions?.includes("identity") &&
    manifest.permissions?.includes("storage"),
  "Required extension API permissions are missing."
);
assert(
  !manifest.permissions?.includes("tabs"),
  "The broad tabs permission is not allowed."
);

const resources = manifest.web_accessible_resources ?? [];
assert(resources.length === 1, "Exactly one web-accessible resource rule is allowed.");
assert(
  JSON.stringify(resources[0].resources?.slice().sort()) ===
    JSON.stringify(["icons/icon32.png", "panel/panel.html"]),
  "Web-accessible resources must remain limited to the panel page and compose icon."
);
assert(
  JSON.stringify(resources[0].matches) === JSON.stringify([expectedGmailHost]),
  "Web-accessible resources must be limited to Gmail."
);
assert(
  resources[0].use_dynamic_url === true,
  "Web-accessible resources must use dynamic URLs."
);

const csp = manifest.content_security_policy?.extension_pages ?? "";
for (const directive of [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src https://www.googleapis.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors https://mail.google.com"
]) {
  assert(csp.includes(directive), `CSP is missing: ${directive}`);
}

const sourceFiles = walk(root).filter((file) => {
  return /\.(js|mjs|html)$/.test(file) &&
    path.relative(root, file) !== "scripts/validate-repo.mjs";
});

for (const file of sourceFiles) {
  const text = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file);

  assert(!/\beval\s*\(/.test(text), `${relative} contains eval().`);
  assert(!/\bnew\s+Function\s*\(/.test(text), `${relative} contains new Function().`);
  assert(!/\.innerHTML\s*=/.test(text), `${relative} writes to innerHTML.`);

  if (file.endsWith(".html")) {
    const remoteScript = /<script[^>]+src=["']https?:\/\//i.test(text);
    assert(!remoteScript, `${relative} loads a remote script.`);
  }
}

const contentScript = fs.readFileSync(
  path.join(root, "content", "content.js"),
  "utf8"
);
assert(
  !contentScript.includes("chrome.storage"),
  "The Gmail content script must not access extension storage."
);
assert(
  !contentScript.includes("MEETZA_GENERATE"),
  "The Gmail content script must not generate availability."
);

for (const file of walk(root).filter((file) => file.endsWith(".js"))) {
  const relative = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  const fetchCount = (text.match(/\bfetch\s*\(/g) || []).length;

  if (relative === path.join("background", "background.js")) {
    assert(fetchCount === 1, "Background worker must have exactly one network fetch call.");
  } else {
    assert(fetchCount === 0, `${relative} must not make network requests.`);
  }
}

const background = fs.readFileSync(
  path.join(root, "background", "background.js"),
  "utf8"
);

assert(
  background.includes(
    'const FREE_BUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";'
  ),
  "FreeBusy endpoint constant is missing."
);
assert(
  !background.includes("overallStart") && !background.includes("overallEnd"),
  "FreeBusy requests must not span across unselected time gaps."
);
assert(
  background.includes("for (const date of request.dates)"),
  "Availability generation must query selected workdays individually."
);

const sharedConfig = fs.readFileSync(
  path.join(root, "shared", "config.js"),
  "utf8"
);
assert(
  /enabled:\s*false/.test(sharedConfig),
  "Gmail integration must default to disabled until host access is granted."
);
assert(
  /rememberRecentPeople:\s*false/.test(sharedConfig),
  "Recent-person storage must default to off."
);

console.log("Repository security checks passed.");

function walk(directory) {
  const results = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
    } else {
      results.push(fullPath);
    }
  }

  return results;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
