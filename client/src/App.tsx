import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { OnboardingGate } from "@/components/OnboardingGate";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ProfilePage } from "@/pages/Profile";
import { SettingsPage } from "@/pages/Settings";
import { ReservationsPage } from "@/pages/Reservations";
import { TestHarnessPage } from "@/pages/TestHarness";
import { LandingPage } from "@/pages/Landing";
import { SquareCallbackPage } from "@/pages/SquareCallback";
import { MenuPage } from "@/pages/Menu";
import { AnalyticsPage } from "@/pages/Dashboard";
import { ChatGptMerchantPage } from "@/pages/ChatGptMerchant";

function ProtectedApp(): JSX.Element {
  return (
    <OnboardingGate>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1 bg-muted/30">
          <Outlet />
        </main>
        <Footer />
      </div>
    </OnboardingGate>
  );
}

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/square/callback" element={<SquareCallbackPage />} />
      <Route path="/app" element={<ProtectedApp />}>
        <Route index element={<Navigate to="profile" replace />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="reservations" element={<ReservationsPage />} />
        <Route path="dashboard" element={<AnalyticsPage />} />
        <Route path="chatgpt-merchant" element={<ChatGptMerchantPage />} />
        {/* WebsiteData page merged into Account - redirect for bookmarks */}
        <Route path="website" element={<Navigate to="/app/settings" replace />} />
        <Route path="website-data" element={<Navigate to="/app/settings" replace />} />
        {import.meta.env.DEV && (
          <Route path="test-harness" element={<TestHarnessPage />} />
        )}
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="profile" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
