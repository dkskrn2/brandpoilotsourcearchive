import { ContactForm } from "@/components/contact-form";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Contact",
  description: "Request a 15-minute initial diagnosis to find the first bottleneck to change across acquisition, enquiries, payment, and operations.",
  path: "/en/contact",
  locale: "en",
  localized: true
});

export default function EnglishContactPage() {
  return <ContactForm locale="en" />;
}
