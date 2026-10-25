import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ConfirmHost } from "@/components/confirm";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountPage } from "@/features/account/AccountPage";
import { AdminPage } from "@/features/admin/AdminPage";
import { LoginPage } from "@/features/auth/LoginPage";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { SetupLinkPage } from "@/features/auth/SetupLinkPage";
import { FamilyLayout } from "@/features/family/FamilyLayout";
import { FinancePage } from "@/features/finance/FinancePage";
import { Landing } from "@/features/landing/Landing";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { VacationPage } from "@/features/vacation/VacationPage";

export function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup/:token" element={<SetupLinkPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Landing />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/admin/:tab?" element={<AdminPage />} />
            <Route path="/f/:token" element={<FamilyLayout />}>
              <Route index element={<Navigate to="vacation" replace />} />
              <Route path="vacation" element={<VacationPage />} />
              <Route path="finance" element={<FinancePage />} />
              <Route path="settings/:section?" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="vacation" replace />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-center" />
      <ConfirmHost />
    </TooltipProvider>
  );
}
