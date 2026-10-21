import type { StepDefinition } from "@/lib/content-blocks";

export default {
  blocks: [
    { type: "section", title: "Deployment Options" },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Where Voice AI Lives in Production",
      content:
        "A voice agent lives inside a server that stays connected to Twilio for the entire call. That's different from a typical web app: you can't use platforms that go to sleep between requests. You need a host that keeps the connection open, scales when more callers arrive, and recovers if something crashes mid-call.",
    },

    {
      type: "image",
      audience: "explorer",
      src: "/images/illustrations/technical-overview.svg",
      alt: "A technical overview diagram — the moving pieces that keep a voice agent running in production.",
      size: "md",
    },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Three Places a Voice Agent Can Live",
      content:
        "When teams pick a home for a voice agent, they usually pick one of three kinds of place:\n\n- **A managed platform** (like Railway or Render) -- easiest path; you hand over your code and the platform handles servers, TLS, and restarts for you.\n- **A container on any cloud** -- more flexible; you bundle the agent into a container and run it on AWS, Azure, or Google Cloud.\n- **A big cloud service directly** -- the most control, the most setup; teams usually only go here when they have a dedicated platform team.\n\nAll three keep the agent online around the clock. The difference is how much of the setup the team wants to own.",
    },

    {
      type: "concept-card",
      audience: "explorer",
      title: "Why a Workshop Environment Isn't Home",
      content:
        "Workshop environments like Codespaces are the pop-up shop of software -- great for a weekend, not meant to stay open 24/7. They pause when no one is using them, which is perfect for building and testing but wrong for a real phone number people call. For a real launch, an agent needs a permanent home: a server that stays awake around the clock, keeps a live connection open for every call, and picks itself back up if anything goes wrong. Teams call that \"hosting.\"",
    },

    {
      type: "callout",
      audience: "explorer",
      variant: "info",
      content:
        "A hosted agent can be wired up to a real phone number that anyone can call -- customers, coworkers, a demo audience. That's the difference between \"someone built something cool\" and \"call this number and try it yourself.\" Showcase comes next.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The agent has been running in a GitHub Codespace during development. For production, it needs a host that keeps a live connection open for each call and handles multiple calls at once.",
    },

    { type: "section", audience: "builder", title: "Key Requirements" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Wherever you deploy, the platform needs to support:",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "**Long-lived connections** -- The server keeps a live connection open for the entire call. Platforms that shut down between requests (like AWS Lambda or Vercel Functions) will not work.\n**Secure connections** -- Twilio requires HTTPS and WSS.\n**Secret storage** -- API keys and credentials need a safe home.\n**Access control** -- Block public call-creation routes and verify Twilio's signature before accepting a voice WebSocket.\n**Always-on server** -- The process must stay running continuously, not start fresh for each request.",
    },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "Deploy this long-running Node.js server to a host that keeps the process and WebSocket connection alive for each call. Deploying `server.js` unchanged as a short-lived serverless function will not keep a Conversation Relay call connected.",
    },

    { type: "page-break" },

    { type: "section", audience: "builder", title: "Prepare Your Builder Server" },

    {
      type: "callout",
      audience: "builder",
      variant: "warning",
      content:
        "**Secure the server before giving it a public address.** The Codespace's protected proxy blocks public `/call` requests and checks Twilio's signature on `/ws`, but a bare `server.js` deployment does not include that proxy. Remove or authenticate the `/call` route so visitors cannot spend your Twilio credit, and validate `X-Twilio-Signature` on WebSocket upgrades so strangers cannot spend your OpenAI credit. Apply equivalent controls before using any of the hosting options below.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Your finished agent is in `workshop/`, separate from the companion Next.js app at the repository root. Push `workshop/server.js`, `workshop/tool-handlers.js`, `workshop/package.json`, and `workshop/package-lock.json` to a GitHub fork or repository you control. For Railway and Render, set the service root directory to `workshop/` so their install and start commands run against the agent.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "The final `workshop/server.js` from the previous step already reads the host's `PORT` and calls `server.listen(PORT)`. If you are deploying an earlier version with `const PORT = 8080`, replace that existing declaration with the line below and keep its existing `server.listen(PORT)` call. Railway supplies `PORT`; Render uses `PORT` with a default of 10000. The fallback keeps local Codespaces testing on 8080:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "workshop/server.js",
      code: `const PORT = Number(process.env.PORT) || 8080;`,
    },

    { type: "section", audience: "builder", title: "Option 1: Railway" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Railway supports WebSockets, GitHub deployments, and HTTPS. Create a service from your GitHub fork or repository. In the service Settings, set **Root Directory** to `/workshop`, **Build Command** to `npm ci`, and **Start Command** to `npm start` (the production script in `workshop/package.json`). See [Railway's monorepo guide](https://docs.railway.com/deployments/monorepo) for the root-directory setting.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Add your credentials in the service's **Variables** tab. Under **Settings → Networking → Public Networking**, choose **Generate Domain**. Railway routes that HTTPS domain to your server's `PORT`; if the domain has a target-port setting, make sure it matches the port shown in the server log. Use the generated domain plus `/twiml` as the Twilio voice webhook URL, with method POST.",
    },

    { type: "page-break" },

    { type: "section", audience: "builder", title: "Option 2: Render" },

    {
      type: "prose",
      audience: "builder",
      content:
        'Render provides HTTPS, WebSocket support, and GitHub integration. Create a **Web Service** from your GitHub fork or repository, then set its **Root Directory** to `workshop`. Commands run relative to that directory. See [Render\'s monorepo guide](https://render.com/docs/monorepo-support) for this setting.',
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Set **Build Command** to `npm ci` and **Start Command** to `npm start`. Add credentials under **Environment** and choose a service plan that stays running during calls. Render supplies a public `https://<service>.onrender.com` domain and a `PORT` value (10000 by default). Once deployed, use that domain plus `/twiml` as the Twilio voice webhook URL, with method POST. The public URL uses HTTPS without `:8080`.",
    },

    { type: "section", audience: "builder", title: "Option 3: Docker on Any Cloud" },

    {
      type: "prose",
      audience: "builder",
      content:
        "For maximum flexibility, save this Dockerfile as `workshop/Dockerfile`. Build it from `workshop/` so the image contains the Builder agent instead of the companion app:",
    },

    {
      type: "code",
      audience: "builder",
      language: "dockerfile",
      file: "workshop/Dockerfile",
      code: `FROM node:20-slim

WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Non-root user for security
RUN addgroup --system appgroup && \\
    adduser --system --ingroup appgroup appuser
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s \\
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Keep your local credentials and installed dependencies out of the Docker image:",
    },

    {
      type: "code",
      audience: "builder",
      language: "text",
      file: "workshop/.dockerignore",
      code: `node_modules
.env
.env.*`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Add a health check endpoint so the platform knows the server is alive:",
    },

    {
      type: "code",
      audience: "builder",
      language: "javascript",
      file: "workshop/server.js",
      highlight: ["1-9"],
      code: `// Inside your http.createServer handler, add a health check.
// Place this route anywhere alongside /twiml; the platform's
// health checker pings it on a schedule to confirm the server is alive.
if (req.url === "/health" && req.method === "GET") {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    uptime: process.uptime(),
  }));
  return;
}`,
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "Build from `workshop/`, where Codespaces terminals already open. If you are in a local clone's repository root, run `cd workshop` once before these commands:",
    },

    {
      type: "terminal",
      audience: "builder",
      commands: `$ docker build -t voice-agent .
