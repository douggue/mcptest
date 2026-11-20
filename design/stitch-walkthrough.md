# Makina Studio: Product Requirements Document (PRD) & Executive Screen Walkthrough

**Document Version:** 2.4 — Final Platform Architecture  
**Product:** Makina Studio (`makina.studio`)  
**Prepared For:** Engineering, Product Design & Go-To-Market Leadership  
**Core Thesis:** Algorithmic competitive intelligence, video telemetry, and high-velocity topic prediction engineered specifically for YouTube creators, studio networks, and production houses.

---

## 1. Executive Summary & Design System

Makina Studio delivers deep algorithmic reverse-engineering for YouTube channels. Unlike generic social media analytics tools that report vanity retrospective metrics, Makina acts as an algorithmic radar—tracking competitive constellation clusters, predicting breakout multipliers on small subscriber baselines, generating psychographic title/hook packages, and providing tactical AI assistance.

### Design Language & System Tokens
- **Theme Name:** Obsidian Radar (`{{DATA:DESIGN_SYSTEM:DESIGN_SYSTEM_1}}`)
- **Color Mode:** Ultra-Deep Obsidian Dark (`#0b0e16` base, `#11131b` surface, `#191b23` containers)
- **Primary Brand Accents:** Electric Cyan (`#00d2ff`), Algorithmic Amber (`#f59e0b`), Outlier Violet (`#8b5cf6`), and Signal Emerald (`#10b981`)
- **Typography:** Geist / Modern Monospace Telemetry font pairing with tabular numeric alignment
- **Chrome Architecture:** Unified Top Navigation Bar (Global search, Credits counter `100 credits +`, Notifications, Creator Profile) with contextual Left Navigation Drawer.

---

## 2. Interactive Screen Architecture & Walkthrough

Below is the complete walkthrough of the 7 production screens comprising the Makina Studio desktop suite.

```
                      ┌──────────────────────────────────────────┐
                      │          Makina Studio Platform          │
                      └────────────────────┬─────────────────────┘
                                           │
         ┌───────────────────┬─────────────┴─────────────┬────────────────────┐
         │                   │                           │                    │
┌────────▼────────┐ ┌────────▼────────┐         ┌────────▼────────┐  ┌────────▼────────┐
│ 1. Competitor   │ │ 2. Results &    │         │ 3. Topic        │  │ 4. Tactical AI  │
│    Radar Map    │ │    Topic Intel  │         │    Streams      │  │    Map Chat     │
│ [SCREEN_21]     │ │ [SCREEN_2]      │         │ [SCREEN_19]     │  │ [SCREEN_17]     │
└────────┬────────┘ └────────┬────────┘         └────────┬────────┘  └────────┬────────┘
         │                   │                           │                    │
         └───────────────────┼───────────────────────────┴────────────────────┘
                             │
         ┌───────────────────┴───────────────────────────┐
         │                                               │
┌────────▼────────┐                             ┌────────▼────────┐
│ 5. YT Telemetry │                             │ 6. Creator      │
│    Dashboard    │                             │    Toolkit      │
│ [SCREEN_11]     │                             │ [SCREEN_15]     │
└────────┬────────┘                             └────────┬────────┘
         │                                               │
         └───────────────────────┬───────────────────────┘
                                 │
                        ┌────────▼────────┐
                        │ 7. Plan &       │
                        │    Credits Hub  │
                        │ [SCREEN_13]     │
                        └─────────────────┘
```

---

### Screen 1: Competitor Radar & Intelligence Field
- **Asset Reference:** `{{DATA:SCREEN:SCREEN_21}}`
- **Route / Archetype:** `/map` — Tactical Network Constellation
- **Target Audience:** Channel strategists diagnosing competitor positioning and adjacent niches.

#### Functional Specifications:
1. **Interactive Orbital Constellation:**
   - Central origin node anchored to user channel (`@americainvents2`).
   - Radial tiers categorized into **Close Orbit**, **Mid Orbit**, and **Distant Orbit** based on audience overlap coefficients.
   - Vector connector lines dynamically weighted to indicate subscriber flow and viewer affinity.
2. **Cluster HUD & Mesh Controller:**
   - Real-time meshing telemetry counter (`Meshing States 2050 +4 more — 98% complete`).
   - Depth level stepping (`L1`, `L2`, `L3`) and zoom/re-center controls.
3. **Focused Competitor Intelligence Drawer:**
   - Pinpoint channel telemetry for selected nodes (e.g., *States 2050*, 94.7K subs, 84.2% audience overlap, 83× breakout velocity).
