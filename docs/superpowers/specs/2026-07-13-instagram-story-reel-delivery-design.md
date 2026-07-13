# Instagram Story and Reel Delivery Design

작성일: 2026-07-13

## Goal

브랜드별로 활성화한 Instagram 형식만 사용해 하루 최대 4개의 주제 큐를 생성하고, 카드뉴스, 스토리, 릴스를 순환 생성 및 자동 게시한다. Threads 등 다른 활성 채널은 같은 주제의 채널별 결과물을 함께 생성한다.

## Fixed Decisions

- 하루 한도는 채널별 게시 수가 아니라 브랜드당 주제 큐 4개다.
- 주제 하나는 하나의 서비스 정책 게시 슬롯을 사용한다.
- 같은 주제의 활성 채널 결과물은 같은 슬롯에서 게시한다.
- Instagram은 `feed_carousel`, `story`, `reel` 중 브랜드가 활성화한 형식만 사용한다.
- 활성 Instagram 형식은 고정 순서 `feed_carousel -> story -> reel`로 순환한다. 비활성 형식은 건너뛴다.
- Threads가 연결돼 있으면 모든 주제에 Threads 텍스트 결과물을 함께 만든다.
- Story는 단일 9:16 이미지 한 장이다.
- Reel은 최대 5장의 9:16 이미지를 연결한 무음 영상이다.
- Reel 장면은 각 3초, 장면 간 0.25초 페이드로 구성한다.
- Reel은 Reels 탭에만 게시하고 Feed 공유는 하지 않는다.
- Reel 워커 요청은 기존 카드뉴스 프롬프트와 분리된 전용 프롬프트를 사용한다.
- 카드뉴스와 Reel의 이미지 수는 워커가 내용 밀도에 따라 1-5개로 결정한다. 5개 고정이 아니다.
- Story는 형식 특성상 항상 이미지 한 장으로 생성한다.
- 중앙 서버는 Instagram 이미지 수나 Reel 장면 수를 결정하지 않는다.
- 워커에는 주제별 대표 URL을 최대 한 개만 전달한다.
- 대표 URL이 있으면 워커가 생성 시점에 직접 조회한다. 중앙 크롤링 스냅샷은 대신 전달하지 않는다.
- 대표 URL이 없거나 조회에 실패해도 워커가 주제와 브랜드 정보를 바탕으로 제한된 콘텐츠를 생성한다.
- 브랜드 설정의 주색 한 개를 워커에 참고값으로 전달한다. `파란색`처럼 일반 색상명일 수 있다.
- 형식 생성 실패 시 다른 Instagram 형식으로 자동 대체하지 않는다.
- Story의 실제 자동 게시 가능 여부는 Meta 권한 및 API capability check 통과 후에만 활성화한다.

## Current Context

현재 API는 `channel_outputs`와 `publish_queue`를 이용해 Instagram 카드뉴스와 Threads를 생성한다. Instagram 카드뉴스는 중앙 API가 `instagram_render` job을 만들고, 별도 PC 워커가 정방형 PNG 및 manifest를 저장한 뒤 중앙 API가 Meta 컨테이너 API로 캐러셀을 게시한다.

현재 큐는 개별 channel output을 예약한다. 이 설계에서는 동일 주제의 여러 channel output이 하나의 주제 슬롯을 공유하도록 바꾼다. 따라서 일일 4개 제한은 publish queue 행 수가 아니라 slot이 배정된 content topic 수에 적용된다.

## Architecture

```text
Daily Topic Selection (max 4 topics per brand)
  -> choose next enabled Instagram format by rotation cursor
  -> prepare topic and brand context
  -> Channel Outputs
       -> selected Instagram format job
            -> worker fetches one optional representative URL
            -> worker decides structure and 1-5 asset count
       -> Threads text when connected
  -> Review / Auto Approval
  -> Topic Publish Group (one policy slot per topic)
       -> publish approved outputs independently at the shared slot
```

### Format Selection

`brand_content_formats` holds the following rows per brand:

| format | purpose | default rotation order |
|---|---|---:|
| `instagram_feed_carousel` | Existing square carousel | 1 |
| `instagram_story` | One vertical Story image | 2 |
| `instagram_reel` | Vertical MP4 from image scenes | 3 |

The selection cursor is stored per brand. For every selected topic, the scheduler chooses the next enabled row after the cursor, writes the selected format to the topic, and advances the cursor transactionally. This prevents two scheduler invocations from selecting the same rotation position.

If no Instagram format is enabled, the topic may still create an output for another connected channel such as Threads. If no channel can produce an output, the topic remains unselected and does not consume one of the four daily topic slots.

### Worker Input and Prompt Contracts

The central API selects the topic and Instagram format but does not prepare the card count, scene count, or Instagram storyboard. It sends the worker a format-specific job containing:

- topic title and angle
- optional target customer, region, season, and notes
- brand name, industry, primary customer, service description, tone, and one brand color value
- one optional representative URL
- selected delivery format
- maximum asset count of five

