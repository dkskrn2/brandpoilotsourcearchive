import {
  runControlledSearch,
  type ControlledSearchInput,
} from "@brand-pilot/worker-runtime";
import type { ResearchEvidenceSnapshotV1 } from "@brand-pilot/content-contracts";
import type { ContentProposalResearchJob } from "./contracts.js";

export interface ContentProposalResearch {
  run(job: ContentProposalResearchJob, signal?: AbortSignal): Promise<ResearchEvidenceSnapshotV1>;
}

type ControlledSearch = (input: ControlledSearchInput) => Promise<ResearchEvidenceSnapshotV1>;

function subjectTitle(job: ContentProposalResearchJob): string | null {
  const { subject, references } = job.baseInput;
  if (subject.kind === "topic_text") return subject.title;
  if (subject.kind === "topic_url") return subject.title;
  const selected = new Set(subject.referenceIds);
  const titles = references
    .filter((reference) => selected.has(reference.referenceItemId))
    .map((reference) => reference.title);
  const combined = titles.join(" / ").trim();
  return combined ? combined.slice(0, 1_000) : null;
}

function publicResearchContext(job: ContentProposalResearchJob): ControlledSearchInput["publicResearchContext"] {
  const snapshot = job.baseInput;
  const purpose = job.request.purpose;
  return {
    purpose,
    subjectKind: snapshot.subject.kind,
    subjectTitle: subjectTitle(job),
    contentInstruction: snapshot.contentInstruction,
    primaryCategory: snapshot.brandCore.primaryCategory,
    detailedCategory: snapshot.brandCore.detailedCategory,
    selectedProduct: purpose === "marketing" && snapshot.product !== null
      ? { name: snapshot.product.name, category: snapshot.brandCore.detailedCategory }
      : null,
  };
}

export function createContentProposalResearch(
  search: ControlledSearch = runControlledSearch,
): ContentProposalResearch {
  return {
    run(job, signal) {
      return search({
        purpose: job.request.purpose,
        mode: job.request.purpose === "informational" ? "required" : "automatic",
        publicResearchContext: publicResearchContext(job),
        signal,
      });
    },
  };
}
