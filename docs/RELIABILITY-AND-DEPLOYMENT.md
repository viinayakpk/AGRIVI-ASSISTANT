# Reliability, Value & Deployment

**How the Companion Agent runs on any machine, survives provider failure, and grounds in real data — with the fewest possible secrets.**

> **Note:** `gateway/` and `docker-compose.yml` were removed from the final submission — the brief asks for one HTML file that opens and works immediately, and shipping a second, server-based way to run the app was creating exactly the "which one do I open" confusion that's a bad look in a walkthrough interview. This document is kept as the design record for that work (the resilience patterns below were real and tested, not hand-waved); `dist/agrivi-companion.html` is the only thing that ships, and it already gets keyless weather and web search working browser-direct, no server required.

You asked three things: *where do I get the keys*, *what else can we add beyond weather*, and *how do we make it reliable and easy so it stands out*. This document answers all three; the code that implemented the server-side half was prototyped in `gateway/` before being cut for the reason above.

---

## 1. The headline: it needs almost no keys

The single most "stand-out" fact we can put in front of an interviewer:

> **The only secret in the entire system is one optional LLM key, and it never touches the browser.**

- **Weather needs no key at all.** [Open-Meteo is free, requires no API key, no sign-up, no credit card](https://open-meteo.com/en/docs) — up to 10,000 calls/day, and it returns exactly what a spray record needs: **wind speed, wind direction, temperature, humidity, precipitation**. I verified it live: `access-control-allow-origin: *` (callable straight from the browser) and it returned the real wind at Slavonija at 13:30 today. [Its data is CC-BY 4.0, commercial use allowed, and the whole server is open-source and self-hostable (AGPLv3)](https://github.com/open-meteo/open-meteo) — so an air-gapped farm could run its own copy.
- **The pesticide authority needs no key.** The [EU Pesticides Database](https://food.ec.europa.eu/plants/pesticides/eu-pesticides-database_en) is the official source of authorisation status and Maximum Residue Levels, with a machine-to-machine API — the authoritative backing for our compliance checks.
- **The LLM is the only paid key**, and with the gateway it lives in an env var on the server, never in the client.

### Where to get each key (only if you want the paid path)

| Capability | Key needed? | Where | Free tier |
|---|---|---|---|
| **Weather (wind/drift, soil, rain)** | ❌ **none** | [open-meteo.com](https://open-meteo.com/en/docs) | 10k calls/day, keyless |
| **LLM agents** | ✅ one | [openrouter.ai/keys](https://openrouter.ai/keys) (you have it) | pay-as-you-go |
| **EU pesticide authorisation / MRL** | ❌ none | [EU Pesticides DB](https://food.ec.europa.eu/plants/pesticides/eu-pesticides-database_en) | open |
| **Satellite NDVI (crop health)** | ✅ free account | [Copernicus Data Space](https://dataspace.copernicus.eu/analyse/apis/sentinel-hub) | free, incl. commercial |
| **Backup weather** (optional 2nd provider) | ✅ free tier | [OpenWeatherMap](https://openweathermap.org/api) / [WeatherAPI](https://www.weatherapi.com/) | ~1k/day free |

**You don't have to fetch any of these for me.** Weather works today with zero keys. Drop the OpenRouter key into `gateway/.env` and the agents light up. Everything else is optional depth you can add when you want it.

---

## 2. What else we can add — value-add data, ranked for *this* domain

Weather is the start, not the story. Here's what actually adds value to a farm work-order agent, ranked by impact-per-effort. Each is a new grounding source the Foresight agent (already built) can reason over.

### Tier 1 — do these; they make the record *authoritative*

**① Live weather at application (Open-Meteo) — building now.**
Wind speed is a *legally required field* for a spray record (drift onto neighbouring land). The agent auto-fills it from the field's coordinates at the application time, and Foresight raises a **drift WARN** when wind exceeds the label threshold. [Farms run spraying and harvest decisions off exactly this data](https://open-meteo.com/). No key. This is the single most convincing "it grounds in reality" moment.

**② EU Pesticides Database — the compliance backbone.**
Our mirror *mocks* product authorisation. The real thing is the [official EU database of authorisations and MRLs](https://food.ec.europa.eu/plants/pesticides/eu-pesticides-database_en). Wiring it means the agent can BLOCK a product whose authorisation was *withdrawn last month* even though the local list still shows it — a compliance catch no static snapshot can make. This turns our validation from "plausible demo" into "actually correct."

### Tier 2 — high value, needs a free account

**③ Satellite NDVI per field (Copernicus Sentinel-2).**
[Free, no-cost, commercial-OK; the Statistical API returns a field's NDVI without downloading imagery](https://dataspace.copernicus.eu/analyse/apis/sentinel-hub). This closes a reasoning loop: *"your NDVI on this block dropped 12% over two weeks — consistent with the fungal pressure you're spraying for. The intervention is justified."* The QA critic's rubric already asks whether the product target matches observed conditions; NDVI is how it finally *knows*.

**④ Soil moisture & rainfastness (Open-Meteo, same keyless call).**
Open-Meteo [exposes soil temperature and moisture at multiple depths](https://open-meteo.com/); combined with the rain forecast, Foresight can warn *"rain in 6 h; this product needs 2 h to become rainfast — you may need to re-apply."* Real money saved.

### Tier 3 — nice, opportunistic

**⑤ Commodity/input prices** → cost-at-application on the record (input-cost tracking).
**⑥ Regional pest/disease pressure models** → justifies or questions an intervention.

**The discipline (from the depth analysis):** every source is gated by *"does it change a decision?"* Weather changes whether the spray was compliant. NDVI changes whether it was justified. A source that only decorates the record is cut.

---

## 3. Reliability — the gateway that makes it stand out

Right now, calling OpenRouter/weather from the browser has two problems: the key is exposed, and one provider hiccup breaks the app. The fix is a **thin resilient gateway** — and it's where the "stand out" engineering lives.

### 3.1 The resilience patterns, and the order they must run in

The 2026 canon is settled — [retries with exponential backoff + jitter, circuit breakers, bulkheads, timeouts, hedged requests, and graceful degradation](https://apiscout.dev/blog/api-resilience-circuit-breakers-retries-bulkheads-2026). The subtlety most people get wrong is **ordering**, and we get it right:

```
request
  │
  ├─ 1. rate limit        (before retries — retries must not burn quota)
  ├─ 2. cache check       (a fresh weather reading is reused, not re-fetched)
  ├─ 3. circuit breaker   (if the provider is known-down, skip straight to fallback)
  │      └─ 4. retry(backoff+jitter)   (retries live INSIDE the breaker)
  │             └─ 5. timeout          (never wait forever)
  ├─ 6. fallback chain    (provider A → provider B → cached/stale → deterministic)
  └─ 7. idempotency       (the write path replays the same key — no duplicates)
```

[Retries inside circuit breakers; rate-limiting before retries; fallback to cached/approximate responses to keep UX alive during a partial outage](https://apiscout.dev/blog/api-resilience-circuit-breakers-retries-bulkheads-2026). This is exactly the layering our gateway implements.

### 3.2 Auto-failover — the thing you specifically asked for

*"When the API fails, it automatically switches."* Two independent failover chains:

- **LLM failover.** The agent asks for a *tier* ("router-class", "extractor-class"), not a hard model id. On a 5xx / timeout / rate-limit the gateway walks a **fallback chain of models** — e.g. `gemini-2.5-flash-lite → llama-3.1-8b → mistral-nemo` — and returns whichever answers. This is the same mechanism [LiteLLM and Portkey productised](https://docs.litellm.ai/docs/routing) ([Portkey open-sourced its gateway under Apache 2.0 in March 2026](https://www.pkgpulse.com/guides/portkey-vs-litellm-vs-openrouter-llm-gateway-2026)); we ship a focused version and can drop in LiteLLM/Portkey for scale.
- **Weather failover.** `Open-Meteo → (optional) OpenWeatherMap → last cached reading (stale-but-labelled) → "ask the worker"`. The record is *never* blocked by a weather outage; it degrades one rung and says so.

And it composes with what's already built: the **agent's own circuit breakers** (client-side, ASI08) and the gateway's **service-level breakers** are two layers of the same idea — the agent degrades a *capability*, the gateway degrades a *provider*.

### 3.3 Why not just use LiteLLM / Portkey?

We should say this out loud in the interview: for production, **use them** — [LiteLLM to self-host, Portkey for governance](https://www.developersdigest.tech/blog/llm-router-comparison-2026). We ship a purpose-built ~300-line gateway instead because (a) it has **zero npm dependencies** — the Docker image is tiny and `docker compose up` never hits an `npm install` failure, and (b) it's *explainable* — every resilience decision is visible in one readable file, which is worth more in a walkthrough than a black-box dependency. The architecture is written so LiteLLM slots in behind the same `/api/llm` endpoint the day scale demands it.

---

## 4. Deployment — `docker compose up`, and the honest alternatives

### 4.1 The layered answer (this is the stand-out framing)

There isn't *one* way to run it — there are three, and offering all three is the point:

| Path | Command | What runs | Keys | For |
|---|---|---|---|---|
| **Zero-install** | *open `agrivi-companion-v2.html`* | frontend only; deterministic + Nano + client-side key | none | "works immediately", the brief's literal ask |
| **One command** | **`docker compose up`** | gateway (keys server-side, failover) + frontend + real weather | 0–1 | a reviewer running it on their machine |
| **Production** | compose + `--profile data` | + Postgres/pgvector for persistent memory, LiteLLM for scale | 1+ | the real deployment |

The static file *still works standalone* — we never break the brief's "open it and it works." Docker adds the production shape on top; it doesn't replace the simple path.

### 4.2 Is Docker the best way? The honest analysis

You asked directly. [Docker Compose is the right tool here — single-server orchestration with minimal overhead, the practical choice for a project this size](https://deploywise.dev/blog/docker-compose-vs-kubernetes); Kubernetes is for multi-node scale we don't have. The credible alternatives, and why Compose still wins for *this*:

- **Podman Compose** — [rootless, daemonless, drop-in `docker`→`podman`](https://www.datacamp.com/tutorial/podman-compose). **We support it for free**: the same `docker-compose.yml` runs under `podman compose up`. Better for security-conscious reviewers.
- **PM2 + nginx, no container** — [lighter, but needs Node + nginx installed on the host](https://deploywise.dev/blog/docker-compose-vs-kubernetes). Loses the "works on any machine identically" guarantee. We keep it as a documented fallback.
- **Single Node binary** — the gateway *also serves the static file*, so `node gateway/server.js` runs the whole thing with just Node installed, no Docker at all. This is our "I don't have Docker" escape hatch.

Our build choices, straight from 2026 best practice:
- **`node:22-alpine`, multi-stage, zero npm deps** — [prefer Alpine/distroless, keep dev tooling out of the production image](https://spacelift.io/blog/docker-alternatives). The image is a few MB.
- **Pinned versions, never `:latest`** — [a versioned tag makes rollbacks reliable; `latest` doesn't tell you what's running](https://deploywise.dev/blog/docker-compose-vs-kubernetes).
- **Healthcheck + graceful shutdown** so Compose knows when it's actually ready.
- **`.env` for secrets, `.env.example` committed** — the only secret is the optional OpenRouter key.

### 4.3 A better idea than *just* Docker: MCP as the integration seam

The most forward-looking framing: expose weather, the EU pesticide DB, and the real AGRIVI write as **MCP servers** behind the gateway (per the [10,000+ server MCP ecosystem now under the Linux Foundation](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026)). Then the *same* agent runs against staging, prod, or a partner's data by swapping a server URL — and every MCP call is fenced by the gateway's policy + resilience layer, because [an MCP tool is untrusted input](https://medium.com/@MattLeads/6-critical-challenges-facing-the-mcp-in-2026-06258e914402). Docker Compose brings the MCP servers up alongside the gateway; that's the "better way" — not replacing Compose, but giving it a standardised, swappable tool surface to orchestrate.

---

## 5. What ships in this change

| Artifact | What it does |
|---|---|
| `gateway/server.js` | zero-dep resilient gateway: serves the app, proxies LLM + weather, with the §3.1 patterns |
| `Dockerfile` | multi-stage, `node:22-alpine`, pinned, healthcheck |
| `docker-compose.yml` | `docker compose up` → gateway on `:8080`; `--profile data` adds Postgres+pgvector |
| `.env.example` | the one optional secret (OpenRouter); weather needs none |
| frontend wiring | real Open-Meteo weather auto-fill + drift Foresight finding; gateway auto-detected, falls back to direct/offline |

---

## 6. The one-sentence pitch

> *Open the file and it works with no keys. Run `docker compose up` and it works with real weather, server-held secrets, and automatic failover across LLM and weather providers. The only secret in the system is one optional LLM key — and it never touches the browser.*

---

### Sources
Weather: [Open-Meteo docs](https://open-meteo.com/en/docs) · [Open-Meteo (keyless, CC-BY)](https://open-meteo.com/) · [Open-Meteo self-host](https://github.com/open-meteo/open-meteo)
Compliance/data: [EU Pesticides Database](https://food.ec.europa.eu/plants/pesticides/eu-pesticides-database_en) · [Copernicus Sentinel Hub](https://dataspace.copernicus.eu/analyse/apis/sentinel-hub) · [EOSDA agriculture API](https://eos.com/agriculture-api/)
Resilience: [circuit breakers/retries/bulkheads 2026](https://apiscout.dev/blog/api-resilience-circuit-breakers-retries-bulkheads-2026) · [resilient API clients](https://medium.com/@pearl.rathour33/resilience-mechanisms-in-api-clients-retry-logic-circuit-breakers-and-fallbacks-09d8f58569d2) · [API gateway resilience](https://zuplo.com/learning-center/api-gateway-resilience-fault-tolerance)
LLM gateways: [LiteLLM routing](https://docs.litellm.ai/docs/routing) · [gateway comparison 2026](https://www.developersdigest.tech/blog/llm-router-comparison-2026) · [Portkey open-source](https://www.pkgpulse.com/guides/portkey-vs-litellm-vs-openrouter-llm-gateway-2026)
Deployment: [Compose vs K8s 2026](https://deploywise.dev/blog/docker-compose-vs-kubernetes) · [Docker alternatives](https://spacelift.io/blog/docker-alternatives) · [Podman Compose](https://www.datacamp.com/tutorial/podman-compose) · [MCP ecosystem](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026)
