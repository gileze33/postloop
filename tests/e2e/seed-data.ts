/** Seed mail for the README screenshot: a busy primary inbox plus a spread of other addresses. All
 * addresses use reserved *.test domains so nothing here is a real destination. */

export interface SeedMessage {
    from: string;
    to: string;
    subject: string;
    html: string;
}

/** The inbox the screenshot opens: it gets the most, and the newest, mail so it sorts to the top. */
export const PRIMARY_INBOX = "you@your-app.test";

const otherInboxes: SeedMessage[] = [
    { from: '"Globex Billing" <billing@globex.test>', to: "billing@your-app.test", subject: "Invoice #2025-114 is now overdue", html: "<p>Your invoice for 249.00 is 14 days overdue.</p>" },
    { from: '"Priya Shah" <priya@initech.test>', to: "billing@your-app.test", subject: "Question about my subscription", html: "<p>Can I switch from monthly to annual mid-term?</p>" },
    { from: '"Security" <security@auth.test>', to: "security@your-app.test", subject: "Suspicious sign-in blocked", html: "<p>We blocked a sign-in attempt from a new device in Berlin.</p>" },
    { from: '"Auth" <no-reply@auth.test>', to: "security@your-app.test", subject: "Password reset requested", html: "<p>Use the link below to reset your password.</p>" },
    { from: '"Marcus Webb" <marcus@acme.test>', to: "hello@your-app.test", subject: "Partnership enquiry", html: "<p>We'd love to explore an integration between our platforms.</p>" },
    { from: '"Tech Weekly" <editor@techweekly.test>', to: "hello@your-app.test", subject: "Press: a couple of quick questions", html: "<p>Do you have 10 minutes this week for a short interview?</p>" },
    { from: '"Dana Cole" <dana@hooli.test>', to: "sales@your-app.test", subject: "Demo request from Hooli", html: "<p>Interested in a demo for a team of 40.</p>" },
    { from: '"Mailer Daemon" <mailer-daemon@relay.test>', to: "noreply@your-app.test", subject: "Delivery Status Notification (Failure)", html: "<p>Address not found: ghost@nowhere.test</p>" },
];

const primary: SeedMessage[] = [
    { from: '"Acme Receipts" <receipts@acme.test>', to: PRIMARY_INBOX, subject: "Your receipt from Acme Store #10428", html: "<p>Thanks for your order. Total: 42.00.</p>" },
    { from: '"Acme Security" <security@acme.test>', to: PRIMARY_INBOX, subject: "New sign-in from Chrome on macOS", html: "<p>We noticed a new sign-in to your account.</p>" },
    { from: '"Linear" <notifications@linear.test>', to: PRIMARY_INBOX, subject: "3 issues assigned to you this week", html: "<p>You have 3 issues due in the current cycle.</p>" },
    { from: '"GitHub" <noreply@github.test>', to: PRIMARY_INBOX, subject: "[postloop] CI run failed on main", html: "<p>The workflow run for main did not complete successfully.</p>" },
    { from: '"Stripe" <receipts@stripe.test>', to: PRIMARY_INBOX, subject: "Your payment to Globex succeeded", html: "<p>A payment of 99.00 was successful.</p>" },
    { from: '"Figma" <updates@figma.test>', to: PRIMARY_INBOX, subject: "Someone commented on 'Onboarding v3'", html: "<p>Sam left a comment on a frame you follow.</p>" },
    { from: '"Notion" <team@notion.test>', to: PRIMARY_INBOX, subject: "Weekly digest: 12 updates in your workspace", html: "<p>Here's what changed across your teamspaces this week.</p>" },
    { from: '"Vercel" <alerts@vercel.test>', to: PRIMARY_INBOX, subject: "Deployment ready: postloop-web", html: "<p>Your latest deployment is now live in production.</p>" },
    { from: '"Calendly" <no-reply@calendly.test>', to: PRIMARY_INBOX, subject: "New event: 1:1 with Sam, Thursday 3pm", html: "<p>A new event has been scheduled on your calendar.</p>" },
    { from: '"Widgets Support" <help@widgets.test>', to: PRIMARY_INBOX, subject: "Re: Need help with my widget order", html: "<p>Thanks for getting back to us. Your replacement has shipped.</p>" },
];

// Other inboxes first, the primary inbox last so its mail is the newest and it sorts to the top.
export const SEED_MESSAGES: SeedMessage[] = [...otherInboxes, ...primary];
