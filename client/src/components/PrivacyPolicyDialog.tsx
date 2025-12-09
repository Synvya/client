import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PrivacyPolicyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrivacyPolicyDialog({
  open,
  onOpenChange,
}: PrivacyPolicyDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Privacy Policy</DialogTitle>
          <p className="text-sm text-muted-foreground">Last updated: December 9th, 2025</p>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Synvya, Inc. d/b/a DineDirect (&quot;<strong>Synvya</strong>,&quot; &quot;<strong>we</strong>,&quot; &quot;<strong>our</strong>,&quot; or &quot;<strong>us</strong>&quot;) respects your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard information when you use the <strong>DineDirect</strong> service (the &quot;<strong>Service</strong>&quot;). This Privacy Policy does <strong>not</strong> cover the public website located at <strong>https://www.dinedirect.app</strong> (the &quot;<strong>Website</strong>&quot;). The Website is governed by a separate privacy policy available at <strong>https://www.dinedirect.app</strong>.
          </p>
          <p className="text-muted-foreground">
            If you are a visitor to the Website but do not use the Service, please refer only to the Website privacy policy. If you are a business owner using the service at https://account.dinedirect.app, this Privacy Policy applies to your use of the Service.
          </p>

          <section>
            <h3 className="font-semibold mb-2">1. Information We Collect</h3>
            
            <h4 className="font-semibold mb-2 mt-3">1.1 Information You Provide Directly</h4>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-semibold">Category</th>
                    <th className="text-left p-2 font-semibold">Examples</th>
                    <th className="text-left p-2 font-semibold">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="p-2">Account Information</td>
                    <td className="p-2">Company name, billing address, email address, password or OAuth credentials</td>
                    <td className="p-2">To create and administer your DineDirect account</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Customer Support</td>
                    <td className="p-2">Content of emails, chat messages, or support tickets you send to us</td>
                    <td className="p-2">To resolve issues and improve the Service</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h4 className="font-semibold mb-2 mt-3">1.2 Information We Retrieve from Square</h4>
            <p className="text-muted-foreground mb-2">
              When you authorize the Service via Square OAuth with scopes <code className="bg-muted px-1 rounded">MERCHANT_PROFILE_READ</code> and <code className="bg-muted px-1 rounded">ITEMS_READ</code>, we collect <strong>read‑only</strong> copies of:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
              <li><strong>Merchant Profile</strong> – name, location, profile image, email address</li>
              <li><strong>Items Library</strong> – item names, descriptions, images, prices, taxes, and discounts</li>
            </ul>

            <h4 className="font-semibold mb-2 mt-3">1.3 Automatically Collected Information</h4>
            <p className="text-muted-foreground mb-2">
              When you access the Service dashboard (not the public Website), we automatically collect:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
              <li><strong>Log data</strong> (IP address, browser type, referring URL, timestamps)</li>
              <li><strong>Device information</strong> (operating system, device type)</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              We do <strong>not</strong> perform cross‑site tracking or behavioral advertising within the Service.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">2. How We Use Information</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-semibold">Purpose</th>
                    <th className="text-left p-2 font-semibold">Legal Basis*</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="p-2">Provide, operate, and maintain the Service</td>
                    <td className="p-2">Contract performance</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Authenticate Square OAuth sessions and display Merchant Data</td>
                    <td className="p-2">Contract performance</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Publish Merchant Data to the Nostr network <strong>only when you click a Publish Action</strong></td>
                    <td className="p-2">Your explicit consent</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Communicate with you about updates, security alerts, and administrative issues</td>
                    <td className="p-2">Legitimate interest</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Improve and develop the Service, including aggregated analytics</td>
                    <td className="p-2">Legitimate interest</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Detect, prevent, and address technical issues, fraud, or misuse</td>
                    <td className="p-2">Legitimate interest / legal obligation</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground text-xs mt-2">
              *Under the EU General Data Protection Regulation (&quot;GDPR&quot;), where applicable.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">3. How We Share Information</h3>
            <p className="text-muted-foreground mb-2">
              We do <strong>not</strong> sell or rent your information. We share information only:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-4">
              <li><strong>With service providers</strong> that process data on our behalf (e.g., cloud hosting, log management) under strict confidentiality obligations;</li>
              <li><strong>When you instruct us to publish Merchant Data to Nostr</strong> – once broadcast, the data becomes publicly accessible and may be replicated by anyone;</li>
              <li><strong>To comply with legal requests</strong> (e.g., subpoena, court order) or to protect rights, property, or safety;</li>
              <li><strong>In connection with a business transfer</strong> (e.g., merger, acquisition) following notice to you and subject to protections at least as strong as this Policy.</li>
            </ol>
          </section>

          <section>
            <h3 className="font-semibold mb-2">4. Data Security</h3>
            <p className="text-muted-foreground mb-2">
              We use industry‑standard administrative, technical, and physical safeguards, including:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
              <li>TLS encryption in transit</li>
              <li>AES‑256 encryption at rest for Square OAuth tokens and database backups</li>
              <li>Principle‑of‑least‑privilege access controls and logging</li>
              <li>Regular vulnerability scanning and penetration testing</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              No method of transmission over the Internet or storage system is 100% secure; therefore we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">5. Data Retention</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-semibold">Data Category</th>
                    <th className="text-left p-2 font-semibold">Retention Period</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="p-2">Square OAuth tokens</td>
                    <td className="p-2">Until you disconnect the app in Square <strong>or</strong> 90 days of inactivity, whichever comes first</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Merchant Data (cached copies)</td>
                    <td className="p-2">24 hours after retrieval, unless earlier deleted upon your request</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Support communications</td>
                    <td className="p-2">3 years</td>
                  </tr>
                  <tr className="border-b">
                    <td className="p-2">Audit logs</td>
                    <td className="p-2">1 year</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground mt-2">
              Content published to Nostr is <strong>immutable and cannot be fully deleted</strong> once broadcast. Revoking Square access does not remove data already on Nostr.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">6. Your Choices & Rights</h3>
            <ul className="list-disc list-inside space-y-2 text-muted-foreground ml-4">
              <li><strong>Disconnect Square integration</strong> – Automatically disconnected 90 days after the initial connection.</li>
              <li><strong>Control publication</strong> – Merchant Data is published to Nostr <strong>only</strong> when you trigger a Publish Action. Do not initiate a Publish Action if you do not want data to become public.</li>
              <li><strong>Access & correction</strong> – You may request a copy of Merchant Data we hold or ask us to correct inaccuracies.</li>
              <li><strong>Deletion</strong> – You may request deletion of data we store, subject to legal obligations and the irreversibility of Nostr broadcasts.</li>
              <li><strong>GDPR & CCPA</strong> – Where applicable, you have additional rights (data portability, restriction of processing, objection, opt‑out of &quot;sale&quot; as defined by CCPA, etc.). Email synvya@synvya.com to exercise rights.</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              We respond to verifiable requests within 30 days (or as required by law).
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">7. International Transfers</h3>
            <p className="text-muted-foreground">
              Synvya Inc is headquartered in the United States. By using the Service, you acknowledge that your information may be transferred to, stored, and processed in the U.S. or other jurisdictions where our service providers operate. We rely on standard contractual clauses or other approved mechanisms for such transfers when required by law.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">8. Children&apos;s Privacy</h3>
            <p className="text-muted-foreground">
              The Service is not directed to children under 13, and we do not knowingly collect personal information from children. If we learn we have collected such information, we will promptly delete it.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">9. Changes to This Privacy Policy</h3>
            <p className="text-muted-foreground">
              We may update this Policy from time to time. Material changes will be announced via email or in‑app notification <strong>30 days</strong> before they take effect. Continued use of the Service after the effective date constitutes acceptance of the revised Policy.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">10. Contact Us</h3>
            <p className="text-muted-foreground mb-2">
              For privacy questions or requests, contact:
            </p>
            <div className="border-l-4 border-muted pl-4 my-2">
              <p className="text-muted-foreground">
                <strong>Privacy Team – Synvya, Inc. d/b/a DineDirect</strong><br />
                9209 Jacobia Ave SE.,<br />
                Snoqualmie, WA 98065<br />
                <strong>Email:</strong> privacy@dinedirect.app
              </p>
            </div>
          </section>

          <p className="text-muted-foreground text-xs mt-4">
            © 2025 Synvya, Inc. d/b/a DineDirect All rights reserved.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

