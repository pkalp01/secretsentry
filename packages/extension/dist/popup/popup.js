"use strict";
(() => {
  // src/sites.ts
  var DEFAULT_SITE_PATTERNS = [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://aistudio.google.com/*",
    "https://copilot.microsoft.com/*",
    "https://m365.cloud.microsoft/*",
    "https://www.perplexity.ai/*",
    "https://chat.deepseek.com/*",
    "https://grok.com/*",
    "https://chat.mistral.ai/*",
    "https://www.meta.ai/*",
    "https://poe.com/*",
    "https://chat.qwen.ai/*",
    "https://huggingface.co/chat/*"
  ];
  var E2E_SITE_PATTERNS = ["http://127.0.0.1/*"];
  var HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
  var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1"]);
  var PATH = /^\/(?:[A-Za-z0-9._~!$&'()+,;=:@%\-/]*\*)?$/;
  function normalizeSitePattern(input) {
    let s = input.trim();
    if (!s || s.length > 253) return null;
    let scheme = "https";
    const schemeMatch = s.match(/^([A-Za-z]+):\/\//);
    if (schemeMatch) {
      scheme = schemeMatch[1].toLowerCase();
      s = s.slice(schemeMatch[0].length);
    }
    const slash = s.indexOf("/");
    let host = (slash === -1 ? s : s.slice(0, slash)).toLowerCase();
    let path = slash === -1 ? "/*" : s.slice(slash);
    host = host.replace(/:\d+$/, "");
    if (host.includes("@")) return null;
    if (scheme !== "https" && !(scheme === "http" && LOCAL_HOSTS.has(host))) return null;
    if (!LOCAL_HOSTS.has(host) && !HOST.test(host)) return null;
    path = path.replace(/[?#].*$/, "");
    if (!path.endsWith("*")) path = path.replace(/\/?$/, "/*");
    if (path !== "/*" && !path.endsWith("/*")) path = path.replace(/\*$/, "/*");
    if (!PATH.test(path)) return null;
    return `${scheme}://${host}${path}`;
  }
  function displayName(pattern) {
    const m = pattern.match(/^[a-z]+:\/\/([^/]+)(\/.*)$/);
    if (!m) return pattern;
    const path = m[2] === "/*" ? "" : m[2].replace(/\/\*$/, "");
    return m[1] + path;
  }
  function patternMatchesUrl(pattern, url) {
    const m = pattern.match(/^([a-z]+):\/\/([^/]+)(\/.*)$/);
    if (!m) return false;
    let u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const [, scheme, host, path] = m;
    if (u.protocol !== `${scheme}:`) return false;
    if (u.hostname.toLowerCase() !== host) return false;
    const prefix = path.replace(/\*$/, "");
    const target = u.pathname;
    return target.startsWith(prefix) || `${target}/` === prefix;
  }
  function permissionOrigin(pattern) {
    return pattern.replace(/^([a-z]+:\/\/[^/]+)\/.*$/, "$1/*");
  }
  function siteForUrl(sites, url) {
    const matching = sites.filter((s) => patternMatchesUrl(s.pattern, url));
    return matching.find((s) => s.enabled) ?? matching[0];
  }

  // src/settings.ts
  var STORAGE_KEY = "settings";
  var MAX_SITES = 200;
  var isE2E = false;
  function builtInPatterns() {
    return [...DEFAULT_SITE_PATTERNS, ...isE2E ? E2E_SITE_PATTERNS : []];
  }
  function defaultSettings() {
    return { version: 1, enabled: true, sites: builtInPatterns().map((pattern) => ({ pattern, enabled: true, builtIn: true })) };
  }
  function sanitizeSettings(raw) {
    const base = defaultSettings();
    if (!raw || typeof raw !== "object") return base;
    const r = raw;
    const builtIns = new Set(builtInPatterns());
    const seen = /* @__PURE__ */ new Set();
    const sites = [];
    if (Array.isArray(r.sites)) {
      for (const item of r.sites.slice(0, MAX_SITES)) {
        if (!item || typeof item !== "object") continue;
        const s = item;
        if (typeof s.pattern !== "string") continue;
        const pattern = builtIns.has(s.pattern) ? s.pattern : normalizeSitePattern(s.pattern);
        if (!pattern || pattern !== s.pattern || seen.has(pattern)) continue;
        seen.add(pattern);
        sites.push({ pattern, enabled: s.enabled !== false, builtIn: builtIns.has(pattern) });
      }
    }
    for (const p of builtIns) if (!seen.has(p)) sites.push({ pattern: p, enabled: true, builtIn: true });
    return { version: 1, enabled: r.enabled !== false, sites };
  }
  async function loadSettings() {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    return sanitizeSettings(got[STORAGE_KEY]);
  }
  async function saveSettings(settings) {
    await chrome.storage.local.set({ [STORAGE_KEY]: sanitizeSettings(settings) });
  }

  // src/registration.ts
  var SCRIPT_ID = "secretsentry";
  var queue = Promise.resolve();
  function reconcileContentScripts() {
    const run = queue.then(reconcile, reconcile);
    queue = run.catch(() => void 0);
    return run;
  }
  async function reconcile() {
    const settings = await loadSettings();
    const wanted = settings.enabled ? settings.sites.filter((s) => s.enabled).map((s) => permissionOrigin(s.pattern)) : [];
    const matches = [];
    for (const origin of new Set(wanted)) {
      if (await chrome.permissions.contains({ origins: [origin] })) matches.push(origin);
    }
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (matches.length === 0) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      return [];
    }
    const script = {
      id: SCRIPT_ID,
      matches,
      js: ["content.js"],
      runAt: "document_start",
      allFrames: false,
      persistAcrossSessions: true
    };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else {
      try {
        await chrome.scripting.registerContentScripts([script]);
      } catch {
        await chrome.scripting.updateContentScripts([script]);
      }
    }
    return matches;
  }

  // src/site-actions.ts
  async function addSite(input) {
    const pattern = normalizeSitePattern(input);
    if (!pattern) {
      return { ok: false, error: "Enter a site like chat.example.com. Use https (http works only for localhost)." };
    }
    const granted = await chrome.permissions.request({ origins: [permissionOrigin(pattern)] });
    if (!granted) return { ok: false, error: "Access wasn't granted, so the site wasn't added." };
    const settings = await loadSettings();
    const existing = settings.sites.find((s) => s.pattern === pattern);
    if (!existing && settings.sites.length >= MAX_SITES) return { ok: false, error: `You can add up to ${MAX_SITES} sites.` };
    if (existing) existing.enabled = true;
    else settings.sites.push({ pattern, enabled: true, builtIn: false });
    await commit(settings);
    return { ok: true, pattern };
  }
  async function setSiteEnabled(pattern, enabled) {
    if (enabled && !await chrome.permissions.request({ origins: [permissionOrigin(pattern)] })) return;
    const settings = await loadSettings();
    const site = settings.sites.find((s) => s.pattern === pattern);
    if (!site) return;
    site.enabled = enabled;
    await commit(settings);
  }
  async function setEnabled(enabled) {
    const settings = await loadSettings();
    settings.enabled = enabled;
    await commit(settings);
  }
  async function commit(settings) {
    await saveSettings(settings);
    await reconcileContentScripts().catch(() => void 0);
  }

  // ../core/src/types.ts
  var CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

  // ../core/src/engine.ts
  function resolveOverlaps(findings, rank = () => 0) {
    const byStart = [...findings].sort((a, b) => a.start - b.start || a.end - b.end);
    if (byStart.every((f, i) => i === 0 || f.start >= byStart[i - 1].end)) return byStart;
    const ordered = [...findings].sort(
      (a, b) => rank(a) - rank(b) || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || b.end - b.start - (a.end - a.start) || a.start - b.start
    );
    const kept = [];
    for (const f of ordered) {
      if (!kept.some((k) => f.start < k.end && f.end > k.start)) kept.push(f);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  // ../core/src/modules/secrets/entropy.ts
  function shannonEntropy(value) {
    if (!value) return 0;
    const counts = /* @__PURE__ */ new Map();
    for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const n = value.length;
    let bits = 0;
    for (const c of counts.values()) {
      const p = c / n;
      bits -= p * Math.log2(p);
    }
    return bits;
  }

  // ../core/src/modules/secrets/validators.ts
  var BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  var crcTable;
  function crc32(input) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
        crcTable[i] = c >>> 0;
      }
    }
    let crc = 4294967295;
    for (let i = 0; i < input.length; i++) {
      crc = crcTable[(crc ^ input.charCodeAt(i)) & 255] ^ crc >>> 8;
    }
    return (crc ^ 4294967295) >>> 0;
  }
  function base62(n, width) {
    let out = "";
    do {
      out = BASE62[n % 62] + out;
      n = Math.floor(n / 62);
    } while (n > 0);
    return out.padStart(width, "0");
  }
  var githubChecksum = (value) => {
    const body = value.slice(4);
    if (body.length !== 36) return "fail";
    const random = body.slice(0, 30);
    const check = body.slice(30);
    return base62(crc32(random), 6) === check ? "pass" : "fail";
  };
  var VALIDATORS = {
    "github-checksum": githubChecksum
  };

  // ../core/src/modules/secrets/filters.ts
  var KNOWN_EXAMPLE_VALUES = /* @__PURE__ */ new Set([
    "AKIAIOSFODNN7EXAMPLE",
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
  ]);
  var PLACEHOLDER_SHAPES = [
    /^<[^>]*>$/,
    // <API_KEY>
    /^\$\{[^}]*\}$/,
    // ${API_KEY}
    /^\{\{[^}]*\}\}$/,
    // {{ api_key }}
    /^\{[^}]*\}$/,
    // {api_key}
    /^%[A-Za-z_][A-Za-z0-9_]*%$/,
    // %API_KEY%
    /^\$[A-Za-z_][A-Za-z0-9_]*$/,
    // $API_KEY
    /^\[[A-Z0-9_]+_\d+\]$/,
    // [OPENAI_KEY_1], our own redaction labels
    /^[x*•.\-_#0]+$/i
    // xxxx, ****, 0000
  ];
  var PLACEHOLDER_WORDS = /your|example|sample|dummy|placeholder|changeme|change_me|redacted|insert|replace|fake|mock|todo|fixme|<|>/i;
  var STOP_VALUES = /* @__PURE__ */ new Set([
    "true",
    "false",
    "null",
    "nil",
    "none",
    "undefined",
    "required",
    "optional",
    "string",
    "number",
    "boolean",
    "password",
    "passwd",
    "secret",
    "token",
    "bearer",
    "basic",
    "notset",
    "not_set",
    "empty",
    "default",
    "hidden",
    "masked",
    "invalid",
    "incorrect",
    "expired",
    "missing"
  ]);
  var VARIABLE_REFERENCE = /^(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|getenv|env\(|ENV\[|System\.getenv|\$env:|config\.|settings\.|secrets\.|vault:)/i;
  var DOTTED_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
  var URL_OR_PATH = /^(?:[a-z][a-z0-9+.\-]*:\/\/|\.{0,2}\/|[A-Za-z]:\\|~\/)/i;
  var EMAIL = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;
  var DESCRIPTIVE_NAME_SUFFIX = /[_\-.](?:name|names|id|ids|type|url|uri|path|file|dir|header|endpoint|length|len|size|field|label|policy|version|arn|ttl|expiry|expires|expiration|count|prefix|env|var|key_?name|hash|algo|algorithm|format|location|ref|store)$/i;
  function isKnownExample(value) {
    return KNOWN_EXAMPLE_VALUES.has(value);
  }
  function isPlaceholder(value) {
    if (PLACEHOLDER_SHAPES.some((re) => re.test(value))) return true;
    if (PLACEHOLDER_WORDS.test(value)) return true;
    const tail = value.slice(-16);
    if (tail.length >= 8 && shannonEntropy(tail) < 1.5) return true;
    return false;
  }
  function looksLikeNonSecretValue(value, followingChar) {
    if (STOP_VALUES.has(value.toLowerCase())) return true;
    if (VARIABLE_REFERENCE.test(value)) return true;
    if (DOTTED_PATH.test(value)) return true;
    if (URL_OR_PATH.test(value)) return true;
    if (EMAIL.test(value)) return true;
    if (followingChar === "(") return true;
    return false;
  }
  function isDescriptiveName(name) {
    return DESCRIPTIVE_NAME_SUFFIX.test(name);
  }
  function isUrlPasswordPlaceholder(value) {
    return /^(?:password|pass|passwd|pwd|secret|pw|xxx+|\*+)$/i.test(value);
  }

  // ../core/src/modules/secrets/rules.generated.ts
  var RULESET_VERSION = "2026.10.1";
  var RULES = [
    {
      "id": "anthropic-api-key",
      "label": "Anthropic API key",
      "category": "ai",
      "confidence": "high",
      "keywords": [
        "sk-ant-"
      ],
      "pattern": "\\b(sk-ant-[A-Za-z0-9_\\-]{32,200})",
      "flags": "",
      "group": 1,
      "placeholder": "ANTHROPIC_API_KEY",
      "description": "Known Anthropic format (sk-ant-)"
    },
    {
      "id": "openai-api-key",
      "label": "OpenAI API key",
      "category": "ai",
      "confidence": "high",
      "keywords": [
        "sk-proj-",
        "sk-svcacct-",
        "sk-admin-"
      ],
      "pattern": "\\b(sk-(?:proj|svcacct|admin)-[A-Za-z0-9_\\-]{40,250})",
      "flags": "",
      "group": 1,
      "placeholder": "OPENAI_API_KEY",
      "description": "Known OpenAI format (sk-proj-, sk-svcacct- or sk-admin-)"
    },
    {
      "id": "openai-legacy-key",
      "label": "OpenAI API key (legacy)",
      "category": "ai",
      "confidence": "high",
      "keywords": [
        "t3blbkfj"
      ],
      "pattern": "\\b(sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "OPENAI_API_KEY",
      "description": 'Older OpenAI format (contains T3BlbkFJ, which is "OpenAI" in base64)'
    },
    {
      "id": "sk-style-api-key",
      "label": "API key (sk- format)",
      "category": "ai",
      "confidence": "medium",
      "keywords": [
        "sk-"
      ],
      "pattern": "\\b(sk-[A-Za-z0-9]{32,64})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "API_KEY",
      "description": "Many AI providers use sk- keys (DeepSeek, Moonshot and others)",
      "minEntropy": 3.5,
      "generic": true
    },
    {
      "id": "huggingface-token",
      "label": "Hugging Face token",
      "category": "ai",
      "confidence": "high",
      "keywords": [
        "hf_"
      ],
      "pattern": "\\b(hf_[A-Za-z0-9]{34,40})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "HF_TOKEN",
      "description": "Known Hugging Face format (hf_ plus 34 or more characters)",
      "minEntropy": 3.5
    },
    {
      "id": "groq-api-key",
      "label": "Groq API key",
      "category": "ai",
      "confidence": "high",
      "keywords": [
        "gsk_"
      ],
      "pattern": "\\b(gsk_[A-Za-z0-9]{52})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "GROQ_API_KEY",
      "description": "Known Groq format (gsk_ plus 52 characters)"
    },
    {
      "id": "replicate-token",
      "label": "Replicate API token",
      "category": "ai",
      "confidence": "high",
      "keywords": [
        "r8_"
      ],
      "pattern": "\\b(r8_[A-Za-z0-9]{37})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "REPLICATE_TOKEN",
      "description": "Known Replicate format (r8_ plus 37 characters)"
    },
    {
      "id": "aws-access-key-id",
      "label": "AWS access key ID",
      "category": "cloud",
      "confidence": "high",
      "keywords": [
        "akia",
        "asia",
        "abia",
        "acca"
      ],
      "pattern": "\\b((?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "AWS_ACCESS_KEY_ID",
      "description": "Known AWS format (AKIA or ASIA plus 16 characters)"
    },
    {
      "id": "aws-secret-access-key",
      "label": "AWS secret access key",
      "category": "cloud",
      "confidence": "high",
      "keywords": [
        "aws",
        "amazon"
      ],
      "pattern": `(?:aws|amazon)[\\w\\-]{0,30}?(?:secret|sk)[\\w\\-]{0,30}?["']?\\s*(?:=|:|=>)\\s*["']?([A-Za-z0-9/+]{40})(?![A-Za-z0-9/+])`,
      "flags": "i",
      "group": 1,
      "placeholder": "AWS_SECRET_ACCESS_KEY",
      "description": "40-character value assigned to an AWS secret key name",
      "minEntropy": 3.5
    },
    {
      "id": "gcp-api-key",
      "label": "Google API key",
      "category": "cloud",
      "confidence": "high",
      "keywords": [
        "aiza"
      ],
      "pattern": "\\b(AIza[0-9A-Za-z_\\-]{35})(?![0-9A-Za-z_\\-])",
      "flags": "",
      "group": 1,
      "placeholder": "GOOGLE_API_KEY",
      "description": "Known Google format (AIza plus 35 characters). Also used for Gemini and Firebase"
    },
    {
      "id": "gcp-service-account-key-id",
      "label": "Google service account key",
      "category": "cloud",
      "confidence": "high",
      "keywords": [
        "private_key_id"
      ],
      "pattern": '"private_key_id"\\s*:\\s*"([a-f0-9]{40})"',
      "flags": "",
      "group": 1,
      "placeholder": "GCP_PRIVATE_KEY_ID",
      "description": "Service account JSON file (the private key itself is flagged separately)"
    },
    {
      "id": "azure-storage-account-key",
      "label": "Azure storage account key",
      "category": "cloud",
      "confidence": "high",
      "keywords": [
        "accountkey"
      ],
      "pattern": "AccountKey=([A-Za-z0-9+/]{86}==)",
      "flags": "",
      "group": 1,
      "placeholder": "AZURE_STORAGE_KEY",
      "description": "Azure Storage connection string with an account key"
    },
    {
      "id": "azure-entra-client-secret",
      "label": "Microsoft Entra client secret",
      "category": "cloud",
      "confidence": "high",
      "keywords": [
        "q~"
      ],
      "pattern": "(?<![A-Za-z0-9_~.\\-])([A-Za-z0-9_~.]{3}\\dQ~[A-Za-z0-9_~.\\-]{31,34})(?![A-Za-z0-9_~.\\-])",
      "flags": "",
      "group": 1,
      "placeholder": "ENTRA_CLIENT_SECRET",
      "description": "Known Entra ID (Azure AD) app secret format (3 characters, a digit, then Q~)",
      "minEntropy": 3.5
    },
    {
      "id": "digitalocean-token",
      "label": "DigitalOcean token",
      "category": "cloud",
      "confidence": "high",
      "keywords": [
        "dop_v1_",
        "doo_v1_",
        "dor_v1_"
      ],
      "pattern": "\\b(do[opr]_v1_[a-f0-9]{64})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "DIGITALOCEAN_TOKEN",
      "description": "Known DigitalOcean format (dop_v1_ plus 64 hex characters)"
    },
    {
      "id": "github-token",
      "label": "GitHub token",
      "category": "code",
      "confidence": "high",
      "keywords": [
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "ghr_"
      ],
      "pattern": "\\b(gh[pousr]_[A-Za-z0-9]{36})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "GITHUB_TOKEN",
      "description": "Known GitHub format (ghp_, gho_, ghu_, ghs_ or ghr_ plus 36 characters)",
      "validate": "github-checksum"
    },
    {
      "id": "github-fine-grained-pat",
      "label": "GitHub fine-grained token",
      "category": "code",
      "confidence": "high",
      "keywords": [
        "github_pat_"
      ],
      "pattern": "\\b(github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "GITHUB_TOKEN",
      "description": "Known GitHub fine-grained token format (github_pat_)"
    },
    {
      "id": "gitlab-token",
      "label": "GitLab token",
      "category": "code",
      "confidence": "high",
      "keywords": [
        "glpat-",
        "gldt-",
        "glrt-"
      ],
      "pattern": "\\b(gl(?:pat|dt|rt)-[A-Za-z0-9_\\-]{20,64})(?![A-Za-z0-9_\\-])",
      "flags": "",
      "group": 1,
      "placeholder": "GITLAB_TOKEN",
      "description": "Known GitLab format (glpat- and related prefixes)"
    },
    {
      "id": "npm-token",
      "label": "npm access token",
      "category": "code",
      "confidence": "high",
      "keywords": [
        "npm_"
      ],
      "pattern": "\\b(npm_[A-Za-z0-9]{36})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "NPM_TOKEN",
      "description": "Known npm format (npm_ plus 36 characters)"
    },
    {
      "id": "pypi-token",
      "label": "PyPI upload token",
      "category": "code",
      "confidence": "high",
      "keywords": [
        "pypi-ageichlwas5vcmc"
      ],
      "pattern": "\\b(pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_\\-]{50,300})",
      "flags": "",
      "group": 1,
      "placeholder": "PYPI_TOKEN",
      "description": "Known PyPI token format (pypi-AgEIcHlwaS5vcmc...)"
    },
    {
      "id": "url-credentials",
      "label": "Password in a connection URL",
      "category": "database",
      "confidence": "high",
      "keywords": [
        "://"
      ],
      "pattern": "\\b[a-z][a-z0-9+.\\-]{1,20}://[^\\s:/@]{1,256}:([^\\s@/]{3,256})@[^\\s/]",
      "flags": "i",
      "group": 1,
      "placeholder": "URL_PASSWORD",
      "description": "A password inside a user:password@host connection string"
    },
    {
      "id": "generic-secret-assignment",
      "label": "Secret assigned to a variable",
      "category": "generic",
      "confidence": "medium",
      "keywords": [
        "key",
        "secret",
        "token",
        "passw",
        "pwd",
        "auth",
        "credential"
      ],
      "pattern": "(?<![A-Za-z0-9])((?:[A-Za-z0-9]{1,30}[_\\-.]){0,4}(?:api[_\\-.]?key|apikey|secret|token|passw(?:or)?d|pwd|auth|credentials?|private[_\\-.]?key|access[_\\-.]?key)(?:[_\\-.][A-Za-z0-9]{1,30}){0,4})[\"'`]?\\s*(?:=|:=|:|=>|->)\\s*[\"'`]?([^\\s\"'`,;(){}\\[\\]<>]{8,256})",
      "flags": "i",
      "group": 2,
      "placeholder": "SECRET",
      "description": "Random-looking value assigned to a secret-like name",
      "nameGroup": 1,
      "minEntropy": 3,
      "generic": true
    },
    {
      "id": "private-key",
      "label": "Private key",
      "category": "keys",
      "confidence": "high",
      "keywords": [
        "private key"
      ],
      "pattern": "(-----BEGIN[ A-Z0-9]{0,40}PRIVATE KEY(?: BLOCK)?-----(?:(?:(?!-----BEGIN)[\\s\\S]){0,12000}?-----END[ A-Z0-9]{0,40}PRIVATE KEY(?: BLOCK)?-----)?)",
      "flags": "",
      "group": 1,
      "placeholder": "PRIVATE_KEY",
      "description": "Begins with a private key header (SSH, TLS, PGP)"
    },
    {
      "id": "jwt",
      "label": "JSON Web Token",
      "category": "tokens",
      "confidence": "high",
      "keywords": [
        "eyj"
      ],
      "pattern": "\\b(eyJ[A-Za-z0-9_\\-]{10,4000}\\.eyJ[A-Za-z0-9_\\-]{10,8000}\\.[A-Za-z0-9_\\-]{10,4000})",
      "flags": "",
      "group": 1,
      "placeholder": "JWT",
      "description": "A signed login or session token (three base64 parts starting with eyJ)"
    },
    {
      "id": "basic-auth-header",
      "label": "Basic auth credentials",
      "category": "tokens",
      "confidence": "high",
      "keywords": [
        "basic"
      ],
      "pattern": `Authorization["']?\\s*[:=]\\s*["']?Basic\\s+([A-Za-z0-9+/]{12,1000}={0,2})`,
      "flags": "i",
      "group": 1,
      "placeholder": "BASIC_AUTH",
      "description": "A username and password encoded in an Authorization header",
      "minEntropy": 3
    },
    {
      "id": "bearer-token",
      "label": "Bearer token",
      "category": "tokens",
      "confidence": "medium",
      "keywords": [
        "bearer"
      ],
      "pattern": "\\bBearer\\s+([A-Za-z0-9._~+/\\-]{20,2000}=*)",
      "flags": "i",
      "group": 1,
      "placeholder": "BEARER_TOKEN",
      "description": "A token sent in an Authorization header",
      "minEntropy": 3.5,
      "generic": true
    },
    {
      "id": "slack-token",
      "label": "Slack token",
      "category": "messaging",
      "confidence": "high",
      "keywords": [
        "xox"
      ],
      "pattern": "\\b(xox[abeprs]-[0-9A-Za-z\\-]{10,250})",
      "flags": "",
      "group": 1,
      "placeholder": "SLACK_TOKEN",
      "description": "Known Slack format (xoxb-, xoxp- and related)",
      "minEntropy": 3
    },
    {
      "id": "slack-webhook",
      "label": "Slack webhook URL",
      "category": "messaging",
      "confidence": "high",
      "keywords": [
        "hooks.slack.com"
      ],
      "pattern": "(https://hooks\\.slack\\.com/services/T[A-Z0-9]{6,12}/B[A-Z0-9]{6,12}/[A-Za-z0-9]{20,32})",
      "flags": "",
      "group": 1,
      "placeholder": "SLACK_WEBHOOK",
      "description": "Anyone with this URL can post to your Slack channel"
    },
    {
      "id": "discord-webhook",
      "label": "Discord webhook URL",
      "category": "messaging",
      "confidence": "high",
      "keywords": [
        "discord"
      ],
      "pattern": "(https://(?:ptb\\.|canary\\.)?discord(?:app)?\\.com/api/webhooks/\\d{17,20}/[A-Za-z0-9_\\-]{60,80})",
      "flags": "",
      "group": 1,
      "placeholder": "DISCORD_WEBHOOK",
      "description": "Anyone with this URL can post to your Discord channel"
    },
    {
      "id": "telegram-bot-token",
      "label": "Telegram bot token",
      "category": "messaging",
      "confidence": "high",
      "keywords": [
        ":aa"
      ],
      "pattern": "\\b(\\d{8,10}:AA[A-Za-z0-9_\\-]{33})(?![A-Za-z0-9_\\-])",
      "flags": "",
      "group": 1,
      "placeholder": "TELEGRAM_BOT_TOKEN",
      "description": "Known Telegram bot token format (bot id, then :AA)"
    },
    {
      "id": "sendgrid-api-key",
      "label": "SendGrid API key",
      "category": "messaging",
      "confidence": "high",
      "keywords": [
        "sg."
      ],
      "pattern": "\\b(SG\\.[A-Za-z0-9_\\-]{22}\\.[A-Za-z0-9_\\-]{43})(?![A-Za-z0-9_\\-])",
      "flags": "",
      "group": 1,
      "placeholder": "SENDGRID_API_KEY",
      "description": "Known SendGrid format (SG. plus two segments)"
    },
    {
      "id": "twilio-api-key",
      "label": "Twilio API key",
      "category": "messaging",
      "confidence": "medium",
      "keywords": [
        "sk"
      ],
      "pattern": "\\b(SK[0-9a-f]{32})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "TWILIO_API_KEY",
      "description": "Matches the Twilio API key format (SK plus 32 hex characters)",
      "minEntropy": 3
    },
    {
      "id": "mailgun-api-key",
      "label": "Mailgun API key",
      "category": "messaging",
      "confidence": "medium",
      "keywords": [
        "key-"
      ],
      "pattern": "\\b(key-[0-9a-f]{32})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "MAILGUN_API_KEY",
      "description": "Matches the Mailgun key format (key- plus 32 hex characters)",
      "minEntropy": 3
    },
    {
      "id": "stripe-live-key",
      "label": "Stripe live secret key",
      "category": "payments",
      "confidence": "high",
      "keywords": [
        "sk_live_",
        "rk_live_"
      ],
      "pattern": "\\b((?:sk|rk)_live_[A-Za-z0-9]{24,99})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "STRIPE_SECRET_KEY",
      "description": "Known Stripe live-mode format (sk_live_ or rk_live_). Can move real money"
    },
    {
      "id": "stripe-test-key",
      "label": "Stripe test secret key",
      "category": "payments",
      "confidence": "medium",
      "keywords": [
        "sk_test_",
        "rk_test_"
      ],
      "pattern": "\\b((?:sk|rk)_test_[A-Za-z0-9]{24,99})\\b",
      "flags": "",
      "group": 1,
      "placeholder": "STRIPE_TEST_KEY",
      "description": "Stripe test-mode key. No real money, but it still unlocks your Stripe account data"
    },
    {
      "id": "square-token",
      "label": "Square access token",
      "category": "payments",
      "confidence": "high",
      "keywords": [
        "sq0atp-",
        "sq0csp-"
      ],
      "pattern": "\\b(sq0(?:atp|csp)-[A-Za-z0-9_\\-]{22,43})(?![A-Za-z0-9_\\-])",
      "flags": "",
      "group": 1,
      "placeholder": "SQUARE_TOKEN",
      "description": "Known Square format (sq0atp- or sq0csp-)"
    },
    {
      "id": "braintree-token",
      "label": "Braintree production token",
      "category": "payments",
      "confidence": "high",
      "keywords": [
        "access_token$production$"
      ],
      "pattern": "(access_token\\$production\\$[a-z0-9]{16}\\$[a-f0-9]{32})",
      "flags": "",
      "group": 1,
      "placeholder": "BRAINTREE_TOKEN",
      "description": "Known Braintree production access token format"
    }
  ];

  // ../core/src/modules/secrets/index.ts
  var DOWNGRADE = { high: "medium", medium: "low", low: "low" };
  function compileRules(rules) {
    return rules.map((r) => ({ ...r, re: new RegExp(r.pattern, "gd" + r.flags.replace(/[gd]/g, "")) }));
  }
  function maskValue(value, ruleId) {
    if (ruleId === "private-key") {
      const lines = value.split(/\r?\n/).length;
      return lines > 1 ? `-----BEGIN … PRIVATE KEY----- (${lines} lines)` : "-----BEGIN … PRIVATE KEY-----";
    }
    if (value.length <= 8) return "•".repeat(value.length);
    if (value.length < 16) return value.slice(0, 2) + "•".repeat(Math.min(10, value.length - 2));
    const keep = value.length >= 20 ? 4 : 2;
    return value.slice(0, keep) + "•".repeat(Math.min(10, value.length - keep - 2)) + value.slice(-2);
  }
  function createSecretsModule(options = {}) {
    const rules = compileRules(options.rules ?? RULES);
    function scan(text, opts = {}) {
      if (!text) return [];
      const lower = text.toLowerCase();
      const disabledRules = new Set(opts.disabledRules ?? []);
      const disabledCats = new Set(opts.disabledCategories ?? []);
      const minRank = CONFIDENCE_RANK[opts.minConfidence ?? "low"];
      const candidates = [];
      for (const rule of rules) {
        if (disabledRules.has(rule.id) || disabledCats.has(rule.category)) continue;
        if (rule.keywords.length && !rule.keywords.some((k) => lower.includes(k))) continue;
        rule.re.lastIndex = 0;
        for (const m of text.matchAll(rule.re)) {
          const value = m[rule.group];
          const span = m.indices?.[rule.group];
          if (value === void 0 || !span) continue;
          const [start, end] = span;
          let confidence = rule.confidence;
          let reason = rule.description;
          const name = rule.nameGroup !== void 0 ? m[rule.nameGroup] : void 0;
          if (isKnownExample(value)) {
            confidence = "low";
            reason = "This is a published example key, not a real one";
          } else {
            if (isPlaceholder(value)) continue;
            if (rule.generic && looksLikeNonSecretValue(value, text[end])) continue;
            if (name && isDescriptiveName(name)) continue;
            if (rule.category === "database" && isUrlPasswordPlaceholder(value)) continue;
            let entropy;
            if (rule.minEntropy !== void 0) {
              entropy = shannonEntropy(value);
              if (entropy < rule.minEntropy) continue;
            }
            if (rule.validate) {
              const validator = VALIDATORS[rule.validate];
              if (validator && validator(value) === "fail") {
                confidence = DOWNGRADE[confidence];
                reason = `${reason}. The built-in checksum did not match, so it may be mistyped or fake`;
              }
            }
            if (rule.generic && name && entropy !== void 0) {
              reason = `Random-looking value (${entropy.toFixed(1)} bits/char) assigned to "${name}"`;
              if (entropy >= 4.3 && value.length >= 24 && confidence === "medium") confidence = "high";
            }
          }
          if (CONFIDENCE_RANK[confidence] < minRank) continue;
          candidates.push({
            module: "secrets",
            ruleId: rule.id,
            label: rule.label,
            category: rule.category,
            start,
            end,
            confidence,
            preview: maskValue(value, rule.id),
            reason,
            placeholder: rule.placeholder,
            specificity: rule.generic ? rule.nameGroup !== void 0 ? 2 : 1 : 0
          });
        }
      }
      return resolveOverlaps(candidates, (c) => c.specificity).map(({ specificity: _s, ...f }) => f);
    }
    return { id: "secrets", version: RULESET_VERSION, ruleCount: rules.length, scan };
  }
  var secretsModule = createSecretsModule();

  // src/ruleset.ts
  var RULESET = { version: secretsModule.version, ruleCount: secretsModule.ruleCount };

  // src/popup/popup.ts
  var $ = (id) => document.getElementById(id);
  function button(label, primary, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (primary) b.className = "primary";
    b.addEventListener("click", onClick);
    return b;
  }
  async function render() {
    const settings = await loadSettings();
    $("rules").textContent = `${RULESET.ruleCount} detection rules · v${chrome.runtime.getManifest().version}`;
    $("enabled").checked = settings.enabled;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url ?? "";
    const actions = $("siteActions");
    actions.replaceChildren();
    $("error").textContent = "";
    const status = $("status");
    let host = "";
    try {
      const u = new URL(url);
      if (u.protocol === "https:" || u.protocol === "http:") host = u.hostname;
    } catch {
    }
    $("host").textContent = host;
    if (!host) {
      status.className = "status";
      $("statusText").textContent = "Not a web page";
      return;
    }
    const site = siteForUrl(settings.sites, url);
    const on = settings.enabled && !!site?.enabled;
    status.className = on ? "status on" : "status";
    $("statusText").textContent = !settings.enabled ? "SecretSentry is off" : on ? `Protecting ${displayName(site.pattern)}` : "Not active on this site";
    if (!settings.enabled) return;
    const reload = () => tab?.id !== void 0 && chrome.tabs.reload(tab.id);
    if (site) {
      actions.append(
        site.enabled ? button("Turn off for this site", false, async () => {
          await setSiteEnabled(site.pattern, false);
          await render();
        }) : button("Turn on for this site", true, async () => {
          await setSiteEnabled(site.pattern, true);
          await render();
          actions.append(button("Reload page to apply", false, reload));
        })
      );
    } else if (normalizeSitePattern(url)) {
      actions.append(
        button(`Add ${host}`, true, async () => {
          const r = await addSite(`${new URL(url).protocol}//${host}`);
          if (!r.ok) {
            $("error").textContent = r.error;
            return;
          }
          await render();
          actions.append(button("Reload page to apply", false, reload));
        })
      );
    }
  }
  $("enabled").addEventListener("change", async (e) => {
    await setEnabled(e.target.checked);
    await render();
  });
  $("manage").addEventListener("click", () => chrome.runtime.openOptionsPage());
  void render();
})();