The representative URL is chosen from the selected crawl-based topic's content URL first, then from a valid topic-table `reference_url`. No more than one URL is sent. Each Instagram format uses a separate worker prompt contract.

| Format | prompt version | output contract |
|---|---|---|
| Feed carousel | `worker-card.v4` | Worker-selected 1-5 square cards, caption, exactly 5 hashtags |
| Story | `worker-story.v1` | One 1080x1920 image, embedded concise copy, no interactive element assumption |
| Reel | `worker-reel.v1` | Worker-selected 1-5 ordered vertical scenes, Reel caption, exactly 5 hashtags |

The worker first obtains source context and then decides the smallest asset count that can explain the topic without losing useful information. It may use one asset. It adds another card or scene only when that asset carries a distinct claim, step, comparison, example, or supporting point. It must not fill five assets by repeating the hook, adding an empty summary, or creating a CTA-only final asset.

The Reel prompt must not ask the worker to adapt existing card-news images. It requires independent vertical scenes and lets the worker determine the scene sequence after reading the source. All prompts prohibit in-image CTA buttons, unsupported claims, watermarks, UI chrome, QR codes, and unreadable small text.

The brand color is a visual direction, not a hard palette. For example, `파란색` means that blue-family colors should guide backgrounds, lines, and emphasis, while white, black, and neutral colors remain allowed for contrast and readability. The worker does not invent a logo or force every surface to use the brand color.

### Source Retrieval Modes

The worker records one of the following modes in its manifest:

| source mode | condition | generation rule |
|---|---|---|
| `direct_url` | Representative URL fetched successfully | Use fetched content as the primary factual basis |
| `topic_only` | No representative URL exists | Use topic and brand context; allow only broadly applicable guidance |
| `url_unavailable` | Representative URL exists but fetch fails | Record the fetch error, then apply the same restrictions as `topic_only` |

`topic_only` and `url_unavailable` outputs must not invent prices, product specifications, customer results, statistics, rankings, guarantees, or other externally verifiable claims. They may provide general industry insight, checklists, comparisons that do not claim measured superiority, and practical guidance consistent with the topic.

Direct URL retrieval allows only HTTP and HTTPS. The worker rejects localhost, loopback, link-local, private network, metadata-service, and non-public resolved addresses. It follows a limited number of redirects, applies response size and timeout limits, accepts text-oriented content only, and does not submit forms or execute page actions. Source wording is not copied verbatim into the generated content.

### Worker Responsibilities

The existing image worker keeps the same claim, heartbeat, completion, and Blob upload protocol. Its job payload gains `deliveryFormat`, topic context, brand context including `brandColor`, optional `representativeUrl`, and a format-specific manifest contract.

| job type | worker output |
|---|---|
| `instagram_feed_render` | 1-5 1080x1080 PNG images and manifest |
| `instagram_story_render` | one 1080x1920 PNG and manifest |
| `instagram_reel_render` | 1-5 1080x1920 scene PNG files, `cover.png`, `reel.mp4`, and manifest |

For a Reel, the worker runs a dedicated Python renderer after image generation. The renderer produces a 30 FPS H.264 MP4, concatenates each scene for three seconds, applies a 0.25 second fade, and adds a silent AAC audio track. It must run `ffprobe` before completion and reject output that is not vertical, lacks the required codecs, is outside the expected duration, or cannot be fetched from its public URL.

The first scene is copied as `cover.png`. No third-party music, TTS, stock audio, or user-uploaded audio is part of this scope.

Before completing any job, the worker validates that the image count matches its own manifest and is within the format limit. For card-news and Reel jobs, it also checks that each asset has a distinct role and rejects duplicated or filler-only entries. The central API validates these manifest rules again before accepting the artifacts.

### Publishing Adapters

`instagramPublisher.ts` becomes a format dispatcher with three adapter functions.

| Adapter | input artifact | Meta publish behavior |
|---|---|---|
| `publishInstagramCarousel` | manifest image URLs | Existing carousel container flow |
| `publishInstagramStory` | one public vertical PNG | Story container flow only after capability check |
| `publishInstagramReel` | public MP4, cover PNG, caption | Create `REELS` media container, poll until `FINISHED`, publish with `share_to_feed=false` |

Meta's official Instagram API collection documents the Reel container flow: a Reel uses `media_type=REELS` with a public `video_url`, waits for container completion, and is finalized through `media_publish`. It also lists MP4, H.264/HEVC, AAC, vertical aspect ratio, duration, and size constraints. See [Meta Instagram API Reels documentation](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-e7d98d25-24e4-4ca1-bb8c-0e169d1a09c0).

Story support is guarded by `checkChannelCapability(brandId, "instagram_story")`. The check records the current Meta API version, required permissions, professional-account condition, and a non-publishing capability result. A Story format cannot be enabled for automatic publication until this check passes in the connected customer's account.

### Topic-Level Scheduling

Replace channel-level slot allocation with topic-level groups.

```text
content_topic
  -> topic_publish_group (one row)
       -> publish_queue items (one per channel output)
```

