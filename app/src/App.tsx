import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ConfirmHost } from "@/components/confirm";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FamilyLayout } from "@/features/family/FamilyLayout";
import { Landing } from "@/features/landing/Landing";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { VacationPage } from "@/features/vacation/VacationPage";

export function App() {
  return (
    <TooltipProvider delayDuration={300}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/f/:token" element={<FamilyLayout />}>
            <Route index element={<Navigate to="vacation" replace />} />
            <Route path="vacation" element={<VacationPage />} />
            <Route path="settings/:section?" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="vacation" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-center" />
      <ConfirmHost />
    </TooltipProvider>
  );
}
