import { AdminConsole } from '../../../components/AdminConsole';
import { resolveAdminDetailId, resolveAdminModule } from '../../../components/admin-routing';
import { redirect } from 'next/navigation';

export default async function AdminModulePage({
  params,
}: {
  readonly params: Promise<{ readonly segments?: string[] }>;
}) {
  const { segments = ['dashboard'] } = await params;
  if (
    segments.join('/') === 'owner/bookings-rentals' ||
    segments.join('/') === 'owner/users-vehicles'
  )
    redirect('/admin/owner/reports');
  const activeModule = resolveAdminModule(segments);
  const detailId = resolveAdminDetailId(segments, activeModule);
  const vehicleChangeProposalId =
    activeModule === 'vehicles' && segments[1] === 'changes' ? segments[2] : undefined;
  return (
    <AdminConsole
      activeModule={activeModule}
      {...(detailId ? { detailId } : {})}
      {...(vehicleChangeProposalId ? { vehicleChangeProposalId } : {})}
    />
  );
}
