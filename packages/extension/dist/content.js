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
  function isProtected(sites, url) {
    return sites.some((s) => s.enabled && patternMatchesUrl(s.pattern, url));
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

  // ../core/src/types.ts
  var CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

  // ../core/src/engine.ts
  function resolveOverlaps(findings, rank = () => 0) {
    const ordered = [...findings].sort(
      (a, b) => rank(a) - rank(b) || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || b.end - b.start - (a.end - a.start) || a.start - b.start
    );
    const kept = [];
    for (const f of ordered) {
      if (!kept.some((k) => f.start < k.end && f.end > k.start)) kept.push(f);
    }
    return kept.sort((a, b) => a.start - b.start);
  }
  function createEngine({ modules, maxInputLength = 2e5 }) {
    return {
      scan(text, options) {
        const t0 = performance.now();
        const truncated = text.length > maxInputLength;
        const input = truncated ? text.slice(0, maxInputLength) : text;
        const all = modules.flatMap((m) => m.scan(input, options));
        return {
          findings: resolveOverlaps(all),
          truncated,
          durationMs: performance.now() - t0,
          modules: modules.map((m) => ({ id: m.id, version: m.version, ruleCount: m.ruleCount }))
        };
      }
    };
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
      "pattern": "(-----BEGIN[ A-Z0-9]{0,40}PRIVATE KEY(?: BLOCK)?-----(?:[\\s\\S]{0,12000}?-----END[ A-Z0-9]{0,40}PRIVATE KEY(?: BLOCK)?-----)?)",
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

  // ../core/src/modules/secrets/redact.ts
  function redact(text, findings, mode = "placeholder") {
    const ordered = [...findings].sort((a, b) => a.start - b.start);
    const counters = /* @__PURE__ */ new Map();
    const labelByValue = /* @__PURE__ */ new Map();
    const replacementFor = /* @__PURE__ */ new Map();
    for (const f of ordered) {
      const value = text.slice(f.start, f.end);
      let replacement;
      if (mode === "remove") replacement = "";
      else if (mode === "mask") replacement = f.preview;
      else {
        const key = `${f.placeholder}\0${value}`;
        replacement = labelByValue.get(key) ?? "";
        if (!replacement) {
          const n = (counters.get(f.placeholder) ?? 0) + 1;
          counters.set(f.placeholder, n);
          replacement = `[${f.placeholder}_${n}]`;
          labelByValue.set(key, replacement);
        }
      }
      replacementFor.set(f, replacement);
    }
    let out = "";
    let cursor = 0;
    for (const f of ordered) {
      if (f.start < cursor) continue;
      out += text.slice(cursor, f.start) + replacementFor.get(f);
      cursor = f.end;
    }
    out += text.slice(cursor);
    return {
      text: out,
      replacements: findings.map((f) => ({ ruleId: f.ruleId, replacement: replacementFor.get(f) ?? "" }))
    };
  }

  // src/content/decide.ts
  var CHUNK = 2e5;
  var OVERLAP = 16e3;
  var engine = createEngine({ modules: [secretsModule], maxInputLength: CHUNK });
  function findSecrets(text) {
    if (!text || text.length < 8) return [];
    if (text.length <= CHUNK) return engine.scan(text, { minConfidence: "medium" }).findings;
    const all = [];
    for (let offset = 0; offset < text.length; offset += CHUNK - OVERLAP) {
      const part = engine.scan(text.slice(offset, offset + CHUNK), { minConfidence: "medium" }).findings;
      for (const f of part) all.push({ ...f, start: f.start + offset, end: f.end + offset });
      if (offset + CHUNK >= text.length) break;
    }
    return resolveOverlaps(all);
  }
  function applyChoice(text, findings, choice) {
    switch (choice) {
      case "allow":
        return text;
      case "placeholder":
        return redact(text, findings, "placeholder").text;
      case "remove":
        return redact(text, findings, "remove").text;
      case "cancel":
        return null;
    }
  }

  // src/content/composer.ts
  var TEXT_INPUT_TYPES = /* @__PURE__ */ new Set(["text", "search", ""]);
  function findComposer(target) {
    if (!(target instanceof Element)) return null;
    if (target instanceof HTMLTextAreaElement) return { kind: "field", el: target };
    if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)) return { kind: "field", el: target };
    let root = null;
    for (let el2 = target; el2; el2 = el2.parentElement) {
      if (el2.isContentEditable) root = el2;
      else if (root) break;
    }
    return root ? { kind: "editable", el: root } : null;
  }
  function getText(c) {
    return c.kind === "field" ? c.el.value : c.el.innerText;
  }
  function setFieldValue(el2, value) {
    const proto = el2 instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el2, value);
    else el2.value = value;
    el2.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function insertAtCaret(c, text) {
    if (document.execCommand("insertText", false, text)) return;
    if (c.kind === "field") {
      const el2 = c.el;
      const start = el2.selectionStart ?? el2.value.length;
      const end = el2.selectionEnd ?? el2.value.length;
      setFieldValue(el2, el2.value.slice(0, start) + text + el2.value.slice(end));
      el2.setSelectionRange(start + text.length, start + text.length);
    } else {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      c.el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }
  function replaceAll(c, text) {
    c.el.focus();
    if (c.kind === "field") {
      c.el.select();
      if (!document.execCommand("insertText", false, text)) setFieldValue(c.el, text);
      return;
    }
    const sel = window.getSelection();
    if (sel) {
      const r = document.createRange();
      r.selectNodeContents(c.el);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    document.execCommand("insertText", false, text);
  }
  var SEND_BUTTON_SELECTOR = [
    'button[type="submit"]',
    'button[aria-label*="send" i]',
    'button[data-testid*="send" i]',
    'button[aria-label*="submit" i]',
    '[role="button"][aria-label*="send" i]'
  ].join(",");
  function isSendButton(el2) {
    return !!el2 && el2.matches(SEND_BUTTON_SELECTOR);
  }
  var COMPOSER_SELECTOR = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
  function findComposerNear(btn) {
    const form = btn.closest("form");
    const inForm = form?.querySelector(COMPOSER_SELECTOR);
    if (inForm) return findComposer(inForm);
    for (let el2 = btn.parentElement, depth = 0; el2 && depth < 6; el2 = el2.parentElement, depth++) {
      const found = el2.querySelector(COMPOSER_SELECTOR);
      if (found) return findComposer(found);
    }
    return null;
  }
  function findSendButton(c) {
    const form = c.el.closest("form");
    const inForm = form?.querySelector(SEND_BUTTON_SELECTOR);
    if (inForm) return inForm;
    for (let el2 = c.el.parentElement, depth = 0; el2 && depth < 6; el2 = el2.parentElement, depth++) {
      const btn = el2.querySelector(SEND_BUTTON_SELECTOR);
      if (btn) return btn;
    }
    return null;
  }

  // src/content/placement.ts
  var GAP = 10;
  var EDGE = 12;
  var MIN_HEIGHT = 120;
  function computePlacement(anchor, viewW, viewH, boxH, boxW = 420) {
    const width = Math.min(boxW, viewW - EDGE * 2);
    const left = Math.max(EDGE, Math.min(anchor.right - width, viewW - width - EDGE));
    const below = anchor.bottom + GAP;
    const spaceBelow = viewH - EDGE - below;
    const spaceAbove = anchor.top - GAP - EDGE;
    if (boxH <= spaceBelow) return { left, width, top: below, maxHeight: spaceBelow };
    if (boxH <= spaceAbove) return { left, width, top: anchor.top - GAP - boxH, maxHeight: spaceAbove };
    if (spaceBelow >= spaceAbove) return { left, width, top: below, maxHeight: Math.max(spaceBelow, MIN_HEIGHT) };
    const maxHeight = Math.max(spaceAbove, MIN_HEIGHT);
    return { left, width, top: Math.max(EDGE, anchor.top - GAP - Math.min(boxH, maxHeight)), maxHeight };
  }
  function visualBounds(el2) {
    const own = el2.getBoundingClientRect();
    const form = el2.closest("form");
    if (form) {
      const f = form.getBoundingClientRect();
      if (f.height > 0 && f.height < window.innerHeight * 0.6) {
        return { top: Math.min(own.top, f.top), bottom: Math.max(own.bottom, f.bottom), left: Math.min(own.left, f.left), right: Math.max(own.right, f.right) };
      }
    }
    return own;
  }

  // src/content/dialog.ts
  var ownHosts = /* @__PURE__ */ new WeakSet();
  var ALLOW_DELAY_MS = 500;
  var HOST_STYLE = [
    "all: initial !important",
    "display: block !important",
    "position: fixed !important",
    "inset: 0 !important",
    "width: 100vw !important",
    "height: 100vh !important",
    "margin: 0 !important",
    "padding: 0 !important",
    "border: 0 !important",
    "background: transparent !important",
    "overflow: visible !important",
    "pointer-events: none !important",
    "opacity: 1 !important",
    "visibility: visible !important",
    "transform: none !important",
    "filter: none !important",
    "clip-path: none !important",
    "z-index: 2147483647 !important"
  ].join("; ");
  function mountHost(tag) {
    const host = document.createElement(tag);
    ownHosts.add(host);
    host.setAttribute("popover", "manual");
    host.style.cssText = HOST_STYLE;
    (document.body ?? document.documentElement).append(host);
    try {
      host.showPopover();
    } catch {
    }
    return host;
  }
  var CSS = `
:host { all: initial; }
.box { position: fixed; z-index: 2147483647; pointer-events: auto; box-sizing: border-box; overflow-y: auto; width: min(420px, calc(100vw - 24px));
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #17202c; background: #fff;
  border: 1px solid #e3b25e; border-radius: 12px; box-shadow: 0 12px 32px rgba(15, 23, 42, .22); padding: 14px; }
.head { display: flex; gap: 10px; align-items: flex-start; }
.icon { flex: none; width: 28px; height: 28px; border-radius: 8px; background: #fdf1dc; color: #9a5300;
  display: grid; place-items: center; font-weight: 700; }
h2 { margin: 0; font-size: 15px; font-weight: 650; }
.sub { margin: 2px 0 0; font-size: 12.5px; color: #5b6676; }
ul { list-style: none; margin: 10px 0; padding: 0; display: grid; gap: 6px; max-height: 180px; overflow: auto; }
li { border: 1px solid #e4e8ee; border-radius: 8px; padding: 7px 9px; display: grid; gap: 1px; }
.label { font-weight: 600; font-size: 13.5px; display: flex; justify-content: space-between; gap: 8px; }
.conf { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #9a5300; }
code { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #5b6676; overflow-wrap: anywhere; }
.why { font-size: 12px; color: #5b6676; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: 600 13px system-ui, -apple-system, "Segoe UI", sans-serif; border-radius: 8px; padding: 8px 12px; cursor: pointer;
  border: 1px solid #cfd6df; background: #fff; color: #17202c; }
button.primary { background: #1f4fbf; border-color: #1f4fbf; color: #fff; }
button.danger { margin-left: auto; background: transparent; border-color: transparent; color: #8a1c1c; text-decoration: underline; }
button:focus-visible { outline: 2px solid #1f4fbf; outline-offset: 2px; }
.brand { margin-top: 8px; font-size: 11px; color: #8a94a3; }
.head { padding-right: 28px; }
button.close { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: #5b6676; font: 400 20px/1 system-ui, sans-serif; display: grid; place-items: center; }
button.close:hover { background: rgba(127, 127, 127, .15); }
@media (prefers-color-scheme: dark) {
  .box { background: #161b22; color: #e6eaf0; border-color: #6b4a1c; }
  .icon { background: #2a1f10; color: #f3a63b; }
  .sub, code, .why { color: #9aa5b5; }
  li { border-color: #2a3240; }
  .conf { color: #f3a63b; }
  button { background: #1c222c; color: #e6eaf0; border-color: #2f3846; }
  button.primary { background: #7da3ff; border-color: #7da3ff; color: #0d1016; }
  button.danger { background: transparent; border-color: transparent; color: #ff9b9b; }
  button.close { background: transparent; color: #9aa5b5; }
}
@media (prefers-reduced-motion: no-preference) { .box { animation: in .14s ease-out; } }
@keyframes in { from { opacity: 0; transform: translateY(6px); } }
`;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== void 0) e.textContent = text;
    return e;
  }
  function renderList(list, findings) {
    list.replaceChildren(
      ...findings.slice(0, 20).map((f) => {
        const li = el("li");
        const label = el("div", "label");
        label.append(el("span", void 0, f.label), el("span", "conf", f.confidence));
        li.append(label, el("code", void 0, f.preview), el("span", "why", f.reason));
        return li;
      })
    );
  }
  function titleFor(findings) {
    return findings.length === 1 ? `This looks like a ${findings[0].label}` : `${findings.length} possible secrets found`;
  }
  function placeNear(box, anchor, fallbackHeight) {
    box.style.maxHeight = "none";
    const natural = box.scrollHeight || fallbackHeight;
    const p = computePlacement(visualBounds(anchor), window.innerWidth, window.innerHeight, natural);
    box.style.left = `${p.left}px`;
    box.style.top = `${p.top}px`;
    box.style.maxHeight = `${p.maxHeight}px`;
  }
  var open = null;
  function isDialogOpen() {
    return open !== null;
  }
  function showDialog(mode, findings, anchor, rescan) {
    if (open) return Promise.resolve("cancel");
    open = new Promise((resolve) => {
      const host = document.createElement("secretsentry-warning");
      const root = host.attachShadow({ mode: "closed" });
      const shownAt = performance.now();
      let visible = false;
      const style = el("style");
      style.textContent = CSS;
      const box = el("div", "box");
      box.setAttribute("role", "alertdialog");
      box.setAttribute("aria-modal", "true");
      const n = findings.length;
      const head = el("div", "head");
      const text = el("div");
      const h2 = el("h2", void 0, titleFor(findings));
      h2.id = "t";
      box.setAttribute("aria-labelledby", "t");
      text.append(h2, el("p", "sub", mode === "paste" ? "Checked on this device before pasting. Nothing was saved or sent." : "Checked on this device before sending. Nothing was saved or sent."));
      head.append(el("div", "icon", "!"), text);
      const list = el("ul");
      renderList(list, findings);
      const actions = el("div", "actions");
      const verb = mode === "paste" ? "Paste" : "Send";
      const btnReplace = el("button", "primary", "Replace with placeholders");
      const btnRemove = el("button", void 0, n === 1 ? "Remove it" : "Remove them");
      const btnAllow = el("button", "danger", `${verb} anyway`);
      const btnCancel = el("button", void 0, "Cancel");
      const btnClose = el("button", "close", "×");
      btnClose.setAttribute("aria-label", "Close");
      btnClose.title = "Close (nothing is sent)";
      for (const b of [btnReplace, btnRemove, btnCancel, btnAllow, btnClose]) b.type = "button";
      actions.append(btnReplace, btnRemove, btnCancel, btnAllow);
      box.append(btnClose, head, list, actions, el("div", "brand", "SecretSentry"));
      let done = false;
      const finish = (choice) => {
        if (done) return;
        done = true;
        observer.disconnect();
        attrObserver.disconnect();
        visibility?.disconnect();
        window.removeEventListener("resize", place, true);
        window.removeEventListener("scroll", place, true);
        window.removeEventListener("input", onEdit, true);
        clearTimeout(editTimer);
        host.remove();
        open = null;
        resolve(choice);
      };
      const on = (b, choice) => b.addEventListener("click", (e) => {
        if (!e.isTrusted) return;
        if (choice === "allow" && (performance.now() - shownAt < ALLOW_DELAY_MS || !visible)) return;
        finish(choice);
      });
      on(btnReplace, "placeholder");
      on(btnRemove, "remove");
      on(btnAllow, "allow");
      on(btnCancel, "cancel");
      on(btnClose, "cancel");
      box.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (!e.isTrusted) return;
        if (e.key === "Escape") {
          e.preventDefault();
          finish("cancel");
        }
        if (e.key === "Tab") {
          const order = [btnReplace, btnRemove, btnCancel, btnAllow, btnClose];
          const i = order.indexOf(root.activeElement);
          e.preventDefault();
          order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length].focus();
        }
      });
      function place() {
        placeNear(box, anchor, 260);
      }
      let editTimer = 0;
      function onEdit(e) {
        if (!rescan || !e.composedPath().includes(anchor)) return;
        clearTimeout(editTimer);
        editTimer = window.setTimeout(() => {
          let fresh;
          try {
            fresh = rescan();
          } catch {
            return;
          }
          if (!fresh.length) return finish("cancel");
          h2.textContent = titleFor(fresh);
          btnRemove.textContent = fresh.length === 1 ? "Remove it" : "Remove them";
          renderList(list, fresh);
          place();
        }, 150);
      }
      window.addEventListener("input", onEdit, true);
      const observer = new MutationObserver(() => {
        if (!host.isConnected) finish("cancel");
      });
      const attrObserver = new MutationObserver(() => finish("cancel"));
      root.append(style, box);
      ownHosts.add(host);
      host.setAttribute("popover", "manual");
      host.style.cssText = HOST_STYLE;
      (document.body ?? document.documentElement).append(host);
      try {
        host.showPopover();
      } catch {
      }
      observer.observe(document.documentElement, { childList: true, subtree: true });
      attrObserver.observe(host, { attributes: true });
      host.addEventListener("toggle", () => {
        if (!host.matches(":popover-open")) finish("cancel");
      });
      let visibility;
      try {
        visibility = new IntersectionObserver(
          (entries) => {
            const last = entries[entries.length - 1];
            visible = last.isVisible ?? last.isIntersecting;
          },
          { trackVisibility: true, delay: 100 }
        );
        visibility.observe(box);
      } catch {
        visible = true;
      }
      place();
      window.addEventListener("resize", place, true);
      window.addEventListener("scroll", place, true);
      btnReplace.focus();
    });
    return open;
  }
  var notice = null;
  function currentNotice() {
    return notice;
  }
  function showNotice(findings, anchor, onAction) {
    notice?.close();
    const host = mountHost("secretsentry-notice");
    const root = host.attachShadow({ mode: false ? "open" : "closed" });
    const style = el("style");
    style.textContent = CSS + `
    .box { padding: 12px; }
    .sub { margin-top: 2px; }
    ul { margin: 8px 0; max-height: 120px; }
    .why { display: none; }
    .actions { align-items: center; }`;
    const box = el("div", "box");
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    const head = el("div", "head");
    const text = el("div");
    const h2 = el("h2");
    text.append(h2, el("p", "sub", "You can keep editing. SecretSentry will ask again before anything is sent."));
    head.append(el("div", "icon", "!"), text);
    const list = el("ul");
    const actions = el("div", "actions");
    const btnReplace = el("button", "primary", "Replace with placeholders");
    const btnRemove = el("button");
    const btnDismiss = el("button", "close", "×");
    btnDismiss.setAttribute("aria-label", "Dismiss");
    btnDismiss.title = "Dismiss. You'll still be asked before sending.";
    for (const b of [btnReplace, btnRemove, btnDismiss]) {
      b.type = "button";
      b.addEventListener("mousedown", (e) => e.preventDefault());
    }
    actions.append(btnReplace, btnRemove);
    box.append(btnDismiss, head, list, actions);
    root.append(style, box);
    const render = (f) => {
      h2.textContent = titleFor(f);
      btnRemove.textContent = f.length === 1 ? "Remove it" : "Remove them";
      renderList(list, f);
      placeNear(box, anchor, 160);
    };
    const place = () => placeNear(box, anchor, 160);
    let closed = false;
    const self = {
      anchor,
      update: (f) => f.length ? render(f) : self.close(),
      close: () => {
        if (closed) return;
        closed = true;
        attrObserver.disconnect();
        window.removeEventListener("resize", place, true);
        window.removeEventListener("scroll", place, true);
        host.remove();
        if (notice === self) notice = null;
      }
    };
    const on = (b, a) => b.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      self.close();
      onAction(a);
    });
    on(btnReplace, "placeholder");
    on(btnRemove, "remove");
    on(btnDismiss, "dismiss");
    const attrObserver = new MutationObserver(() => self.close());
    attrObserver.observe(host, { attributes: true });
    window.addEventListener("resize", place, true);
    window.addEventListener("scroll", place, true);
    render(findings);
    notice = self;
    return self;
  }
  function showToast(message, anchor) {
    const host = mountHost("secretsentry-toast");
    const root = host.attachShadow({ mode: "closed" });
    const style = el("style");
    style.textContent = `:host{all:initial}.t{position:fixed;z-index:2147483647;font:13px system-ui,-apple-system,"Segoe UI",sans-serif;
    background:#17202c;color:#fff;padding:8px 12px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.25)}`;
    const t = el("div", "t", message);
    t.setAttribute("role", "status");
    root.append(style, t);
    const r = anchor.getBoundingClientRect();
    t.style.left = `${Math.max(12, r.left)}px`;
    t.style.top = `${Math.max(12, r.top - 44)}px`;
    setTimeout(() => host.remove(), 4500);
  }

  // src/content/index.ts
  var settings = null;
  loadSettings().then((s) => settings = s, () => settings = null);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && STORAGE_KEY in changes) settings = sanitizeSettings(changes[STORAGE_KEY].newValue);
  });
  function isActive() {
    if (!settings) return true;
    return settings.enabled && isProtected(settings.sites, location.href);
  }
  var lastComposer = null;
  var bypass = null;
  function stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function targetOf(e) {
    return e.composedPath()[0] ?? e.target;
  }
  function isOurs(e) {
    return e.composedPath().some((n) => n instanceof Element && ownHosts.has(n));
  }
  function failClosed(e, anchor) {
    stop(e);
    if (anchor) showToast("SecretSentry couldn't check this, so it was held back. If this keeps happening, turn SecretSentry off for this site.", anchor);
  }
  function takeBypass(el2) {
    if (bypass && bypass.el === el2 && Date.now() < bypass.until) {
      bypass = null;
      return true;
    }
    return false;
  }
  function cleanComposer(composer, choice) {
    const current = getText(composer);
    const fresh = findSecrets(current);
    if (!fresh.length) return;
    const out = applyChoice(current, fresh, choice);
    if (out !== null) replaceAll(composer, out);
    requestAnimationFrame(() => {
      const left = findSecrets(getText(composer)).length;
      const n = fresh.length;
      showToast(
        left ? "SecretSentry couldn't edit this chat box. Please remove the secret yourself." : `${choice === "placeholder" ? "Replaced" : "Removed"} ${n} secret${n === 1 ? "" : "s"}. Review, then send.`,
        composer.el
      );
    });
  }
  function refreshNotice(composer) {
    if (isDialogOpen()) return;
    const findings = findSecrets(getText(composer));
    const existing = currentNotice();
    if (existing && existing.anchor === composer.el) return existing.update(findings);
    if (!findings.length) return;
    showNotice(findings, composer.el, (action) => {
      composer.el.focus();
      if (action !== "dismiss") cleanComposer(composer, action);
    });
  }
  function guardIncomingText(e, data) {
    if (!isActive() || !e.isTrusted || isOurs(e)) return;
    const composer = findComposer(targetOf(e));
    if (!composer) return;
    try {
      if (isDialogOpen()) return stop(e);
      const text = data?.getData("text/plain") ?? "";
      if (findSecrets(text).length) {
        setTimeout(() => refreshNotice(composer), 0);
        return;
      }
      const html = data?.getData("text/html") ?? "";
      if (html && findSecrets(html).length) {
        stop(e);
        if (text) insertAtCaret(composer, text);
        showToast("Pasted as plain text: the formatted version contained a hidden secret.", composer.el);
      }
    } catch {
      failClosed(e, composer.el);
    }
  }
  function onPaste(e) {
    guardIncomingText(e, e.clipboardData);
  }
  function onDrop(e) {
    guardIncomingText(e, e.dataTransfer);
  }
  var refreshTimer = 0;
  function onInput(e) {
    const n = currentNotice();
    if (!n || isOurs(e)) return;
    const composer = findComposer(targetOf(e));
    if (!composer || composer.el !== n.anchor) return;
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      try {
        refreshNotice(composer);
      } catch {
        n.close();
      }
    }, 150);
  }
  function checkBeforeSend(composer, resend) {
    if (takeBypass(composer.el)) return false;
    const findings = findSecrets(getText(composer));
    if (!findings.length) return false;
    currentNotice()?.close();
    void showDialog("send", findings, composer.el, () => findSecrets(getText(composer))).then((choice) => {
      if (choice === "cancel") return composer.el.focus();
      if (choice === "allow") {
        bypass = { el: composer.el, until: Date.now() + 1500 };
        composer.el.focus();
        resend();
        return;
      }
      cleanComposer(composer, choice);
    });
    return true;
  }
  function onKeyDown(e) {
    if (!isActive() || isOurs(e) || e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const composer = findComposer(targetOf(e));
    if (!composer) return;
    lastComposer = composer;
    try {
      if (isDialogOpen()) return stop(e);
      if (!e.isTrusted && takeBypass(composer.el)) return;
      const init = {
        key: e.key,
        code: e.code,
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
        composed: true,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey
      };
      const resend = () => {
        const btn = findSendButton(composer);
        if (btn) btn.click();
        else composer.el.dispatchEvent(new KeyboardEvent("keydown", init));
      };
      if (checkBeforeSend(composer, resend)) stop(e);
    } catch {
      failClosed(e, composer.el);
    }
  }
  function onClick(e) {
    if (!isActive() || isOurs(e)) return;
    const t = targetOf(e);
    const btn = t instanceof Element ? t.closest("button, [role='button']") : null;
    if (!isSendButton(btn)) return;
    try {
      if (isDialogOpen()) return stop(e);
      const near = findComposerNear(btn);
      const composer = near ?? (lastComposer?.el.isConnected ? lastComposer : null);
      if (!composer) return;
      if (checkBeforeSend(composer, () => btn.click())) stop(e);
    } catch {
      failClosed(e, btn);
    }
  }
  function onFocusIn(e) {
    if (!isActive() || isOurs(e)) return;
    const c = findComposer(targetOf(e));
    if (c) lastComposer = c;
  }
  window.addEventListener("paste", onPaste, true);
  window.addEventListener("drop", onDrop, true);
  window.addEventListener("input", onInput, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("focusin", onFocusIn, true);
})();
