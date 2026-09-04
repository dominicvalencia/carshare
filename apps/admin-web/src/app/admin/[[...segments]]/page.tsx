import { AdminConsole } from '../../../components/AdminConsole';
import { resolveAdminDetailId, resolveAdminModule } from '../../../components/admin-routing';

export default async function AdminModulePage({
  params,
}: {
  readonly params: Promise<{ readonly segments?: string[] }>;
}) {
  const { segments = ['dashboard'] } = await params;
  const activeModule = resolveAdminModule(segments);
  const detailId = resolveAdminDetailId(segments, activeModule);
  return <AdminConsole activeModule={activeModule} {...(detailId ? { detailId } : {})} />;
}
