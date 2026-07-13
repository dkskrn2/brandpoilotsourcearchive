import { describe, expect, it, vi } from "vitest";
import { buildChannelOutputs, buildMasterDraft, buildMasterDraftPrompt, generateMasterDraftWithOpenAI, getPromptSpec } from "./contentGenerator";

describe("contentGenerator", () => {
  it("builds a reusable master draft from a brand profile and source materials", () => {
    const draft = buildMasterDraft({
      brandProfile: {
        name: "Jeju Pilot",
        industry: "travel consulting",
        primaryCustomer: "first-time travelers",
        serviceDescription: "Jeju route planning",
        tone: "calm expert"
      },
      sourceMaterials: [{
        sourceType: "owned",
        contentUrl: "https://brand.example.com/faq"
      }]
    });

    expect(draft.title).toContain("Jeju Pilot");
    expect(draft.coreMessage).toContain("Jeju route planning");
    expect(draft.targetAudience).toBe("first-time travelers");
    expect(draft.supportingEvidence).toHaveLength(1);
  });

  it("exposes a versioned master draft prompt contract", () => {
    const spec = getPromptSpec("draft.master.v1");
    const prompt = buildMasterDraftPrompt({
      brandProfile: {
        name: "Jeju Pilot",
        industry: "travel consulting",
        primaryCustomer: "first-time travelers",
        serviceDescription: "Jeju route planning",
        tone: "calm expert"
      },
      sourceMaterials: [{
        sourceType: "reference",
        contentUrl: "https://news.example.com/trends",
        content: "Travelers prefer compact routes. Long transfers reduce satisfaction."
      }]
    });

    expect(spec).toMatchObject({
      id: "draft.master.v1",
      api: "openai.responses",
      responseName: "brand_pilot_master_draft"
    });
    expect(spec?.schema).toMatchObject({
      required: ["title", "contentTheme", "coreMessage", "targetAudience", "customerProblem", "keyPoints", "supportingEvidence"]
    });
    expect(prompt.system).toContain("당신은 한국어 마케팅 콘텐츠 초안을 만드는 작성자입니다.");
    expect(prompt.system).toContain("reference 소스의 문장이나 표현을 직접 복제하지 마세요.");
    expect(prompt.system).toContain("최종 콘텐츠 문안에 로고 삽입 지시나 브랜드명을 직접 노출하는 문구를 넣지 마세요.");
    expect(prompt.system).toContain("소스 자료를 그대로 요약하는 데 그치지 말고");
    expect(prompt.system).toContain("첫 장에는 강한 훅을 넣으세요.");
    expect(prompt.system).toContain("놀라움, 공감, 불안, 욕망 같은 심리적 동기");
    expect(prompt.system).toContain("한 문장에는 하나의 핵심 생각만 담으세요.");
    expect(prompt.system).toContain("추상적인 표현보다 입력에서 확인되는 구체적인 상황과 기준을 사용하세요.");
    expect(prompt.system).toContain("주제 명확성, 대상 적합성, 다음 내용을 읽게 만드는 궁금증");
    expect(prompt.system).toContain("실제 사례 정보가 입력에 있을 때만 이야기 구조를 사용하세요.");
    expect(prompt.system).toContain("정확성 > 명확성 > 구체성 > 말투 > 스타일");
    expect(prompt.user).toContain("브랜드 프로필:");
    expect(prompt.user).toContain("- name: Jeju Pilot");
    expect(prompt.user).toContain("- sourceType: reference");
    expect(prompt.user).toContain("- contentUrl: https://news.example.com/trends");
    expect(prompt.user).toContain("- content:");
    expect(prompt.user).toContain("Travelers prefer compact routes.");
  });

  it("builds a master draft prompt from a single topic row without source URLs", () => {
    const prompt = buildMasterDraftPrompt({
      brandProfile: {
        name: "Jeju Pilot",
        industry: "travel consulting",
        primaryCustomer: "first-time travelers",
        serviceDescription: "Jeju route planning",
        tone: "calm expert"
      },
      topicMaterial: {
        topicTitle: "제주 가족 숙소 체크리스트",
        topicAngle: "숙소 권역과 이동 동선을 먼저 정리",
        targetCustomer: "가족 여행자",
        region: "제주",
        season: "봄",
        referenceUrl: "https://example.com/topic",
        notes: "과장 없이 상담형으로 작성"
      },
      sourceMaterials: []
    });

    expect(prompt.user).toContain("주제표 자료:");
    expect(prompt.user).toContain("- topicTitle: 제주 가족 숙소 체크리스트");
    expect(prompt.user).toContain("- topicAngle: 숙소 권역과 이동 동선을 먼저 정리");
    expect(prompt.user).not.toContain("- sourceType:");
  });

  it("creates only central text channel outputs", () => {
    const outputs = buildChannelOutputs({
      brandName: "Jeju Pilot",
      defaultCta: "Book a consultation",
      masterDraft: buildMasterDraft({
        brandProfile: {
          name: "Jeju Pilot",
          industry: "travel consulting",
          primaryCustomer: "first-time travelers",
          serviceDescription: "Jeju route planning",
          tone: "calm expert"
        },
        sourceMaterials: [{
          sourceType: "owned",
          contentUrl: "https://brand.example.com/faq"
        }]
      })
    });

    expect(outputs.map((output) => output.channel)).toEqual(["threads"]);
    expect(outputs[0]).toMatchObject({
      channel: "threads",
      outputJson: { linkPolicy: "brand_link_optional" }
    });
  });

  it("does not serialize centrally owned storyboard fields", () => {
    const outputs = buildChannelOutputs({
      brandName: "Jeju Pilot",
      defaultCta: "Book a consultation",
      masterDraft: {
        title: "처음 제주 여행, 숙소부터 고르면 동선이 꼬입니다",
        contentTheme: "숙소 권역 중심 여행 설계",
        coreMessage: "숙소 위치를 먼저 정하면 이동 피로를 줄일 수 있다.",
        targetAudience: "첫 제주 가족 여행자",
        customerProblem: "후기는 많은데 우리 가족에게 맞는 숙소 기준은 찾기 어렵다.",
        keyPoints: [
          "숙소 권역을 먼저 정한다.",
          "아이 동반 이동 시간을 줄인다.",
          "식사와 관광지를 같은 권역으로 묶는다.",
          "렌터카 이동 부담을 확인한다."
        ],
        supportingEvidence: [
          "자사 상담 사례에서 긴 동선은 여행 피로를 키우는 요소로 확인됐다.",
          "참고 자료는 여행자가 정보 과잉 상황에서 기준을 잃기 쉽다고 설명한다."
        ]
      }
    });
    const serialized = JSON.stringify(outputs);

    expect(serialized).not.toContain('"slides"');
    expect(serialized).not.toContain('"cards"');
    expect(serialized).not.toContain('"scenes"');
    expect(serialized).not.toContain('"assetCount"');
    expect(serialized).not.toContain('"storyboard"');
    expect(outputs.every((output) => !Object.hasOwn(output, "storyboard") && !Object.hasOwn(output.outputJson, "storyboard"))).toBe(true);
  });

  it("generates a master draft through OpenAI Responses API and extracts token usage", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "gpt-5.5",
        text: {
          format: {
            type: "json_schema",
            name: "brand_pilot_master_draft",
            strict: true
          }
        }
      });
      expect(body).not.toHaveProperty("tools");
      expect(body.input[0]).toMatchObject({ role: "system" });
      expect(body.input[1].content).toContain("브랜드 프로필:");
      expect(body.input[1].content).toContain("Owned FAQ says visitors need short routes.");

      return new Response(JSON.stringify({
        id: "resp_123",
        output_text: JSON.stringify({
          title: "제주 식도락 동선 설계",
          contentTheme: "제주 식도락 여행 동선",
          coreMessage: "제주 식도락 동선은 짧고 명확해야 한다.",
          targetAudience: "first-time travelers",
          customerProblem: "초행 여행자는 이동 시간을 예측하기 어렵다.",
          keyPoints: ["숙소 주변 권역을 중심으로 일정을 압축한다."],
          supportingEvidence: ["Owned FAQ says visitors need short routes."]
        }),
        usage: { input_tokens: 120, output_tokens: 80 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    const result = await generateMasterDraftWithOpenAI({
      apiKey: "sk-test",
      model: "gpt-5.5",
      fetchImpl: fetchSpy as any,
      input: {
        brandProfile: {
          name: "Jeju Pilot",
          industry: "travel consulting",
          primaryCustomer: "first-time travelers",
          serviceDescription: "Jeju route planning",
          tone: "calm expert"
        },
        sourceMaterials: [{
          sourceType: "owned",
          contentUrl: "https://brand.example.com/faq",
          content: "Owned FAQ says visitors need short routes."
        }]
      }
    });

    expect(fetchSpy).toHaveBeenCalledWith("https://api.openai.com/v1/responses", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer sk-test" })
    }));
    expect(result.draft.coreMessage).toContain("제주 식도락");
    expect(result.responseId).toBe("resp_123");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
  });

  it("throws a clear error when OpenAI returns a failed response", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "model_not_found" }
    }), { status: 404, headers: { "content-type": "application/json" } }));

    await expect(generateMasterDraftWithOpenAI({
      apiKey: "sk-test",
      model: "gpt-5.5",
      fetchImpl: fetchSpy as any,
      input: {
        brandProfile: {
          name: "Jeju Pilot",
          industry: null,
          primaryCustomer: null,
          serviceDescription: null,
          tone: null
        },
        sourceMaterials: []
      }
    })).rejects.toThrow("openai_response_failed:404:model_not_found");
  });
});

