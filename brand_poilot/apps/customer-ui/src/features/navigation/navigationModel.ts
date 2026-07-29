import {
  CreditCard,
  Headphones,
  LayoutDashboard,
  ChartNoAxesCombined,
  MessageCircleReply,
  ScanSearch,
  Send,
  Settings2,
  Share2,
  Sparkles,
  Library,
  type LucideIcon,
} from "lucide-react";

export interface CustomerNavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface CustomerNavigationGroup {
  id: string;
  label: string;
  items: CustomerNavigationItem[];
}

export const customerNavigation: CustomerNavigationGroup[] = [
  {
    id: "overview",
    label: "개요",
    items: [
      { label: "대시보드", path: "/dashboard", icon: LayoutDashboard },
      { label: "성과·개선", path: "/performance", icon: ChartNoAxesCombined },
    ],
  },
  {
    id: "brand",
    label: "브랜드",
    items: [
      { label: "브랜드 센터", path: "/brand-center", icon: Settings2 },
      { label: "레퍼런스", path: "/references", icon: Library },
    ],
  },
  {
    id: "content",
    label: "콘텐츠",
    items: [
      { label: "콘텐츠 생성", path: "/ai-content", icon: Sparkles },
      { label: "게시 관리", path: "/publish-queue", icon: Send },
    ],
  },
  {
    id: "channels",
    label: "채널·고객",
    items: [
      { label: "채널", path: "/channels", icon: Share2 },
      {
        label: "Instagram 고객응대",
        path: "/dm-automation",
        icon: MessageCircleReply,
      },
    ],
  },
  {
    id: "settings",
    label: "설정·지원",
    items: [
      {
        label: "결제 및 구독",
        path: "/billing",
        icon: CreditCard,
      },
      { label: "고객센터", path: "/support", icon: Headphones },
    ],
  },
];

export const onboardingNavigationItem: CustomerNavigationItem = {
  label: "브랜드 분석",
  path: "/brand-center?tab=understanding&section=sources",
  icon: ScanSearch,
};

const pageTitles = new Map(
  customerNavigation.flatMap((group) =>
    group.items
      .filter((item) => item.path.startsWith("/"))
      .map((item) => [item.path, item.label] as const),
  ),
);

pageTitles.set(onboardingNavigationItem.path, onboardingNavigationItem.label);

export function resolveCustomerPageTitle(rawPath: string): string | null {
  const pathname = rawPath.split(/[?#]/, 1)[0];

  if (pathname.startsWith("/ai-content/") && pathname !== "/ai-content/new") {
    return "콘텐츠 결과";
  }

  return pageTitles.get(pathname) ?? null;
}