The policy scheduler assigns up to four topic groups to the existing daily policy times. Every approved output inside a group receives the same `scheduled_for` timestamp. A failed or rejected output never blocks a different approved output in the same group. A group with no approved outputs consumes no slot.

The scheduler continues to defer overflow topics to the next available policy day. It never converts a failed Reel or Story into a feed carousel without a new generation decision.

## Data Model Changes

| Area | Change |
|---|---|
| `brand_profiles` | Add optional `brand_color` text used as a worker visual hint |
| `brand_content_formats` | New table for enabled format, rotation order, and capability status |
| `brand_format_rotation_states` | New table holding the next Instagram rotation position per brand |
| `content_topics` | Add `selected_instagram_format` |
| `channel_outputs` | Add `delivery_format` to distinguish channel from actual output shape |
| `topic_publish_groups` | New table with a unique `content_topic_id`, representing one topic's shared policy slot |
| `publish_queue` | Add `topic_publish_group_id`; retain one row per output for retry and external post history |
| `jobs` | Allow Story and Reel render job types; payload includes delivery format and renderer contract version |
| `storage_artifacts` | Allow rendered video and Reel cover artifacts |

Worker prompt version, representative URL, source mode, fetch status, selected asset count, and validation result are stored in the job `payload_json`/`result_json` and artifact manifest. Central `llm_runs` remains responsible for central text-generation calls and does not claim ownership of worker-side image composition.

All new relations use existing workspace and brand ownership columns. Existing feed carousel rows are migrated to `delivery_format=instagram_feed_carousel` and keep their current artifacts and publication records.

## Customer UI

### Brand Settings

The customer sees three Instagram format toggles: Card News, Story, and Reel. Disabled formats cannot be selected by the rotation scheduler. The rotation order is shown as a fixed sequence, not user-configurable in the initial release.

The settings screen stores one optional brand color text value. Values such as `파란색`, `남색`, or `초록색` are accepted without requiring a HEX code or a secondary color. If the value is empty, the worker uses a neutral format-appropriate palette.

Story remains disabled with an explicit capability reason until the connected account passes the Story API capability check.

### Content Review

The review inbox shows the selected format next to every output:

- Feed: square card-news preview
- Story: vertical 9:16 image preview
- Reel: HTML video preview using the uploaded MP4 and visible duration

Approve, Reject, and Regenerate remain independent per output. Regenerate preserves the selected delivery format and uses that format's prompt version.

### Publish Management

The table groups rows by topic and shows one scheduled time for the group. Channel-format rows appear beneath the topic row with independent publish status, artifact link, external media ID, and failure reason.

## Failure and Recovery

- An invalid Reel MP4, missing public URL, or failed Meta container ends in `failed` with a safe error code and publish attempt record.
- Retryable video rendering failures use the existing job retry policy; exhausted attempts require a user regeneration request.
- A Story capability failure disables only the Story format for that brand and does not affect feed carousel, Reel, or Threads.
- Reel processing timeouts do not publish a pending container. The queue remains failed or deferred according to the explicit API error classification.
- Token expiration and permission failures mark the Instagram channel `needs_attention` and stop further automatic publishing for that channel.
- A representative URL fetch failure is logged as a safe worker error code but does not fail the job by itself. The job continues in `url_unavailable` mode under the restricted fact policy.
- A blocked or unsafe representative URL is never fetched. The worker records `source_url_blocked` and continues under the restricted fact policy.

## Delivery Order

1. Add topic-level grouping and brand format rotation.
2. Upgrade card-news generation to `worker-card.v4`, pass brand color and one optional representative URL, and verify adaptive 1-5 card output.
3. Add Story output, `worker-story.v1`, vertical image job contract, capability check, and publishing adapter.
4. Add Reel output, `worker-reel.v1`, direct source retrieval, Python/ffmpeg video renderer, storage validation, and Reel publishing adapter.
5. Update customer UI and publish management to display format-specific previews, source mode, and group status.
6. Run an adaptive card-count quality test, one isolated Story capability test, and one private Reel end-to-end test before enabling the new behavior for customer accounts.

## Non-Goals

- Interactive Story stickers, polls, questions, countdowns, links, mentions, and music.
- User-controlled Reel transition timing, audio selection, caption editing, or cover editing.
- Automatic substitution from a failed format to another format.
- Separate per-format daily caps.
- Central selection of card count, Reel scene count, or Instagram storyboard.
- Passing central crawl snapshot text to the worker as a substitute for direct URL retrieval.
- Worker local/production environment separation. This remains a separate task.

## Self-Review

- No placeholder or deferred implementation detail is required to understand the proposed feature boundaries.
- The daily cap is consistently defined as four topics, not four outputs or four channel posts.
- The selected Instagram format is one per topic, while other connected channels can still produce a result for that topic.
- Reel assets, worker output, publisher input, review preview, and queue behavior all use the same topic-level group model.
- Card-news and Reel counts are consistently worker-selected within 1-5; Story remains exactly one image.
- Source behavior is defined for a valid URL, missing URL, fetch failure, and blocked URL without relying on an unstated snapshot fallback.
- Brand color is consistently an optional visual hint rather than a strict palette or generated brand identity.
