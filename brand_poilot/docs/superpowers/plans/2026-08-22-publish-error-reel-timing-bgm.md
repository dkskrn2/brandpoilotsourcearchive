# 게시 오류·릴스 3초·BGM 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instagram 해시태그 게시 오류를 수정하고, 이미지 워커가 새 릴스를 장면당 3초와 지정 BGM으로 합성하도록 하나의 안전한 릴리스 후보를 만든다.

**Architecture:** API 게시 오류와 릴스 합성은 독립 커밋으로 유지한다. 새 릴스는 이미지 워커 안에서만 고정 MP3를 AAC로 합성하고, 공용 manifest는 기존 `null` 읽기와 새 `aac` 읽기를 허용하지만 기존 데이터는 수정하지 않는다. 고객 UI는 화면 변경 없이 새 parser를 포함해 재빌드하며 DB·카드뉴스·다른 워커는 변경하지 않는다.

**Tech Stack:** TypeScript, TypeBox, Vitest, Python, FFmpeg/ffprobe, Docker

---

## 변경 파일 구조

- `apps/api/src/instagramCaption.ts`: 생성 해시태그를 정규화·중복 제거한 뒤 5개로 제한한다.
- `apps/api/src/instagramCaption.test.ts`: 혼합 접두사, 중복, 잘못된 태그 회귀를 고정한다.
- `packages/brand-pilot-content-contracts/src/manifest.ts`: V3 MP4의 `audioCodec`을 `null | "aac"`로 읽는다.
- `packages/brand-pilot-content-contracts/src/validators.ts`: 저장 완료 자산도 같은 오디오 계약을 사용한다.
- `workers/brand-pilot-image-worker/assets/mixkit-a-very-happy-christmas-897.mp3`: 릴스 전용 고정 BGM이다.
- `workers/brand-pilot-image-worker/Dockerfile`: 고정 BGM을 런타임 이미지에 포함하고 checksum을 검증한다.
- `workers/brand-pilot-image-worker/src/reelRenderer.ts`: 새 릴스에 3초 장면, BGM, 12% 볼륨, 0.5초 페이드를 요구한다.
- `workers/brand-pilot-image-worker/scripts/render-reel.py`: studio Reel에도 비반복 오디오를 자르고 AAC로 합성한다.
- `workers/brand-pilot-image-worker/src/manifest.ts`: 새 릴스 manifest에 `audioCodec: "aac"`를 기록한다.
- `workers/brand-pilot-image-worker/src/aiContentFinalizer.ts`: AAC 결과를 Blob 저장과 manifest 생성에 전달한다.
- `workers/brand-pilot-image-worker/src/storage.ts`: AI 콘텐츠 MP4 저장 타입이 AAC를 보존한다.
- `apps/api/src/aiContentManifest.ts`: 기존 무음 V3와 신규 AAC V3를 모두 읽되 3초·4초 완료본만 허용한다.
- `apps/customer-ui/src/features/ai-content/aiContentApiGateway.test.ts`: 고객 UI가 신규 AAC manifest를 읽는 회귀를 고정한다.
- `scripts/release-impact.mjs`: 배포 대상을 API, 고객 UI, 이미지 워커로 정확히 제한한다.
- 대응 테스트 파일과 `scripts/verify-reel.mjs`: 계약·합성·기존 조회/게시 회귀를 검증한다.

### Task 1: Instagram 게시 오류 패치 이식

**Files:**
- Modify: `apps/api/src/instagramCaption.ts`
- Test: `apps/api/src/instagramCaption.test.ts`

- [ ] **Step 1: 혼합 해시태그 실패 테스트를 추가한다**

```ts
expect(formatInstagramCaption("본문", ["#태그1", "태그2", "태그3", "태그4", "태그5", "태그6"]))
  .toBe("본문\n\n#태그1 #태그2 #태그3 #태그4 #태그5");
```

- [ ] **Step 2: RED를 확인한다**

Run: `npm exec vitest run apps/api/src/instagramCaption.test.ts`
Expected: `instagram_caption_hashtags_invalid`로 실패

- [ ] **Step 3: 정규화 후 중복 제거·5개 제한을 구현한다**

```ts
const value = tag.trim().replace(/^#/, "");
const canonical = `#${value}`;
const key = canonical.toLocaleLowerCase();
```

빈 값, 공백 포함, 중간 `#`, 문자열이 아닌 값은 계속 거부한다.

- [ ] **Step 4: API 관련 테스트와 타입 검사를 실행한다**

Run: `npm exec vitest run apps/api/src/instagramCaption.test.ts apps/api/src/aiContentPublish.test.ts`
Expected: 모두 PASS

- [ ] **Step 5: 게시 오류 패치를 독립 커밋한다**

```bash
git add apps/api/src/instagramCaption.ts apps/api/src/instagramCaption.test.ts
git commit -m "fix: normalize generated instagram hashtags"
```

