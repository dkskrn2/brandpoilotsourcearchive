export interface HelpGuideLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface HelpGuideSection {
  title: string;
  items: string[];
  links?: HelpGuideLink[];
}

export interface HelpTourStep {
  selector: string;
  title: string;
  description: string;
}

export interface HelpGuide {
  id: string;
  path: string;
  title: string;
  summary: string;
  sections: HelpGuideSection[];
  tour: HelpTourStep[];
}

const pageHeaderStep = (description: string): HelpTourStep => ({
  selector: '[data-guide="page-header"]',
  title: "현재 화면",
  description
});

export const helpGuides: HelpGuide[] = [
  {
    id: "dashboard",
    path: "/dashboard",
    title: "대시보드",
    summary: "최근 30일의 생성·검토·게시 기록과 연결 채널 성과를 모아 운영 상태를 보여줍니다.",
    sections: [{ title: "확인하고 조치하기", items: ["게시 큐와 채널 성과 수집 기록을 기준으로 발행·노출·검토·실패 수치를 집계합니다.", "운영 흐름에서 작업이 쌓인 단계를 찾아 게시 관리나 채널 연결 화면에서 처리합니다.", "노출 데이터가 없는 채널은 미수집으로 표시되며, 연결 상태와 마지막 수집 시각을 먼저 확인합니다."] }],
    tour: [pageHeaderStep("게시 기록과 채널 성과를 최근 30일 기준으로 집계한 운영 현황입니다."), { selector: ".dashboard-summary", title: "30일 핵심 지표", description: "발행 수, 수집된 노출 수, 검토 대기와 게시 실패 건수를 비교합니다." }, { selector: ".dashboard-workflow", title: "작업 정체 구간", description: "주제 선택부터 게시까지 작업이 쌓인 단계를 확인하고 해당 관리 화면으로 이동합니다." }]
  },
  {
    id: "ai-content",
    path: "/ai-content",
    title: "AI 콘텐츠 생성",
    summary: "브랜드 정보와 저장한 레퍼런스를 사용해 카드뉴스, 블로그, 마케팅 이미지를 직접 생성합니다.",
    sections: [{ title: "생성 흐름", items: ["원하는 산출물 유형을 선택하면 유형에 맞는 크기와 결과 형식이 적용됩니다.", "브랜드 설정, 자사 정보와 선택한 레퍼런스를 확인하고 목적·타겟·소구점을 입력합니다.", "생성 요청은 전용 워커 대기열에 저장되며 완료 후 실제 이미지나 HTML을 미리보고 다운로드할 수 있습니다."] }],
    tour: [pageHeaderStep("새 콘텐츠 만들기에서 카드뉴스, 블로그 또는 마케팅 이미지를 선택하고 생성할 수 있습니다."), { selector: ".ai-content-job-list", title: "생성 작업과 결과", description: "대기·생성·완료·실패 상태를 확인하고 완료된 실제 결과를 다시 엽니다." }]
  },
  {
    id: "ai-content-new",
    path: "/ai-content/new",
    title: "새 AI 콘텐츠",
    summary: "브랜드·자사 정보와 선택한 레퍼런스를 근거로 목적, 타겟, 소구점과 산출물 조건을 정합니다.",
    sections: [{ title: "생성 전 확인", items: ["브랜드 설정과 자사 URL 분석 정보가 기본 근거로 사용되며, 특정 제품 URL이나 저장한 트렌드 레퍼런스를 추가할 수 있습니다.", "만들려는 목적, 핵심 타겟과 강조할 소구점을 구체적으로 입력하고 저장한 항목은 다음 생성에서 다시 불러옵니다.", "최종 단계에서 근거와 결과 형식을 확인하면 요청이 전용 워커 대기열에 저장되고 생성 이력에서 상태를 확인할 수 있습니다."] }],
    tour: [{ selector: ".wizard-header", title: "무엇을 만들지 확인", description: "카드뉴스는 여러 장의 정방형 이미지, 블로그는 게시 가능한 HTML과 설명용 이미지, 마케팅 소재는 한 장의 광고 이미지로 생성됩니다. 현재 선택과 작성 단계를 확인합니다." }, { selector: ".wizard-progress", title: "근거부터 표현 조건까지 준비", description: "자사 URL 또는 제품 URL을 고른 뒤 타겟·소구점·레퍼런스·생성 지시를 순서대로 정합니다. 완료한 단계와 남은 단계를 여기서 확인합니다." }, { selector: ".wizard-workspace", title: "입력값이 사용되는 위치", description: "자사 정보와 제품 URL은 사실 근거로, 타겟과 소구점은 제목·본문·CTA의 방향으로, 레퍼런스는 구성과 표현 참고로 사용됩니다. 확인되지 않은 가격이나 성과는 생성 근거로 쓰지 않습니다." }]
  },
  {
    id: "ai-content-result",
    path: "/ai-content/:generationId",
    title: "AI 콘텐츠 결과",
    summary: "전용 워커가 만든 실제 이미지 또는 HTML과 사용한 생성 조건을 확인합니다.",
    sections: [{ title: "결과 관리", items: ["완료된 카드뉴스·마케팅 소재는 실제 이미지로, 블로그는 본문 HTML과 필요한 설명 이미지로 미리봅니다.", "실패한 작업은 오류 사유를 확인한 뒤 다시 생성하고, 완료 결과는 파일로 다운로드할 수 있습니다.", "게시 가능한 카드뉴스를 게시 관리로 보내면 검토 또는 예약 게시 흐름이 시작됩니다."] }],
    tour: [pageHeaderStep("요청한 생성 조건, 작업 상태와 결과 제목을 확인합니다."), { selector: ".ai-generation-output-list", title: "실제 산출물", description: "이미지 또는 HTML 미리보기와 생성 상태를 확인하고 다운로드하거나 다음 작업으로 보냅니다." }]
  },
  {
    id: "publish-queue",
    path: "/publish-queue",
    title: "게시 관리",
    summary: "생성된 채널 콘텐츠와 게시 큐 기록을 상태별로 확인하고 승인부터 게시 결과까지 관리합니다.",
    sections: [{ title: "상태별 작업", items: ["검토 필요에서 생성된 이미지·영상·본문을 열어보고 승인, 재생성 또는 거절합니다.", "승인된 결과는 게시 큐에 저장되고 예약·게시 중 상태에서 자동 발행 진행 상황과 게시 일시를 확인합니다.", "완료 결과는 실제 산출물과 외부 게시 정보를 확인하거나 다운로드하고, 실패 건은 오류 원인을 확인합니다."] }],
    tour: [pageHeaderStep("채널별 생성 결과와 게시 작업을 하나의 목록으로 관리합니다."), { selector: ".queue-filters", title: "게시 상태 선택", description: "준비 중, 검토 필요, 게시 예정, 완료, 문제 중 확인할 상태를 선택합니다." }, { selector: ".publish-management-grid", title: "콘텐츠와 게시 정보", description: "카드별로 결과물, 채널, 게시 일시, 현재 상태와 가능한 작업을 확인합니다." }]
  },
  {
    id: "sources",
    path: "/sources",
    title: "소스",
    summary: "콘텐츠 생성에 보조 근거로 사용할 외부 URL과 크롤링 이력, 주제표 행을 관리합니다.",
    sections: [{ title: "자료별 사용 방식", items: ["자사 URL은 브랜드 설정에서 한 개만 등록하고, 이 화면에는 외부 사례·기사 등 참고 URL을 추가합니다.", "등록한 URL은 크롤링 결과와 오류 이력이 저장되며 활성 상태인 자료만 콘텐츠 생성의 참고 근거가 됩니다.", "CSV·Excel 주제표는 검증 후 유효한 미사용 행부터 생성 후보가 되고, 사용된 행은 자동으로 다시 선택되지 않습니다."] }],
    tour: [pageHeaderStep("외부 참고 자료와 주제 후보가 수집·검증된 상태를 확인합니다."), { selector: ".content > .panel", title: "참고 자료와 주제표", description: "URL 등록·크롤링 이력 또는 주제표 검증 결과를 확인하고 사용할 항목을 관리합니다." }]
  },
  {
    id: "instagram-trends",
    path: "/instagram-trends",
    title: "Instagram 트렌드 탐색",
    summary: "트렌드용 Meta 연결을 사용해 공개 해시태그의 인기 미디어를 조회하고 생성 레퍼런스로 저장합니다.",
    sections: [{ title: "검색하고 저장하기", items: ["먼저 트렌드용 Meta OAuth를 연결해야 하며 일반 게시 연결과 권한 상태가 다를 수 있습니다.", "#을 제외한 해시태그를 입력하거나 추천 태그를 누르면 Instagram API의 인기 미디어를 조회합니다.", "작성자, 캡션, 반응과 원본 링크를 확인한 뒤 필요한 콘텐츠만 저장하면 AI 콘텐츠 생성의 트렌드 레퍼런스에 표시됩니다."] }],
    tour: [pageHeaderStep("Meta API로 조회한 공개 해시태그 인기 미디어와 저장 상태를 확인합니다."), { selector: ".trend-search-panel", title: "해시태그로 조회", description: "추천 태그를 누르거나 해시태그를 직접 입력해 인기 미디어 검색을 실행합니다." }, { selector: ".trend-results", title: "인기 미디어와 원본", description: "작성자와 반응, 캡션, 원본 링크를 확인하고 생성에 참고할 결과만 저장합니다." }]
  },
  {
    id: "channels",
    path: "/channels",
    title: "채널 연결",
    summary: "외부 계정에서 OAuth 권한을 승인하고 연결이 확인된 채널만 콘텐츠 생성과 게시에 사용합니다.",
    sections: [
      { title: "연결 전에 확인할 정보", items: ["각 채널의 연결 가이드에서 필요한 계정 유형, 관리 권한과 지원 상태를 먼저 확인합니다.", "Instagram 게시·DM 연결에는 전문 계정이 필요하고, 트렌드 탐색까지 사용하려면 별도로 연결된 Facebook Page와 Page 관리 권한이 필요합니다.", "아이디·비밀번호나 직접 만든 액세스 토큰을 입력하지 않고 각 플랫폼의 OAuth 화면에서 로그인합니다."], links: [{ label: "Meta Business 설정 열기", href: "https://business.facebook.com/latest/settings/", external: true }] },
      { title: "연결 후 동작", items: ["OAuth에서 요청 권한을 승인하면 계정명과 연결 상태가 저장됩니다.", "연결됨 상태를 확인한 뒤 채널을 활성화해야 해당 채널용 콘텐츠 생성과 게시 큐 등록이 시작됩니다.", "준비 중인 채널은 외부 앱 설정과 심사가 끝나기 전까지 실제 연결이나 자동 게시를 제공하지 않습니다."] }
    ],
    tour: [pageHeaderStep("자동 게시에 사용할 계정의 OAuth 연결과 채널 활성 상태를 관리합니다."), { selector: '[data-guide="channel-list"]', title: "채널별 인증과 지원 상태", description: "계정 조건과 상세 가이드를 확인하고 OAuth가 제공되는 채널만 연결합니다." }, { selector: '[data-guide="meta-oauth"]', title: "Instagram에서 직접 승인", description: "게시할 Instagram 전문 계정으로 로그인해 프로필·게시·메시지 권한을 승인합니다." }, { selector: '[data-guide="channel-status"]', title: "연결 결과와 조치", description: "연결 계정명, 만료, 권한 부족, 게시 실패 상태를 확인하고 필요하면 다시 연결합니다." }]
  },
  {
    id: "dm-automation",
    path: "/dm-automation",
    title: "DM 자동답변",
    summary: "Instagram DM 대화 기록과 자동답변 상태를 확인하고, 답변 근거가 되는 브랜드별 자사 정보를 관리합니다.",
    sections: [{ title: "대화와 답변 지식 관리", items: ["대화 목록은 연결된 Instagram 계정의 수신·발신 기록, 미확인 수와 자동응답 상태를 표시합니다.", "사람의 확인이 필요한 대화는 자동응답을 중지하거나 수동 답변을 보내고, 처리 후 자동응답을 다시 시작합니다.", "FAQ·제품·이벤트 자료를 자사 정보로 추가하면 검증 후 브랜드 Wiki 재생성에 반영되어 이후 자동답변의 검색 근거가 됩니다."] }],
    tour: [pageHeaderStep("연결된 Instagram 계정의 DM과 브랜드별 답변 근거를 함께 관리합니다."), { selector: ".dm-conversation-list", title: "고객별 대화", description: "최근 메시지, 미확인 여부와 자동응답 중지 상태를 확인하고 대화를 선택합니다." }, { selector: ".dm-thread", title: "답변 이력과 수동 답변", description: "수신·자동 발신 기록을 확인하고 필요한 경우 담당자가 직접 답변합니다." }, { selector: ".dm-knowledge-panel", title: "자동답변용 자사 정보", description: "FAQ·제품 자료를 등록하고 Wiki 생성 상태와 반영된 자료 수를 확인합니다." }]
  },
  {
    id: "brand-settings",
    path: "/brand-settings",
    title: "브랜드 설정",
    summary: "콘텐츠 워커와 DM Wiki가 공통으로 사용할 브랜드 정체성, 고객, 자사 사이트와 운영 정책을 저장합니다.",
    sections: [{ title: "입력 정보와 사용처", items: ["브랜드명, 대표·세부 분야, 핵심 고객과 설명은 콘텐츠 주제·문체와 DM 답변 맥락에 사용됩니다.", "자사 URL은 공개된 공식 사이트 한 개를 등록하며 크롤링·정제 후 콘텐츠 근거와 브랜드 Wiki에 반영됩니다.", "로고는 선택 항목이고 브랜드 컬러·톤·생성 기준·기본 CTA는 이미지와 문구의 표현 방향에 사용됩니다.", "자동 승인을 켜면 브랜드의 지원 채널 전체에 적용되며 차단 조건이 있는 결과는 계속 검토가 필요합니다."] }],
    tour: [pageHeaderStep("콘텐츠 생성과 자동답변에 반복 사용되는 브랜드 기준을 저장합니다."), { selector: ".brand-profile-layout", title: "브랜드와 고객 정보", description: "브랜드명, 분야, 핵심 고객, 설명과 선택 로고를 입력하면 생성·검색 기준에 반영됩니다." }, { selector: ".toggle-row", title: "브랜드 전체 운영 정책", description: "자동 승인처럼 모든 활성 채널의 검토 흐름에 영향을 주는 옵션을 설정합니다." }]
  },
  {
    id: "support",
    path: "/support",
    title: "고객센터",
    summary: "오류·계정·채널·기능 문의를 접수하고 브랜드별 문의 상태와 관리자 답변을 확인합니다.",
    sections: [{ title: "문의 접수와 확인", items: ["문의 유형을 선택하고 화면, 발생 시각, 재현 순서와 오류 문구를 포함해 제목과 내용을 작성합니다.", "접수하면 현재 브랜드의 문의 내역에 저장되고 신규·처리 중·완료 상태로 갱신됩니다.", "목록에서 문의를 선택하면 제출한 내용과 관리자 답변을 확인할 수 있으며 추가 문제가 있으면 새 문의로 접수합니다."] }],
    tour: [pageHeaderStep("현재 브랜드의 문의를 작성하고 접수 이후 처리 결과를 확인합니다."), { selector: ".support-history-list", title: "내 문의와 답변", description: "접수 시각과 처리 상태를 확인하고 항목을 열어 관리자 답변을 읽습니다." }]
  },
  {
    id: "billing",
    path: "/billing",
    title: "결제 및 구독",
    summary: "결제 시스템에 저장된 구독 상태, 이용 권한, 다음 결제일과 결제 이력을 확인합니다.",
    sections: [{ title: "결제 정보와 변경", items: ["카드 번호 원문은 모종이 저장하지 않으며 결제수단 표시 정보와 결제 결과만 확인합니다.", "결제수단 등록·변경과 결제 승인은 Toss Payments 연동 화면에서 처리되고 결과가 이 화면에 반영됩니다.", "해지를 예약하면 현재 이용 기간 종료일에 적용되며, 결제 실패나 이용 권한 만료 시 생성·게시 기능이 제한될 수 있습니다."] }],
    tour: [pageHeaderStep("현재 구독, 서비스 이용 가능 여부와 결제 처리 결과를 확인합니다."), { selector: ".billing-page .panel", title: "구독·결제 결과", description: "플랜 상태, 다음 결제일, 결제수단 표시 정보와 과거 승인·실패 이력을 확인합니다." }]
  },
  {
    id: "onboarding",
    path: "/onboarding",
    title: "시작 준비",
    summary: "브랜드 정보, 자사 자료와 채널 연결 상태를 기준으로 첫 생성·게시까지 필요한 준비 작업을 안내합니다.",
    sections: [{ title: "권장 완료 순서", items: ["브랜드 설정에서 브랜드명, 분야, 핵심 고객과 자사 URL을 저장해 생성 근거를 준비합니다.", "실제로 사용할 채널의 계정 조건을 확인하고 OAuth 연결 후 채널을 활성화합니다.", "참고 URL이나 주제표를 준비하고 첫 콘텐츠를 생성·검토·게시하면 해당 단계가 완료로 반영됩니다."] }],
    tour: [pageHeaderStep("저장 데이터와 실제 작업 기록을 기준으로 완료 수와 남은 준비 항목을 표시합니다."), { selector: ".checklist", title: "다음 준비 작업", description: "미완료 사유와 필요한 행동을 확인하고 항목을 선택해 해당 설정 화면으로 이동합니다." }]
  }
];

function matchesGuidePath(pattern: string, pathname: string) {
  if (pattern === pathname) return true;
  if (!pattern.includes(":")) return false;
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  return patternParts.length === pathParts.length && patternParts.every((part, index) => part.startsWith(":") || part === pathParts[index]);
}

export function guideForPath(pathname: string) {
  return helpGuides.find((guide) => matchesGuidePath(guide.path, pathname)) ?? null;
}
