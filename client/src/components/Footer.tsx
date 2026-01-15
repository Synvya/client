import { useState } from "react";
import { PrivacyPolicyDialog } from "@/components/PrivacyPolicyDialog";
import { TermsOfServiceDialog } from "@/components/TermsOfServiceDialog";

export function Footer(): JSX.Element {
  const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const [termsDialogOpen, setTermsDialogOpen] = useState(false);

  return (
    <>
      <footer className="border-t">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <button
              onClick={() => setPrivacyDialogOpen(true)}
              className="transition-colors hover:text-primary"
            >
              Privacy Policy
            </button>
            <button
              onClick={() => setTermsDialogOpen(true)}
              className="transition-colors hover:text-primary"
            >
              Terms of Service
            </button>
            <a
              href="mailto:synvya@synvya.com"
              className="transition-colors hover:text-primary"
            >
              Support
            </a>
          </div>
          <div className="text-sm text-muted-foreground">
            © 2026 Synvya, Inc. All rights reserved.
          </div>
        </div>
      </footer>
      <PrivacyPolicyDialog open={privacyDialogOpen} onOpenChange={setPrivacyDialogOpen} />
      <TermsOfServiceDialog open={termsDialogOpen} onOpenChange={setTermsDialogOpen} />
    </>
  );
}