### Task 2: V3 릴스 AAC 호환 계약

**Files:**
- Modify: `packages/brand-pilot-content-contracts/src/manifest.ts`
- Modify: `packages/brand-pilot-content-contracts/src/validators.ts`
- Modify: `apps/api/src/aiContentManifest.ts`
- Test: `packages/brand-pilot-content-contracts/src/schemas.test.ts`
- Test: `packages/brand-pilot-content-contracts/src/validators.test.ts`
- Test: `apps/api/src/aiContentManifest.test.ts`

- [ ] **Step 1: AAC V3 manifest 수용 테스트를 추가한다**

```ts
const video = { ...validVideo, audioCodec: "aac" as const };
expect(parseAiContentManifestV3({ ...manifest, assets: [...scenes, video] })).toBeDefined();
expect(parseActiveAiContentManifestV3({ ...manifest, assets: [...scenes, video] })).toBeDefined();
```

- [ ] **Step 2: RED를 확인한다**

Run: `npm exec vitest run packages/brand-pilot-content-contracts/src/schemas.test.ts packages/brand-pilot-content-contracts/src/validators.test.ts apps/api/src/aiContentManifest.test.ts`
Expected: `audioCodec: "aac"`가 현재 `null` 전용 계약에서 거부되어 FAIL

- [ ] **Step 3: 읽기 계약만 `null | "aac"`로 확장한다**

```ts
audioCodec: Type.Union([Type.Null(), Type.Literal("aac")])
```

API의 V3 video metadata 검사도 같은 두 값만 허용한다. V2 계약과 기존 DB 행은 수정하지 않는다.

- [ ] **Step 4: GREEN과 기존 무음 fixture 호환을 확인한다**

Run: Task 2 Step 2와 동일
Expected: AAC 신규 fixture와 null 기존 fixture 모두 PASS

- [ ] **Step 5: 계약 변경을 독립 커밋한다**

```bash
git add packages/brand-pilot-content-contracts/src/manifest.ts packages/brand-pilot-content-contracts/src/validators.ts packages/brand-pilot-content-contracts/src/*.test.ts apps/api/src/aiContentManifest.ts apps/api/src/aiContentManifest.test.ts
git commit -m "feat: accept aac audio in active reel manifests"
```

### Task 3: 이미지 워커 전용 BGM 자산 패키징

**Files:**
- Create: `workers/brand-pilot-image-worker/assets/mixkit-a-very-happy-christmas-897.mp3`
- Modify: `workers/brand-pilot-image-worker/Dockerfile`
- Test: `scripts/deployment-contract.test.mjs`

- [ ] **Step 1: Docker 이미지가 BGM과 checksum 검증을 요구하는 실패 테스트를 추가한다**

테스트는 Dockerfile에 자산 COPY와 SHA-256 `714BAA43F1C04E8CA77A8268825EA7E68E958917F5F5FE4C656D83811E1D0C98` 검증이 있는지 확인한다.

- [ ] **Step 2: RED를 확인한다**

Run: `node --test scripts/deployment-contract.test.mjs`
Expected: BGM COPY/checksum 계약 누락으로 FAIL

- [ ] **Step 3: 사용자 제공 MP3를 byte-for-byte 복사하고 Docker에 포함한다**

원본과 저장본 SHA-256을 각각 계산해 동일한지 확인한다. 런타임 위치는 `/app/workers/brand-pilot-image-worker/assets/mixkit-a-very-happy-christmas-897.mp3`로 고정한다.

- [ ] **Step 4: Docker 계약 테스트를 통과시킨다**

Run: `node --test scripts/deployment-contract.test.mjs`
Expected: PASS

