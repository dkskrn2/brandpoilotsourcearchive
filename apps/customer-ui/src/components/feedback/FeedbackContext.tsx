import { createContext, useContext, useMemo } from "react";

interface FeedbackContextValue {
  openFeedback: () => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({
  children,
  onOpenFeedback,
}: {
  children: React.ReactNode;
  onOpenFeedback: () => void;
}) {
  const value = useMemo(() => ({ openFeedback: onOpenFeedback }), [onOpenFeedback]);

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback() {
  return useContext(FeedbackContext);
}
