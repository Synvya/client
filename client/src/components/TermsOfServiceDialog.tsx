import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TermsOfServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TermsOfServiceDialog({
  open,
  onOpenChange,
}: TermsOfServiceDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Terms of Service</DialogTitle>
          <p className="text-sm text-muted-foreground">Last updated: December 9th, 2025</p>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            These Terms of Service (&quot;<strong>Terms</strong>&quot;) are a legally binding agreement between you (&quot;<strong>Merchant</strong>,&quot; &quot;<strong>you</strong>&quot;) and Synvya, Inc. (&quot;<strong>Synvya</strong>,&quot; &quot;<strong>we</strong>,&quot; or &quot;<strong>us</strong>&quot;). By subscribing to, or using the Synvya service (the &quot;<strong>Service</strong>&quot;) and by authorizing the Service to publish information to the Nostr network, you acknowledge that you have read, understood, and agree to be bound by these Terms. If you do not agree, you must not use the Service.
          </p>
          <p className="text-muted-foreground">
            These Terms do <strong>not</strong> cover the public website located at <strong>https://www.synvya.com</strong> (the &quot;<strong>Website</strong>&quot;). The Website is governed by separate Terms of Use available at https://www.synvya.com.
          </p>

          <section>
            <h3 className="font-semibold mb-2">Service Overview</h3>
            <p className="text-muted-foreground">
              Synvya provides an integration to AI assistants through the Nostr network to —only when you expressly direct us to do so—publish your Business Data (business name, address, contact details, products, services, prices, etc.) to the open, decentralized Nostr protocol (&quot;<strong>Nostr</strong>&quot;).
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Eligibility & Merchant Responsibilities</h3>
            <p className="text-muted-foreground mb-2">You represent and warrant that:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-4">
              <li>You are at least 18 years old and have authority to bind the business entity on whose behalf you use the Service.</li>
              <li>You own or have obtained all necessary rights in the Business Data and any intellectual-property elements contained therein.</li>
              <li>Your use of the Service, and the publication of Business Data on Nostr, will not violate any applicable law, regulation, contractual obligation, or third-party right.</li>
            </ol>
            <p className="text-muted-foreground mt-2">
              You are solely responsible for the accuracy, completeness, and legality of the Business Data you provide or authorize Synvya to retrieve and publish.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Publication to Nostr & Irrevocability</h3>
            <p className="text-muted-foreground mb-2">
              The Service provides buttons or other UI elements (each, a &quot;<strong>Publish Action</strong>&quot;) that allow you to instruct Synvya to publish:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground ml-4">
              <li>Business Data, and/or</li>
              <li>Product and services information</li>
            </ol>
            <p className="text-muted-foreground mt-2 mb-2">to Nostr. By performing a Publish Action, you:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
              <li>Direct Synvya, acting as your agent, to broadcast the selected Business Data to Nostr;</li>
              <li>Grant Synvya a non-exclusive, worldwide, royalty-free, sublicensable license to copy, transmit, and display that data as required to complete your Publish Action;</li>
              <li>Acknowledge that data on Nostr is public, decentralized, and cannot be fully deleted or recalled once broadcast.</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              Synvya bears no responsibility for any third-party access, use, or republication of Business Data once it is published to Nostr or any modification of the Business Data by a third-party Nostr app authorized by you through your Nostr private key.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Data Security & Privacy</h3>
            <p className="text-muted-foreground mb-2">
              Synvya employs industry-standard measures (including encryption in transit and at rest, minimum-necessary data retention, and access logging) to safeguard data under our control. We process Business Data solely:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-4">
              <li>To render it within the Service&apos;s dashboards; and</li>
              <li>To publish it to Nostr when you perform a Publish Action.</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              Synvya does not store, sell, rent, or otherwise disclose Business Data to third parties except as described in these Terms or as required by law.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Intellectual Property</h3>
            <p className="text-muted-foreground">
              Except for Business Data, all software, documentation, trademarks, logos, and other materials comprising the Service are the property of Synvya or its licensors and are protected by intellectual-property laws. You receive only the limited rights expressly granted in these Terms.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Warranty Disclaimer</h3>
            <p className="text-muted-foreground">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE.&quot; TO THE MAXIMUM EXTENT PERMITTED BY LAW, SYNVYA DISCLAIMS ALL WARRANTIES—EXPRESS, IMPLIED, OR STATUTORY—INCLUDING ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. SYNVYA DOES NOT WARRANT THAT THE SERVICE WILL BE ERROR-FREE, UNINTERRUPTED, OR THAT BUSINESS DATA PUBLISHED TO NOSTR WILL BE ACCURATE OR CURRENT.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Limitation of Liability</h3>
            <p className="text-muted-foreground">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL SYNVYA, ITS AFFILIATES, DIRECTORS, OFFICERS, EMPLOYEES, AGENTS, OR LICENSORS BE LIABLE TO YOU OR ANY THIRD PARTY FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, PUNITIVE, OR EXEMPLARY DAMAGES (INCLUDING LOST PROFITS, LOST REVENUE, OR LOSS OF DATA) ARISING OUT OF OR IN CONNECTION WITH THE SERVICE, WHETHER BASED ON CONTRACT, TORT, STRICT LIABILITY, OR OTHERWISE, EVEN IF SYNVYA HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. SYNVYA&apos;S TOTAL CUMULATIVE LIABILITY UNDER THESE TERMS WILL NOT EXCEED THE GREATER OF (A) THE FEES YOU HAVE PAID TO SYNVYA (IF ANY) DURING THE 12 MONTHS PRECEDING THE CLAIM AND (B) ONE HUNDRED U.S. DOLLARS (US $100).
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Indemnification</h3>
            <p className="text-muted-foreground">
              You agree to indemnify, defend, and hold harmless Synvya and its affiliates, directors, officers, employees, and agents from and against any claims, damages, liabilities, costs, and expenses (including reasonable attorneys&apos; fees) arising out of or related to: (a) your Business Data; (b) your breach of these Terms; or (c) your use of the Service in violation of applicable law or the rights of any third party.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Suspension & Termination</h3>
            <p className="text-muted-foreground">
              Synvya may suspend or terminate your access to the Service at any time, with or without notice, if we reasonably believe you have violated these Terms or if required by law. Upon termination, Section Publication to Nostr & Irrevocability, Section Warranty Disclaimer, Section Limitation of Liability, Section Indemnification, Section Governing Law, and Section Dispute Resolution will survive.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Governing Law</h3>
            <p className="text-muted-foreground">
              These Terms will be governed by and construed in accordance with the laws of the State of Washington, U.S.A., without regard to conflict-of-law provisions. The United Nations Convention on Contracts for the International Sale of Goods does not apply.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Dispute Resolution; Venue</h3>
            <p className="text-muted-foreground">
              Any dispute, claim, or controversy arising out of or relating to these Terms or the Service that cannot be resolved informally will be submitted to binding arbitration under the Commercial Arbitration Rules of the American Arbitration Association. The arbitration will be conducted in Bellevue, Washington, in English, by a single arbitrator. Judgment on the arbitration award may be entered in any court having jurisdiction. Either party may seek injunctive relief in a court of competent jurisdiction to prevent actual or threatened infringement, misappropriation, or violation of intellectual-property rights.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Modifications to Terms</h3>
            <p className="text-muted-foreground">
              Synvya may amend these Terms from time to time. Material changes will become effective 30 days after we post the revised Terms on our website or notify you via email. Your continued use of the Service after the effective date constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Changes to the Service</h3>
            <p className="text-muted-foreground">
              We reserve the right to modify, suspend, or discontinue the Service (in whole or in part) at any time without liability to you. Where feasible, we will provide advance notice of material changes.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Entire Agreement</h3>
            <p className="text-muted-foreground">
              These Terms constitute the entire agreement between you and Synvya regarding the Service and supersede any prior agreements or understandings. If any provision of these Terms is held unenforceable, the remaining provisions will remain in full force and effect.
            </p>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Contact Information</h3>
            <p className="text-muted-foreground">
              For questions about these Terms or the Service, please contact Synvya at:
            </p>
            <p className="text-muted-foreground mt-2">
              <strong>Synvya, Inc.</strong><br />
              9209 Jacobia Ave SE<br />
              Snoqualmie, WA 98065<br />
              Email: legal@synvya.com
            </p>
          </section>

          <p className="text-muted-foreground text-xs mt-4">
            © 2025 Synvya, Inc. All rights reserved.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

