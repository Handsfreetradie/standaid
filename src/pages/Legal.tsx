import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUPPORT_EMAIL = "hello@standaid.ai";
const LAST_UPDATED = "20 August 2026";

interface LegalProps {
  kind: "terms" | "privacy";
}

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-base font-bold text-foreground">{title}</h2>
    <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
  </section>
);

const Legal = ({ kind }: LegalProps) => {
  const navigate = useNavigate();

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-lg px-4 py-6 pb-16">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 text-muted-foreground"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        <h1 className="text-2xl font-extrabold text-foreground mb-1">
          {kind === "terms" ? "Terms of Service" : "Privacy Policy"}
        </h1>
        <p className="text-xs text-muted-foreground mb-6">Last updated: {LAST_UPDATED}</p>

        {kind === "terms" ? (
          <div className="space-y-6">
            <Section title="1. What StandAId is">
              <p>
                StandAId is an app that helps Australian tradespeople search, understand and study
                standards documents that they upload themselves. It uses artificial intelligence (AI)
                to answer questions about your uploaded documents, generate study material, and
                provide trade calculators.
              </p>
            </Section>

            <Section title="2. It's a reference aid — not a substitute for the standard">
              <p>
                AI-generated answers, study material and calculator results can contain errors. They
                are provided as a convenience to help you find and understand information faster —
                they are not professional advice, not a compliance certification, and not a
                replacement for the published standard, the National Construction Code, or the
                judgement of a licensed tradesperson.
              </p>
              <p className="font-medium text-foreground">
                Always verify safety-critical values against the published standard before relying on
                them. You remain fully responsible for work you carry out.
              </p>
            </Section>

            <Section title="3. Your uploads and copyright">
              <p>
                You may only upload documents you are legally entitled to use — for example, a
                standard you have purchased or hold a valid licence or subscription for. By
                uploading, you confirm this and accept responsibility for complying with the
                publisher's terms.
              </p>
              <p className="font-medium text-foreground">
                Standards Australia's terms do not permit any AI or machine-learning use of their
                content. Documents affected by this (AS, AS/NZS and NZS standards) are stored in
                your account for viewing only — AI search, chat and Learn/study features are not
                available for them, regardless of your subscription tier. We detect and apply this
                automatically at upload; it is not something you can opt into or out of.
              </p>
              <p>
                Your uploaded documents are stored privately against your account. They are never
                shared with, or made searchable by, other users — even if another user owns the same
                standard, they cannot access, view or search your copy. Where AI processing is
                available for a document, it (text extraction, indexing and answering your
                questions) happens solely to provide the service to you.
              </p>
            </Section>

            <Section title="4. Your account">
              <p>
                Keep your login details secure — you're responsible for activity on your account.
                One account is for one person; don't share access. We may suspend accounts that
                breach these terms or abuse the service.
              </p>
            </Section>

            <Section title="5. Subscriptions and fair use">
              <p>
                Free accounts include a limited number of AI queries per day and partial document
                indexing. Paid plans lift those limits, subject to fair-use caps that protect the
                service from runaway automated usage. To manage or cancel a subscription, contact us
                at {SUPPORT_EMAIL}.
              </p>
            </Section>

            <Section title="6. Liability">
              <p>
                To the maximum extent permitted by law (including the Australian Consumer Law, whose
                consumer guarantees are not excluded), StandAId is provided "as is" and we are not
                liable for loss arising from reliance on AI-generated content or calculator results.
                Where liability cannot be excluded, it is limited to re-supplying the service or the
                amount you paid for it in the previous 12 months.
              </p>
            </Section>

            <Section title="7. Changes and contact">
              <p>
                We may update these terms as the service evolves; material changes will be flagged in
                the app. These terms are governed by the laws of Western Australia. Questions:{" "}
                <a className="text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
              </p>
            </Section>
          </div>
        ) : (
          <div className="space-y-6">
            <Section title="1. What we collect">
              <p>
                Account details (email, name), the documents you upload, the questions you ask
                (text, voice transcripts and photos you submit for analysis), your quiz and exam
                activity, feedback you give on answers, and basic usage information needed to run
                and secure the service.
              </p>
            </Section>

            <Section title="2. How we use it">
              <p>
                To provide the service: extracting and indexing your documents so they're
                searchable, generating answers and study material with AI, tracking your study
                progress, and enforcing plan limits. Feedback you submit on answers may be reviewed
                to improve accuracy.
              </p>
              <p className="font-medium text-foreground">
                We do not sell your data, and your uploaded documents are never shared with or made
                available to other users.
              </p>
            </Section>

            <Section title="3. AI processing">
              <p>
                To generate answers, relevant excerpts of your documents, your questions and any
                photos you submit are processed by our AI providers (Anthropic and OpenAI) under
                their API terms, which do not permit them to train their models on this data. Voice
                input is transcribed on your device by your browser, not on our servers.
              </p>
              <p>
                This only applies to documents eligible for AI processing. Standards Australia's
                content (AS, AS/NZS and NZS standards) is excluded from AI processing entirely — see
                our Terms of Service, Section 3.
              </p>
            </Section>

            <Section title="4. Where it's stored">
              <p>
                Data is stored with our hosting provider (Supabase) in access-controlled databases
                and private file storage. Documents are served only to your logged-in account via
                short-lived links, and are never accessible to any other user — this reflects
                Standards Australia's licensing requirements as well as our own security design. We
                take reasonable steps to protect your information in line with the Privacy Act 1988
                (Cth) and the Australian Privacy Principles.
              </p>
            </Section>

            <Section title="5. Retention and deletion">
              <p>
                Your data is kept while your account is active. Deleting a standard removes its
                content from your library. To delete your account and associated data, or to
                request a copy of your data, email{" "}
                <a className="text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
                and we'll action it within 30 days.
              </p>
            </Section>

            <Section title="6. Contact and complaints">
              <p>
                Privacy questions or complaints:{" "}
                <a className="text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
                If you're not satisfied with our response, you can contact the Office of the
                Australian Information Commissioner (oaic.gov.au).
              </p>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
};

export default Legal;