$ docker run -p 8080:8080 --env-file .env voice-agent`,
    },

    { type: "page-break" },

    { type: "section", audience: "builder", title: "Cloud-Specific Deployment" },

    {
      type: "prose",
      audience: "builder",
      content:
        "**AWS** -- Use ECS (Fargate) or EC2. Fargate scales automatically. Place an Application Load Balancer in front with WebSocket stickiness enabled.\n**Azure** -- Use Azure Container Apps or App Service. Both support WebSockets. Container Apps is simpler.\n**Google Cloud** -- Use Cloud Run or GKE. Cloud Run supports WebSockets but caps request timeout at 60 minutes -- set `--timeout` explicitly.",
    },

    { type: "section", audience: "builder", title: "Environment Variables" },

    {
      type: "prose",
      audience: "builder",
      content:
        "Set these values in your deployment platform's environment or secrets settings. Use real credentials and E.164 phone numbers; `HANDOFF_PHONE_NUMBER` must be a reachable destination to test a live transfer. The host supplies `PORT`, and the server defaults to 8080 locally:",
    },

    {
      type: "code",
      audience: "builder",
      language: "bash",
      file: ".env",
      code: `OPENAI_API_KEY=sk-...
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+15551234567
MY_PHONE_NUMBER=+15557654321
HANDOFF_PHONE_NUMBER=+15559876543`,
    },

    {
      type: "callout",
      audience: "builder",
      variant: "error",
      content:
        "Never commit `.env` to version control. Add it to `.gitignore` and set environment variables through the platform's dashboard or secrets manager.",
    },

    { type: "section", audience: "builder", title: "Update Twilio Webhook" },

    {
      type: "prose",
      audience: "builder",
      content:
        "After securing the public routes, update the Twilio phone number's voice webhook in the Twilio Console to `https://<your-public-domain>/twiml` with method POST. Use the domain Railway generated or Render assigned, rather than your Codespace URL. A call placed to that Twilio number will use the deployed `/twiml` and `/ws` endpoints.",
    },

    {
      type: "prose",
      audience: "builder",
      content:
        "You do **not** need to edit the WebSocket URL inside your server code. The `/twiml` handler builds it dynamically from `req.headers.host`, so once the Twilio webhook points at the production domain, the `wss://` URL in the generated TwiML updates itself -- no code change required.",
    },

    {
      type: "deep-dive",
      audience: "builder",
      title: "Scaling for concurrent calls",
      content:
        "Each active call maintains one WebSocket connection and one OpenAI stream. A single Node.js process can handle 50-100 concurrent calls depending on tool complexity and memory usage.\n\nFor higher concurrency, run multiple instances behind a load balancer. Since each call is independent (no shared state), you don't need sticky sessions -- each new call creates a fresh connection to whichever instance is available.\n\nMonitor memory carefully. Each call's conversation history grows over time. For long calls, implement history trimming to prevent memory pressure.",
    },
  ],
} satisfies StepDefinition;
