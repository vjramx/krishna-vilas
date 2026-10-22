import { TopBackBar } from '@/components/nav';
import { useLanguage } from '@/context/LanguageContext';

/** Root anchor — updates here only, never per-section. */
const LAST_UPDATED = '21 October 2026';

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`pp-${n}`} className="card p-4">
      <h2 id={`pp-${n}`} className="text-[15px] font-bold text-brand-text">
        {n}. {title}
      </h2>
      <div className="mt-1.5 grid gap-1.5 text-sm leading-relaxed text-brand-text/90">{children}</div>
    </section>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-1.5">
      <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-subtle" />
      <span>{children}</span>
    </li>
  );
}

export default function PrivacyPolicyPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-dvh bg-brand-bg">
      <TopBackBar title={t('account.privacy')} />
      <main className="app-col pb-nav pt-4" lang="en-IN">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-subtle">
          Last updated: {LAST_UPDATED}
        </p>

        <p className="card p-4 text-sm leading-relaxed text-brand-text">
          Krishna Vilas (&ldquo;we,&rdquo; &ldquo;our,&rdquo; or &ldquo;us&rdquo;) respects your privacy. This
          Privacy Policy explains how the Krishna Vilas Food Delivery app collects, uses, stores, and
          shares information when you use our services.
        </p>

        <Section n={1} title="Information We Collect">
          <p>Depending on how you use the app, we may collect:</p>
          <ul>
            <Bullet>
              <strong className="font-semibold">Personal information:</strong> Name and mobile number.
            </Bullet>
            <Bullet>
              <strong className="font-semibold">Delivery information:</strong> Delivery address and delivery instructions.
            </Bullet>
            <Bullet>
              <strong className="font-semibold">Order information:</strong> Food items ordered, order details, order status, and order history.
            </Bullet>
            <Bullet>
              <strong className="font-semibold">Communication information:</strong> Messages or details you provide when contacting us for support.
            </Bullet>
            <Bullet>
              <strong className="font-semibold">Technical information:</strong> Basic device, diagnostic, or usage information, if collected by the app or its service providers.
            </Bullet>
          </ul>
        </Section>

        <Section n={2} title="How We Use Your Information">
          <p>We use collected information to:</p>
          <ul>
            <Bullet>Receive and process food orders.</Bullet>
            <Bullet>Confirm orders and communicate updates.</Bullet>
            <Bullet>Arrange food delivery in Karatagi, Karnataka, subject to availability.</Bullet>
            <Bullet>Respond to customer questions and complaints.</Bullet>
            <Bullet>Maintain app security and improve our services.</Bullet>
            <Bullet>Meet applicable legal obligations.</Bullet>
          </ul>
        </Section>

        <Section n={3} title="Payments">
          <p>
            Our app supports <strong className="font-semibold">Cash on Delivery (COD)</strong> for eligible
            orders. We do not require online card or banking details to place a COD order.
          </p>
        </Section>

        <Section n={4} title="Sharing of Information">
          <p>We may share relevant information with:</p>
          <ul>
            <Bullet>Restaurant staff to prepare and manage your order.</Bullet>
            <Bullet>Delivery personnel to deliver your order.</Bullet>
            <Bullet>Hosting, database, and technical service providers that help operate the app.</Bullet>
            <Bullet>Government authorities when disclosure is required by applicable law.</Bullet>
          </ul>
          <p className="font-semibold">We do not sell your personal information to third parties.</p>
        </Section>

        <Section n={5} title="Data Storage and Security">
          <p>
            We take reasonable measures to protect your information against unauthorized access, misuse,
            loss, or disclosure. Information may be stored using secure database and hosting services.
          </p>
          <p>
            However, no electronic storage or transmission method can be guaranteed to be completely secure.
          </p>
        </Section>

        <Section n={6} title="Data Retention and Deletion">
          <p>
            We retain information for as long as reasonably necessary to fulfil orders, provide support,
            maintain relevant records, and meet legal requirements.
          </p>
          <p>
            You can delete your account and its personal data directly in the app under{' '}
            <strong className="font-semibold">Account → Delete account</strong>, or request deletion by
            email to the address below or via our public page at{' '}
            <a href="/delete-account" className="font-medium text-brand-primary underline active:opacity-80">
              /delete-account
            </a>
            . Some anonymized order records (items, amounts, dates — with all personal data removed) may
            need to be retained where required by law for accounting, tax, fraud-prevention or
            dispute-resolution purposes.
          </p>
          <p>
            An active order must be delivered or cancelled before deletion can complete.
          </p>
        </Section>

        <Section n={7} title="Children's Privacy">
          <p>
            Our app is intended for general customers and is not specifically designed to collect personal
            information from children. If you believe a child has provided personal information
            inappropriately, please contact us so we can review the request.
          </p>
        </Section>

        <Section n={8} title="Third-Party Services">
          <p>
            The app may rely on third-party services for hosting, databases, notifications, analytics, or
            other technical functions. These providers may process information as needed to deliver their
            services and under their applicable privacy terms.
          </p>
        </Section>

        <Section n={9} title="Your Privacy Rights">
          <p>
            Subject to applicable law, you may request access to, correction of, or deletion of your
            personal information. You may contact us with questions or concerns about how your
            information is handled.
          </p>
          <p>
            Deleting your account in the app removes your profile and personal data immediately and
            prevents further use of it; see section 6.
          </p>
        </Section>

        <Section n={10} title="Changes to This Privacy Policy">
          <p>
            We may update this Privacy Policy when our app, services, or legal requirements change. The
            revised version will include an updated date.
          </p>
        </Section>

        <Section n={11} title="Contact Us">
          <dl className="grid gap-1">
            <div className="flex gap-1.5">
              <dt className="font-semibold">App Name:</dt>
              <dd>Krishna Vilas Food Delivery</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-semibold">Business Name:</dt>
              <dd>Krishna Vilas</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="font-semibold">Location:</dt>
              <dd>Karatagi, Koppal District, Karnataka, India</dd>
            </div>
          </dl>
          <p>
            <span className="font-semibold">Email:</span>{' '}
            <a href="mailto:vjramx@gmail.com" className="font-medium text-brand-primary underline active:opacity-80">
              vjramx@gmail.com
            </a>
          </p>
        </Section>
      </main>
    </div>
  );
}
