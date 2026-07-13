import type { ServiceDetail } from "@/lib/service-details";

export const englishServiceDetails = {
  "service-research": {
    title: "UX Research",
    eyebrow: "RESEARCH LENS",
    headline: "Why do customers arrive, and where do they stop?",
    description: "Observe the full experience from first contact to completion and use evidence, not assumptions, to set the improvement order.",
    image: "/images/generated/ux-research-journey.webp",
    imageAlt: "Research map connecting customer behavior and interview evidence to an end-to-end journey",
    sections: [
      { title: "See the whole journey before choosing a screen to fix", body: "We look beyond interface polish to understand whether people can complete the outcome they came for.", points: ["Identify exits and repeated friction", "Compare observed behavior with interview evidence", "Agree priorities against evidence"] },
      { title: "Choose the research method around the question", body: "Qualitative and quantitative methods are combined to understand both the reason and the scale of a problem.", points: ["Customer interviews and usability tests", "Surveys and voice-of-customer analysis", "Competitive experience review"] },
      { title: "Change the experience, then measure again", body: "Research does not end in a report. Findings are converted into interface and operating changes that can be verified.", points: ["Define the outcome and hypothesis", "Find recurring patterns", "Compare before-and-after signals"] }
    ],
    process: ["Observe", "Understand", "Connect", "Validate"]
  },
  "service-analytics": {
    title: "Data Analytics",
    eyebrow: "DECISION SYSTEM",
    headline: "Why do decisions stay slow when data keeps growing?",
    description: "Turn scattered numbers into comparable evidence that helps the team choose the next action.",
    image: "/images/generated/data-decision-system.webp",
    imageAlt: "Analysis system bringing several data streams into one decision point",
    sections: [
      { title: "Analysis begins before opening a tool", body: "Data can answer only after the team agrees what must be understood and which decision it should change.", points: ["Define the problem and hypothesis", "Choose metrics that match the question", "Set comparison and evaluation rules"] },
      { title: "Separate a result from a conclusion", body: "We explain what a numerical difference means instead of stopping after reporting that it exists.", points: ["Separate symptoms and causes", "Read totals together with distributions", "Convert conclusions into priorities"] },
      { title: "End with a next action", body: "Every analysis should produce a change or experiment with an owner and a measurable completion condition.", points: ["Actionable recommendation", "Owner and definition of done", "Measurement after the change"] }
    ],
    process: ["Define", "Compare", "Conclude", "Act"]
  },
  "service-design": {
    title: "Conversion Design",
    eyebrow: "CONVERSION PATH",
    headline: "Why is there traffic, but no next action?",
    description: "Arrange value, evidence, and calls to action in the order customers decide, turning a complex choice into a clear path.",
    image: "/images/generated/conversion-blueprint.webp",
    imageAlt: "Conversion blueprint turning complex choices into one clear action path",
    sections: [
      { title: "Connect visual clarity to a customer decision", body: "A strong interface must also make clear what the customer should notice, trust, and do next.", points: ["Place the core value and difference", "Support claims with evidence", "Prioritize decision-critical information"] },
      { title: "Resolve hesitation before the CTA", body: "Questions about price, scope, risk, and the process should be answered before the customer is asked to enquire or buy.", points: ["State what the button does", "Remove late and repeated calls to action", "Explain risk and expected outcomes"] },
      { title: "Give every page one job", body: "Landing pages create relevance, service pages build understanding, and detail or case pages provide confidence.", points: ["Message by acquisition context", "Remove duplicated information", "Connect pages in a natural sequence"] }
    ],
    process: ["Inform", "Decide", "Prove", "Act"]
  },
  "service-consulting": {
    title: "Business Logic",
    eyebrow: "OPERATING LOGIC",
    headline: "Why does work become harder as features increase?",
    description: "Define workflows, exceptions, permissions, and completion rules before development so the product remains operable at scale.",
    image: "/images/generated/conversion-blueprint.webp",
    imageAlt: "Operating blueprint organizing complex business rules into a consistent workflow",
    sections: [
      { title: "Start with how the work really moves", body: "Map who decides what, when ownership changes, and how each case reaches completion.", points: ["Current workflow and bottlenecks", "Roles and permissions", "Exceptions and recovery paths"] },
      { title: "Agree the expensive-to-reverse decisions first", body: "States, settlement rules, and data ownership should be stable before screens and code make them costly to change.", points: ["State transitions and completion rules", "Data ownership and retention", "Operator control boundaries"] },
      { title: "Prioritize requirements against value and risk", body: "Not every feature belongs in the first release. Sequence work by customer value, operating risk, and dependency.", points: ["Required versus optional capabilities", "Dependencies and release units", "Testable acceptance criteria"] }
    ],
    process: ["Workflow", "Rules", "Access", "Operations"]
  },
  "service-writing": {
    title: "Persuasive Copywriting",
    eyebrow: "MESSAGE FLOW",
    headline: "Why do customers hesitate when the page explains so much?",
    description: "Replace feature lists with a message that answers customer questions, supports the promise, and makes the next step explicit.",
    image: "/images/generated/content-operations-loop.webp",
    imageAlt: "Content workflow moving from evidence and drafting through review, publishing, and improvement",
    sections: [
      { title: "Write the reason to care before the feature", body: "Begin with how the customer's situation changes, then explain the product capability that makes it possible.", points: ["One-sentence promise", "Customer problem and desired outcome", "Evidence for the difference"] },
      { title: "Answer hesitation before purchase", body: "Price, trust, risk, and alternatives are addressed in the order a customer is likely to consider them.", points: ["Frequently asked questions", "Cases and measurable evidence", "Scope and limitations"] },
      { title: "Explain what happens after the button", body: "Tell customers who will respond, when they will hear back, and what information will be needed.", points: ["Specific call to action", "Clear process", "Consistent follow-up message"] }
    ],
    process: ["Hesitation", "Promise", "Evidence", "Next step"]
  },
  "service-startup": {
    title: "Startup Build",
    eyebrow: "LAUNCH LOOP",
    headline: "How much should you build before the idea is proven?",
    description: "Launch only what the hypothesis needs, then use real behavior to decide which capability deserves to come next.",
    image: "/images/generated/content-operations-loop.webp",
    imageAlt: "Product loop connecting an idea to an MVP, launch, measurement, and the next improvement",
    sections: [
      { title: "Move from a concept to a service customers can use", body: "We connect sign-up, the core job, data, and operating tools instead of stopping at static design screens.", points: ["Core customer journey", "Data and permission model", "Deployment and operating environment"] },
      { title: "Separate what is needed now from what can wait", body: "Capabilities that directly test the hypothesis come first. The rest earn priority through observation.", points: ["Hypothesis to validate", "Minimum launch scope", "Criteria for follow-up features"] },
      { title: "Put post-launch learning back into the product", body: "Behavioral signals and customer feedback determine the sequence of the next experiments and releases.", points: ["Measure the core behavior", "Collect customer feedback", "Release and improve repeatedly"] }
    ],
    process: ["Hypothesis", "MVP", "Launch", "Learn"]
  }
} satisfies Record<string, ServiceDetail>;

export type EnglishServiceSlug = keyof typeof englishServiceDetails;
