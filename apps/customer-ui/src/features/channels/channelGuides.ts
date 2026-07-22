import type { ChannelType } from "../../types";

export interface ChannelGuideLink {
  label: string;
  href: string;
}

export interface ChannelGuideSetupSection {
  title: string;
  steps: readonly string[];
}

export interface ChannelGuidePermission {
  name: string;
  purpose: string;
}

export interface ChannelGuideTroubleshooting {
  problem: string;
  solution: string;
}

export interface ChannelConnectionGuide {
  channel: ChannelType;
  label: string;
  serviceStatus: "available" | "preparing";
  summary: string;
  prerequisites: readonly string[];
  accountSetup: readonly ChannelGuideSetupSection[];
  oauthSteps: readonly string[];
  permissions: readonly ChannelGuidePermission[];
  completionChecks: readonly string[];
  troubleshooting: readonly ChannelGuideTroubleshooting[];
  officialLinks: readonly ChannelGuideLink[];
  operatorNote: string;
}

export const channelGuides: Record<ChannelType, ChannelConnectionGuide> = {
  instagram: {
    channel: "instagram",
    label: "Instagram",
    serviceStatus: "available",
    summary: "Instagram 전문 계정으로 OAuth를 승인하면 게시와 DM 기능을 연결할 수 있습니다. 트렌드 탐색은 별도의 Facebook Page 연결이 필요합니다.",
    prerequisites: [
      "공개 상태의 Instagram 전문 계정이 필요합니다. 사업자라면 비즈니스 계정을 권장합니다.",
      "게시와 DM 연결에는 Facebook Page가 필수가 아닙니다. Instagram 앱에서 해당 전문 계정으로 정상 로그인되는지 확인합니다.",
      "트렌드 탐색도 사용할 경우에는 Instagram 전문 계정과 연결된 Facebook Page 및 해당 Page의 관리 권한이 추가로 필요합니다.",
      "Instagram 아이디와 비밀번호를 모종에 입력하지 않습니다. Instagram OAuth 화면에서 직접 로그인하고 권한을 승인합니다."
    ],
    accountSetup: [
      {
        title: "비즈니스 계정으로 전환",
        steps: [
          "Instagram 모바일 앱에서 프로필을 엽니다.",
          "오른쪽 위 메뉴를 누르고 설정 및 활동으로 이동합니다.",
          "계정 유형 및 도구에서 프로페셔널 계정으로 전환을 선택합니다.",
          "브랜드에 맞는 카테고리를 고른 뒤 비즈니스를 선택해 전환을 완료합니다.",
          "전문 계정은 비공개로 사용할 수 없으므로 프로필 공개 상태도 확인합니다."
        ]
      },
      {
        title: "트렌드 탐색을 사용할 때만 Page 연결",
        steps: [
          "게시와 DM만 사용한다면 이 단계는 건너뜁니다.",
          "Instagram 프로필에서 프로필 편집을 누릅니다.",
          "공개 비즈니스 정보의 Page를 선택합니다.",
          "Facebook에 로그인하고 기존 Page를 선택하거나 새 Page를 만듭니다.",
          "트렌드 화면에서 별도의 Meta 권한 연결을 실행할 때 Page 관리 권한이 있는 Facebook 계정으로 승인합니다."
        ]
      }
    ],
    oauthSteps: [
      "모종 채널 화면에서 Meta OAuth 연결을 누릅니다.",
      "열린 Instagram 로그인 화면에서 실제 게시할 전문 계정으로 로그인합니다.",
      "연결할 Instagram 프로필이 맞는지 확인합니다.",
      "표시되는 권한을 일부 해제하지 말고 승인합니다. 필요한 권한을 빼면 게시나 DM 기능이 동작하지 않을 수 있습니다.",
      "모종으로 돌아와 연결 계정명과 연결됨 상태를 확인한 뒤 채널을 활성화합니다."
    ],
    permissions: [
      { name: "instagram_business_basic", purpose: "연결한 Instagram 전문 계정의 ID와 사용자명을 확인합니다." },
      { name: "instagram_business_content_publish", purpose: "승인된 피드 카드뉴스, 스토리와 릴스를 연결 계정에 게시합니다." },
      { name: "instagram_business_manage_messages", purpose: "DM 자동답변을 켠 경우 Instagram 메시지를 수신하고 답변합니다." },
      { name: "트렌드용 Facebook 권한", purpose: "트렌드 탐색을 별도로 연결할 때 Page와 연결된 Instagram 계정에서 공개 해시태그 미디어를 조회합니다." }
    ],
    completionChecks: [
      "연결 계정에 실제 Instagram 사용자명이 표시됩니다.",
      "채널 상태가 연결됨으로 표시됩니다.",
      "DM 자동답변을 사용할 경우 메시지 권한과 Webhook 상태도 정상인지 확인합니다.",
      "연결 후에만 채널 활성화 스위치를 켤 수 있습니다."
    ],
    troubleshooting: [
      { problem: "개인 계정이라 연결할 수 없음", solution: "Instagram 앱에서 계정을 크리에이터 또는 비즈니스 전문 계정으로 전환한 뒤 다시 연결합니다." },
      { problem: "권한 부족 또는 다시 연결 필요", solution: "Instagram 설정의 앱 및 웹사이트에서 기존 모종 권한을 확인한 뒤 OAuth 다시 연결을 실행합니다." },
      { problem: "OAuth 후 다른 Instagram 계정이 연결됨", solution: "Instagram 로그인 화면에서 현재 로그인 계정을 확인하고 실제 게시할 전문 계정으로 다시 연결합니다." },
      { problem: "트렌드 연결에서 계정을 찾지 못함", solution: "Instagram 전문 계정과 Facebook Page 연결, 로그인한 Facebook 사용자의 Page 관리 권한을 확인합니다." },
      { problem: "리디렉션 URI 또는 앱 설정 오류", solution: "고객 계정 문제가 아니라 모종 운영 설정 문제입니다. 고객센터에 오류 화면과 발생 시간을 전달합니다." }
    ],
    officialLinks: [
      { label: "Instagram 전문 계정 안내", href: "https://www.facebook.com/help/instagram/138925576505882" },
      { label: "Instagram 앱 권한 관리", href: "https://help.instagram.com/1144624522593085" },
      { label: "트렌드용 Page 연결", href: "https://www.facebook.com/help/1148909221857370" }
    ],
    operatorNote: "Instagram 앱, 앱 시크릿, Redirect URI, Webhook과 권한 심사는 모종이 관리합니다. 고객이 Meta 개발자 앱이나 액세스 토큰을 만들 필요는 없습니다."
  },
  threads: {
    channel: "threads",
    label: "Threads",
    serviceStatus: "preparing",
    summary: "Threads 프로필을 OAuth로 승인해 텍스트와 미디어 게시 권한을 연결합니다.",
    prerequisites: [
      "게시할 Threads 프로필이 필요합니다.",
      "Threads 앱에서 해당 프로필로 정상 로그인되고 게시가 가능한지 확인합니다.",
      "고객이 Meta 개발자 앱이나 액세스 토큰을 만들 필요는 없습니다."
    ],
    accountSetup: [
      { title: "Threads 프로필 준비", steps: ["Threads 앱을 설치하고 Instagram 또는 Meta 계정으로 프로필을 만듭니다.", "프로필 이름과 공개 범위를 확인하고 테스트 글을 직접 게시할 수 있는지 확인합니다.", "여러 프로필을 사용한다면 모종에 연결할 프로필을 미리 정합니다."] }
    ],
    oauthSteps: [
      "Threads 연결 기능이 열리면 채널 화면에서 Threads 연결을 누릅니다.",
      "게시할 Threads 프로필로 로그인합니다.",
      "기본 프로필 조회와 콘텐츠 게시 권한을 승인합니다.",
      "모종으로 돌아와 프로필명과 연결됨 상태를 확인한 뒤 채널을 활성화합니다."
    ],
    permissions: [
      { name: "threads_basic", purpose: "연결한 Threads 프로필을 식별하고 기본 정보를 확인합니다." },
      { name: "threads_content_publish", purpose: "승인된 Threads 콘텐츠를 고객 프로필에 게시합니다." }
    ],
    completionChecks: ["연결한 Threads 프로필명이 표시됩니다.", "채널 상태가 연결됨으로 바뀝니다.", "연결 완료 후 채널 활성화가 가능해집니다."],
    troubleshooting: [
      { problem: "로그인 계정과 게시할 프로필이 다름", solution: "Threads 앱에서 현재 프로필을 확인한 뒤 OAuth를 다시 시작합니다." },
      { problem: "권한 승인 후에도 미연결", solution: "OAuth 화면에서 게시 권한을 해제하지 않았는지 확인하고 다시 연결합니다." }
    ],
    officialLinks: [{ label: "Threads API 시작 안내", href: "https://developers.facebook.com/docs/threads/get-started" }],
    operatorNote: "Threads OAuth 앱 설정과 게시 권한 심사는 모종이 준비합니다. 현재 고객 연결 기능은 준비 중입니다."
  },
  x: {
    channel: "x",
    label: "X",
    serviceStatus: "preparing",
    summary: "게시할 X 계정이 모종의 글 작성 권한을 OAuth로 승인하는 방식입니다.",
    prerequisites: ["게시가 제한되지 않은 X 계정이 필요합니다.", "이메일 또는 전화번호 인증과 보안 확인을 완료합니다.", "여러 X 계정에 로그인돼 있다면 게시할 계정을 미리 확인합니다."],
    accountSetup: [
      { title: "X 계정 준비", steps: ["X에서 게시할 프로필로 로그인합니다.", "새 글을 직접 게시할 수 있는지 확인합니다.", "보호 계정 여부와 조직의 공개 정책을 확인합니다."] }
    ],
    oauthSteps: ["X 연결 기능이 열리면 채널 화면에서 X 연결을 누릅니다.", "게시할 X 계정으로 로그인합니다.", "프로필 조회, 글 읽기·작성, 장기 연결 권한을 확인하고 승인합니다.", "모종으로 돌아와 사용자명과 연결 상태를 확인합니다."],
    permissions: [
      { name: "users.read", purpose: "연결한 X 계정의 사용자명을 확인합니다." },
      { name: "tweet.read / tweet.write", purpose: "기존 게시 상태를 확인하고 승인된 글을 게시합니다." },
      { name: "offline.access", purpose: "매번 로그인하지 않아도 예약 게시 시 토큰을 갱신합니다." }
    ],
    completionChecks: ["X 사용자명이 정확히 표시됩니다.", "채널 상태가 연결됨으로 바뀝니다.", "활성화 후 승인 콘텐츠만 게시 큐에 들어갑니다."],
    troubleshooting: [
      { problem: "잘못된 X 계정이 연결됨", solution: "X에서 계정을 전환하거나 로그아웃한 뒤 다시 연결합니다." },
      { problem: "쓰기 권한이 없음", solution: "OAuth 동의 화면에서 글 작성 권한을 승인했는지 확인합니다." }
    ],
    officialLinks: [{ label: "X OAuth 2.0 안내", href: "https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token" }],
    operatorNote: "X 개발자 프로젝트, Client ID, Redirect URI와 API 요금제는 모종이 관리합니다. 현재 고객 연결 기능은 준비 중입니다."
  },
  linkedin: {
    channel: "linkedin",
    label: "LinkedIn",
    serviceStatus: "preparing",
    summary: "개인 프로필 또는 관리 권한이 있는 회사 Page를 선택해 OAuth로 게시 권한을 승인합니다.",
    prerequisites: ["정상 사용 가능한 LinkedIn 회원 계정이 필요합니다.", "회사 Page에 게시하려면 해당 Page의 관리자 또는 콘텐츠 관리 권한이 필요합니다.", "개인 프로필과 회사 Page 중 게시 대상을 미리 정합니다."],
    accountSetup: [
      { title: "회사 Page 게시 준비", steps: ["LinkedIn에서 회사 Page를 엽니다.", "관리 도구에서 자신의 Page 역할과 콘텐츠 게시 권한을 확인합니다.", "권한이 없다면 Page 최고 관리자에게 역할 부여를 요청합니다."] }
    ],
    oauthSteps: ["LinkedIn 연결 기능이 열리면 채널 화면에서 LinkedIn 연결을 누릅니다.", "게시 권한이 있는 회원 계정으로 로그인합니다.", "프로필 확인과 게시 권한을 승인합니다.", "회사 Page 게시를 선택한 경우 연결 후 게시 대상 Page가 맞는지 확인합니다."],
    permissions: [
      { name: "OpenID 프로필", purpose: "연결한 LinkedIn 회원을 식별합니다." },
      { name: "w_member_social", purpose: "승인된 콘텐츠를 회원 프로필에 게시합니다." },
      { name: "조직 게시 권한", purpose: "회사 Page 게시를 지원할 때 관리 가능한 조직과 게시 권한을 확인합니다." }
    ],
    completionChecks: ["연결한 회원명 또는 회사 Page명이 표시됩니다.", "선택한 게시 대상이 실제 운영 대상과 일치합니다.", "채널 상태가 연결됨으로 바뀝니다."],
    troubleshooting: [
      { problem: "회사 Page가 목록에 없음", solution: "LinkedIn Page 역할과 게시 권한을 확인하고 권한이 있는 계정으로 다시 연결합니다." },
      { problem: "개인 프로필만 연결됨", solution: "회사 Page 게시 지원 상태와 조직 권한 승인 여부를 확인합니다." }
    ],
    officialLinks: [{ label: "LinkedIn 게시 API 안내", href: "https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin" }],
    operatorNote: "LinkedIn 앱과 Share on LinkedIn 제품, 조직 게시 심사는 모종이 관리합니다. 현재 고객 연결 기능은 준비 중입니다."
  },
  youtube: {
    channel: "youtube",
    label: "YouTube",
    serviceStatus: "preparing",
    summary: "게시할 YouTube 채널을 선택하고 Google OAuth에서 동영상 업로드 권한을 승인합니다.",
    prerequisites: ["Google 계정뿐 아니라 실제 YouTube 채널이 필요합니다.", "YouTube 채널이 없다면 YouTube에서 채널을 먼저 생성해야 합니다.", "여러 채널 또는 브랜드 계정을 관리한다면 게시할 채널을 미리 확인합니다."],
    accountSetup: [
      { title: "YouTube 채널 생성", steps: ["YouTube에 Google 계정으로 로그인합니다.", "프로필 메뉴에서 채널 만들기를 선택합니다.", "개인 채널 또는 조직에서 관리할 브랜드 채널의 이름을 정하고 생성을 완료합니다.", "YouTube Studio에 들어가 해당 채널로 업로드가 가능한지 확인합니다."] }
    ],
    oauthSteps: ["YouTube 연결 기능이 열리면 채널 화면에서 YouTube 연결을 누릅니다.", "업로드할 채널을 소유하거나 관리하는 Google 계정으로 로그인합니다.", "계정에 여러 YouTube 채널이 있으면 실제 게시할 채널을 선택합니다.", "동영상 업로드 권한을 승인하고 모종에서 채널명을 확인합니다."],
    permissions: [
      { name: "YouTube 채널 조회", purpose: "연결한 Google 계정에서 게시할 YouTube 채널을 확인합니다." },
      { name: "youtube.upload", purpose: "승인된 동영상을 선택한 YouTube 채널에 업로드합니다." },
      { name: "오프라인 접근", purpose: "예약 게시 시 재로그인 없이 토큰을 갱신합니다." }
    ],
    completionChecks: ["Google 계정명이 아니라 실제 YouTube 채널명이 표시됩니다.", "선택한 채널이 YouTube Studio의 운영 채널과 같습니다.", "채널 상태가 연결됨으로 바뀝니다."],
    troubleshooting: [
      { problem: "연결할 YouTube 채널이 없음", solution: "Google 계정으로 YouTube 채널을 먼저 생성한 뒤 다시 연결합니다." },
      { problem: "잘못된 브랜드 채널이 선택됨", solution: "Google 계정의 채널 전환 메뉴에서 대상 채널을 확인하고 OAuth를 다시 연결합니다." },
      { problem: "확인되지 않은 앱 경고", solution: "모종의 Google 앱 검증 상태와 테스트 사용자 등록이 필요한 운영 설정 문제입니다. 고객센터에 문의합니다." }
    ],
    officialLinks: [
      { label: "YouTube OAuth 안내", href: "https://developers.google.com/youtube/v3/guides/authentication" },
      { label: "YouTube 업로드 권한", href: "https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps" }
    ],
    operatorNote: "Google Cloud 프로젝트, YouTube Data API, OAuth 동의 화면과 앱 검증은 모종이 관리합니다. 현재 고객 연결 기능은 준비 중입니다."
  },
  tiktok: {
    channel: "tiktok",
    label: "TikTok",
    serviceStatus: "preparing",
    summary: "TikTok 계정이 Content Posting 권한을 승인하면 모종이 게시 전 설정을 확인하고 콘텐츠를 전송합니다.",
    prerequisites: ["동영상 또는 사진 게시가 가능한 TikTok 계정이 필요합니다.", "계정의 이메일·전화번호 확인과 보안 검사를 완료합니다.", "조직 계정이라면 OAuth를 승인할 담당 계정을 정합니다."],
    accountSetup: [
      { title: "TikTok 계정 준비", steps: ["TikTok 앱에서 게시할 계정으로 로그인합니다.", "콘텐츠를 직접 게시할 수 있고 계정에 제한 알림이 없는지 확인합니다.", "게시 공개 범위와 댓글·듀엣·이어붙이기 정책을 미리 정합니다."] }
    ],
    oauthSteps: ["TikTok 연결 기능이 열리면 채널 화면에서 TikTok 연결을 누릅니다.", "게시할 TikTok 계정으로 로그인합니다.", "프로필 확인과 콘텐츠 게시 권한을 승인합니다.", "모종으로 돌아와 계정명과 연결됨 상태를 확인합니다."],
    permissions: [
      { name: "user.info.basic", purpose: "연결한 TikTok 계정의 기본 정보를 확인합니다." },
      { name: "video.publish", purpose: "사용자가 승인한 콘텐츠를 TikTok 계정에 직접 게시합니다." }
    ],
    completionChecks: ["연결한 TikTok 사용자명이 표시됩니다.", "게시 공개 범위와 상호작용 설정을 확인할 수 있습니다.", "채널 상태가 연결됨으로 바뀝니다."],
    troubleshooting: [
      { problem: "게시물이 비공개로만 생성됨", solution: "TikTok 정책상 심사되지 않은 API 클라이언트는 비공개 게시로 제한될 수 있습니다." },
      { problem: "게시 권한이 표시되지 않음", solution: "모종의 TikTok 앱에 Content Posting 제품과 video.publish 승인이 완료됐는지 고객센터에 확인합니다." }
    ],
    officialLinks: [{ label: "TikTok Content Posting API", href: "https://developers.tiktok.com/doc/content-posting-api-get-started" }],
    operatorNote: "TikTok 개발자 앱, Direct Post 설정, 도메인 검증과 video.publish 심사는 모종이 관리합니다. 현재 고객 연결 기능은 준비 중입니다."
  }
};
