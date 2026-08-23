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

function publicResearchContext(job: ContentProposalResearchJob) {
  const snapshot = job.baseInput;
  const purpose = job.request.purpose;
  const selectedReferenceIds = snapshot.subject.kind === "reference"
    ? new Set(snapshot.subject.referenceIds)
    : null;
  const subjectReferences = selectedReferenceIds === null
    ? undefined
    : snapshot.references
      .filter((reference) => selectedReferenceIds.has(reference.referenceItemId))
      .map(({ title, sourceUrl, text }) => ({ title, sourceUrl, text }));
  return {
    purpose,
    subjectKind: snapshot.subject.kind,
    subjectTitle: subjectTitle(job),
    sourceUrls: snapshot.subject.kind === "topic_url"
      ? {
          requestedUrl: snapshot.subject.requestedUrl,
          canonicalUrl: snapshot.subject.canonicalUrl,
        }
      : null,
    contentInstruction: snapshot.contentInstruction,
    primaryCategory: snapshot.brandCore.primaryCategory,
    detailedCategory: snapshot.brandCore.detailedCategory,
    selectedProduct: purpose === "marketing" && snapshot.product !== null
      ? { name: snapshot.product.name, category: snapshot.brandCore.detailedCategory }
      : null,
    ...(subjectReferences === undefined ? {} : { subjectReferences }),
  };
}

export function createContentProposalResearch(
  search: ControlledSearch = runControlledSearch,
): ContentProposalResearch {
  return {
    run(job, signal) {
      return search({
        purpose: job.request.purpose,
        mode: job.request.purpose === "marketing" && job.request.outputFormat === "blog"
          ? "automatic"
          : "required",
        evidenceGranularity: "independent_claim",
        publicResearchContext: publicResearchContext(job),
        signal,
      });
    },
  };
}
