# Brand Pilot Customer UI StyleSeed Design Review

Date: 2026-07-05  
Target: `docs/prototypes/brand-pilot-customer-ui`  
Mode: report only

## Design Score: 76 / 100   (`docs/prototypes/brand-pilot-customer-ui`)   C

Per-file scan:

| File | Score | Notes |
|---|---:|---|
| `assets/prototype.css` | 73 | Solid base system, but mobile overflow and many hardcoded color values pull the score down. |
| `pages/sources.html` | 74 | Useful consolidation, but primary actions target collapsed details and the URL table breaks mobile width. |
| `pages/content.html` | 76 | Instagram square card preview is directionally right, but the review layout overflows on mobile. |
| `pages/channels.html` | 78 | Clear channel states, but token forms lack associated labels and connection-check output stays collapsed. |
| `pages/publish-queue.html` | 80 | Queue states are understandable; tab accessibility needs tightening. |
| `pages/onboarding.html` | 82 | Best page in the set: focused next actions and low cognitive load. |
| `pages/brand-settings.html` | 80 | Clear form structure, but generic save/cancel prototype behavior and label association need work. |

## Score Breakdown

Coherence            15/20  
The UI mostly agrees on 8px radius and restrained SaaS styling, but there are still competing shape languages: 8px panels/buttons (`prototype.css:196-198`, `prototype.css:148-156`), pill badges (`prototype.css:222-228`), and unused phone-preview styling with 28px radius (`prototype.css:420-428`). Status and informational hues are also used broadly across lists (`prototype.css:234-239`).

Color discipline     10/16  
The root tokens are a good start (`prototype.css:1-19`), but many colors are still hardcoded in component rules: nav text (`prototype.css:85`), danger borders (`prototype.css:170`), neutral disabled states (`prototype.css:176-183`), selected rows (`prototype.css:281-283`), alert borders (`prototype.css:351-354`), preview gradients (`prototype.css:457-465`), and empty states (`prototype.css:489-496`). Status colors appear on many normal rows, which weakens severity hierarchy.

Hierarchy & type     13/16  
Page hierarchy is readable, and panel headings are compact (`prototype.css:211-215`). The weaker point is dense data surfaces: badges, row titles, meta text, and table data compete in the same visual band, especially in `content.html:34-50` and `sources.html:34-41`.

Layout & spacing     8/12  
Desktop layout is mostly stable, but mobile breaks. The two-column grid keeps a `minmax(360px, .72fr)` secondary column (`prototype.css:193`), while tables have no responsive strategy (`prototype.css:295-306`). On a 390px viewport this creates document widths of 644px on Content and 498px on Sources. Inline spacing also appears on collapsed panels (`sources.html:71`, `sources.html:75`, `sources.html:79`, `channels.html:59`).

States                9/12  
Empty, failed, blocked, and regeneration states exist (`content.html:60-68`, `publish-queue.html:53`). Missing pieces are loading states and state visibility after CTA actions. Several CTAs move to collapsed `<details>` sections instead of opening them (`sources.html:23`, `sources.html:57`, `channels.html:23`, `channels.html:45`).

UX writing            10/12  
Most actions are concrete: "URL 추가", "주제표 업로드", "연결 점검", "토큰 추가". Some prototype actions are still generic or not result-oriented enough, such as "저장" in `brand-settings.html:22`, and technical channel copy like token/account fields is exposed directly to customers in `channels.html:39-44`.

Motion & polish      11/12  
There is almost no motion, which is acceptable for this operational UI. The main polish issue is not animation but missing focus/interaction affordance for hidden details: summary markers are removed (`prototype.css:356-363`) without adding a replacement disclosure cue.

## Fix First

1. Fix mobile overflow on Content and Sources.  
   Highest gain: layout, visual quality, accessibility. Make tables horizontally contained or card-based on mobile, and remove the fixed 360px grid minimum from the mobile path.

2. Make CTA targets reveal the destination state.  
   Highest functional gain. `URL 추가`, `검증 시작`, `저장 후 크롤링`, `연결 점검`, and `저장 후 연결 점검` should open the target `<details>` section or route to a visible tab/panel.

3. Add real tab and form semantics.  
   Highest accessibility gain. Add `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-controls`, stable panel IDs, and `for`/`id` pairs for form labels.

4. Reduce status-color noise.  
   Use neutral badges for normal states and reserve green/yellow/red/purple for states that need interpretation or action.

5. Remove unused styling and hardcoded component colors.  
   Delete or repurpose the old phone-preview block, move component colors to semantic tokens, and keep the square Instagram preview as the only Instagram visual model.

Estimated re-score after these fixes: 86-89 / 100.