### Task 4: 신규 AI 콘텐츠 릴스 BGM 합성

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/reelRenderer.ts`
- Modify: `workers/brand-pilot-image-worker/scripts/render-reel.py`
- Test: `workers/brand-pilot-image-worker/src/reelRenderer.test.ts`
- Modify: `workers/brand-pilot-image-worker/scripts/verify-reel.mjs`

- [ ] **Step 1: 신규 렌더러가 BGM 인자와 AAC 결과를 요구하는 테스트를 작성한다**

```ts
expect(args).toEqual(expect.arrayContaining([
  "--audio", expect.stringMatching(/mixkit-a-very-happy-christmas-897\.mp3$/),
  "--seconds-per-scene", "3",
  "--audio-volume", "0.12",
  "--audio-fade-seconds", "0.5",
]));
expect(result.video.audioCodec).toBe("aac");
```

- [ ] **Step 2: RED를 확인한다**

Run: `npm exec vitest run workers/brand-pilot-image-worker/src/reelRenderer.test.ts`
Expected: 신규 경로가 audio 인자를 전달하지 않고 무음을 요구해 FAIL

- [ ] **Step 3: TypeScript 렌더러를 최소 수정한다**

기본 BGM 경로를 정적 자산으로 해석해 Python에 전달한다. 새 출력은 정확히 video stream 1개, audio stream 1개, H.264/AAC, 30fps, `sceneCount * 3`초여야 한다.

- [ ] **Step 4: Python studio 합성 경로에 비반복 BGM을 추가한다**

studio 경로에서는 `-stream_loop -1`을 사용하지 않는다. 다음 필터를 영상 총 길이에 적용한다.

```text
volume=0.12,atrim=duration=<video-duration>,asetpts=PTS-STARTPTS,
afade=t=in:st=0:d=0.5,afade=t=out:st=<duration-0.5>:d=0.5
```

AAC 48kHz stereo로 mux하고 `-t <video-duration>`에서 자른다.

- [ ] **Step 5: GREEN을 확인한다**

Run: `npm exec vitest run workers/brand-pilot-image-worker/src/reelRenderer.test.ts`
Expected: PASS

- [ ] **Step 6: 실제 MP3와 FFmpeg로 1장·5장 합성을 검증한다**

Run: `node workers/brand-pilot-image-worker/scripts/verify-reel.mjs`
Expected:
- 1 scene: 3.000s, H.264, AAC, 1080×1920, 30fps
- 5 scenes: 15.000s, H.264, AAC, 1080×1920, 30fps

### Task 5: Finalizer·Blob·manifest에 AAC 보존

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentFinalizer.ts`
- Modify: `workers/brand-pilot-image-worker/src/storage.ts`
- Modify: `workers/brand-pilot-image-worker/src/manifest.ts`
- Test: `workers/brand-pilot-image-worker/src/aiContentFinalizer.test.ts`
- Test: `workers/brand-pilot-image-worker/src/manifest.test.ts`
- Test: `workers/brand-pilot-image-worker/src/storage.test.ts`

- [ ] **Step 1: 신규 완료 manifest가 AAC를 기록하는 실패 테스트를 작성한다**

```ts
expect(manifest.assets).toContainEqual(expect.objectContaining({
  role: "video",
  durationSeconds: 15,
  audioCodec: "aac",
}));
```

- [ ] **Step 2: RED를 확인한다**

Run: `npm exec vitest run workers/brand-pilot-image-worker/src/manifest.test.ts workers/brand-pilot-image-worker/src/aiContentFinalizer.test.ts workers/brand-pilot-image-worker/src/storage.test.ts`
Expected: 현재 finalizer/storage가 `null`만 허용해 FAIL

- [ ] **Step 3: 새 렌더 결과의 AAC 값을 그대로 저장·manifest화한다**

신규 렌더러 타입은 `audioCodec: "aac"`로 좁게 유지한다. 읽기·저장 인터페이스만 필요한 위치에서 `null | "aac"`를 허용해 기존 fixture를 깨지 않는다.

- [ ] **Step 4: GREEN을 확인한다**

Run: Task 5 Step 2와 동일
Expected: PASS

- [ ] **Step 5: 릴스 3초와 BGM 변경을 함께 커밋한다**

```bash
git add workers/brand-pilot-image-worker packages/brand-pilot-content-contracts apps/api/src/aiContentManifest.ts apps/api/src/aiContentManifest.test.ts scripts/deployment-contract.test.mjs
git commit -m "feat: render three-second reels with bundled bgm"
```

### Task 6: 전체 회귀와 배포 영향 검증

**Files:**
- Verify only

- [ ] **Step 1: 이미지 워커 전체 테스트와 빌드를 실행한다**

Run: `npm test --workspace @brand-pilot/image-worker -- --maxWorkers=4`
Run: `npm run build --workspace @brand-pilot/image-worker`
Expected: 모두 PASS

- [ ] **Step 2: 공용 계약과 API 게시·다운로드 회귀를 실행한다**

Run: `npm exec vitest run packages/brand-pilot-content-contracts/src apps/api/src/instagramCaption.test.ts apps/api/src/aiContentManifest.test.ts apps/api/src/aiContentPublish.test.ts apps/api/src/aiContentDownload.test.ts apps/api/src/aiContentRenderJobs.pglite.test.ts -- --maxWorkers=4`
Run: `npm run typecheck --workspace @brand-pilot/api`
Expected: 모두 PASS

- [ ] **Step 3: 변경 범위와 whitespace를 확인한다**

Run: `git diff --check`
Run: `git status --short`
Expected: API 게시 패치, contracts, image worker, 관련 테스트·문서·BGM 외 변경 없음

- [ ] **Step 4: 배포 영향 분석을 실행한다**

Run: 저장소의 release impact 검사
Expected: `api + customerUi + imageWorker`만 변경 대상으로 판정되고 DB migration·다른 워커는 제외

- [ ] **Step 5: 운영 배포 전에 멈추고 보고한다**

원격 main, 운영 SHA/digest, 롤백 digest, hotfix 중첩 여부를 확인한다. 사용자 승인 전 병합·운영 배포는 하지 않는다.