4. **"Breaking Out Right Now" Video Feed:**
   - Outlier coefficient badges highlighting disproportionate reach (e.g., Tito's Vodka `323,533×`, EU Climate Action `148,398×`, Javier Jarquin `81,452×`).
   - Granular multiplier filters: `All Outliers`, `100x+`, `50x+`, `Under 10K`.
5. **Radar Benchmarking Roster:**
   - Pinned watchlist showing tracked channels, subscriber counts, and relative orbital distance.

---

### Screen 2: Results & Algorithmic Viability Feed
- **Asset Reference:** `{{DATA:SCREEN:SCREEN_2}}`
- **Route / Archetype:** `/results` — Curated Topic Briefs & Packaging Studio
- **Target Audience:** Scriptwriters, creative directors, and thumbnail designers.

#### Functional Specifications:
1. **Curated Topic Dossiers:**
   - **Topic #4: Rock-melting drill to repower coal plants** (Viability `6/10`, Search `500–6K/mo`, Quaise Gyrotron mechanism).
   - **Topic #5: First fusion power plant built for Microsoft** (Viability `6/10`, Search `500–7K/mo`, Helion Energy).
   - **Topic #6: Arkansas Lithium Discovery: Smackover Brines** (Viability `8.5/10 High Breakout`, Search `15K–35K/mo`, USGS 2024 verified).
2. **High-CTR Title Variation Packages:**
   - Pre-computed, velocity-tested variants with Star, Hide, and 1-Click Clipboard Copy actions.
   - Example syntax: *"America Just Built a Drill That Melts Rock — It Could Replace Coal Plants Forever"*.
3. **Strategic Veins & Algorithmic Telemetry (Right Rail):**
   - **Small Channel Case Studies:** Empirical proof of channels breaking out with <500 subs (*British Empire* at 135×, *American Breakthroughs* at 50×).
   - **Live Vein Heatmap (Last 30–60 Days):** "Replace X forever" mechanisms, Humanoid robotics (99.8× spike), "Inside a giant factory" format.
   - **Infrastructure Fatigue Flag:** Automated warning regarding saturated topics (-0.1× to -0.2× retention drop on generic megaprojects).
4. **Viewer Psychology & Channel Title Identity Formula:**
   - Hardcoded prompt engineering formula: `"America Just [built/did X]: [hard number or claim] — [Rival] Should Worry / CHINA SHOCKED"`.
5. **Ground Truth Fact-Check Ledger:**
   - Verified scientific and industrial citations backing every topic claim.

---

### Screen 3: Topic Streams & Algorithmic Clusters
- **Asset Reference:** `{{DATA:SCREEN:SCREEN_19}}`
- **Route / Archetype:** `/topics` — Macro Trend Detection & Niche Mining
- **Target Audience:** Content researchers planning 30-day editorial roadmaps.

#### Functional Specifications:
1. **Cluster KPI Header:**
   - High-Velocity Active Topics (14 topics, +4 new).
   - Audience Cross-Resonance (84.2% optimal fit).
   - Average Outlier Factor (42.6× surge).
   - Topic Saturation Risk Meter (Low, 38% free whitespace).
2. **Active Algorithmic Stream Directory:**
   - Filterable stream directory across *Advanced Megaprojects*, *AI Hardware Breakthroughs*, *Hypersonic Drones*, and *Humanoid Factory Robotics*.
   - Outlier peak metrics (e.g., `78× PEAK`, `+142% 30d`) and competitor presence tags.
3. **Cluster Telemetry Matrix & Teleprompter Workspace:**
   - CTR benchmark (14.8%), Audience retention (71.2%), Algorithm affinity score (98/100).
   - Instant 1-click **Auto-Draft Script** and **Export Brief** actions.
   - Pre-tested Opening Script Hook with pacing parameters (165 words/min, visual cut cadence every 2.4s).
4. **Breakout Outliers Driving the Cluster:**
   - Direct video references fueling momentum (e.g., *States 2050* $120B Tunnel at 148,398× outlier, *MegaBuilds* Texas Reactor at 69,006× outlier).

---

### Screen 4: Tactical AI Chat & Map Intel
- **Asset Reference:** `{{DATA:SCREEN:SCREEN_17}}`
- **Route / Archetype:** `/map-chat` — Vector-Grounded Conversational Copilot
- **Target Audience:** Solo creators and producers needing real-time strategic diagnosis.

#### Functional Specifications:
1. **Grounding & Mesh Synchronization:**
   - AI agent synchronized directly with 72 competitor graph nodes and active telemetry.
2. **Tactical Conversational Thread:**
   - Competitive comparison queries (e.g., analyzing why `@States2050` is capturing the 25–34 demographic).
   - Tactical Diagnostics Cards: Cut frequency comparison (3.2s vs channel 6.8s), thumbnail contrast ratios (4.8:1 dual-focal ISO), and hook stickiness (+24.1%).
3. **Interactive Target Orbit Radar HUD:**
   - Live orbital sub-map focusing on competitor clusters with affinity scores.
4. **Strategy Scratchpad:**
   - Persistent idea backlog allowing creators to save actionable hooks and export directly into production script outlines.

---

### Screen 5: YT Dashboard & Channel Telemetry
- **Asset Reference:** `{{DATA:SCREEN:SCREEN_11}}`
- **Route / Archetype:** `/yt-dashboard` — Velocity & Cohort Performance Hub
- **Target Audience:** Channel managers evaluating growth against algorithmic baselines.

#### Functional Specifications:
1. **High-Level 28-Day Telemetry Matrix:**
   - Total View Volume (1.48M views, +24.8% growth).
   - Rolling Daily Average (52.8K views/day, +8.4K pace).
   - Spike Peak Day Analysis (184.2K views on Nov 12, fission reactor drop).
   - Breakout Outlier Multiplier (14.2× surge, Top 1% in niche).
2. **View Velocity & Algorithmic Distribution Trajectory:**
   - Dual-series trajectory chart tracking channel curve against competitor medians (*States 2050*, *The Tesla Space*).
   - Video upload drop markers identifying immediate velocity catalysts.
3. **Realtime 48-Hour Hourly Velocity Histogram:**
   - Rolling live view counter (88,322 views, 1,840/hr) with peak hour velocity flags.
4. **Cohort Benchmarking Radar:**
   - Real-time leaderboard comparing upload density, 28-day view counts, and viral ratios across the peer cohort.

---

### Screen 6: Creator Toolkit & Video Reverse-Engineering
- **Asset Reference:** `{{DATA:SCREEN:SCREEN_15}}`
- **Route / Archetype:** `/tools` — Deep Video Deconstruction
- **Target Audience:** Video editors, thumbnail artists, and script doctors.

#### Functional Specifications:
1. **Universal YouTube Video Parser:**
   - URL input with sub-second parsing latency (180ms) and credit allocation tracker.
2. **6 Modular Intelligence Decoders:**
   - *Transcript & Script Breakdown*: Timestamped transcript extraction and hook pacing.
   - *HD Thumbnail & Visual Saliency*: 4K thumbnail extraction, saliency heatmaps, and mobile contrast testing.
   - *Title & Hook Simulator*: 24 packaging variants with predictive CTR scoring (94.2% accuracy).
   - *Competitor Video Dissector*: Cuts-per-minute counters and B-roll distribution telemetry.
   - *Tag & Metadata Inspector*: Extraction of hidden tags, topic categories, and schema data.
   - *Outlier Multiplier Calculator*: Statistical divergence against channel baseline.
3. **Signal Analysis Workspace:**
   - Live dissection case study (Tito's Vodka 323,533× outlier), featuring cold-open retention curves (99.2% hook retention) and narrative segment breakdowns.

---

### Screen 7: Plan & Credits Billing Matrix
- **Asset Reference:** `{{DATA:SCREEN:SCREEN_13}}`
- **Route / Archetype:** `/plans` — Usage Quotas & Subscription Architecture
- **Target Audience:** Finance, account owners, and enterprise teams managing compute budgets.

#### Functional Specifications:
1. **Real-time Quota Gauges:**
   - Current credit allocation meter (100 credits remaining).
   - Visual progress bars for Map/MCP/API ingest, Tracked channels in radar, and Concurrent topic batches.
2. **Three-Tier Subscription Architecture:**
   - **Free ($0/mo):** 100 starter credits, 1 tracked channel, 5 weekly deep researches.
   - **Creator ($19/mo - Recommended):** 1,500 monthly recurring credits (~50 topic batches), 10 tracked channels, direct Claude/ChatGPT bridge.
   - **Pro ($49/mo - Best Value):** 5,000 monthly credits (~166 topic batches), 100 tracked channels, unlimited API sweeps, priority analyst queue.
3. **Full System Capability Comparison Matrix:**
   - Granular breakdown of limits, parallel crawling nodes, model routing, and dedicated SLA response times.
4. **Audit-Grade Billing History & Top-Up Packs:**
   - Modular credit pack purchase modules ($12 for 1,000 units, $45 for 5,000 units) with PDF invoice downloads and payment method management.

---

## 3. Technical Integration & Delivery Checklist

| Milestone | Deliverable | Status | Target Implementation |
|---|---|---|---|
| **Phase 1: Foundation** | Obsidian Radar Design System (`{{DATA:DESIGN_SYSTEM:DESIGN_SYSTEM_1}}`) | Completed | Global CSS variables & token dictionary |
| **Phase 2: Graph & Feed** | Competitor Radar (`SCREEN_21`) & Results Feed (`SCREEN_2`) | Completed | Canvas WebGL / SVG node graph & feed API |
| **Phase 3: Intelligence** | Topic Streams (`SCREEN_19`) & Tactical AI (`SCREEN_17`) | Completed | Vector search endpoint & LLM streaming chat |
| **Phase 4: Telemetry** | YT Dashboard (`SCREEN_11`) & Creator Tools (`SCREEN_15`) | Completed | YouTube Data API v3 & Whisper/Vision pipeline |
| **Phase 5: Monetization** | Plan & Credits Billing Matrix (`SCREEN_13`) | Completed | Stripe billing integration & token bucket meter |

---
*Generated by Stitch for Makina Studio. All screens, telemetry components, and UI assets are fully compiled and available on the Canvas.*
