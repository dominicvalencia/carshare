import { Suspense } from 'react';
import { StaffInvitationActivation } from '../../components/StaffInvitationActivation';

export default function StaffInvitationPage() {
  return (
    <Suspense fallback={<main className="admin-login-page">Loading invitation…</main>}>
      <StaffInvitationActivation />
    </Suspense>
  );
}
